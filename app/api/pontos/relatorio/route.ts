import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canPontos, type Analise } from '@/lib/pontos/types';
import { diretoriaPdf, pdfName, pontoPdf, zipName } from '@/lib/pontos/pdf';
import { pontoXlsx } from '@/lib/pontos/xlsx';
import { supervisorXlsx } from '@/lib/pontos/supervisor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** nome com acento no download (RFC 5987) e um reserva sem acento */
const disposition = (name: string) => `attachment; filename="${name.normalize('NFD').replace(/[̀-ͯ]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

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
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition(zipName(a)), 'Cache-Control': 'no-store', 'X-Pdf-Name': pdfName(a) } });
  } catch (e) {
    return serverError(e);
  }
}
