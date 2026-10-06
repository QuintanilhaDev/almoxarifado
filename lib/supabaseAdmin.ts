import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export const BUCKET = 'anexos';

export function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada');
  return url.replace(/\/+$/, '');
}

export function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return key;
}

/** Cliente com a chave secreta. Só roda no servidor. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl(), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

let bucketReady = false;
/** Garante que o bucket privado de anexos exista. */
export async function ensureBucket() {
  if (bucketReady) return;
  const { data } = await db().storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db().storage.createBucket(BUCKET, { public: false });
    if (error && !/exist/i.test(error.message)) throw error;
  }
  bucketReady = true;
}
