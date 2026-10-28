import { requireUser } from '@/lib/access';
import { AccessError, serverError } from '@/lib/http';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { deslFail, desligados, temDesligamento } from '@/lib/rh/desligamento';
import { aplicaFiltro, devolucaoPdf, devolucaoXlsx, type FiltroRelatorio } from '@/lib/rh/devolucaoRelatorio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const disposition = (name: string) => `attachment; filename="${name.normalize('NFD').replace(/[̀-ͯ]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Relatório de desligados com a devolução: ?format=pdf|xlsx&situacao=pendentes|todos&cliente=&posto= */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    if (!(await temDesligamento())) return deslFail();
    const q = new URL(req.url).searchParams;
    const f: FiltroRelatorio = { cliente: (q.get('cliente') ?? '').slice(0, 120), posto: (q.get('posto') ?? '').slice(0, 120), situacao: q.get('situacao') === 'todos' ? 'todos' : 'pendentes' };
    const lista = aplicaFiltro(await desligados(), f);
    const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('-');
    const base = `${f.situacao === 'pendentes' ? 'Devoluções pendentes' : 'Desligados e devoluções'} ${hoje}`;
    if (q.get('format') === 'xlsx') {
      const buf = await devolucaoXlsx(lista, f, user.display_name);
      return new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition(`${base}.xlsx`), 'Cache-Control': 'no-store' },
      });
    }
    const buf = await devolucaoPdf(lista, f, user.display_name);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition(`${base}.pdf`), 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
