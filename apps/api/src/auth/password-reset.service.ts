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
import { EmailService } from './email.service';
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
 * Two paths generate the same kind of link:
 *
 *   1. Self-service (`requestForSelf`) — the person types their own email
 *      and, if `EmailService` is configured, gets a real message. This is
 *      the ordinary "forgot password" flow, and only exists because real
 *      email delivery does now: earlier there was nowhere for the link to
 *      go, since the one person who could use a self-service form is
 *      exactly the person who, by definition, cannot sign in to request
 *      anything else for themselves.
 *   2. Admin-relayed (`initiate`) — the same mechanism `InvitationService`
 *      already uses: an administrator generates a link for someone else and
 *      hands it over directly. Kept even with email working, for the same
 *      reason a support desk keeps a manual override: email is unconfigured,
 *      undeliverable, or landed in spam, and someone still needs a way in.
 *
 * One deliberate difference from invitations, roles-editing and
 * deactivation: `initiate` does NOT refuse acting on your own account.
 * Those refuse self-service because self-service there is a privilege-
 * escalation or lockout risk; here self-service is the ordinary case for
 * a solo owner who still has a session open somewhere and wants a fresh
 * password as a precaution.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  /** Create a reset link and return the raw token ONCE — same discipline as `InvitationService.invite()`. */
  async initiate(params: {
    companyId: string;
    actor: WorkflowActor;
    userId: string;
  }): Promise<{ token: string; email: string; expiresAt: Date; emailed: boolean }> {
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

    const { token, expiresAt } = await this.createToken({ userId: user.id, createdById: params.actor.userId });

    await this.audit.write({
      transactionId: user.id,
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

    // Best-effort: the admin still gets the link back to relay manually
    // either way, so a failed or unconfigured send does not block them.
    const emailed = await this.email.send({
      to: user.email,
      subject: 'Reset your BioAssetPro password',
      html: resetEmailHtml(linkFor(token)),
    });

    return { token, email: user.email, expiresAt, emailed };
  }

  /**
   * The self-service entry point. Deliberately returns nothing about whether
   * the email had an account — same reasoning `AuthService.login()` already
   * gives for one generic failure message: telling the caller either way is
   * how a "forgot password" form becomes an email-enumeration tool. The
   * response takes the same minimum time regardless, so the network request
   * itself cannot be timed to tell the two cases apart from the outside.
   */
  async requestForSelf(rawEmail: string): Promise<void> {
    const startedAt = Date.now();
    const email = rawEmail.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.active) {
      const { token } = await this.createToken({ userId: user.id, createdById: user.id });

      await this.audit.write({
        transactionId: user.id,
        module: 'AUTH',
        entityType: 'User',
        entityId: user.id,
        status: 'PENDING',
        action: AuditAction.UPDATE,
        userId: user.id,
        comments: 'Password reset requested (self-service)',
      });

      await this.email.send({
        to: user.email,
        subject: 'Reset your BioAssetPro password',
        html: resetEmailHtml(linkFor(token)),
      });
    }

    const MIN_RESPONSE_MS = 400;
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
    }
  }

  /** Shared by both entry points: mint a token, superseding whatever the person had outstanding. */
  private async createToken(params: {
    userId: string;
    createdById: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    // A previous outstanding link for the same person is superseded, not left
    // alongside — same rule `InvitationService.invite()` applies to a repeat
    // invite, so two live credentials never exist for one account.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: params.userId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALID_FOR_HOURS * 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: params.userId,
        tokenHash: hashToken(token),
        createdById: params.createdById,
        expiresAt,
      },
    });

    return { token, expiresAt };
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

/** Where the link in the email points — the API has no page of its own for this, the web app does. */
function linkFor(token: string): string {
  const origin = process.env.APP_URL ?? 'http://localhost:3000';
  return `${origin}/reset-password/${token}`;
}

function resetEmailHtml(link: string): string {
  return `
    <p>Someone asked to reset the password on this BioAssetPro account.</p>
    <p><a href="${link}">Set a new password</a></p>
    <p>This link works once and expires in one hour. If you did not ask for this, you can ignore it — your password will not change.</p>
  `.trim();
}
