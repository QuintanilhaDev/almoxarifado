import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { canHoras } from '@/lib/horas/access';
import type { ApuracaoHoras } from '@/lib/horas/calculo';
import { horasPdf, horasXlsx, periodoHoras } from '@/lib/horas/relatorio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const disposition = (name: string) => `attachment; filename="${name.normalize('NFD').replace(/[̀-ͯ]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** ?format=zip (padrão: PDF + planilha) | pdf | xlsx */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canHoras(user)) throw new AccessError(403, 'O apurador de horas extras é do RH.');
    const text = await req.text();
    if (text.length > 8_000_000) return fail('Apuração grande demais.', 413);
    let a: ApuracaoHoras;
    try {
      a = JSON.parse(text).apuracao as ApuracaoHoras;
    } catch {
      return fail('Dados inválidos.');
    }
    if (!a || !Array.isArray(a.funcionarios) || !a.periodo || a.funcionarios.length > 3000 || a.funcionarios.some((f) => !Array.isArray(f.dias) || f.dias.length > 800)) return fail('Apuração inválida. Leia o arquivo de novo.');
    const format = new URL(req.url).searchParams.get('format') ?? 'zip';
    const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (format === 'pdf') return new Response(new Uint8Array(await horasPdf(a)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition('RELATÓRIO DE HORAS EXTRAS.pdf'), 'Cache-Control': 'no-store' } });
    if (format === 'xlsx') return new Response(new Uint8Array(await horasXlsx(a)), { headers: { 'Content-Type': xlsxType, 'Content-Disposition': disposition('PLANILHA DE HORAS EXTRAS.xlsx'), 'Cache-Control': 'no-store' } });
    const [pdf, xlsx] = await Promise.all([horasPdf(a), horasXlsx(a)]);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const when = new Date(a.geradoEm);
    zip.file('RELATÓRIO DE HORAS EXTRAS.pdf', pdf, { date: when });
    zip.file('PLANILHA DE HORAS EXTRAS.xlsx', xlsx, { date: when });
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition(`Horas Extras ${periodoHoras(a).replace(/\//g, '-')}.zip`), 'Cache-Control': 'no-store' } });
  } catch (e) {
    return serverError(e);
  }
}
