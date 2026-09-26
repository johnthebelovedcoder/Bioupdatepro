'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface NoticeState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): NoticeState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

export async function sendCode(_previous: NoticeState, formData: FormData): Promise<NoticeState> {
  try {
    const result = await api<{ sentTo: string; expiresInMinutes: number }>('/notifications/whatsapp/number', {
      method: 'POST',
      body: { number: String(formData.get('number') ?? '') },
    });
    revalidatePath('/notifications');
    return { error: null, message: `A code went by WhatsApp to the number ending ${result.sentTo}. It lasts ${result.expiresInMinutes} minutes.` };
  } catch (caught) {
    return failed(caught, 'Could not send a code.');
  }
}

export async function verifyCode(_previous: NoticeState, formData: FormData): Promise<NoticeState> {
  try {
    await api('/notifications/whatsapp/verify', { method: 'POST', body: { code: String(formData.get('code') ?? '') } });
  } catch (caught) {
    return failed(caught, 'Could not verify that code.');
  }
  revalidatePath('/notifications');
  return { error: null, message: 'Number verified.' };
}

export async function setConsent(consent: boolean): Promise<NoticeState> {
  try {
    await api('/notifications/whatsapp/consent', { method: 'POST', body: { consent } });
  } catch (caught) {
    return failed(caught, 'Could not record that.');
  }
  revalidatePath('/notifications');
  return { error: null, message: consent ? 'You will get approval notices on WhatsApp.' : 'No more WhatsApp messages.' };
}

export async function savePolicy(_previous: NoticeState, formData: FormData): Promise<NoticeState> {
  try {
    await api('/notifications/policy', {
      method: 'POST',
      body: { emailEvents: formData.getAll('email').map(String), whatsappEvents: formData.getAll('whatsapp').map(String) },
    });
  } catch (caught) {
    return failed(caught, 'Could not save the notification events.');
  }
  revalidatePath('/notifications');
  return { error: null, message: 'Saved.' };
}
