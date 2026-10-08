import 'server-only';

/**
 * Limite de tentativas em memória. Na Vercel cada instância tem a sua memória, então
 * isto é um freio (contra robôs insistentes), não uma garantia absoluta.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return {
    ok: b.count <= max,
    retryAfterMs: Math.max(0, b.resetAt - now),
    reset: () => {
      buckets.delete(key);
    },
  };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
