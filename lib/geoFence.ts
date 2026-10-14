import { SignJWT, jwtVerify } from 'jose';
import { secretKey } from './session';

/**
 * Cerca de localização: a plataforma só funciona dentro do terreno da empresa.
 *
 * O navegador manda a posição; o servidor confere a distância até o ponto da empresa e,
 * se a pessoa está dentro, dá uma permissão curta (cookie assinado de 3 minutos), renovada
 * enquanto ela continua lá dentro. Sem essa permissão, as rotas do sistema recusam.
 * O master geral não tem cerca. O formulário público dos supervisores não é afetado.
 *
 * Ajustes (variáveis de ambiente na Vercel):
 *   GEO_FENCE=off           desliga a cerca
 *   GEO_LAT / GEO_LNG       ponto da empresa
 *   GEO_RADIUS_M            raio do terreno, em metros (padrão 150)
 *   GEO_MAX_ACCURACY_M      precisão mínima aceita do GPS, em metros (padrão 200)
 */
export const GEO_COOKIE = 'maxhub_geo';
export const GEO_TTL_S = 180;
export const GEO_EXEMPT_TTL_S = 12 * 3600;

export function geoConfig() {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    on: (process.env.GEO_FENCE ?? 'on').toLowerCase() !== 'off',
    lat: num(process.env.GEO_LAT, -12.986892099250628),
    lng: num(process.env.GEO_LNG, -38.489956547863),
    radius: num(process.env.GEO_RADIUS_M, 150),
    maxAccuracy: num(process.env.GEO_MAX_ACCURACY_M, 200),
  };
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

export async function signGeo(sub: string, exempt: boolean): Promise<string> {
  return new SignJWT({ x: exempt ? 1 : 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${exempt ? GEO_EXEMPT_TTL_S : GEO_TTL_S}s`)
    .setAudience('geo')
    .sign(await secretKey());
}

export async function verifyGeo(token: string | undefined | null, sub: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, await secretKey(), { algorithms: ['HS256'], audience: 'geo' });
    return payload.sub === sub;
  } catch {
    return false;
  }
}

/** rotas que funcionam sem a cerca: login/sessão, a própria localização e o formulário público dos supervisores */
export function geoFree(path: string): boolean {
  return /^\/api\/(auth\/|geo\b|form\b|requests\/?$|upload-url\b|max\/publico\b|audit\b)/.test(path);
}
