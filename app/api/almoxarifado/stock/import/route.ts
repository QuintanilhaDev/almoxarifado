import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireAlmox } from '@/lib/access';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { fetchAll, intOrNull, moneyOrNull, str } from '@/lib/almoxarifado/stockData';
import { ITEM_SCHEMA, SheetError, classify, itemKey, loadSheets, norm, readSheets } from '@/lib/almoxarifado/sheetReader';
import { isMissingColumn } from '@/lib/auth';
import { MISSING_CATEGORIES_SQL, cleanCategories } from '@/lib/almoxarifado/categories';
import { readUpload } from '@/lib/almoxarifado/upload';
import type { ImportPreview } from '@/lib/almoxarifado/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function existingKeys() {
  const rows = await fetchAll<{ name: string; size: string | null }>('stock_items', 'id, name, size', {
    column: 'name_key',
    tiebreak: 'id',
  });
  const keys = new Set(rows.map((r) => itemKey(r.name, r.size)));
  // nome -> uma chave de variação com tamanho já cadastrada
  const sized = new Map<string, string>();
  for (const r of rows) if (norm(r.size)) sized.set(norm(r.name), itemKey(r.name, r.size));
  return { keys, sized };
}

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
 * Passo 1 (multipart, campo "file"): lê a planilha de itens e devolve a pré-visualização.
 * Passo 2 (JSON { rows }): cadastra só os itens novos (mesmo nome + tamanho = já existe,
 * e não é alterado).
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAlmox('estoque', 'edit');
    const { keys: existing, sized } = await existingKeys();

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
        rows: classify(read.rows, (d) => rowKey(d.name, d.size, sized), existing).rows,
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
    let skipped = 0;
    const withCategories = body.rows.some((r) => cleanCategories(r?.categories).length > 0);
    for (const r of body.rows) {
      const name = str(r?.name, 160);
      if (!name) continue;
      const size = str(r.size, 40);
      const k = rowKey(name, size, sized);
      if (existing.has(k) || seen.has(k)) {
        skipped++;
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
    if (added) await broadcast('stock:update', { by: admin.display_name });
    return NextResponse.json({ added, skipped });
  } catch (e) {
    return serverError(e);
  }
}
