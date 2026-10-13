import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { COLLAB_SCHEMA, SheetError, loadSheets, readSheets } from '@/lib/almoxarifado/sheetReader';
import { readUpload } from '@/lib/almoxarifado/upload';
import { colabAccess } from '@/lib/pedidos/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Lê a planilha de colaboradores e devolve as linhas para conferir (nada é gravado aqui). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!colabAccess(user, 'edit')) throw new AccessError(403, 'Só o RH importa colaboradores.');
    const up = await readUpload(req);
    if ('error' in up) return up.error;
    let read;
    try {
      read = readSheets(await loadSheets(up.buf, up.name), COLLAB_SCHEMA);
    } catch (e) {
      if (e instanceof SheetError) return fail(e.message, 422);
      throw e;
    }
    const rows = read.rows.map((r) => r.data).filter((d) => String(d.name ?? '').trim());
    if (!rows.length) return fail('Não achei colaboradores na planilha. Ela precisa de uma coluna "Nome" (e, de preferência, Matrícula, Função, Posto e tamanhos).', 422);
    // datas do Excel chegam como número de série
    for (const r of rows) {
      const a = r.admissao;
      if (typeof a === 'number' || (typeof a === 'string' && /^\d{5}$/.test(a))) {
        const d = new Date(Date.UTC(1899, 11, 30) + Number(a) * 86_400_000);
        r.admissao = d.toISOString().slice(0, 10);
      }
    }
    return NextResponse.json({ rows, warnings: read.warnings, columns: read.sheets.flatMap((s) => s.columns.filter((c) => c.field).map((c) => `${c.header} → ${c.field}`)) });
  } catch (e) {
    return serverError(e);
  }
}
