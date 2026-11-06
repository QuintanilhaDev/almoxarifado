import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { rateLimit } from '@/lib/rateLimit';
import { UUID_RE } from '@/lib/almoxarifado/stockData';
import { getSector } from '@/lib/sectors';
import { TICKET_COLS, isDev, isKind, isOpen, isPriority, isStatus, type Ticket, type TicketMessage, type TicketStatus } from '@/lib/chamados';
import { chamadosFail, cleanAttachments, cleanText, missingTickets } from '@/lib/chamadosServer';

export const dynamic = 'force-dynamic';

/** Chamados: o desenvolvedor vê todos; os demais, só os que abriram. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const dev = isDev(user);
    // ?todos=1: a fila do desenvolvedor; sem ele, só os chamados que a pessoa abriu
    const todos = dev && new URL(req.url).searchParams.get('todos') === '1';
    let q = db().from('tickets').select(TICKET_COLS).order('updated_at', { ascending: false }).limit(todos ? 1000 : 300);
    if (!todos) q = q.eq('opened_by_id', user.id);
    const { data, error } = await q;
    if (error) {
      if (missingTickets(error)) return NextResponse.json({ tickets: [], dev, setup: true }, { headers: { 'Cache-Control': 'no-store' } });
      throw error;
    }
    return NextResponse.json({ tickets: data ?? [], dev }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}

/** Abre um chamado: { title, description, kind, priority, page, sector, attachments } */
export async function POST(req: Request) {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    if (!rateLimit(`chamado:${user.id}`, 15, 60 * 60_000).ok) return fail('Muitos chamados em pouco tempo. Espere um pouco ou complete um chamado já aberto.', 429);
    const title = cleanText(b.title, 140);
    const text = cleanText(b.description, 4000);
    if (!title) return fail('Dê um título curto ao chamado.');
    if (!text) return fail('Descreva o que aconteceu ou o que você precisa.');
    const kind = isKind(b.kind) ? b.kind : 'erro';
    const priority = isPriority(b.priority) ? b.priority : 'normal';
    const attachments = cleanAttachments(b.attachments, user);
    if (!attachments) return fail('Anexo inválido. Envie o arquivo de novo.');
    const sector = getSector(String(b.sector ?? '')) ? String(b.sector) : user.is_master && b.sector === 'hub' ? 'hub' : user.sector;
    const now = new Date().toISOString();
    const msg: TicketMessage = { at: now, by: user.display_name, dev: isDev(user), text, ...(attachments.length ? { attachments } : {}) };
    const { data, error } = await db()
      .from('tickets')
      .insert({
        sector,
        opened_by_id: user.id,
        opened_by: user.display_name,
        opened_by_user: user.username,
        title,
        kind,
        priority,
        page: cleanText(b.page, 120) || null,
        messages: [msg],
        last_from: 'usuario',
        owner_seen_at: now,
      })
      .select(TICKET_COLS)
      .single();
    if (error) {
      if (missingTickets(error)) return chamadosFail();
      throw error;
    }
    await broadcast('ticket:update', { by: user.display_name, status: 'aberto' });
    return NextResponse.json({ ticket: data });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Conversa e situação do chamado (?id=):
 *  { text?, attachments?, status?, priority?, seen? }
 * Quem abriu: responde, marca como visto, encerra ou reabre o próprio chamado.
 * Desenvolvedor: responde, muda a situação e a prioridade de qualquer chamado.
 */
export async function PATCH(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return fail('Chamado não encontrado.', 404);
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail('Dados inválidos.');
  try {
    const user = await requireUser();
    const dev = isDev(user);
    const { data: cur, error: e0 } = await db().from('tickets').select(TICKET_COLS).eq('id', id).maybeSingle();
    if (e0) {
      if (missingTickets(e0)) return chamadosFail();
      throw e0;
    }
    const t = cur as Ticket | null;
    const owner = !!t && t.opened_by_id === user.id;
    if (!t || (!owner && !dev)) return fail('Chamado não encontrado.', 404);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    // só marcar a resposta como vista (não mexe na ordem da lista)
    if (b.seen === true && owner && b.text == null && b.status == null && b.priority == null) {
      const { data, error } = await db().from('tickets').update({ owner_seen_at: now }).eq('id', id).select(TICKET_COLS).single();
      if (error) throw error;
      return NextResponse.json({ ticket: data });
    }

    const text = cleanText(b.text, 4000);
    const attachments = cleanAttachments(b.attachments, user);
    if (!attachments) return fail('Anexo inválido. Envie o arquivo de novo.');
    if (!text && attachments.length) return fail('Escreva uma mensagem junto com o anexo.');

    let status: TicketStatus | null = null;
    if (b.status != null) {
      if (!isStatus(b.status)) return fail('Situação inválida.');
      if (!dev) {
        // quem abriu só encerra (resolvido/fechado) ou reabre o próprio chamado
        if (!['resolvido', 'fechado', 'aberto'].includes(b.status)) throw new AccessError(403, 'Só o desenvolvedor muda a situação do chamado.');
        if (b.status === 'aberto' && isOpen(t.status)) return fail('O chamado já está em aberto.');
      }
      status = b.status;
    }
    if (b.priority != null) {
      if (!dev) throw new AccessError(403, 'Só o desenvolvedor muda a prioridade.');
      if (!isPriority(b.priority)) return fail('Prioridade inválida.');
      patch.priority = b.priority;
    }

    // o desenvolvedor respondeu e não escolheu a situação: fica "respondido" (aguardando quem abriu)
    if (text && dev && !status && (t.status === 'aberto' || t.status === 'em_andamento') && !owner) status = 'respondido';
    // quem abriu escreveu de novo num chamado encerrado ou respondido: volta para "aberto"
    if (text && owner && !dev && !status && t.status !== 'aberto' && t.status !== 'em_andamento') status = 'aberto';

    if (!text && !status && patch.priority == null) return fail('Escreva uma mensagem ou escolha a situação.');

    const messages = [...(t.messages ?? [])];
    // só a mudança escolhida aparece na conversa ("marcou como resolvido"); a automática (responder, reabrir) não
    const escolhida = b.status != null && status && status !== t.status ? status : null;
    if (text || escolhida) {
      messages.push({ at: now, by: user.display_name, dev, text, ...(attachments.length ? { attachments } : {}), ...(escolhida ? { status: escolhida } : {}) });
    }
    patch.messages = messages.slice(-200);
    patch.updated_at = now;
    if (status) {
      patch.status = status;
      patch.resolved_at = status === 'resolvido' || status === 'fechado' ? (t.resolved_at ?? now) : null;
    }
    if (text) patch.last_from = dev ? 'dev' : 'usuario';
    if (owner) patch.owner_seen_at = now;

    const { data, error } = await db().from('tickets').update(patch).eq('id', id).select(TICKET_COLS).single();
    if (error) throw error;
    await broadcast('ticket:update', { by: user.display_name, status: String(patch.status ?? t.status) });
    return NextResponse.json({ ticket: data });
  } catch (e) {
    return serverError(e);
  }
}
