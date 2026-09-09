'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

export interface InviteResult {
  error: string | null;
  /**
   * The link, returned ONCE.
   *
   * There is no mail transport in this product, so the invitation is handed
   * back to whoever created it to send by whatever they actually use — which on
   * a Nigerian farm is WhatsApp, not email. That is not a workaround: it is the
   * channel the message will arrive on fastest.
   *
   * It appears once and is not stored anywhere the interface can read again,
   * because the token is a credential and the server only keeps its hash.
   */
  link?: string;
  email?: string;
}

export async function createInvitation(
  _previous: InviteResult,
  formData: FormData,
): Promise<InviteResult> {
  const email = String(formData.get('email') ?? '').trim();
  const roles = formData.getAll('roles').map(String).filter(Boolean);

  if (!email) return { error: 'Enter an email address.' };
  if (roles.length === 0) return { error: 'Choose what this person will be allowed to do.' };

  try {
    const invitation = await api<{ id: string; email: string; token: string }>(
      '/auth/invitations',
      // The helper stringifies the body itself — passing a string here would
      // send a JSON-encoded JSON string, which the API rejects as malformed.
      { method: 'POST', body: { email, roles } },
    );

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    revalidatePath('/staff');
    return {
      error: null,
      email: invitation.email,
      link: `${origin}/join/${invitation.token}`,
    };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : 'That did not work. Please try again.',
    };
  }
}

export async function revokeInvitation(id: string): Promise<void> {
  await api(`/auth/invitations/${id}/revoke`, { method: 'POST' });
  revalidatePath('/staff');
}

export interface PendingInvitation {
  id: string;
  email: string;
  roles: string[];
  invitedBy: string;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}

export async function listInvitations(): Promise<PendingInvitation[]> {
  try {
    return await api<PendingInvitation[]>('/auth/invitations');
  } catch {
    // A staff page that cannot list invitations is still worth showing.
    return [];
  }
}

export interface Person {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: 'ACTIVE' | 'SUSPENDED';
}

/**
 * The people actually on this farm — real `User` rows, not a fixture.
 *
 * This used to be a hardcoded list of six names that never changed no matter
 * who signed up or accepted an invitation, which is exactly the wrong thing
 * for an access-control screen to get wrong: an admin auditing who has
 * access would see people who do not exist and not see the ones who do.
 */
export async function listPeople(): Promise<Person[]> {
  try {
    return await api<Person[]>('/auth/users');
  } catch {
    return [];
  }
}

/**
 * Just the headcount, for anyone to read — not everyone who needs to know
 * "is this farm staffed yet" holds a role that can call `listPeople` above.
 * The onboarding checklist is exactly that caller: it used to ask
 * `listPeople` and, for most roles, silently get an empty list back from
 * the role check refusing it rather than the farm genuinely having nobody
 * on it, which told a Finance Controller their fully-staffed farm still
 * needed a first invitation.
 */
export async function getTeamSize(): Promise<number> {
  try {
    const { count } = await api<{ count: number }>('/auth/users/count');
    return count;
  } catch {
    return 0;
  }
}

/**
 * Active people's names, for "recorded by" pickers — open to any role, unlike
 * `listPeople` above. A production supervisor recording a treatment cannot
 * call the staff-management endpoint, but still needs to say who did it.
 */
export async function getActiveNames(): Promise<Array<{ id: string; name: string }>> {
  try {
    return await api<Array<{ id: string; name: string }>>('/auth/users/names');
  } catch {
    return [];
  }
}

export interface RoleEditResult {
  error: string | null;
  ok?: boolean;
}

export async function updatePersonRoles(
  userId: string,
  _previous: RoleEditResult,
  formData: FormData,
): Promise<RoleEditResult> {
  const roles = formData.getAll('roles').map(String).filter(Boolean);
  if (roles.length === 0) return { error: 'Choose what this person is allowed to do.' };

  try {
    await api(`/auth/users/${userId}/roles`, { method: 'POST', body: { roles } });
    revalidatePath('/staff');
    return { error: null, ok: true };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : 'That did not work. Please try again.',
    };
  }
}

export async function deactivatePerson(id: string): Promise<void> {
  await api(`/auth/users/${id}/deactivate`, { method: 'POST' });
  revalidatePath('/staff');
}

export async function reactivatePerson(id: string): Promise<void> {
  await api(`/auth/users/${id}/reactivate`, { method: 'POST' });
  revalidatePath('/staff');
}

export interface PasswordResetResult {
  error: string | null;
  /**
   * The link, returned ONCE — same reasoning as `InviteResult.link`. Kept
   * even now that email can send it automatically: shown as a fallback in
   * case delivery is unconfigured, slow, or lands in spam, and the server
   * keeps only a hash of the token, so this genuinely is the only moment it
   * can be read regardless.
   */
  link?: string;
  email?: string;
  /** Whether Resend actually accepted the message — see `EmailService.send()`. */
  emailed?: boolean;
}

export async function resetPersonPassword(id: string): Promise<PasswordResetResult> {
  try {
    const reset = await api<{ token: string; email: string; emailed: boolean }>(
      `/auth/users/${id}/reset-password`,
      { method: 'POST' },
    );
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    return {
      error: null,
      email: reset.email,
      link: `${origin}/reset-password/${reset.token}`,
      emailed: reset.emailed,
    };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : 'That did not work. Please try again.',
    };
  }
}
