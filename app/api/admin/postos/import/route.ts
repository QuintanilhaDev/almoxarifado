import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { currentAdmin, unauthorized } from '@/lib/auth';
import { fail, readJson, serverError } from '@/lib/http';
import { broadcast } from '@/lib/broadcast';
import { loadPostos, str } from '@/lib/stockData';
import { POSTO_SCHEMA, SheetError, classify, loadSheets, postoKey, readSheets } from '@/lib/sheetReader';
import { readUpload } from '@/lib/upload';
import type { ImportPreview } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Passo 1 (multipart, campo "file"): lê a planilha e devolve a pré-visualização.
 * Passo 2 (JSON { rows }): grava só os postos que ainda não existem.
 * Postos que já estão cadastrados NUNCA são alterados nem substituídos.
 */
export async function POST(req: Request) {
  try {
    const admin = await currentAdmin();
    if (!admin) return unauthorized();
    const existing = new Set((await loadPostos()).map((p) => postoKey(p.name)));

    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const up = await readUpload(req);
      if ('error' in up) return up.error;
      let read;
      try {
        read = readSheets(await loadSheets(up.buf, up.name), POSTO_SCHEMA);
      } catch (e) {
        if (e instanceof SheetError) return fail(e.message, 422);
        throw e;
      }
      if (!read.rows.length) {
        return fail(
          'Não encontrei nenhum posto nessa planilha. Confira se há uma coluna com os nomes (ex.: "Posto" ou "Nome").',
          422,
          { sheets: read.sheets, warnings: read.warnings },
        );
      }
      const preview: ImportPreview = {
        rows: classify(read.rows, (d) => postoKey(d.name), existing).rows,
        sheets: read.sheets,
        ignored: read.ignored,
        warnings: read.warnings,
      };
      return NextResponse.json(preview);
    }

    const body = await readJson<{ rows?: Record<string, unknown>[] }>(req);
    if (!Array.isArray(body?.rows) || !body.rows.length) return fail('Não há postos para adicionar.');
    if (body.rows.length > 5000) return fail('Importe no máximo 5000 postos por vez.');
    const seen = new Set<string>();
    const fresh: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const r of body.rows) {
      const name = str(r?.name, 120);
      if (!name) continue;
      const k = postoKey(name);
      if (existing.has(k) || seen.has(k)) {
        skipped++;
        continue;
      }
      seen.add(k);
      fresh.push({
        name,
        code: str(r.code, 40),
        city: str(r.city, 80),
        address: str(r.address, 200),
        supervisor: str(r.supervisor, 120),
        notes: str(r.notes, 400),
        created_by: admin.display_name,
      });
    }
    let added = 0;
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await db()
        .from('postos')
        .upsert(fresh.slice(i, i + 500), { onConflict: 'name_key', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      added += data?.length ?? 0;
    }
    skipped += fresh.length - added;
    if (added) await broadcast('postos:update', { by: admin.display_name });
    return NextResponse.json({ added, skipped });
  } catch (e) {
    return serverError(e);
  }
}
