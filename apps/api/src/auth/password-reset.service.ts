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
import { passwordProblem } from './registration.service';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { AuditAction } from '@bioassetpro/database';
import type { WorkflowActor } from '../workflow/workflow.types';

/** How long a reset link stays usable — short, because unlike an invitation it grants access to an EXISTING account. */
const VALID_FOR_HOURS = 1;

/**
 * Recovering an account whose password was forgotten.
 *
 * See `PasswordResetToken`'s own schema comment for why this cannot be the
 * ordinary self-service "type your email, get a link" flow: there is no mail
 * transport in this product, and — the more fundamental reason — a person
 * who forgot their password cannot sign in to request anything for
 * themselves anyway. So this mirrors `InvitationService` almost exactly: an
 * administrator generates a link and relays it by whatever channel actually
 * reaches the person, the same honest workaround already accepted for
 * inviting people onto a farm.
 *
 * One deliberate difference from invitations, roles-editing and
 * deactivation: this does NOT refuse acting on your own account. Those
 * refuse self-service because self-service there is a privilege-escalation
 * or lockout risk; here self-service is the ordinary case for a solo owner
 * who still has a session open somewhere and wants to set a fresh password
 * as a precaution. It is only reachable from an already-authenticated
 * session either way — someone actually locked out still needs another
 * admin to act for them, which this product cannot solve without a mail
 * transport, and does not pretend to.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Create a reset link and return the raw token ONCE — same discipline as `InvitationService.invite()`. */
  async initiate(params: {
    companyId: string;
    actor: WorkflowActor;
    userId: string;
  }): Promise<{ token: string; email: string; expiresAt: Date }> {
    const user = await this.prisma.user.findFirst({
      where: { id: params.userId, companyId: params.companyId },
    });
    if (!user) throw new NotFoundException('No such person on this farm.');

    // Same authority check invitations use for editing/deactivating someone
    // — a Farm Manager should not be able to force a CFO's password to
    // reset — except self is always allowed, per this method's own note.
    if (params.userId !== params.actor.userId) {
      this.assertCanAct(params.actor.roles ?? [], user.roles);
    }

    // A previous outstanding link for the same person is superseded, not left
    // alongside — same rule `InvitationService.invite()` applies to a repeat
    // invite, so two live credentials never exist for one account.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALID_FOR_HOURS * 60 * 60 * 1000);

    const created = await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        createdById: params.actor.userId,
        expiresAt,
      },
    });

    await this.audit.write({
      transactionId: created.id,
      module: 'AUTH',
      entityType: 'User',
      entityId: user.id,
      status: 'PENDING',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Password reset link generated for ${user.email}`,
    });

    return { token, email: user.email, expiresAt };
  }

  /** What the person following the link should be shown before they commit. */
  async describe(token: string): Promise<{ email: string }> {
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { email: true } } },
    });
    if (!reset) throw new NotFoundException('This link is not valid.');
    this.assertUsable(reset);
    return { email: reset.user.email };
  }

  /** Set the new password and sign them straight in — same reasoning as `InvitationService.accept()`. */
  async complete(params: {
    token: string;
    password: string;
  }): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const problem = passwordProblem(params.password);
    if (problem) throw new BadRequestException(problem);

    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(params.token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!reset) throw new NotFoundException('This link is not valid.');
    this.assertUsable(reset);

    const passwordHash = await hashPassword(params.password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });

      // Marked used in the same transaction the password actually changes in,
      // so a token can never be spent twice by two simultaneous requests.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This link has already been used.');
      }

      await this.audit.write(
        {
          transactionId: reset.id,
          module: 'AUTH',
          entityType: 'User',
          entityId: reset.userId,
          status: 'UPDATED',
          action: AuditAction.UPDATE,
          userId: reset.userId,
          comments: 'Password reset via link',
        },
        tx,
      );
    });

    return this.auth.login(reset.user.email, params.password);
  }

  /** Same top-tier authority guard `InvitationService` uses — see its own comment for the reasoning. */
  private static readonly TOP_TIER = ['ADMINISTRATOR', 'CFO'];

  private assertCanAct(actorRoles: readonly string[], targetRoles: readonly string[]): void {
    if (actorRoles.includes('ADMINISTRATOR')) return;
    const outranks = PasswordResetService.TOP_TIER.filter(
      (role) => targetRoles.includes(role) && !actorRoles.includes(role),
    );
    if (outranks.length > 0) {
      throw new ForbiddenException('You cannot act on an account with more authority than your own.');
    }
  }

  private assertUsable(reset: {
    usedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): void {
    if (reset.usedAt) throw new ConflictException('This link has already been used.');
    if (reset.revokedAt) {
      throw new NotFoundException('This link was replaced by a newer one. Ask for a fresh link.');
    }
    if (reset.expiresAt < new Date()) {
      throw new NotFoundException('This link has expired. Ask for a new one — links last one hour.');
    }
  }
}

/** The stored form of a token. Never reversible, only comparable. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
