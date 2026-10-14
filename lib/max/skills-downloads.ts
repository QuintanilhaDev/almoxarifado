import { SECTORS, sectorPath } from '../sectors';
import { canOpenSector, hasLevel } from '../permissions';
import { downloadAlmoxMetrics } from '../almoxarifado/metricsDownload';
import type { Period } from '../almoxarifado/metrics';
import { windowIn } from './when';
import { listJoin, type Query } from './text';
import type { MaxHost, Skill } from './types';

/**
 * Tudo que a Max baixa na plataforma. Em todos os casos ela corre até os botões de verdade
 * (aba → botão de baixar) e dá um soquinho em cada um; o download acontece no soco.
 */

/** Setores com métricas para baixar: registre aqui a função que gera o gráfico (.png) e a planilha (.xlsx). */
const METRICS_DOWNLOAD: Record<string, (format: 'png' | 'xlsx', period: Period) => Promise<{ filename: string; periodLabel: string }>> = {
  almoxarifado: downloadAlmoxMetrics,
};

const D = 86_400_000;
const tabSel = (id: string) => `.nav-item[data-tab="${id}"], .tab[data-tab="${id}"]`;

/** baixa um arquivo pela rota (o servidor manda como anexo, a página não muda) */
function fileDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** corre e soca (ou, sem o palco, só executa) */
function press(host: MaxHost, sel: string, opts?: { exec?: () => void; skipActive?: boolean }) {
  if (host.press) return host.press(sel, opts);
  if (opts?.exec) return opts.exec();
  if (typeof document !== 'undefined') (document.querySelector(sel) as HTMLElement | null)?.click();
}

/** "baixar", "exportar", "me envia"… (e não "dar baixa", que é movimentação de estoque) */
export function wantsFile(q: Query | { re: (r: RegExp) => RegExpMatchArray | null }): boolean {
  if (q.re(/\b(dar|deu|dei|de|da|demos) (uma |a )?baixa\b/)) return false;
  return Boolean(q.re(/\b(baixar|baixe|baixa|baixando|download|downloads|exportar|exporte|exporta|salvar|salve|salva|gerar|gere|gera|enviar|envie|envia|mandar|mande|manda|imprimir)\b/));
}
const aboutGestao = (q: Query) => Boolean(q.re(/\b(gestao|relatorio geral|relatorio de gestao|indicadores gerais)\b/));
const aboutXml = (q: Query) => Boolean(q.re(/\b(xml|xmls)\b/));
const aboutOrdersFile = (q: Query, host: MaxHost) =>
  Boolean(host.pedidos) && Boolean(q.re(/\b(pedidos? de materia\w*|pedidos|admissoes|trocas)\b/)) && !q.re(/\bsolicitac\w+\b/) && !(host.pedidos?.scope === 'almox' && !q.re(/\b(pedidos? de materia\w*|admissoes|trocas)\b/));

/** A pessoa quer o ARQUIVO das métricas (baixar, exportar, "me envie a planilha"), não só ver os números. */
export function wantsMetricsFile(q: Query | { re: (r: RegExp) => RegExpMatchArray | null }): boolean {
  if (!wantsFile(q)) return false;
  if (q.re(/\b(gestao|pdf|xml|pedidos?|notas?|colaboradores?)\b/)) return false;
  return Boolean(q.re(/\b(metrica|metricas|relatorio|relatorios|indicadores|planilha|planilhas|grafico|graficos|xlsx|png|excel)\b/));
}

