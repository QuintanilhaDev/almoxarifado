import { NextResponse } from 'next/server';
import { db } from '@/lib/supabaseAdmin';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { SUPPLIER_SCHEMA, SheetError, loadSheets, readSheets } from '@/lib/almoxarifado/sheetReader';
import { readUpload } from '@/lib/almoxarifado/upload';
import type { ImportPreview, ImportPreviewRow } from '@/lib/almoxarifado/types';
import { nameKey, supplierEdit, supplierFields } from '@/lib/compras/fornecedores';
import { missingSuppliers, suppliersSetup } from '@/lib/compras/fornecedoresServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Lê a planilha de fornecedores (a mesma leitura inteligente das outras importações) e devolve
 * a pré-visualização: novo, já cadastrado (vai ser completado com o que a planilha trouxer),
 * repetido na planilha ou com problema. Nada é gravado aqui: a gravação é o POST /api/compras/fornecedores.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!supplierEdit(user)) throw new AccessError(403, 'Só o setor Compras importa fornecedores.');
    const up = await readUpload(req);
    if ('error' in up) return up.error;
    let read;
    try {
      read = readSheets(await loadSheets(up.buf, up.name), SUPPLIER_SCHEMA);
    } catch (e) {
      if (e instanceof SheetError) return fail(e.message, 422);
      throw e;
    }
    if (!read.rows.length) {
      return fail('Não encontrei fornecedores nessa planilha. Confira se há uma coluna com o nome (ex.: "Razão social" ou "Fornecedor").', 422, { sheets: read.sheets, warnings: read.warnings });
    }

    const { data: existing, error } = await db().from('suppliers').select('id, name, cnpj').limit(20000);
    if (error) throw error;
    const docs = new Set<string>();
    const names = new Set<string>();
    for (const e of (existing ?? []) as { name: string; cnpj: string | null }[]) {
      if (e.cnpj) docs.add(e.cnpj);
      names.add(nameKey(e.name));
    }
    const seen = new Set<string>();
    const rows: ImportPreviewRow[] = read.rows.map((r) => {
      const f = supplierFields(r.data);
      if ('error' in f) return { data: r.data, status: 'invalid', error: f.error, source: r.source };
      const key = f.row.cnpj ? `d:${f.row.cnpj}` : `n:${nameKey(f.row.name)}`;
      if (seen.has(key)) return { data: f.row as unknown as ImportPreviewRow['data'], status: 'duplicate', source: r.source };
      seen.add(key);
      const known = f.row.cnpj ? docs.has(f.row.cnpj) : names.has(nameKey(f.row.name));
      return { data: f.row as unknown as ImportPreviewRow['data'], status: known ? 'exists' : 'new', source: r.source };
    });
    const preview: ImportPreview = { rows, sheets: read.sheets, ignored: read.ignored, warnings: read.warnings };
    return NextResponse.json(preview);
  } catch (e) {
    if (missingSuppliers(e)) return suppliersSetup();
    return serverError(e);
  }
}
