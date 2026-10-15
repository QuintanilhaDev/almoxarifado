import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { fail, readJson } from '@/lib/http';
import { GEO_COOKIE, GEO_EXEMPT_TTL_S, GEO_TTL_S, geoConfig, geoFenced, judge, signGeo, type GeoStatus } from '@/lib/geoFence';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge });
/** último estado de cada pessoa (para avisar a Auditoria só quando muda) */
const last = new Map<string, GeoStatus>();

/**
 * Recebe a posição do navegador e diz se a pessoa está dentro do terreno da empresa.
 * Dentro: renova a permissão de 3 minutos. Fora (ou GPS impreciso): tira a permissão.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Faça login.', 401);
  const cfg = geoConfig();
  if (!geoFenced(user)) {
    const res = NextResponse.json({ status: cfg.on ? 'isento' : 'desligado' });
    res.cookies.set(GEO_COOKIE, await signGeo(user.id, true), cookieOpts(GEO_EXEMPT_TTL_S));
    return res;
  }
  const b = await readJson<{ lat?: unknown; lng?: unknown; accuracy?: unknown; reason?: unknown }>(req);
  const lat = Number(b?.lat);
  const lng = Number(b?.lng);
  const accuracy = Number(b?.accuracy);
  let status: GeoStatus;
  let distance: number | null = null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    status = 'impreciso';
  } else {
    const j = judge(lat, lng, accuracy);
    status = j.status;
    distance = Math.round(j.distance);
  }
  const prev = last.get(user.id);
  if (prev !== status) {
    last.set(user.id, status);
    const where = distance === null ? '' : distance >= 1000 ? ` (${(distance / 1000).toFixed(1).replace('.', ',')} km da empresa)` : ` (${distance} m da empresa)`;
    void audit({
      user,
      kind: 'local',
      action: status === 'dentro' ? 'Entrou na área da empresa' : status === 'fora' ? `Saiu da área da empresa${where}: acesso bloqueado` : 'Localização imprecisa: acesso bloqueado',
      ok: status === 'dentro',
    });
  }
  const res = NextResponse.json({ status, distance, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, radius: cfg.radius });
  if (status === 'dentro') res.cookies.set(GEO_COOKIE, await signGeo(user.id, false), cookieOpts(GEO_TTL_S));
  else res.cookies.set(GEO_COOKIE, '', cookieOpts(0));
  return res;
}
