import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canPontos, type Analise } from '@/lib/pontos/types';
import { diretoriaPdf, pdfName, pontoPdf, safeFileName, zipName } from '@/lib/pontos/pdf';
import { pontoXlsx } from '@/lib/pontos/xlsx';
import { supervisorXlsx } from '@/lib/pontos/supervisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** só ASCII visível, sem aspas nem barra invertida (reserva para navegadores antigos e cabeçalhos) */
const asciiName = (name: string) =>
  safeFileName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
/** nome com acento no download (RFC 5987) e um reserva sem acento */
const disposition = (name: string) =>
  `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(safeFileName(name)).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const cleanLine = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Relatórios da análise (a tela manda a análise já recortada pelos filtros):
 *  ?format=zip (padrão) → RELATÓRIO COMPLETO.pdf + RELATÓRIO PARA DIRETORIA.pdf + RELATÓRIO PARA SUPERVISOR.xlsx
 *  ?format=pdf | diretoria | supervisor | xlsx → um arquivo só.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canPontos(user)) throw new AccessError(403, 'A aba Pontos não está liberada para você.');
    const text = await req.text();
    if (text.length > 8_000_000) return fail('Análise grande demais para o relatório.', 413);
    let a: Analise;
    try {
      a = JSON.parse(text).analise as Analise;
    } catch {
      return fail('Dados inválidos.');
    }
    if (!a || !Array.isArray(a.funcionarios) || !a.periodo?.from || !a.resumo || a.funcionarios.length > 3000 || a.funcionarios.some((f) => !Array.isArray(f.dias) || f.dias.length > 62)) return fail('Análise inválida. Analise o espelho de novo.');
    // datas só no formato AAAA-MM-DD (vão para o PDF e para o nome dos arquivos)
    if (!validDay(a.periodo.from) || !validDay(a.periodo.to)) return fail('Período inválido. Analise o espelho de novo.');
    if (a.filtros && typeof a.filtros === 'object') {
      if (a.filtros.de !== undefined && !validDay(a.filtros.de)) delete a.filtros.de;
      if (a.filtros.ate !== undefined && !validDay(a.filtros.ate)) delete a.filtros.ate;
      for (const k of ['posto', 'filial', 'funcao'] as const) if (a.filtros[k] !== undefined) a.filtros[k] = cleanLine(a.filtros[k], 80) || undefined;
    } else a.filtros = undefined;
    // quem gerou é quem está logado (nunca o que o navegador manda)
    a.geradoPor = user.display_name;
    a.geradoEm = Number.isNaN(Date.parse(String(a.geradoEm))) ? new Date().toISOString() : new Date(a.geradoEm).toISOString();
    a.arquivo = cleanLine(a.arquivo, 120);
    const format = new URL(req.url).searchParams.get('format') ?? 'zip';
    if (format === 'xlsx') {
      const buf = await pontoXlsx(a);
      return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition('PLANILHA DE CONTROLE.xlsx'), 'Cache-Control': 'no-store' } });
    }
    if (format === 'supervisor') return new Response(new Uint8Array(await supervisorXlsx(a)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition('RELATÓRIO PARA SUPERVISOR.xlsx'), 'Cache-Control': 'no-store' } });
    if (format === 'pdf') return new Response(new Uint8Array(await pontoPdf(a)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition('RELATÓRIO COMPLETO.pdf'), 'Cache-Control': 'no-store' } });
    if (format === 'diretoria') return new Response(new Uint8Array(await diretoriaPdf(a)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition('RELATÓRIO PARA DIRETORIA.pdf'), 'Cache-Control': 'no-store' } });
    const [completo, diretoria, supervisor] = await Promise.all([pontoPdf(a), diretoriaPdf(a), supervisorXlsx(a)]);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const when = new Date(a.geradoEm);
    zip.file('RELATÓRIO COMPLETO.pdf', completo, { date: when });
    zip.file('RELATÓRIO PARA DIRETORIA.pdf', diretoria, { date: when });
    zip.file('RELATÓRIO PARA SUPERVISOR.xlsx', supervisor, { date: when });
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition(zipName(a)), 'Cache-Control': 'no-store', 'X-Pdf-Name': asciiName(pdfName(a)) } });
  } catch (e) {
    return serverError(e);
  }
}
