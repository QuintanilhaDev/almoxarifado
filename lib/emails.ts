import 'server-only';
import { db } from './supabaseAdmin';

export async function isAuthorizedEmail(email: string) {
  const { data, error } = await db()
    .from('authorized_emails')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
