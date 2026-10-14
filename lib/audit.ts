import 'server-only';
import { headers } from 'next/headers';
import { serviceKey, supabaseUrl } from './supabaseAdmin';
import type { HubUser } from './permissions';
import { AUDIT_EVENT, type AuditEvent, type AuditKind } from './auditTypes';

/**
 * Auditoria ao vivo, sem banco: cada ação vai na hora para a aba Auditoria do painel master
 * (pelo Supabase Realtime, num canal com nome secreto que só o master recebe) e as últimas
 * ficam na memória do servidor, para quem abrir a aba já ver o que acabou de acontecer.
 * Por não ser gravada, a lista recomeça quando o servidor reinicia (publicação nova).
 */
const MAX = 800;
const g = globalThis as unknown as { __maxAudit?: AuditEvent[]; __maxAuditTopic?: string };
const buffer = (g.__maxAudit ??= []);

export async function auditTopic(): Promise<string> {
  if (g.__maxAuditTopic) return g.__maxAuditTopic;
  const raw = process.env.SESSION_SECRET || (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'almox::' + process.env.SUPABASE_SERVICE_ROLE_KEY : 'maxhub');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('auditoria::' + raw));
  g.__maxAuditTopic = 'maxhub-auditoria-' + [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  return g.__maxAuditTopic;
}

export function recentAudit(): AuditEvent[] {
  return buffer.slice(-MAX);
}

/** aparelho, em poucas palavras ("Chrome · Windows") */
function device(ua: string | null): string | null {
  if (!ua) return null;
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

export async function audit(input: {
  user: Pick<HubUser, 'id' | 'display_name' | 'username' | 'sector' | 'is_master'> | null;
  /** quando não há usuário (ex.: login errado) */
  who?: string;
  kind: AuditKind;
  action: string;
  detail?: string | null;
  ok?: boolean;
  path?: string | null;
}): Promise<AuditEvent> {
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const h = await headers();
    ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null;
    ua = h.get('user-agent');
  } catch {
    /* fora de uma requisição */
  }
  const u = input.user;
  const ev: AuditEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: input.kind,
    action: input.action.slice(0, 220),
    detail: input.detail ? String(input.detail).slice(0, 400) : null,
    ok: input.ok !== false,
    user: u
      ? { id: u.id, name: u.display_name, username: u.username, sector: u.sector, master: u.is_master }
      : { id: null, name: input.who ?? 'Alguém', username: null, sector: null, master: false },
    path: input.path ?? null,
    ip,
    device: device(ua),
  };
  buffer.push(ev);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  // ao vivo para quem estiver com a aba Auditoria aberta
  try {
    const key = serviceKey();
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
    if (key.startsWith('eyJ')) hdrs.Authorization = `Bearer ${key}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    await fetch(`${supabaseUrl()}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: hdrs,
      signal: ctrl.signal,
      body: JSON.stringify({ messages: [{ topic: await auditTopic(), event: AUDIT_EVENT, payload: ev, private: false }] }),
    }).catch(() => undefined);
    clearTimeout(t);
  } catch {
    /* sem Realtime: a aba confere a lista de tempos em tempos */
  }
  return ev;
}
