import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AccessError, fail, serverError } from '@/lib/http';
import { colabAccess } from '@/lib/pedidos/access';
import { missingP3, p3Fail } from '@/lib/pedidos/server';
import { INDICADORES, fold, linhasDe, type Indicador } from '@/lib/rh/controle';
import { carregarControle } from '@/lib/rh/controleServer';
import { carregarContratos } from '@/lib/rh/contratosServer';
import { controleXlsx } from '@/lib/rh/controleXlsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const disposition = (name: string) => `attachment; filename="${name.normalize('NFD').replace(/[̀-ͯ]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Controle do RH.
 *  sem ?ind → os seis números, o estoque por contrato e as exigências cadastradas;
 *  ?ind=kit_incompleto|pendentes|vencidas|reposicoes|aso|cursos → a relação (pendências e sem informação);
 *  &format=xlsx (com contrato, posto, funcao, q) → a relação filtrada em Excel.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!colabAccess(user)) throw new AccessError(403, 'Você não tem acesso aos colaboradores.');
    const sp = new URL(req.url).searchParams;
    const ind = sp.get('ind') as Indicador | null;
    if (ind && !INDICADORES.some((x) => x.id === ind)) return fail('Indicador inválido.');
    const c = await carregarControle();
    if (!ind) {
      const funcoes = [...new Set(c.colabs.map((x) => x.role).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      // clientes do cadastro e os contratos do RH (a exigência por cliente vale para os dois)
      const contratosRh = (await carregarContratos()).map((x) => x.name);
      const clientes = [...new Set([...contratosRh, ...(c.colabs.map((x) => x.client).filter(Boolean) as string[])])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const empresas = [...new Set(c.colabs.map((x) => x.company).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      return NextResponse.json(
        { hoje: c.hoje, resumo: c.resumo, contratos: c.contratos, estoque: c.estoque, exigencias: c.exigencias, temExigencias: c.temExigencias, semPlanilha: c.semPlanilha, colaboradores: c.colabs.length, funcoes, clientes, empresas },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    let linhas = linhasDe(ind, c.colabs);
    if (sp.get('format') !== 'xlsx') return NextResponse.json({ ind, linhas }, { headers: { 'Cache-Control': 'no-store' } });
    // a mesma busca e os mesmos filtros da tela
    const contrato = sp.get('contrato') ?? '';
    const posto = sp.get('posto') ?? '';
    const funcao = sp.get('funcao') ?? '';
    const q = fold(sp.get('q') ?? '');
    linhas = linhas.filter((l) => (!contrato || l.contrato === contrato) && (!posto || (l.posto_name ?? '') === posto) && (!funcao || (l.role ?? '') === funcao) && (!q || fold(`${l.name} ${l.matricula ?? ''} ${l.item} ${l.contrato} ${l.posto_name ?? ''}`).includes(q)));
    const filtro = [contrato && `Contrato: ${contrato}`, posto && `Posto: ${posto}`, funcao && `Função: ${funcao}`, q && `Busca: ${sp.get('q')}`].filter(Boolean).join(' · ') || 'Todos os colaboradores ativos';
    const buf = await controleXlsx(ind, linhas, filtro, user.display_name);
    const hoje = c.hoje.split('-').reverse().join('-');
    const nome = INDICADORES.find((x) => x.id === ind)!.titulo;
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': disposition(`${nome} ${hoje}.xlsx`), 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (missingP3(e)) return p3Fail();
    return serverError(e);
  }
}
