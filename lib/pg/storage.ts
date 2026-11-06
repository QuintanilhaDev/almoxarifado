import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Anexos em uma pasta do próprio servidor (no lugar do Storage do Supabase), com a mesma
 * forma de uso: db().storage.from('anexos').upload / download / remove / createSignedUrls…
 *
 * Pasta: STORAGE_DIR (padrão /var/lib/maxhub/arquivos), organizada como <bucket>/<caminho>.
 * Cada arquivo tem ao lado um "<arquivo>.tipo" com o tipo (image/jpeg, application/pdf…).
 * Links temporários são assinados com o SESSION_SECRET e servidos por /api/arquivos.
 */
const ROOT = () => path.resolve(process.env.STORAGE_DIR || '/var/lib/maxhub/arquivos');
type R<T> = { data: T | null; error: { message: string; statusCode?: string } | null };
const fail = <T>(message: string, statusCode = '400'): R<T> => ({ data: null, error: { message, statusCode } });

/** caminho seguro dentro da pasta (nada de "..", nada de caminho absoluto) */
export function safeKey(bucket: string, p: string): string | null {
  if (!/^[\w-]+$/.test(bucket)) return null;
  const clean = String(p || '').replace(/^\/+/, '');
  if (!clean || clean.includes('\0') || clean.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  const full = path.resolve(ROOT(), bucket, clean);
  if (!full.startsWith(path.resolve(ROOT(), bucket) + path.sep)) return null;
  return full;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET não configurado');
  return s;
}
export function sign(bucket: string, p: string, exp: number, kind: 'get' | 'put'): string {
  return createHmac('sha256', secret()).update(`${kind}\n${bucket}\n${p}\n${exp}`).digest('base64url');
}
export function checkSig(bucket: string, p: string, exp: number, kind: 'get' | 'put', sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const want = Buffer.from(sign(bucket, p, exp, kind));
  const got = Buffer.from(String(sig || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}
export function signedUrl(bucket: string, p: string, ttlSeconds: number, kind: 'get' | 'put' = 'get'): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const q = new URLSearchParams({ b: bucket, p, e: String(exp), s: sign(bucket, p, exp, kind) });
  return `/api/arquivos?${q.toString()}`;
}

export async function writeFile(bucket: string, p: string, body: Buffer, type: string, upsert = false): Promise<R<{ path: string }>> {
  const full = safeKey(bucket, p);
  if (!full) return fail('Caminho de arquivo inválido.');
  await fs.mkdir(path.dirname(full), { recursive: true });
  try {
    await fs.writeFile(full, body, { flag: upsert ? 'w' : 'wx' });
  } catch (e) {
    if ((e as { code?: string }).code === 'EEXIST') return fail('The resource already exists', '409');
    throw e;
  }
  await fs.writeFile(`${full}.tipo`, type || 'application/octet-stream');
  return { data: { path: p }, error: null };
}

export async function readFile(bucket: string, p: string): Promise<{ body: Buffer; type: string } | null> {
  const full = safeKey(bucket, p);
  if (!full) return null;
  try {
    const body = await fs.readFile(full);
    const type = await fs.readFile(`${full}.tipo`, 'utf8').catch(() => 'application/octet-stream');
    return { body, type: type.trim() || 'application/octet-stream' };
  } catch {
    return null;
  }
}

class Bucket {
  constructor(private bucket: string) {}

  async upload(p: string, body: Buffer | ArrayBuffer | Blob | Uint8Array, opts?: { contentType?: string; upsert?: boolean }) {
    const buf = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body as ArrayBuffer);
    try {
      return await writeFile(this.bucket, p, buf, opts?.contentType || (body instanceof Blob ? body.type : '') || 'application/octet-stream', Boolean(opts?.upsert));
    } catch (e) {
      return fail(String((e as Error).message), '500');
    }
  }
  async download(p: string): Promise<R<Blob>> {
    const f = await readFile(this.bucket, p);
    if (!f) return fail('Object not found', '404');
    return { data: new Blob([new Uint8Array(f.body)], { type: f.type }), error: null };
  }
  async remove(paths: string[]): Promise<R<{ name: string }[]>> {
    const out: { name: string }[] = [];
    for (const p of paths) {
      const full = safeKey(this.bucket, p);
      if (!full) continue;
      await fs.rm(full, { force: true });
      await fs.rm(`${full}.tipo`, { force: true });
      out.push({ name: p });
    }
    return { data: out, error: null };
  }
  async createSignedUrl(p: string, ttl: number): Promise<R<{ signedUrl: string }>> {
    if (!safeKey(this.bucket, p)) return fail('Caminho inválido.');
    return { data: { signedUrl: signedUrl(this.bucket, p, ttl) }, error: null };
  }
  async createSignedUrls(paths: string[], ttl: number): Promise<R<{ path: string; signedUrl: string; error: string | null }[]>> {
    return { data: paths.map((p) => ({ path: p, signedUrl: safeKey(this.bucket, p) ? signedUrl(this.bucket, p, ttl) : '', error: safeKey(this.bucket, p) ? null : 'invalid' })), error: null };
  }
  /** link para o navegador enviar o arquivo direto (formulário dos supervisores), vale 2 horas */
  async createSignedUploadUrl(p: string): Promise<R<{ signedUrl: string; token: string; path: string }>> {
    if (!safeKey(this.bucket, p)) return fail('Caminho inválido.');
    const url = signedUrl(this.bucket, p, 2 * 3600, 'put');
    return { data: { signedUrl: url, token: new URL(url, 'http://x').searchParams.get('s') || '', path: p }, error: null };
  }
}

export const diskStorage = {
  from: (bucket: string) => new Bucket(bucket),
  async getBucket(bucket: string) {
    await fs.mkdir(path.join(ROOT(), bucket), { recursive: true });
    return { data: { id: bucket, name: bucket, public: false }, error: null };
  },
  async createBucket(bucket: string) {
    await fs.mkdir(path.join(ROOT(), bucket), { recursive: true });
    return { data: { name: bucket }, error: null };
  },
  async updateBucket() {
    return { data: { message: 'ok' }, error: null };
  },
};