export const downloadSkills: Skill[] = [
  /* ---------- métricas de um setor (gráfico .png ou planilha .xlsx) ---------- */
  {
    id: 'download-metrics',
    scopes: ['hub', 'sector'],
    examples: ['Max, desejo baixar as métricas do almoxarifado', 'Max, baixar a planilha das métricas do último mês'],
    match: (q, host) => {
      if (!wantsMetricsFile(q)) return 0;
      // no painel master, "relatório"/"planilha" sem setor é a Gestão
      if (host.scope === 'hub' && !q.re(/\b(metricas?|grafico|graficos)\b/) && !SECTORS.some((s) => s.aliases.some((a) => q.any(a)))) return 0;
      return 0.97;
    },
    run: (q, host) => {
      const named = SECTORS.find((s) => s.aliases.some((a) => q.any(a)) || q.any(s.name));
      const sector = named ?? host.sector;
      if (!sector) {
        const withMetrics = SECTORS.filter((s) => s.metrics).map((s) => s.name);
        return { say: `De qual setor você quer baixar as métricas? Hoje ${withMetrics.length === 1 ? `só o ${withMetrics[0]} tem` : `têm métricas: ${listJoin(withMetrics)}`}.`, chips: withMetrics.map((n) => `Max, baixar as métricas do ${n}`) };
      }
      if (!canOpenSector(host.user, sector.slug)) return { say: `Você não tem acesso ao setor ${sector.name}, então não posso baixar as métricas dele.` };
      const download = METRICS_DOWNLOAD[sector.slug];
      if (!sector.metrics || !download) {
        return { say: `O setor ${sector.name} ainda não possui métricas. Caso queira que esse setor obtenha uma contagem de métricas, contate Mateus na sede.` };
      }
      if (!hasLevel(host.user, sector.slug, 'metricas', 'view')) return { say: `Você não tem acesso às Métricas do setor ${sector.name}. Fale com o master do setor se precisar.` };
      const format: 'png' | 'xlsx' = q.any('planilha', 'planilhas', 'xlsx', 'excel', 'tabela') ? 'xlsx' : 'png';
      const w = windowIn(q.norm);
      const period = w?.standard ?? 'ultima-semana';
      const periodLabel = period === 'ultimo-dia' ? 'último dia' : period === 'ultimo-mes' ? 'último mês' : 'última semana';
      const kind = format === 'png' ? 'o gráfico' : 'a planilha';
      const note = w && !w.standard ? ' Esse arquivo só existe nos períodos da tela de Métricas, então usei a última semana.' : '';
      return {
        say: `Baixando ${kind} das métricas do ${sector.name}, período: ${periodLabel}. Vai para a pasta de downloads do seu computador.${note}`,
        text: `Baixando ${kind} das métricas do ${sector.name} (${periodLabel}).${note}`,
        chips: format === 'png' ? [`Max, baixar a planilha das métricas do ${sector.name}`] : [`Max, baixar o gráfico das métricas do ${sector.name}`],
        act: () => {
          if (host.sector?.slug !== sector.slug) host.navigate(sectorPath(sector.slug), { spoken: true });
          press(host, tabSel('metricas'), { skipActive: true });
          press(host, `[data-testid="dl-${format}"]`, {
            exec: () => {
              download(format, period).catch((e) => console.error('[max] métricas', e));
            },
          });
        },
      };
    },
  },

  /* ---------- relatório da Gestão (Excel ou PDF), no painel master ---------- */
  {
    id: 'download-gestao',
    scopes: ['hub', 'sector'],
    examples: ['Max, baixar o PDF da Gestão', 'Max, exportar a planilha da Gestão dos últimos 90 dias'],
    match: (q, host) => {
      if (!wantsFile(q)) return 0;
      if (aboutGestao(q)) return 0.98;
      // no painel master, "baixar o relatório / o pdf / a planilha" é a Gestão
      if (host.scope === 'hub' && q.re(/\b(relatorios?|pdf|planilhas?|excel|xlsx)\b/) && !q.re(/\b(metricas?|grafico)\b/) && !SECTORS.some((s) => s.aliases.some((a) => q.any(a)))) return 0.96;
      return 0;
    },
    run: (q, host) => {
      if (!host.user?.is_master) return { say: 'Os relatórios da Gestão ficam no painel master, e só quem é master geral consegue baixar.' };
      const pdf = q.re(/\b(pdf|imprimir|relatorio)\b/) && !q.re(/\b(planilhas?|excel|xlsx)\b/);
      const w = windowIn(q.norm);
      const days = w ? Math.max(7, Math.min(365, Math.round((w.toMs - w.fromMs) / D))) : null;
      const kind = pdf ? 'o PDF' : 'a planilha';
      const route = pdf ? '/api/gestao/pdf' : '/api/gestao/export';
      return {
        say: `Baixando ${kind} da Gestão${days ? `, últimos ${days} dias` : ''}. Vai para a pasta de downloads do seu computador.`,
        chips: [pdf ? 'Max, baixar a planilha da Gestão' : 'Max, baixar o PDF da Gestão'],
        act: () => {
          if (host.scope !== 'hub') host.navigate('/hub', { spoken: true });
          press(host, tabSel('gestao'), { skipActive: true });
          press(host, `[data-max="gestao-${pdf ? 'pdf' : 'xlsx'}"]`, days ? { exec: () => fileDownload(`${route}?days=${days}`) } : undefined);
        },
      };
    },
  },

  /* ---------- planilha dos pedidos de material ---------- */
  {
    id: 'download-orders',
    scopes: ['sector'],
    examples: ['Max, baixar a planilha dos pedidos de material'],
    match: (q, host) => (wantsFile(q) && aboutOrdersFile(q, host) && !aboutGestao(q) ? 0.98 : 0),
    run: (_q, host) => {
      if (!host.tabs.some((t) => t.id === 'pedidos')) return { say: 'Você não tem acesso aos pedidos de material. Fale com o master do seu setor.' };
      const list = host.pedidos?.orders();
      if (list === null) return { say: 'Ainda estou carregando os pedidos de material. Tente de novo em alguns segundos.' };
      if (list && !list.length) return { say: 'Ainda não há pedidos de material na lista, então não tem planilha para baixar.' };
      return {
        say: 'Baixando a planilha dos pedidos de material que estão na lista. Vai para a pasta de downloads do seu computador.',
        act: () => {
          press(host, tabSel('pedidos'), { skipActive: true });
          press(host, '[data-max="pedidos-xlsx"]');
        },
      };
    },
  },

  /* ---------- XML de uma nota fiscal ---------- */
  {
    id: 'download-nota-xml',
    scopes: ['sector'],
    examples: ['Max, baixar o XML da nota 1234'],
    match: (q) => (wantsFile(q) && aboutXml(q) ? 0.98 : 0),
    run: async (q, host) => {
      if (!host.tabs.some((t) => t.id === 'notas')) return { say: 'As notas fiscais ficam no Almoxarifado e no Financeiro. Aqui você não tem acesso a elas.' };
      const m = q.norm.match(/\b(?:nota|nf|nfe|numero)(?: fiscal)?(?: numero| n| no)? (\d{1,9})\b/) ?? q.norm.match(/\b(\d{2,9})\b/);
      if (!m) return { say: 'De qual nota? Me diga o número, por exemplo: "Max, baixar o XML da nota 1234".' };
      const num = m[1].replace(/^0+/, '');
      let notes: { id: string; number: string; access_key: string | null }[] = [];
      try {
        const r = await fetch('/api/almoxarifado/notas', { credentials: 'same-origin' });
        notes = ((await r.json()) as { notes?: typeof notes }).notes ?? [];
      } catch {
        return { say: 'Não consegui carregar as notas agora. Tente de novo em alguns segundos.' };
      }
      const n = notes.find((x) => String(x.number).replace(/^0+/, '') === num);
      if (!n) return { say: `Não encontrei a nota número ${num}.` };
      if (!n.access_key) return { say: `A nota ${num} foi digitada à mão, então não tem XML para baixar.` };
      return {
        say: `Baixando o XML da nota ${num}. Vai para a pasta de downloads do seu computador.`,
        act: () => {
          press(host, tabSel('notas'), { skipActive: true });
          press(host, `[data-max-nota="${n.number}"]`);
          press(host, '[data-max="nota-xml"]', { exec: () => fileDownload(`/api/almoxarifado/notas/${n.id}?xml=1`) });
        },
      };
    },
  },
];
