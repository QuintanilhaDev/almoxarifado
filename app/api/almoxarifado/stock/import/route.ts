import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { dbMessage, fetchAll, intOrNull, moneyOrNull, str } from '@/lib/almoxarifado/stockData';
import { ITEM_SCHEMA, SheetError, classify, itemKey, loadSheets, norm, readSheets } from '@/lib/almoxarifado/sheetReader';
import { isMissingColumn } from '@/lib/auth';
import { MISSING_CATEGORIES_SQL, cleanCategories } from '@/lib/almoxarifado/categories';
import { readUpload } from '@/lib/almoxarifado/upload';
import type { ImportPreview } from '@/lib/almoxarifado/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Current = { id: string; name: string; size: string | null; quantity: number; min_quantity: number; cost: number | null };

async function existingKeys() {
  const rows = await fetchAll<Current>('stock_items', 'id, name, size, quantity, min_quantity, cost', {
    column: 'name_key',
    tiebreak: 'id',
  });
  const byKey = new Map<string, Current>();
  for (const r of rows) byKey.set(itemKey(r.name, r.size), r);
  const keys = new Set(byKey.keys());
  // nome -> uma chave de variação com tamanho já cadastrada
  const sized = new Map<string, string>();
  for (const r of rows) if (norm(r.size)) sized.set(norm(r.name), itemKey(r.name, r.size));
  return { keys, sized, byKey };
}

/** o que muda num item que já existe (só o que veio preenchido na planilha) */
function diffOf(cur: Current, d: Record<string, unknown>) {
  const qty = intOrNull(d.quantity);
  const min = intOrNull(d.min_quantity);
  const cost = moneyOrNull(d.cost);
  return {
    quantity: qty !== null && qty !== Number(cur.quantity) ? qty : null,
    min_quantity: min !== null && min !== Number(cur.min_quantity) ? min : null,
    cost: cost !== null && cost !== (cur.cost === null ? null : Number(cur.cost)) ? cost : null,
  };
}
const changed = (x: ReturnType<typeof diffOf>) => x.quantity !== null || x.min_quantity !== null || x.cost !== null;

/**
 * Chave de comparação de uma linha da planilha. Se o item vem SEM tamanho mas o mesmo
 * produto já existe com tamanho, a linha é tratada como o item que já existe (e não como
 * uma cópia nova "sem tamanho"), evitando duplicar o estoque.
 */
function rowKey(name: unknown, size: unknown, sized: Map<string, string>) {
  const k = itemKey(name, size);
  if (!norm(size)) return sized.get(norm(name)) ?? k;
  return k;
}

