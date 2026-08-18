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
