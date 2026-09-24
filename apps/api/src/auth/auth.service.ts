import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/retry';
import { verifyPassword } from './password';

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
}

/** However active a session is, the password is asked for again after this. */
export const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
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
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.fullName,
      roles: user.roles,
      authAt: Math.floor(Date.now() / 1000),
    };

    return { accessToken: await this.jwt.signAsync(payload), user: authenticated };
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
  async resolve(userId: string): Promise<AuthenticatedUser> {
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
    };
  }
}
