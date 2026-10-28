import { SignJWT, jwtVerify } from 'jose';
import { secretKey } from './session';

/**
 * Cerca de localização: para os usuários da lista (hoje só o @uesley), a plataforma só
 * funciona dentro do terreno da empresa. Os demais entram de qualquer lugar.
 *
 * O navegador manda a posição; o servidor confere a distância até o ponto da empresa e,
 * se a pessoa está dentro, dá uma permissão curta (cookie assinado de 3 minutos), renovada
 * enquanto ela continua lá dentro. Sem essa permissão, as rotas do sistema recusam.
 * Quem não está na lista (e o master geral) recebe uma permissão sem cerca.
 * O formulário público dos supervisores não é afetado.
 *
 * Ajustes (variáveis de ambiente na Vercel):
 *   GEO_FENCE=off           desliga a cerca
 *   GEO_USERS               usuários com cerca, separados por vírgula (padrão: uesley)
 *   GEO_LAT / GEO_LNG       ponto da empresa
 *   GEO_RADIUS_M            raio do terreno, em metros (padrão 150)
 *   GEO_MAX_ACCURACY_M      precisão mínima aceita do GPS, em metros (padrão 200)
 */
export const GEO_COOKIE = 'maxhub_geo';
export const GEO_TTL_S = 180;
/** quem não tem cerca: a permissão dura o mesmo que o login (e é conferida de novo a cada tela aberta) */
export const GEO_EXEMPT_TTL_S = 7 * 24 * 3600;

export function geoConfig() {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    on: (process.env.GEO_FENCE ?? 'on').toLowerCase() !== 'off',
    lat: num(process.env.GEO_LAT, -12.986892099250628),
    lng: num(process.env.GEO_LNG, -38.489956547863),
    radius: num(process.env.GEO_RADIUS_M, 150),
    maxAccuracy: num(process.env.GEO_MAX_ACCURACY_M, 200),
    users: (process.env.GEO_USERS ?? 'uesley')
      .split(',')
      .map((u) => u.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  };
}

/** esta pessoa só pode usar o sistema dentro do terreno? */
export function geoFenced(user: { username?: string | null; is_master?: boolean | null }): boolean {
  const c = geoConfig();
  if (!c.on || user.is_master) return false;
  return c.users.includes(String(user.username ?? '').trim().toLowerCase().replace(/^@/, ''));
}

/** distância em metros entre dois pontos (fórmula de haversine) */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeoStatus = 'dentro' | 'fora' | 'impreciso' | 'isento' | 'desligado';

/** está dentro? (a margem da precisão do GPS conta só até 30 m, para não abrir a cerca) */
export function judge(lat: number, lng: number, accuracy: number): { status: GeoStatus; distance: number } {
  const c = geoConfig();
  const distance = distanceM(lat, lng, c.lat, c.lng);
  if (!Number.isFinite(accuracy) || accuracy > c.maxAccuracy) return { status: 'impreciso', distance };
  return { status: distance <= c.radius + Math.min(accuracy, 30) ? 'dentro' : 'fora', distance };
}

export async function signGeo(sub: string, exempt: boolean, username?: string | null): Promise<string> {
  const claims: Record<string, unknown> = { x: exempt ? 1 : 0 };
  if (exempt && username) claims.u = String(username).trim().toLowerCase().replace(/^@/, '');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${exempt ? GEO_EXEMPT_TTL_S : GEO_TTL_S}s`)
    .setAudience('geo')
    .sign(await secretKey());
}

/** situação atual da pessoa no banco (cache curto, roda também no middleware) */
const statusCache = new Map<string, { at: number; v: { username: string; is_master: boolean; active: boolean } | null }>();
const STATUS_TTL_MS = 60_000;

async function currentStatus(sub: string): Promise<{ username: string; is_master: boolean; active: boolean } | null | undefined> {
  const hit = statusCache.get(sub);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.v;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key || !/^[0-9a-f-]{36}$/i.test(sub)) return undefined;
  try {
    const r = await fetch(`${url}/rest/v1/admins?id=eq.${sub}&select=username,is_master,active`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!r.ok) return undefined;
    const rows = (await r.json()) as { username?: string; is_master?: boolean; active?: boolean }[];
    const row = rows[0];
    const v = row ? { username: String(row.username ?? ''), is_master: Boolean(row.is_master), active: row.active !== false } : null;
    if (statusCache.size > 2000) statusCache.clear();
    statusCache.set(sub, { at: Date.now(), v });
    return v;
  } catch {
    return undefined;
  }
}

export async function verifyGeo(token: string | undefined | null, sub: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, await secretKey(), { algorithms: ['HS256'], audience: 'geo' });
    if (payload.sub !== sub) return false;
    if (payload.x !== 1) return true;
    // permissão "sem cerca": confere se a pessoa continua sem cerca hoje
    // (entrou na lista GEO_USERS, deixou de ser master, trocou de usuário…)
    if (typeof payload.u === 'string' && geoFenced({ username: payload.u })) return false;
    const now = await currentStatus(sub);
    if (now === undefined) return typeof payload.u === 'string'; // banco fora do ar: vale só o que dá para conferir
    if (!now || !now.active) return false;
    return !geoFenced(now);
  } catch {
    return false;
  }
}

/** rotas que funcionam sem a cerca: login/sessão, a própria localização e o formulário público dos supervisores */
export function geoFree(path: string): boolean {
  return /^\/api\/(auth\/|geo\b|form\b|requests\/?$|upload-url\b|max\/publico\b|audit\b)/.test(path);
}