/**
 * Passo 1 (multipart, campo "file"): lê a planilha de itens e devolve a pré-visualização,
 * mostrando o que muda nos itens que já existem.
 * Passo 2 (JSON { rows }): cadastra os itens novos e atualiza os que já existem (mesmo nome
 * + tamanho): o saldo vira um ajuste no histórico; mínimo e custo são trocados. Itens que
 * não estão na planilha ficam como estão, e nenhuma movimentação é apagada.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { keys: existing, sized, byKey } = await existingKeys();

    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const up = await readUpload(req);
      if ('error' in up) return up.error;
      let read;
      try {
        read = readSheets(await loadSheets(up.buf, up.name), ITEM_SCHEMA);
      } catch (e) {
        if (e instanceof SheetError) return fail(e.message, 422);
        throw e;
      }
      if (!read.rows.length) {
        return fail(
          'Não encontrei nenhum item nessa planilha. Confira se há uma coluna com a descrição dos produtos.',
          422,
          { sheets: read.sheets, warnings: read.warnings },
        );
      }
      const preview: ImportPreview = {
        rows: classify(read.rows, (d) => rowKey(d.name, d.size, sized), existing).rows.map((r) => {
          if (r.status !== 'exists') return r;
          const cur = byKey.get(rowKey(r.data.name, r.data.size, sized));
          if (!cur) return r;
          const x = diffOf(cur, r.data);
          return {
            ...r,
            status: changed(x) ? ('update' as const) : r.status,
            current: { quantity: Number(cur.quantity), min_quantity: Number(cur.min_quantity), cost: cur.cost === null ? null : Number(cur.cost) },
          };
        }),
        sheets: read.sheets,
        ignored: read.ignored,
        warnings: read.warnings,
      };
      return NextResponse.json(preview);
    }

    const body = await readJson<{ rows?: Record<string, unknown>[] }>(req);
    if (!Array.isArray(body?.rows) || !body.rows.length) return fail('Não há itens para adicionar.');
    if (body.rows.length > 5000) return fail('Importe no máximo 5000 itens por vez.');
    const seen = new Set<string>();
    const fresh: Record<string, unknown>[] = [];
    const updates: { cur: Current; x: ReturnType<typeof diffOf> }[] = [];
    let skipped = 0;
    const withCategories = body.rows.some((r) => cleanCategories(r?.categories).length > 0);
    for (const r of body.rows) {
      const name = str(r?.name, 160);
      if (!name) continue;
      const size = str(r.size, 40);
      const k = rowKey(name, size, sized);
      if (seen.has(k)) {
        skipped++;
        continue;
      }
      if (existing.has(k)) {
        seen.add(k);
        const cur = byKey.get(k);
        const x = cur ? diffOf(cur, r) : null;
        if (cur && x && changed(x)) updates.push({ cur, x });
        else skipped++;
        continue;
      }
      seen.add(k);
      const categories = cleanCategories(r.categories);
      fresh.push({
        name,
        size,
        unit: str(r.unit, 20) ?? 'Cada',
        quantity: intOrNull(r.quantity) ?? 0,
        min_quantity: intOrNull(r.min_quantity) ?? 0,
        cost: moneyOrNull(r.cost),
        // sempre presente: o PostgREST exige as mesmas chaves em todas as linhas do lote
        ...(withCategories ? { categories } : {}),
        created_by: admin.display_name,
      });
    }
    let added = 0;
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await db()
        .from('stock_items')
        .upsert(fresh.slice(i, i + 500), { onConflict: 'name_key,size_key', ignoreDuplicates: true })
        .select('id, name, size, quantity');
      if (error) {
        if (withCategories && isMissingColumn(error)) return fail(MISSING_CATEGORIES_SQL, 409);
        throw error;
      }
      added += data?.length ?? 0;
      if (data?.length) {
        const { error: me } = await db()
          .from('stock_movements')
          .insert(
            data.map((d) => ({
              item_id: d.id,
              item_name: d.name + (d.size ? ` · ${d.size}` : ''),
              kind: 'criacao',
              quantity: d.quantity,
              before_qty: 0,
              after_qty: d.quantity,
              note: 'Importado de planilha',
              by_name: admin.display_name,
            })),
          );
        if (me) console.error(me); // o histórico é secundário: não desfaz a importação
      }
    }
    skipped += fresh.length - added;

    // itens que já existem: saldo por ajuste (fica no histórico), mínimo e custo direto
    let updated = 0;
    const errors: string[] = [];
    const label = (c: Current) => c.name + (c.size ? ` · ${c.size}` : '');
    const one = async ({ cur, x }: (typeof updates)[number]) => {
      if (x.quantity !== null) {
        const { error } = await db().rpc('stock_move', {
          p_item: cur.id,
          p_kind: 'ajuste',
          p_qty: x.quantity,
          p_posto: null,
          p_note: 'Atualizado pela planilha',
          p_by: admin.display_name,
        });
        if (error) {
          errors.push(`${label(cur)}: ${dbMessage(error) ?? 'não consegui ajustar o saldo'}`);
          if (!dbMessage(error)) console.error(error);
          return;
        }
      }
      const patch: Record<string, unknown> = {};
      if (x.min_quantity !== null) patch.min_quantity = x.min_quantity;
      if (x.cost !== null) patch.cost = x.cost;
      if (Object.keys(patch).length) {
        const { error } = await db().from('stock_items').update(patch).eq('id', cur.id);
        if (error) {
          errors.push(`${label(cur)}: não consegui trocar o mínimo/custo`);
          console.error(error);
          if (x.quantity === null) return;
        }
      }
      updated++;
    };
    for (let i = 0; i < updates.length; i += 8) await Promise.all(updates.slice(i, i + 8).map(one));

    if (added || updated) await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ added, updated, skipped, errors });
  } catch (e) {
    return serverError(e);
  }
}
