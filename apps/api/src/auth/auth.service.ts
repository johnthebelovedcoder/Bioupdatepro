import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/retry';
import { verifyPassword } from './password';
import { MfaService } from './mfa.service';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  roles: string[];
  /**
   * The tenant this request may see. Null for a user with no company, which
   * resolves to no company-scoped data rather than to all of it.
   *
   * Deliberately absent from the JWT payload below. A token is a bearer
   * artefact that outlives the state it was minted from, and a user moved
   * between companies must not keep reading the old one until their token
   * expires. It is read from the database on every request instead.
   */
  companyId: string | null;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  mfaSetupOnly?: boolean;
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  /**
   * When the person actually signed in, in epoch seconds. Carried unchanged
   * through every refresh, so an active session keeps renewing but never
   * outlives MAX_SESSION_SECONDS from the password that started it.
   */
  authAt?: number;
  iat?: number;
  purpose?: 'MFA_LOGIN';
  jti?: string;
  mfaSetupOnly?: boolean;
}

export type AuthLoginResult =
  | { accessToken: string; user: AuthenticatedUser; mfaSetupRequired?: true }
  | { mfaRequired: true; challengeToken: string };

/** However active a session is, the password is asked for again after this. */
export const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<AuthLoginResult> {
    const user = await withDbRetry(() =>
      this.prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      }),
    );

    // One message for every failure. Distinguishing "no such user" from "wrong
    // password" tells an attacker which emails are real.
    const failure = new UnauthorizedException('Email or password is incorrect.');
    if (!user) {
      // Still spend the time, so a missing user is not measurably faster.
      await verifyPassword(password, 'scrypt$00$00');
      throw failure;
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw failure;

    // A deactivated user keeps their history but cannot act. Checked after the
    // password so the response does not reveal that the account exists.
    if (!user.active) {
      throw new UnauthorizedException('This account is deactivated.');
    }

    const authenticated: AuthenticatedUser = {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles,
      companyId: user.companyId,
      mfaRequired: this.mfa.requiredFor(user.roles),
      mfaEnabled: Boolean(user.mfaEnabledAt && user.mfaSecret),
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.fullName,
      roles: user.roles,
      authAt: Math.floor(Date.now() / 1000),
    };

    if (authenticated.mfaRequired && !authenticated.mfaEnabled) {
      return {
        accessToken: await this.jwt.signAsync({ ...payload, mfaSetupOnly: true }, { expiresIn: '10m' }),
        user: { ...authenticated, mfaSetupOnly: true },
        mfaSetupRequired: true as const,
      };
    }
    if (authenticated.mfaRequired) {
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      const challenge = await this.prisma.mfaLoginChallenge.create({
        data: { userId: user.id, expiresAt },
        select: { id: true },
      });
      await this.prisma.mfaLoginChallenge.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
      });
      return {
        mfaRequired: true as const,
        challengeToken: await this.jwt.signAsync(
          { sub: user.id, authAt: payload.authAt, purpose: 'MFA_LOGIN', jti: challenge.id },
          { expiresIn: '5m' },
        ),
      };
    }
    return { accessToken: await this.jwt.signAsync(payload), user: authenticated };
  }

  async verifyMfaLogin(challengeToken: string, code: string) {
    let challenge: JwtPayload;
    try {
      challenge = await this.jwt.verifyAsync<JwtPayload>(challengeToken);
    } catch {
      throw new UnauthorizedException('This MFA challenge has expired. Sign in again.');
    }
    if (challenge.purpose !== 'MFA_LOGIN' || !challenge.sub || !challenge.authAt || !challenge.jti) {
      throw new UnauthorizedException('This MFA challenge is not valid. Sign in again.');
    }
    const activeChallenge = await this.prisma.mfaLoginChallenge.findFirst({
      where: { id: challenge.jti, userId: challenge.sub, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!activeChallenge) throw new UnauthorizedException('This MFA challenge has already been used or has expired.');
    if (!(await this.mfa.verifyLogin(challenge.sub, code))) {
      throw new UnauthorizedException('That authenticator or recovery code is not valid.');
    }
    const consumed = await this.prisma.mfaLoginChallenge.updateMany({
      where: { id: activeChallenge.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException('This MFA challenge has already been used. Sign in again.');
    }
    const user = await this.resolve(challenge.sub);
    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      name: user.fullName,
      roles: user.roles,
      authAt: challenge.authAt,
    };
    return { accessToken: await this.jwt.signAsync(payload), user };
  }

  /**
   * A fresh token for someone still working, so a session ends when they stop
   * using the site rather than twelve hours after they happened to sign in —
   * which cut people off mid-task. The token presented has already been
   * verified by the guard; its user is re-read (roles and name are current),
   * and its original sign-in time is kept, so no chain of refreshes can stretch
   * a session past MAX_SESSION_SECONDS.
   */
  async refresh(token: string): Promise<{ accessToken: string }> {
    const presented = this.jwt.decode<JwtPayload>(token);
    if (presented?.purpose || presented?.mfaSetupOnly) {
      throw new UnauthorizedException('Complete MFA setup or verification before renewing this session.');
    }
    const authAt = presented?.authAt ?? presented?.iat;
    if (!presented?.sub || !authAt) throw new UnauthorizedException('Session is no longer valid.');
    if (Math.floor(Date.now() / 1000) - authAt > MAX_SESSION_SECONDS) {
      throw new UnauthorizedException('Please sign in again — a session lasts at most seven days.');
    }
    const user = await this.resolve(presented.sub);
    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      name: user.fullName,
      roles: user.roles,
      authAt,
    };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  /**
   * Re-read the user on every request rather than trusting the token's copy of
   * the roles. A token issued before someone was moved off the approver role
   * must not keep approving with it — approval authority is exactly the thing
   * that cannot go stale. The same argument applies to the company: it decides
   * which tenant's data the request can reach.
   */
  async resolve(userId: string, mfaSetupOnly = false): Promise<AuthenticatedUser> {
    const user = await withDbRetry(() => this.prisma.user.findUnique({ where: { id: userId } }));
    if (!user || !user.active) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles,
      companyId: user.companyId,
      mfaRequired: this.mfa.requiredFor(user.roles),
      mfaEnabled: Boolean(user.mfaEnabledAt && user.mfaSecret),
      ...(mfaSetupOnly ? { mfaSetupOnly: true } : {}),
    };
  }
}
