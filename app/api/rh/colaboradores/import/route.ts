import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { db } from '@/lib/supabaseAdmin';
import { AccessError, fail, serverError } from '@/lib/http';
import { COLLAB_SCHEMA, SheetError, loadSheets, readSheets } from '@/lib/almoxarifado/sheetReader';
import { readUpload } from '@/lib/almoxarifado/upload';
import { colabAccess } from '@/lib/pedidos/access';
import { fetchAll } from '@/lib/almoxarifado/stockData';

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
    // todas as abas: a mesma pessoa em várias abas já vem juntada (pela matrícula); cada linha diz de onde veio
    const abaDe = (src: string) => src.replace(/, linha \d+$/, '');
    const rows: Record<string, string | number | null>[] = read.rows
      .map((r): Record<string, string | number | null> => ({ ...r.data, _abas: [...new Set((r.sources ?? [r.source]).map(abaDe))].join(' + ') }))
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
    // quem já está cadastrado (mesma matrícula) é atualizado; quem foi desligado continua desligado
    const ex = await fetchAll<{ matricula: string | null; active: boolean }>('collaborators', 'matricula, active', { column: 'id' }, (q) => q.not('matricula', 'is', null));
    const mat = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '') || String(v ?? '').trim();
    const existentes = new Map((ex ?? []).map((e) => [mat(e.matricula), e.active !== false]));
    let novos = 0;
    let atualizar = 0;
    let desligados = 0;
    for (const r of rows) {
      const k = r.matricula ? mat(r.matricula) : '';
      const st = k && existentes.has(k) ? (existentes.get(k) ? 'atualizar' : 'desligado') : 'novo';
      r._status = st;
      if (st === 'novo') novos++;
      else if (st === 'atualizar') atualizar++;
      else desligados++;
    }
    const conta = (campo: string) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const v = String(r[campo] ?? '').trim();
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome, n]) => ({ nome, n }));
    };
    const resumo = { novos, atualizar, desligados, semMatricula: rows.filter((r) => !r.matricula).length, semFuncao: rows.filter((r) => !r.role).length, clientes: conta('client'), funcoes: conta('role') };
    const abas = read.sheets.map((x) => ({ nome: x.name, linhas: x.read, ignorada: x.skipped ?? null, oculta: Boolean(x.hidden) }));
    // empresa pelo nome do arquivo, para quem não tem a coluna (ex.: "Colaboradores_Max_Servicos.xlsx")
    const f = up.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const empresa = /servic/.test(f) ? 'Max Serviços' : /forte/.test(f) ? 'Max Forte' : /confia/.test(f) ? 'Max Confiável' : '';
    const columns = [...new Set(read.sheets.flatMap((s) => s.columns.filter((c) => c.field).map((c) => `${c.header} → ${LABEL[c.field!] ?? c.field}`)))];
    return NextResponse.json({ rows, abas, juntados: read.merged ?? 0, resumo, empresa, warnings: read.warnings, columns });
  } catch (e) {
    return serverError(e);
  }
}
