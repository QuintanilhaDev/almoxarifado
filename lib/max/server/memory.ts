import 'server-only';
import { db } from '../../supabaseAdmin';
import { signatureKey, type Learned } from '../learn';

/**
 * Memória de aprendizado da Max no banco (tabelas do supabase/max_aprendizado.sql).
 * Tudo aqui é "melhor esforço": se as tabelas não existirem ou o banco falhar, a Max
 * segue funcionando sem memória e nenhuma resposta é atrasada por causa disso.
 */
export interface LearnedRow extends Learned {
  id: string;
  key: string;
  scope: string;
  sector: string | null;
  hits: number;
  good: number;
  bad: number;
  created_by: string | null;
  updated_at: string;
}
export interface NoteRow {
  id: string;
  sector: string | null;
  text: string;
  created_by: string | null;
  created_at: string;
}
export interface MissRow {
  id: string;
  phrase: string;
  scope: string | null;
  sector: string | null;
  reason: string;
  answer: string | null;
  user_name: string | null;
  created_at: string;
}

const TTL = 45_000;
const MAX_LEARNED = 600;
let enabled: boolean | null = null;
let checkedAt = 0;
let learnedCache: { at: number; rows: LearnedRow[] } | null = null;
let notesCache: { at: number; rows: NoteRow[] } | null = null;

function missingTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '42P01' || err?.code === 'PGRST205' || err?.code === 'PGRST202' || /relation .* does not exist|could not find the table/i.test(err?.message ?? '');
}
function off(e: unknown) {
  if (missingTable(e)) {
    enabled = false;
    checkedAt = Date.now();
  } else console.error('[max/memoria]', (e as Error)?.message ?? e);
}
/** depois de 2 minutos tenta de novo (o SQL pode ter sido rodado nesse meio tempo) */
const usable = () => enabled !== false || Date.now() - checkedAt > 120_000;
export const memoryEnabled = () => enabled === true;

export async function allLearned(): Promise<LearnedRow[]> {
  if (!usable()) return [];
  if (learnedCache && Date.now() - learnedCache.at < TTL) return learnedCache.rows;
  try {
    const { data, error } = await db().from('max_learned').select('id, key, phrase, scope, sector, route, tool, args, hits, good, bad, created_by, updated_at').order('updated_at', { ascending: false }).limit(MAX_LEARNED);
    if (error) throw error;
    enabled = true;
    learnedCache = { at: Date.now(), rows: (data ?? []) as LearnedRow[] };
    return learnedCache.rows;
  } catch (e) {
    off(e);
    return [];
  }
}

/** Exemplo ainda confiável? (mais 👎 do que acertos = aposentado) */
export const trusted = (r: Pick<LearnedRow, 'good' | 'bad'>) => r.bad === 0 || r.good > r.bad;

/** Exemplos que valem para esta tela/setor. */
export async function learnedFor(scope: string, sector: string | null): Promise<LearnedRow[]> {
  return (await allLearned()).filter((r) => trusted(r) && r.scope === scope && (r.sector ?? null) === (sector ?? null));
}

const keyOf = (scope: string, sector: string | null, phrase: string) => `${scope}|${sector ?? ''}|${signatureKey(phrase)}`.slice(0, 400);

/** Guarda (ou reforça) um pedido resolvido. */
export async function remember(e: { phrase: string; scope: string; sector: string | null; route?: string | null; tool?: string | null; args?: Record<string, unknown> | null; by: string }): Promise<void> {
  if (!usable() || !signatureKey(e.phrase)) return;
  const key = keyOf(e.scope, e.sector, e.phrase);
  try {
    const found = (await allLearned()).find((r) => r.key === key);
    if (enabled === false) return;
    const now = new Date().toISOString();
    if (found) {
      // mesma solução: reforça · solução diferente: troca só se a antiga não tinha 👍
      const same = (found.route ?? null) === (e.route ?? null) && (found.tool ?? null) === (e.tool ?? null);
      if (!same && found.good > 0) return;
      const patch = same ? { hits: found.hits + 1, updated_at: now } : { route: e.route ?? null, tool: e.tool ?? null, args: e.args ?? null, phrase: e.phrase.slice(0, 300), hits: 1, good: 0, bad: 0, updated_at: now };
      const { error } = await db().from('max_learned').update(patch).eq('id', found.id);
      if (error) throw error;
      Object.assign(found, patch);
    } else {
      const row = { key, phrase: e.phrase.slice(0, 300), scope: e.scope, sector: e.sector, route: e.route ?? null, tool: e.tool ?? null, args: e.args ?? null, created_by: e.by };
      const { error } = await db().from('max_learned').upsert(row, { onConflict: 'key', ignoreDuplicates: true });
      if (error) throw error;
      learnedCache = null;
    }
  } catch (err) {
    off(err);
  }
}

