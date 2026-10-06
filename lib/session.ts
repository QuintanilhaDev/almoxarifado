import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'almox_session';
export const SESSION_DAYS = 7;

export interface SessionPayload {
  sub: string; // id do admin
  name: string;
}

async function secretKey(): Promise<Uint8Array> {
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
  return new SignJWT({ name: payload.name })
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
    return { sub: payload.sub, name: String(payload.name ?? '') };
  } catch {
    return null;
  }
}
