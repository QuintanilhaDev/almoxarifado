import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { COLLAB_SCHEMA, SheetError, loadSheets, readSheets } from '@/lib/almoxarifado/sheetReader';
import { readUpload } from '@/lib/almoxarifado/upload';
import { colabAccess } from '@/lib/pedidos/access';

export const dynamic = 'force-dynamic';
const LABEL: Record<string, string> = {
  matricula: 'matrícula',
  name: 'nome',
  role: 'função',
  client: 'cliente',
  posto: 'posto',
  company: 'empresa',
  admissao: 'admissão',
  telefone: 'telefone',
  camisa: 'camisa',
  calca: 'calça',
  calcado: 'calçado',
};
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
    // a aba de cada linha (a planilha pode ter várias, ex.: "SEM O TRE" e "TODOS"): a tela escolhe qual importar
    const rows: Record<string, string | number | null>[] = read.rows
      .map((r): Record<string, string | number | null> => ({ ...r.data, _aba: r.source.replace(/, linha \d+$/, '') }))
      .filter((d) => String(d.name ?? '').trim());
    if (!rows.length) return fail('Não achei colaboradores na planilha. Ela precisa de uma coluna "Nome" (e, de preferência, Matrícula, Função, Posto e tamanhos).', 422);
    // datas do Excel chegam como número de série
    for (const r of rows) {
      const a = r.admissao;
      if (typeof a === 'number' || (typeof a === 'string' && /^\d{5}$/.test(a))) {
        const d = new Date(Date.UTC(1899, 11, 30) + Number(a) * 86_400_000);
        r.admissao = d.toISOString().slice(0, 10);
      }
    }
    const abas = [...new Set(rows.map((r) => r._aba))].map((nome) => ({ nome, linhas: rows.filter((r) => r._aba === nome).length }));
    // empresa pelo nome do arquivo, para quem não tem a coluna (ex.: "Colaboradores_Max_Servicos.xlsx")
    const f = up.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const empresa = /servic/.test(f) ? 'Max Serviços' : /forte/.test(f) ? 'Max Forte' : /confia/.test(f) ? 'Max Confiável' : '';
    const columns = [...new Set(read.sheets.flatMap((s) => s.columns.filter((c) => c.field).map((c) => `${c.header} → ${LABEL[c.field!] ?? c.field}`)))];
    return NextResponse.json({ rows, abas, empresa, warnings: read.warnings, columns });
  } catch (e) {
    return serverError(e);
  }
}
