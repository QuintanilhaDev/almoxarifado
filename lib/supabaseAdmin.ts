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

/**
 * Regras do próprio Storage para o bucket (valem mesmo para quem tem a URL assinada):
 * fotos/vídeos do formulário dos supervisores e os anexos de Compras/recebimento.
 */
export const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/x-m4v',
    'application/pdf', 'application/xml', 'text/xml', 'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword', 'application/vnd.ms-excel',
  ],
};

let bucketReady = false;
/** Garante que o bucket privado de anexos exista (com limite de tamanho e de tipos). */
export async function ensureBucket() {
  if (bucketReady) return;
  const { data } = await db().storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db().storage.createBucket(BUCKET, BUCKET_OPTIONS);
    if (error && !/exist/i.test(error.message)) throw error;
  } else {
    // bucket criado antes das regras: aplica agora (se falhar, a conferência das rotas continua valendo)
    const { error } = await db()
      .storage.updateBucket(BUCKET, BUCKET_OPTIONS)
      .catch((e: unknown) => ({ error: e as Error }));
    if (error) console.error('[storage] regras do bucket', error);
  }
  bucketReady = true;
}
