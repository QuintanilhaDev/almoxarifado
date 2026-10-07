import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { protocolLabel } from '@/lib/format';
import { UUID_RE, dbMessage, intOrNull } from '@/lib/stockData';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

function missingSql(e: unknown): boolean {
  const c = (e as { code?: string } | null)?.code;
  return c === 'PGRST202' || c === '42883' || c === '42703';
}
const MISSING_SQL_MSG = 'Falta rodar o arquivo baixa_e_usuarios.sql no Supabase (passo novo do README).';

async function applications(id: string) {
  const { data } = await db().from('requests').select('stock_applications').eq('id', id).maybeSingle();
  return (data?.stock_applications ?? []) as unknown[];
}

/**
 * Dá baixa nos itens identificados na resposta, de uma vez só (tudo ou nada).
 * A mesma "key" nunca baixa duas vezes (duplo clique, internet que caiu e voltou).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  const body = await readJson<{
    key?: string;
    mode?: string;
    posto_id?: string | null;
    lines?: { item_id?: string; quantity?: unknown }[];
    text?: string;
  }>(req);
  if (!body) return fail('Requisição inválida.');
  if (!body.key || !KEY_RE.test(body.key)) return fail('Requisição inválida. Recarregue a página e tente de novo.');
  const mode = body.mode === 'transferencia' ? 'transferencia' : body.mode === 'saida' ? 'saida' : null;
  if (!mode) return fail('Escolha como dar a baixa.');
  let posto: string | null = null;
  if (mode === 'transferencia') {
    if (!body.posto_id || !UUID_RE.test(body.posto_id)) return fail('Escolha o posto de destino.');
    posto = body.posto_id;
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) return fail('Marque pelo menos um item.');
  if (body.lines.length > 300) return fail('Dê baixa em no máximo 300 itens por vez.');
  const lines: { item_id: string; quantity: number }[] = [];
  for (const l of body.lines) {
    const raw = Number(String(l?.quantity ?? '').replace(',', '.'));
    const q = Number.isInteger(raw) ? intOrNull(raw) : null;
    if (!l?.item_id || !UUID_RE.test(l.item_id) || q === null || q < 1) {
      return fail('Confira os itens: cada um precisa de uma quantidade maior que zero.');
    }
    lines.push({ item_id: l.item_id, quantity: q });
  }
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data: r, error: rerr } = await db().from('requests').select('id, protocol, collaborator').eq('id', id).maybeSingle();
    if (rerr) throw rerr;
    if (!r) return fail('Solicitação não encontrada.', 404);
    const note = `Solicitação ${protocolLabel(r.protocol)}${r.collaborator ? ' · ' + r.collaborator : ''}`.slice(0, 200);
    const { data, error } = await db().rpc('apply_request_baixa', {
      p_request: id,
      p_key: body.key,
      p_mode: mode,
      p_posto: posto,
      p_lines: lines,
      p_note: note,
      p_text: String(body.text ?? '').slice(0, 4000),
      p_by: admin.display_name,
    });
    if (error) {
      if (missingSql(error)) return fail(MISSING_SQL_MSG, 500);
      const m = dbMessage(error);
      if (m) return fail(m, 400);
      throw error;
    }
    const result = (data ?? {}) as { already?: boolean; items?: number; units?: number; application?: unknown };
    if (!result.already) {
      await broadcast('stock:update', { by: admin.display_name });
      if (mode === 'transferencia') await broadcast('postos:update', { by: admin.display_name });
      await broadcast('request:update', { id, by: admin.display_name });
    }
    return NextResponse.json({ ...result, applications: await applications(id) });
  } catch (e) {
    return serverError(e);
  }
}

/** Estorna uma baixa (devolve ao almoxarifado, uma única vez). ?app=<key da baixa> */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail('Solicitação não encontrada.', 404);
  const app = new URL(req.url).searchParams.get('app') ?? '';
  if (!KEY_RE.test(app)) return fail('Baixa inválida.');
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const { data, error } = await db().rpc('revert_request_baixa', { p_request: id, p_app: app, p_by: admin.display_name });
    if (error) {
      if (missingSql(error)) return fail(MISSING_SQL_MSG, 500);
      const m = dbMessage(error);
      if (m) return fail(m, 400);
      throw error;
    }
    await broadcast('stock:update', { by: admin.display_name });
    await broadcast('postos:update', { by: admin.display_name });
    await broadcast('request:update', { id, by: admin.display_name });
    return NextResponse.json({ ...((data ?? {}) as object), applications: await applications(id) });
  } catch (e) {
    return serverError(e);
  }
}
