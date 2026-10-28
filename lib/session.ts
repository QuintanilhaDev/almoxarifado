import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'maxhub_session';
export const SESSION_DAYS = 7;

export interface SessionPayload {
  sub: string; // id do usuário
  name: string;
  /** impressão da senha (ver passwordFingerprint); tokens antigos não têm */
  pwf?: string;
}

/**
 * Pedacinho do sha256 do hash da senha guardado no banco. Vai no token: se a senha
 * mudar, a impressão muda e as sessões antigas caem.
 */
export async function passwordFingerprint(hash: string | null | undefined): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pwf::' + String(hash ?? '')));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/** hash bcrypt de verdade? (usuário sem senha definida tem um marcador no lugar) */
export function isBcryptHash(hash: unknown): hash is string {
  return typeof hash === 'string' && hash.startsWith('$2') && hash.length >= 59;
}

export async function secretKey(): Promise<Uint8Array> {
  const raw =
    process.env.SESSION_SECRET ||
    // Se esquecerem de configurar SESSION_SECRET, derivamos da chave secreta do Supabase
    // (continua secreto e estável entre deploys).
    (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'almox::' + process.env.SUPABASE_SERVICE_ROLE_KEY : '');
  if (!raw) throw new Error('SESSION_SECRET não configurada');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return new Uint8Array(digest);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload.pwf ? { name: payload.name, pwf: payload.pwf } : { name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(await secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await secretKey(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      name: String(payload.name ?? ''),
      ...(typeof payload.pwf === 'string' ? { pwf: payload.pwf } : {}),
    };
  } catch {
    return null;
  }
}
