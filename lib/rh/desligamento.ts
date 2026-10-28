import 'server-only';
import { db } from '../supabaseAdmin';
import { fail } from '../http';
import { COLLAB_COLS } from '../pedidos/rh';
import type { ControleFarda } from '../fardamento/types';
import { DEV_COLS, type Desligado, type Devolucao, type ItemEntregue } from './devolucao';

/**
 * Desligamento: o que o colaborador recebeu (para conferir a devolução) e a checagem de que
 * o banco já tem as colunas/tabela novas (supabase/desligamento.sql). Sem elas, o resto do
 * cadastro continua funcionando como antes.
 */

export const DESL_SETUP = 'O registro de desligamento ainda não foi ativado no banco. Rode o arquivo supabase/desligamento.sql no SQL Editor do Supabase.';
export const deslFail = () => fail(DESL_SETUP, 409, { setup: true });

let cache: { ok: boolean; at: number } | null = null;
/** o banco já tem o desligamento? (guardado por 1 minuto; vale a resposta "sim" para sempre) */
export async function temDesligamento(): Promise<boolean> {
  if (cache && (cache.ok || Date.now() - cache.at < 60_000)) return cache.ok;
  const { error } = await db().from('collaborator_returns').select('id').limit(1);
  const ok = !error;
  if (ok) {
    const c = await db().from('collaborators').select('client, dismissed_at').limit(1);
    cache = { ok: !c.error, at: Date.now() };
  } else cache = { ok: false, at: Date.now() };
  return cache.ok;
}
export const DESL_COLS = 'client, dismissed_at, dismissal_reason, dismissal_notes, dismissed_by';
export async function collabCols(): Promise<string> {
  return (await temDesligamento()) ? `${COLLAB_COLS}, ${DESL_COLS}` : COLLAB_COLS;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Tudo o que o colaborador recebeu, agrupado por item e tamanho:
 *  - entregas registradas no sistema (menos o que já voltou pelo Almoxarifado);
 *  - a planilha de controle de fardamento importada na Gestão (pelo nome do funcionário).
 */
export async function itensEntregues(c: { id: string; name: string }): Promise<{ itens: ItemEntregue[]; postoPlanilha: string | null }> {
  const out = new Map<string, ItemEntregue>();
  const add = (source: ItemEntregue['source'], name: string, size: string | null, qty: number, date: string | null, posto: string | null) => {
    if (qty <= 0) return;
    const key = `${source}|${fold(name)}|${fold(size ?? '')}`;
    const x = out.get(key) ?? { key, source, item_name: name, size, qty: 0, last: null, datas: [], posto: null };
    x.qty += qty;
    if (date) {
      x.datas.push(date);
      if (!x.last || date > x.last) {
        x.last = date;
        x.posto = posto ?? x.posto;
      }
    }
    out.set(key, x);
  };
  const { data: del, error } = await db().from('deliveries').select('item_name, size, qty, returned_qty, delivered_at, posto_name').eq('collaborator_id', c.id).limit(2000);
  if (error) throw error;
  for (const d of del ?? [])
    add('sistema', String(d.item_name), (d.size as string | null) ?? null, Number(d.qty) - Number(d.returned_qty ?? 0), String(d.delivered_at).slice(0, 10), (d.posto_name as string | null) ?? null);

  let postoPlanilha: string | null = null;
  const { data: meta } = await db().from('hub_meta').select('value').eq('key', 'fardamento_controle').maybeSingle();
  const ctrl = meta?.value as ControleFarda | undefined;
  if (ctrl?.entregas?.length) {
    const alvo = fold(c.name);
    let ultima = '';
    for (const e of ctrl.entregas) {
      if (fold(e.f) !== alvo) continue;
      const dt = e.d ?? `${e.m}-01`;
      for (const [peca, tam, q] of e.i) add('planilha', peca, tam, q, dt, e.p);
      if (dt > ultima) {
        ultima = dt;
        postoPlanilha = e.p;
      }
    }
  }
  const itens = [...out.values()]
    .map((x) => ({ ...x, datas: [...new Set(x.datas)].sort() }))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'sistema' ? -1 : 1) || (b.last ?? '').localeCompare(a.last ?? '') || a.item_name.localeCompare(b.item_name, 'pt-BR'));
  return { itens, postoPlanilha };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const inteiro = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 100000 ? n : null;
};
export const dataOk = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v.slice(0, 10)) && Number.isFinite(Date.parse(v.slice(0, 10))) ? v.slice(0, 10) : null);

/** um item da conferência, validado (status, quantidades e data coerentes) */
export function itemDevolucao(x: Record<string, unknown>, padraoData: string | null): { error: string } | { row: Record<string, unknown> } {
  const item_name = txt(x.item_name, 120);
  if (!item_name) return { error: 'Informe o nome do item.' };
  const status = ['pendente', 'devolvido', 'nao_devolvido'].includes(String(x.status)) ? String(x.status) : 'pendente';
  const qty_delivered = inteiro(x.qty_delivered ?? 0);
  if (qty_delivered === null) return { error: `${item_name}: quantidade entregue inválida.` };
  let qty_returned = inteiro(x.qty_returned ?? 0);
  if (qty_returned === null) return { error: `${item_name}: quantidade devolvida inválida.` };
  let returned_at = dataOk(x.returned_at);
  if (status === 'devolvido') {
    if (!qty_returned) qty_returned = qty_delivered || 1;
    returned_at ??= padraoData;
    if (!returned_at) return { error: `${item_name}: informe a data da devolução.` };
  }
  if (status === 'pendente' && !qty_returned) returned_at = null;
  if (qty_delivered && qty_returned > qty_delivered) return { error: `${item_name}: devolveu ${qty_returned}, mas recebeu ${qty_delivered}.` };
  const source = ['sistema', 'planilha', 'manual'].includes(String(x.source)) ? String(x.source) : 'manual';
  return {
    row: {
      source,
      item_name,
      size: txt(x.size, 20),
      qty_delivered,
      last_delivered_at: dataOk(x.last_delivered_at),
      qty_returned,
      status,
      returned_at,
      notes: txt(x.notes, 300),
    },
  };
}

/** desligados com a conferência de devolução de cada um (para a lista e o relatório) */
export async function desligados(opts: { pendentes?: boolean } = {}): Promise<Desligado[]> {
  const { data: cs, error } = await db()
    .from('collaborators')
    .select('id, name, matricula, role, company, client, posto_name, dismissed_at, dismissal_reason, dismissed_by, active')
    .eq('active', false)
    .order('dismissed_at', { ascending: false, nullsFirst: false })
    .limit(10000);
  if (error) throw error;
  const ids = (cs ?? []).map((c) => c.id as string);
  const por = new Map<string, Devolucao[]>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: rs, error: e1 } = await db()
      .from('collaborator_returns')
      .select(DEV_COLS)
      .in('collaborator_id', ids.slice(i, i + 300))
      .order('created_at')
      .limit(20000);
    if (e1) throw e1;
    for (const r of rs ?? []) {
      const k = r.collaborator_id as string;
      por.set(k, [...(por.get(k) ?? []), r as unknown as Devolucao]);
    }
  }
  const out = (cs ?? []).map((c) => {
    const itens = por.get(c.id as string) ?? [];
    return { ...(c as unknown as Desligado), itens, pendentes: itens.filter((x) => x.status === 'pendente').length };
  });
  return opts.pendentes ? out.filter((d) => d.pendentes > 0) : out;
}