/** 👍 / 👎 sobre a resposta dada a uma frase. */
export async function feedback(scope: string, sector: string | null, phrase: string, good: boolean): Promise<boolean> {
  if (!usable()) return false;
  const key = keyOf(scope, sector, phrase);
  try {
    const found = (await allLearned()).find((r) => r.key === key);
    if (!found) return false;
    const patch = good ? { good: found.good + 1 } : { bad: found.bad + 1 };
    const { error } = await db().from('max_learned').update(patch).eq('id', found.id);
    if (error) throw error;
    Object.assign(found, patch);
    return true;
  } catch (e) {
    off(e);
    return false;
  }
}

export async function logMiss(m: { phrase: string; scope: string; sector: string | null; reason: string; answer?: string | null; user: string }): Promise<void> {
  if (!usable()) return;
  try {
    const { error } = await db().from('max_misses').insert({ phrase: m.phrase.slice(0, 300), scope: m.scope, sector: m.sector, reason: m.reason, answer: m.answer ? m.answer.slice(0, 300) : null, user_name: m.user });
    if (error) throw error;
    enabled = true;
  } catch (e) {
    off(e);
  }
}

export async function notesFor(sector: string | null): Promise<NoteRow[]> {
  return (await allNotes()).filter((n) => !n.sector || n.sector === sector);
}
export async function allNotes(): Promise<NoteRow[]> {
  if (!usable()) return [];
  if (notesCache && Date.now() - notesCache.at < TTL) return notesCache.rows;
  try {
    const { data, error } = await db().from('max_notes').select('id, sector, text, created_by, created_at').order('created_at', { ascending: false }).limit(60);
    if (error) throw error;
    enabled = true;
    notesCache = { at: Date.now(), rows: (data ?? []) as NoteRow[] };
    return notesCache.rows;
  } catch (e) {
    off(e);
    return [];
  }
}
export async function addNote(text: string, sector: string | null, by: string): Promise<'ok' | 'off' | 'full'> {
  if (!usable()) return 'off';
  try {
    if ((await allNotes()).length >= 60) return 'full';
    if (enabled === false) return 'off';
    const { error } = await db().from('max_notes').insert({ text: text.slice(0, 240), sector, created_by: by });
    if (error) throw error;
    notesCache = null;
    return 'ok';
  } catch (e) {
    off(e);
    return 'off';
  }
}

export async function recentMisses(limit = 80): Promise<MissRow[]> {
  if (!usable()) return [];
  try {
    const { data, error } = await db().from('max_misses').select('id, phrase, scope, sector, reason, answer, user_name, created_at').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    enabled = true;
    return (data ?? []) as MissRow[];
  } catch (e) {
    off(e);
    return [];
  }
}

const TABLES = { aprendido: 'max_learned', nota: 'max_notes', falha: 'max_misses' } as const;
export async function forget(kind: keyof typeof TABLES, id: string | 'todas'): Promise<boolean> {
  if (!usable()) return false;
  try {
    const q = db().from(TABLES[kind]).delete();
    const { error } = id === 'todas' ? await q.not('id', 'is', null) : await q.eq('id', id);
    if (error) throw error;
    learnedCache = null;
    notesCache = null;
    return true;
  } catch (e) {
    off(e);
    return false;
  }
}
