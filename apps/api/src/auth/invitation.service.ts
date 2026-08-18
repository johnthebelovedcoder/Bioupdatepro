import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from './password';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { passwordProblem } from './registration.service';
import { AuditAction } from '@bioassetpro/database';
import type { WorkflowActor } from '../workflow/workflow.types';

/** How long an invitation stays usable. */
const VALID_FOR_DAYS = 14;

/**
 * Adding somebody to a farm that already exists.
 *
 * Registration creates a company; this puts people INSIDE one. Without it every
 * worker needing an account would sign up as an owner and land in a farm of
 * one, staring at an empty dashboard wondering where the birds went.
 *
 * Three things this is careful about:
 *
 *   1. THE TOKEN IS A CREDENTIAL. For fourteen days it is enough on its own to
 *      join a company and act inside it, so it is stored hashed and the raw
 *      value exists only in the link handed to the person. A leaked backup of
 *      this table is useless.
 *
 *   2. YOU CANNOT INVITE SOMEBODY ABOVE YOURSELF. The roles offered are bounded
 *      by the inviter's own, or a farm manager could mint an administrator and
 *      quietly promote themselves through a second account.
 *
 *   3. IT NAMES THE COMPANY, NOT THE CALLER. Accepting resolves the company
 *      from the invitation record, never from anything the accepting request
 *      says — otherwise a valid token for one farm could be redirected into
 *      another.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Create an invitation and return the raw token ONCE.
   *
   * The caller is responsible for delivering it. There is no mail transport in
   * this product yet, so the link is handed back to the inviter to send by
   * whatever they actually use — which on a Nigerian farm is WhatsApp, not
   * email. That is not a workaround; it is how the message will reach the
   * person fastest.
   */
  async invite(params: {
    companyId: string;
    actor: WorkflowActor;
    email: string;
    roles: string[];
  }): Promise<{ id: string; email: string; token: string; expiresAt: Date }> {
    const email = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new BadRequestException('That email address does not look right.');
    }

    const roles = [...new Set(params.roles.filter(Boolean))];
    if (roles.length === 0) {
      throw new BadRequestException('Choose what this person will be allowed to do.');
    }

    /*
     * Nobody may hand out authority they do not hold. An administrator is
     * exempt because they already have every role there is to give.
     */
    const inviter = params.actor.roles ?? [];
    if (!inviter.includes('ADMINISTRATOR')) {
      const beyond = roles.filter((role) => !inviter.includes(role));
      if (beyond.length > 0) {
        throw new ForbiddenException(
          `You cannot give someone a role you do not have yourself: ${beyond.join(', ')}.`,
        );
      }
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(
        existing.companyId === params.companyId
          ? 'That person is already on this farm.'
          : 'That email already has an account.',
      );
    }

    // A previous outstanding invitation to the same person is superseded rather
    // than left alongside, so two live links never exist for one address.
    await this.prisma.invitation.updateMany({
      where: { companyId: params.companyId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALID_FOR_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.invitation.create({
      data: {
        companyId: params.companyId,
        email,
        roles,
        tokenHash: hashToken(token),
        invitedById: params.actor.userId,
        expiresAt,
      },
    });

    await this.audit.write({
      transactionId: invitation.id,
      module: 'AUTH',
      entityType: 'Invitation',
      entityId: invitation.id,
      status: 'PENDING',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Invited ${email} as ${roles.join(', ')}`,
    });

    return { id: invitation.id, email, token, expiresAt };
  }

  /** What the person following the link should be shown before they commit. */
  async describe(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        company: { select: { name: true } },
        invitedBy: { select: { fullName: true } },
      },
    });

    if (!invitation) throw new NotFoundException('This invitation is not valid.');
    this.assertUsable(invitation);

    return {
      email: invitation.email,
      farmName: invitation.company.name,
      invitedBy: invitation.invitedBy.fullName,
      roles: invitation.roles,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept: create the user inside the inviting company and sign them in.
   *
   * The email comes from the INVITATION, not from the form. Letting the person
   * choose it would turn a link addressed to one worker into an account for
   * anybody who got hold of it.
   */
  async accept(params: {
    token: string;
    fullName: string;
    password: string;
  }): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const fullName = params.fullName.trim();
    if (!fullName) throw new BadRequestException('Enter your name.');

    const problem = passwordProblem(params.password);
    if (problem) throw new BadRequestException(problem);

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(params.token) },
    });
    if (!invitation) throw new NotFoundException('This invitation is not valid.');
    this.assertUsable(invitation);

    const taken = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (taken) throw new ConflictException('That email already has an account. Try signing in.');

    const passwordHash = await hashPassword(params.password);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          fullName,
          passwordHash,
          companyId: invitation.companyId,
          roles: invitation.roles,
        },
      });

      // Marked accepted in the same transaction as the user is created, so a
      // token can never be spent twice by two simultaneous requests.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date(), acceptedUserId: user.id },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This invitation has already been used.');
      }

      await this.audit.write(
        {
          transactionId: invitation.id,
          module: 'AUTH',
          entityType: 'Invitation',
          entityId: invitation.id,
          status: 'ACCEPTED',
          action: AuditAction.UPDATE,
          userId: user.id,
          comments: `${invitation.email} joined as ${invitation.roles.join(', ')}`,
        },
        tx,
      );
    });

    return this.auth.login(invitation.email, params.password);
  }

  /** Outstanding invitations, so somebody can see who has been asked. */
  async list(companyId: string) {
    const rows = await this.prisma.invitation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { invitedBy: { select: { fullName: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      roles: row.roles,
      invitedBy: row.invitedBy.fullName,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.acceptedAt
        ? 'ACCEPTED'
        : row.revokedAt
          ? 'REVOKED'
          : row.expiresAt < new Date()
            ? 'EXPIRED'
            : 'PENDING',
    }));
  }

  async revoke(params: { companyId: string; id: string; actor: WorkflowActor }) {
    const done = await this.prisma.invitation.updateMany({
      // Scoped to the company: an id from another farm must not be revocable.
      where: { id: params.id, companyId: params.companyId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (done.count === 0) {
      throw new NotFoundException('No invitation to withdraw.');
    }
    return { revoked: true };
  }

  private assertUsable(invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): void {
    if (invitation.acceptedAt) {
      throw new ConflictException('This invitation has already been used.');
    }
    if (invitation.revokedAt) {
      throw new NotFoundException('This invitation was withdrawn.');
    }
    if (invitation.expiresAt < new Date()) {
      throw new NotFoundException('This invitation has expired. Ask for a new one.');
    }
  }
}

/** The stored form of a token. Never reversible, only comparable. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
