import { formatDateTime, protocolLabel, timeAgo } from '../format';
import type { MetricsData, Period } from '../almoxarifado/metrics';
import type { Posto, PostoStockLine, RequestStatus, StockItem } from '../almoxarifado/types';
import { maxEmit } from './bus';
import { bestMatches, contentTokens, listJoin, normalize, plural, type Query } from './text';
import type { MaxHost, MaxReply, Skill } from './types';
import type { RangeData } from '../almoxarifado/range';
import { windowIn, type TimeWindow } from './when';
import { categoryInPhrase, countCategories, hasCategory } from '../almoxarifado/categories';

const SECTOR = 'almoxarifado';
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const itemLabel = (i: { name: string; size: string | null }) => i.name + (i.size ? ` · ${i.size}` : '');
const isLow = (i: StockItem) => i.min_quantity > 0 && i.quantity <= i.min_quantity;
/** quantidade para falar: "zerado" soa melhor do que "com 0" */
const withQty = (n: number) => (n === 0 ? 'zerado' : `com ${fmt(n)}`);
/** "do Posto 01" / "do posto Shopping Barra" (sem repetir a palavra posto) */
const ofPosto = (name: string) => (/^posto\b/i.test(name.trim()) ? `do ${name}` : `do posto ${name}`);
const thePosto = (name: string) => (/^posto\b/i.test(name.trim()) ? `O ${name}` : `O posto ${name}`);
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
/** dentro do setor a Max abre a tela; no painel master ela só responde */
const inSector = (host: MaxHost) => host.scope === 'sector';
const opened = (host: MaxHost) => (inSector(host) ? ' Abri para você.' : '');

const REQ_WORDS = ['solicitacao', 'solicitacoes', 'pedido', 'pedidos', 'requisicao', 'requisicoes', 'chamado', 'chamados'];
const STOCK_WORDS = ['estoque', 'almoxarifado', 'saldo', 'inventario'];

const PERIOD_SPOKEN: Record<Period, string> = {
  hoje: 'Hoje',
  'ultimo-dia': 'Nas últimas 24 horas',
  'ultima-semana': 'Na última semana',
  'ultimo-mes': 'No último mês',
};

/** Período citado na frase (ou null se não falou de tempo). */
export function periodIn(q: Query): Period | null {
  if (q.re(/\b(mes|mensal|30 dias|trinta dias|ultimos 30|4 semanas|quatro semanas)\b/)) return 'ultimo-mes';
  if (q.re(/\b(semana|semanal|7 dias|sete dias|ultimos 7|ultimos dias)\b/)) return 'ultima-semana';
  if (q.re(/\b(24 horas|24h|vinte e quatro horas|ultimo dia|ontem|ultimas horas|de ontem pra ca|de ontem para ca)\b/)) return 'ultimo-dia';
  if (q.re(/\b(hoje|do dia|de hoje|agora|neste momento|ate agora)\b/)) return 'hoje';
  return null;
}

function noAccess(what: string): MaxReply {
  return { say: `Você não tem acesso a ${what} neste setor. Fale com o master do setor se precisar.` };
}

function loading(what: string): MaxReply {
  return { say: `Ainda estou carregando ${what}. Tente de novo em alguns segundos.` };
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Não consegui consultar agora.');
  return j as T;
}

/** O que a pessoa quer procurar no estoque ("quanto tem de bota 42" -> "bota 42"). */
export function stockNeedle(q: Query): string | null {
  const patterns: RegExp[] = [
    /\b(?:quant[oa]s?) (?:\w+ )?(?:tem|temos|ha|existe|existem|sobrou|sobraram|resta|restam|ficou|ficaram)(?: ainda)? (?:de |do |da |dos |das )?(.+)$/,
    /\b(?:quant[oa]s?) (.+?) (?:tem|temos|ha|existe|existem|sobrou|sobraram|resta|restam)\b.*$/,
    /\b(?:saldo|quantidade|estoque|disponibilidade) (?:atual )?(?:de |do |da |dos |das )(.+)$/,
    /\b(?:tem|temos|ha|existe|ainda tem|sobrou) (.+?) (?:no|em|na) (?:estoque|almoxarifado)\b.*$/,
    /\b(?:procur\w+|busc\w+|pesquis\w+|localiz\w+|ach\w+|encontr\w+|consult\w+)(?: por| o| a| os| as| um| uma)? (.+)$/,
    /\b(?:cade|onde esta|onde estao|onde fica|onde ficam)(?: o| a| os| as)? (.+)$/,
  ];
  for (const p of patterns) {
    const m = q.norm.match(p);
    if (!m) continue;
    const needle = m[1]
      .replace(/\b(no|em|na|do|da) (estoque|almoxarifado)\b/g, ' ')
      .replace(/\b(disponivel|disponiveis|ai|agora|hoje|atualmente|por favor|pra mim|para mim|ainda|temos|tem)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (needle) return needle;
  }
  return null;
}

const GENERIC = new Set(['item', 'itens', 'iten', 'produto', 'produtos', 'coisa', 'coisas', 'material', 'materiais', 'unidade', 'unidades', 'peca', 'pecas', 'estoque', 'almoxarifado', 'tudo', 'total']);
const OTHER_TOPIC = new Set(['posto', 'postos', 'usuario', 'usuarios', 'email', 'emails', 'e-mail', 'e-mails', 'pessoa', 'pessoas', 'supervisor', 'supervisores', ...REQ_WORDS]);

function findPosto(q: Query, postos: Posto[]): Posto | null {
  const m = q.norm.match(/\bpostos? (?:de |do |da |d[oa]s |chamado |numero |n )?(.+)$/);
  const needle = (m ? m[1] : q.norm).replace(/\b(tem|ha|possui|estoque|itens|o que|quais|mostrar|abrir|ver)\b/g, ' ').trim();
  if (!needle) return null;
  // primeiro o nome inteiro ("Posto 01", "Shopping Barra"), depois por partes
  const exact = postos.find((p) => normalize(p.name) === normalize('posto ' + needle) || normalize(p.name) === needle);
  if (exact) return exact;
  const hits = bestMatches(needle, postos, (p) => `${p.name} ${p.code ?? ''}`, 0.7, 2);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[0].score - hits[1].score < 0.05) return null; // ambíguo
  return hits[0].item;
}

function requestCounts(host: MaxHost) {
  const list = host.almox?.requests() ?? null;
  if (!list) return null;
  const c: Record<RequestStatus, number> = { nova: 0, pendente: 0, resolvida: 0 };
  list.forEach((r) => c[r.status]++);
  return { list, c };
}

const LOW_RE = /\b(estoque (baixo|minimo|critico)|abaixo do minimo|no minimo|acabando|em falta|faltando|precis\w+ (repor|comprar)|repor|reposicao|o que comprar|lista de compras?|zerad[oa]s?|sem saldo|esgotad[oa]s?|sem estoque|acabou|acabaram)\b/;
const CAT_FILLER = new Set(['categoria', 'categorias', 'max', 'tipo', 'grupo', 'linha']);

/* ---------- movimentação em um período qualquer ---------- */
const OUT_RE = /\b(sai|saiu|sairam|saindo|saida|saidas|enviad\w+|enviamos|enviou|enviaram|transferid\w+|transferimos|transferiu|transferiram|retirad\w+|retirou|retiraram|despachad\w+|distribuid\w+|entregues?|entregou|entregaram|entregamos)\b/;
const IN_RE = /\b(entrou|entraram|entrando|entrada|entradas|recebid\w+|recebemos|recebeu|receberam|devolvid\w+|devolveu|devolveram|devolucao|devolucoes|repost\w+|repusemos|(chegou|chegaram) (no|ao|em) (estoque|almoxarifado))\b/;
/** a frase fala de movimentação (algo que aconteceu), não do saldo de agora */
export const aboutMoves = (q: Query) => OUT_RE.test(q.norm) || IN_RE.test(q.norm);

async function getRange(w: TimeWindow): Promise<RangeData> {
  return getJson<RangeData>(`/api/almoxarifado/metrics/range?from=${encodeURIComponent(new Date(w.fromMs).toISOString())}&to=${encodeURIComponent(new Date(w.toMs).toISOString())}`);
}

/** Item citado em uma pergunta de movimentação ("quantas botas saíram ontem" -> "botas"). */
export function movedNeedle(q: Query): string | null {
  const patterns: RegExp[] = [
    /\bquant[oa]s? (?:unidades de |pecas de |itens de )?(.+?) (?:sai\w*|entr\w+|foram|foi|for|receb\w+|cheg\w+|devolv\w+|envi\w+|transfer\w+|retir\w+)\b/,
    /\b(?:saidas?|entradas?|devoluc\w+) (?:de|do|da|dos|das) (.+)$/,
    /\b(?:sai|saiu|sairam|entrou|entraram|enviad\w+|enviamos|transferid\w+|retirad\w+|recebid\w+|recebemos|devolvid\w+) (?:de |do |da |dos |das )?(.+)$/,
  ];
  for (const p of patterns) {
    const m = q.norm.match(p);
    if (!m) continue;
    const cleaned = m[1]
      .replace(/\b(n[oa]s?|d[oa]s?|de|em|ultim[oa]s?|\d+|horas?|dias?|semanas?|mes|meses|minutos?|hoje|ontem|anteontem|esta|essa|este|esse|nesta|nessa|neste|nesse|passad[oa]s?|desde|ate|agora|pra|para|ca|aos?|postos?|foram|foi|que|mais|menos|ja|meia)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const toks = contentTokens(cleaned);
    if (toks.length && !toks.every((t) => GENERIC.has(t))) return toks.filter((t) => !GENERIC.has(t)).join(' ');
  }
  return null;
}

const movesSkill: Skill = {
  id: 'almox-moves',
  sector: SECTOR,
  examples: ['Max, quantos itens saíram nas últimas 15 horas?', 'Max, o que entrou no estoque ontem?', 'Max, quantas botas saíram esta semana?'],
  match: (q, host) => {
    const out = OUT_RE.test(q.norm);
    const inn = IN_RE.test(q.norm);
    if (!out && !inn) return 0;
    if (q.any(...REQ_WORDS)) return 0; // "quantas solicitações recebemos" é outra pergunta
    if (host.scope === 'hub' && !q.any('almoxarifado', 'almox', 'estoque', 'itens', 'item', 'unidades')) return 0;
    const asks = Boolean(q.re(/\b(quant[oa]s?|quais?|o que|que|teve|houve|tivemos|mostr\w+|ver|list\w+|total|resumo|me (diz|diga|fala|fale|informe))\b/));
    if (!asks && !windowIn(q.norm)) return 0;
    // entradas E saídas juntas, sem item: é o resumo das métricas
    if (out && inn && !movedNeedle(q)) return 0;
    return 0.94;
  },
  run: async (q, host) => {
    if (!host.can('metricas') && !host.can('estoque')) return noAccess('Métricas');
    const explicit = windowIn(q.norm);
    const w: TimeWindow = explicit ?? { fromMs: Date.now() - 7 * 86_400_000, toMs: Date.now(), label: 'Nos últimos 7 dias', standard: 'ultima-semana' };
    let data: RangeData;
    try {
      data = await getRange(w);
    } catch (e) {
      return { say: `Não consegui ler as movimentações agora. ${(e as Error).message}` };
    }
    const wantsOut = OUT_RE.test(q.norm);
    const wantsIn = IN_RE.test(q.norm);
    const dir: 'out' | 'in' = wantsOut || !wantsIn ? 'out' : 'in';
    const t = data.totals;
    const lead = w.label;
    const noPeriod = explicit ? '' : ' Como você não disse o período, considerei os últimos 7 dias.';
    const verb = (n: number) => (dir === 'out' ? (n === 1 ? 'saiu' : 'saíram') : n === 1 ? 'entrou' : 'entraram');
    const place = dir === 'out' ? 'do almoxarifado' : 'no almoxarifado';
    const act =
      inSector(host) && w.standard && host.can('metricas')
        ? () => {
            host.goTab('metricas');
            maxEmit('almox:metricas', { period: w.standard! });
          }
        : undefined;

    // pergunta sobre um item específico
    const needle = movedNeedle(q);
    if (needle) {
      const hits = bestMatches(needle, data.items, (i) => i.name, 0.6, 60);
      const best = hits[0]?.score ?? 0;
      const close = hits.filter((h) => h.score >= best - 0.08).map((h) => h.item);
      const both = wantsOut && wantsIn;
      const sum = (k: 'in' | 'out') => close.reduce((a, i) => a + i[k], 0);
      if (!close.length || (!both && sum(dir) === 0)) {
        return { say: `${lead} não ${dir === 'out' ? 'saiu' : 'entrou'} nenhuma unidade de “${needle}” ${place}.${noPeriod}`, act };
      }
      // um item só: fala o nome como está cadastrado
      const moved = close.filter((i) => (both ? i.in + i.out : i[dir]) > 0);
      const what = moved.length === 1 ? moved[0].name.replace(' · ', ' ') : `“${needle}”`;
      const rows = moved
        .sort((a, b) => b[dir] - a[dir])
        .slice(0, 8)
        .map((i) => ({ label: i.name, value: both ? `+${fmt(i.in)} / −${fmt(i.out)}` : fmt(i[dir]) }));
      return {
        say: both
          ? `${lead}, de ${what}, entraram ${plural(sum('in'), 'unidade', 'unidades')} e saíram ${fmt(sum('out'))}.${noPeriod}`
          : `${lead} ${verb(sum(dir))} ${plural(sum(dir), 'unidade', 'unidades')} de ${what} ${place}${rows.length > 1 ? `, em ${fmt(rows.length)} variações` : ''}.${noPeriod}`,
        card: { kind: 'list', title: `${lead} · ${both ? 'entradas / saídas' : dir === 'out' ? 'saídas' : 'entradas'} de “${needle}”`, rows },
        act,
        source: 'metricas',
      };
    }

    const units = dir === 'out' ? t.out : t.in;
    const kinds = dir === 'out' ? t.itemsOut : t.itemsIn;
    const moves = dir === 'out' ? t.outMoves : t.inMoves;
    if (units === 0) {
      return { say: `${lead} não ${dir === 'out' ? 'saiu' : 'entrou'} nenhum item ${place}.${noPeriod}`, act, source: 'metricas' };
    }
    const top = data.items.filter((i) => i[dir] > 0).sort((a, b) => b[dir] - a[dir]);
    let say = `${lead} ${verb(units)} ${plural(units, 'unidade', 'unidades')} ${place}, de ${plural(kinds, 'item diferente', 'itens diferentes')}, em ${plural(moves, 'movimentação', 'movimentações')}.`;
    if (dir === 'out' && t.toPostos > 0) say += t.toPostos === t.out ? ' Tudo foi para postos.' : ` ${fmt(t.toPostos)} ${t.toPostos === 1 ? 'foi' : 'foram'} para postos.`;
    if (dir === 'in' && t.returned > 0) say += ` ${fmt(t.returned)} ${t.returned === 1 ? 'veio' : 'vieram'} de devolução de postos.`;
    if (top[0]) say += ` O que mais ${dir === 'out' ? 'saiu' : 'entrou'} foi ${top[0].name.replace(' · ', ' ')}, com ${fmt(top[0][dir])}.`;
    return {
      say: say + noPeriod,
      card: {
        kind: 'list',
        title: `${lead} · ${dir === 'out' ? 'saídas do almoxarifado' : 'entradas no almoxarifado'}`,
        rows: top.slice(0, 6).map((i) => ({ label: i.name, value: fmt(i[dir]) })),
        foot: `Total: ${plural(units, 'unidade', 'unidades')} · ${plural(kinds, 'item', 'itens')} · ${plural(moves, 'movimentação', 'movimentações')}${data.truncated ? ' (período muito grande: valores parciais)' : ''}`,
      },
      act,
      chips: inSector(host) ? ['Max, o que entrou no estoque ontem?', 'Max, métricas da última semana'] : undefined,
      source: 'metricas',
    };
  },
};

/** Resumo (entradas, saídas, solicitações) de um período fora dos botões da tela de Métricas. */
async function customMetrics(w: TimeWindow): Promise<MaxReply> {
  let data: RangeData;
  try {
    data = await getRange(w);
  } catch (e) {
    return { say: `Não consegui ler as métricas agora. ${(e as Error).message}` };
  }
  const t = data.totals;
  const net = t.in - t.out;
  const r = data.requests;
  const open = r.nova + r.pendente;
  let say: string;
  if (t.in === 0 && t.out === 0 && r.total === 0) say = `${w.label} não houve movimentação no estoque nem solicitações.`;
  else {
    const netText = net === 0 ? 'saldo zerado' : net > 0 ? `saldo positivo de ${plural(net, 'unidade', 'unidades')}` : `saldo negativo de ${plural(-net, 'unidade', 'unidades')}`;
    say = `${w.label} foram ${plural(t.in, 'entrada', 'entradas')} e ${plural(t.out, 'saída', 'saídas')} em unidades, com ${netText}.`;
    say += r.total ? ` Chegaram ${plural(r.total, 'solicitação', 'solicitações')}${open ? `, ${open === 1 ? '1 ainda aberta' : `${fmt(open)} ainda abertas`}` : ', todas resolvidas'}.` : ' Nenhuma solicitação chegou no período.';
    const top = data.items.filter((i) => i.out > 0).sort((a, b) => b.out - a.out)[0];
    if (top) say += ` O item que mais saiu foi ${top.name.replace(' · ', ' ')}, com ${plural(top.out, 'unidade', 'unidades')}.`;
  }
  return {
    say,
    card: {
      kind: 'stats',
      title: w.label,
      stats: [
        { label: 'Entradas', value: fmt(t.in), tone: 'in' },
        { label: 'Saídas', value: fmt(t.out), tone: 'out' },
        { label: 'Saldo', value: (net > 0 ? '+' : '') + fmt(net), tone: net < 0 ? 'warn' : 'plain' },
        { label: 'Solicitações', value: fmt(r.total) },
        { label: 'Em aberto', value: fmt(open), tone: open ? 'warn' : 'plain' },
        { label: 'Para postos', value: fmt(t.toPostos) },
      ],
      foot: 'Período personalizado: a tela de Métricas mostra só os períodos fixos.',
    },
    source: 'metricas',
  };
}

export const almoxSkills: Skill[] = [
  movesSkill,
  /* ---------- métricas ---------- */
  {
    id: 'almox-metrics',
    sector: SECTOR,
    examples: ['Max, métricas da última semana', 'Max, como foi o mês?', 'Max, entradas e saídas de hoje'],
    match: (q, host) => {
      // no painel master, "métricas" sozinho é o resumo do hub; as do almoxarifado precisam ser pedidas pelo nome
      if (host.scope === 'hub' && !q.any('almoxarifado', 'almox', 'estoque')) return 0;
      const period = windowIn(q.norm);
      if (q.any('metrica', 'metricas', 'relatorio', 'relatorios', 'indicador', 'indicadores', 'desempenho', 'balanco', 'movimentacao', 'movimentacoes', 'estatistica', 'estatisticas', 'dashboard', 'grafico')) return 0.93;
      if (q.any('entrada', 'entradas', 'entrou', 'entraram') && q.any('saida', 'saidas', 'saiu', 'sairam')) return 0.92;
      if (period && q.any('entrada', 'entradas', 'saida', 'saidas', 'saiu', 'sairam', 'entrou', 'entraram', 'movimentou', 'movimento')) return 0.9;
      if (period && q.any('resumo', 'numeros', 'resultado', 'resultados', 'panorama', 'visao geral')) return 0.9;
      if (period && period.standard !== 'hoje' && q.any(...REQ_WORDS) && q.any('quantas', 'quantos', 'chegaram', 'recebemos', 'vieram', 'tivemos', 'foram')) return 0.91;
      const offTopic = q.any('tempo', 'clima', 'chuva', 'chover', 'temperatura', 'previsao', 'calor', 'frio', 'dolar', 'euro', 'transito', 'jogo', 'voce');
      if (period && !offTopic && q.re(/\b(como (foi|foram|esta|estao|ta|anda|andam)|me atualiz\w+|me da um resumo|o que aconteceu|o que rolou)\b/)) return 0.88;
      return 0;
    },
    run: async (q, host) => {
      if (!host.can('metricas')) return noAccess('Métricas');
      // período fora dos botões da tela ("últimas 15 horas", "ontem", "mês passado"…)
      const w = windowIn(q.norm);
      if (w && !w.standard) return customMetrics(w);
      const period = w?.standard ?? periodIn(q) ?? 'ultima-semana';
      let data: MetricsData;
      try {
        data = (await getJson<{ data: MetricsData }>(`/api/almoxarifado/metrics?period=${period}`)).data;
      } catch (e) {
        return { say: `Não consegui ler as métricas agora. ${(e as Error).message}` };
      }
      const t = data.totals;
      const lead = PERIOD_SPOKEN[period];
      let say: string;
      if (t.moves === 0 && t.requests === 0) {
        say = `${lead} não houve movimentação no estoque nem solicitações.`;
      } else {
        const net = t.net === 0 ? 'saldo zerado' : t.net > 0 ? `saldo positivo de ${plural(t.net, 'unidade', 'unidades')}` : `saldo negativo de ${plural(-t.net, 'unidade', 'unidades')}`;
        say = `${lead} foram ${plural(t.in, 'entrada', 'entradas')} e ${plural(t.out, 'saída', 'saídas')} em unidades, com ${net}.`;
        say += t.requests
          ? ` Chegaram ${plural(t.requests, 'solicitação', 'solicitações')}${t.requestsOpen ? `, ${t.requestsOpen === 1 ? '1 ainda aberta' : `${fmt(t.requestsOpen)} ainda abertas`}` : ', todas resolvidas'}.`
          : ' Nenhuma solicitação chegou no período.';
        const top = data.items.find((i) => i.out > 0);
        if (top) say += ` O item que mais saiu foi ${top.name}, com ${plural(top.out, 'unidade', 'unidades')}.`;
      }
      if (data.stock.low > 0) say += ` Atenção: ${plural(data.stock.low, 'item está', 'itens estão')} com estoque baixo.`;
      return {
        say,
        card: {
          kind: 'stats',
          title: `${data.periodLabel} · ${data.rangeLabel}`,
          stats: [
            { label: 'Entradas', value: fmt(t.in), tone: 'in' },
            { label: 'Saídas', value: fmt(t.out), tone: 'out' },
            { label: 'Saldo', value: (t.net > 0 ? '+' : '') + fmt(t.net), tone: t.net < 0 ? 'warn' : 'plain' },
            { label: 'Solicitações', value: fmt(t.requests), tone: 'plain' },
            { label: 'Em aberto', value: fmt(t.requestsOpen), tone: t.requestsOpen ? 'warn' : 'plain' },
            { label: 'Estoque baixo', value: fmt(data.stock.low), tone: data.stock.low ? 'warn' : 'plain' },
          ],
          foot: inSector(host) ? 'Abri a tela de Métricas com esse período.' : 'Almoxarifado · para ver o gráfico, abra o setor.',
        },
        act: () => {
          if (inSector(host)) {
            host.goTab('metricas');
            maxEmit('almox:metricas', { period });
          } else {
            // deixa o período escolhido para quando o master abrir o setor
            try {
              localStorage.setItem('almox:metricas:periodo', period);
            } catch {
              /* ignore */
            }
          }
        },
        chips: inSector(host) ? ['Max, o que está com estoque baixo?', 'Max, como foi o mês?'] : ['Max, abrir o almoxarifado', 'Max, o que está com estoque baixo?'],
        source: 'metricas',
      };
    },
  },

  /* ---------- solicitações ---------- */
  {
    id: 'almox-request-open',
    sector: SECTOR,
    examples: ['Max, abrir a solicitação 12'],
    match: (q) => (q.any(...REQ_WORDS, 'protocolo') && q.numbers.length > 0 && !windowIn(q.norm) ? 0.93 : 0),
    run: (q, host) => {
      if (!host.can('solicitacoes')) return noAccess('Solicitações');
      const list = host.almox?.requests();
      if (!list) return loading('as solicitações');
      const n = q.numbers[0];
      const r = list.find((x) => x.protocol === n);
      if (!r) return { say: `Não encontrei a solicitação número ${n}.`, text: `Não encontrei a solicitação ${protocolLabel(n)}.` };
      const status = r.status === 'nova' ? 'nova' : r.status === 'pendente' ? 'pendente' : 'resolvida';
      return {
        say: `Solicitação ${n}, de ${r.collaborator || 'colaborador não informado'}${r.posto ? `, ${ofPosto(r.posto)}` : ''}. Está ${status}.${opened(host)}`,
        text: `${protocolLabel(r.protocol)} · ${r.collaborator || 'Colaborador'}${r.posto ? ' · ' + r.posto : ''} · ${status} · ${formatDateTime(r.created_at)}`,
        act: () => {
          host.goTab('solicitacoes');
          maxEmit('almox:inbox', { filter: r.status, protocol: r.protocol });
        },
      };
    },
  },
  {
    id: 'almox-request-latest',
    sector: SECTOR,
    examples: ['Max, qual foi a última solicitação?'],
    match: (q) => (q.any(...REQ_WORDS) && q.re(/\b(ultim[oa]|mais recente|mais nov[oa]|acabou de chegar|chegou agora|recente)\b/) && !q.re(/\bultim[oa]s? (semana|mes|dia|dias|horas)\b/) ? 0.92 : 0),
    run: (_q, host) => {
      if (!host.can('solicitacoes')) return noAccess('Solicitações');
      const list = host.almox?.requests();
      if (!list) return loading('as solicitações');
      if (!list.length) return { say: 'Ainda não chegou nenhuma solicitação.' };
      const r = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const ago = timeAgo(r.created_at);
      return {
        say: `A mais recente é a número ${r.protocol}, de ${r.collaborator || 'colaborador não informado'}${r.posto ? `, ${ofPosto(r.posto)}` : ''}. Está ${r.status}.${opened(host)}`,
        text: `${protocolLabel(r.protocol)} · ${r.collaborator || 'Colaborador'}${r.posto ? ' · ' + r.posto : ''} · ${r.status} · ${ago === 'agora' ? 'agora' : 'há ' + ago}`,
        act: () => {
          host.goTab('solicitacoes');
          maxEmit('almox:inbox', { filter: r.status, protocol: r.protocol });
        },
      };
    },
  },
  {
    id: 'almox-request-count',
    sector: SECTOR,
    examples: ['Max, tem solicitação nova?', 'Max, quantas solicitações pendentes?'],
    match: (q) => {
      if (!q.any(...REQ_WORDS)) return 0;
      if (q.any('quantas', 'quantos', 'tem', 'temos', 'ha', 'existe', 'existem', 'chegou', 'chegaram', 'nova', 'novas', 'novo', 'novos', 'pendente', 'pendentes', 'resolvida', 'resolvidas', 'aberta', 'abertas', 'aberto', 'atrasada', 'atrasadas', 'situacao', 'status', 'resumo', 'fila', 'mostrar', 'mostre', 'mostra', 'ver', 'listar', 'liste')) return 0.89;
      return 0;
    },
    run: (q, host) => {
      if (!host.can('solicitacoes')) return noAccess('Solicitações');
      const data = requestCounts(host);
      if (!data) return loading('as solicitações');
      const { c } = data;
      const wants: RequestStatus | null = q.any('pendente', 'pendentes', 'atrasada', 'atrasadas')
        ? 'pendente'
        : q.any('resolvida', 'resolvidas', 'concluida', 'concluidas', 'finalizada', 'finalizadas')
          ? 'resolvida'
          : q.any('nova', 'novas', 'novo', 'novos', 'chegou', 'chegaram')
            ? 'nova'
            : null;
      const card = {
        kind: 'stats' as const,
        title: 'Solicitações',
        stats: [
          { label: 'Novas', value: fmt(c.nova), tone: c.nova ? ('warn' as const) : ('plain' as const) },
          { label: 'Pendentes', value: fmt(c.pendente), tone: 'plain' as const },
          { label: 'Resolvidas', value: fmt(c.resolvida), tone: 'in' as const },
        ],
      };
      const go = (filter: RequestStatus) => () => {
        host.goTab('solicitacoes');
        maxEmit('almox:inbox', { filter });
      };
      if (wants === 'nova') {
        return { say: c.nova ? `Sim, ${c.nova === 1 ? 'há 1 solicitação nova' : `há ${fmt(c.nova)} solicitações novas`} esperando.` : 'Nenhuma solicitação nova no momento.', card, act: go('nova') };
      }
      if (wants === 'pendente') {
        return { say: c.pendente ? `${c.pendente === 1 ? 'Há 1 solicitação pendente' : `Há ${fmt(c.pendente)} solicitações pendentes`}.` : 'Nenhuma solicitação pendente.', card, act: go('pendente') };
      }
      if (wants === 'resolvida') {
        return { say: `${plural(c.resolvida, 'solicitação resolvida', 'solicitações resolvidas')} até agora.`, card, act: go('resolvida') };
      }
      const open = c.nova + c.pendente;
      return {
        say: open
          ? `Há ${plural(open, 'solicitação em aberto', 'solicitações em aberto')}: ${plural(c.nova, 'nova', 'novas')} e ${plural(c.pendente, 'pendente', 'pendentes')}. Já foram resolvidas ${fmt(c.resolvida)}.`
          : `Nenhuma solicitação em aberto. Já foram resolvidas ${fmt(c.resolvida)}.`,
        card,
        act: go(c.nova ? 'nova' : c.pendente ? 'pendente' : 'resolvida'),
      };
    },
  },

  /* ---------- estoque ---------- */
  {
    id: 'almox-stock-category',
    sector: SECTOR,
    examples: ['Max, quanto temos de EPI?', 'Max, mostre os itens da Max Forte', 'Max, quais categorias existem no estoque?'],
    match: (q, host) => {
      if (aboutMoves(q) || windowIn(q.norm)) return 0;
      if (LOW_RE.test(q.norm)) return 0; // "estoque baixo na Max Forte" é com a outra habilidade
      if (q.re(/\b(sem categoria|categorias)\b/) && !q.re(/\b(usuario|usuarios|setor|setores)\b/)) return 0.9;
      const items = host.almox?.items();
      const cat = categoryInPhrase(q.norm, items ? countCategories(items).map((c) => c.name) : []);
      if (!cat) return 0;
      const about = q.any(...STOCK_WORDS, 'categoria', 'itens', 'item', 'unidades', 'produtos', 'materiais') || q.re(/\b(quant[oa]s?|quais|o que (tem|temos|ha)|mostr\w+|filtr\w+|list\w+|ver|abr\w+|resumo)\b/);
      if (!about) return 0;
      // "quanto tem de capacete epi" cita um item de verdade: a busca por item cuida disso
      const needle = stockNeedle(q);
      if (needle && items) {
        const rest = contentTokens(needle.replace(new RegExp(`\\b${normalize(cat).replace(/\s+/g, '\\s+')}\\b`), ' ')).filter((t) => !GENERIC.has(t) && !CAT_FILLER.has(t));
        if (rest.length && bestMatches(rest.join(' '), items, itemLabel, 0.6, 1).length) return 0;
      }
      return 0.93;
    },
    run: (q, host) => {
      if (!host.can('estoque')) return noAccess('Estoque');
      const items = host.almox?.items();
      if (!items) return loading('o estoque');
      const cats = countCategories(items);
      if (!cats.length) return { say: 'Os itens do estoque ainda não têm categoria.' };
      const none = items.filter((i) => !i.categories.length).length;
      if (q.re(/\bsem categoria\b/)) {
        return {
          say: none ? `${plural(none, 'item está', 'itens estão')} sem categoria.` : 'Todos os itens têm categoria.',
          act: () => {
            host.goTab('estoque');
            maxEmit('almox:estoque', { filter: 'todos', query: '', category: none ? '__sem__' : '' });
          },
        };
      }
      const cat = categoryInPhrase(q.norm, cats.map((c) => c.name));
      if (!cat) {
        return {
          say: `O estoque está dividido em ${plural(cats.length, 'categoria', 'categorias')}: ${listJoin(cats.map((c) => `${c.name} com ${fmt(c.n)}`))}. Um item pode estar em mais de uma.${none ? ` ${plural(none, 'item está', 'itens estão')} sem categoria.` : ''}`,
          card: { kind: 'list', title: 'Categorias do estoque', rows: cats.map((c) => ({ label: c.name, value: fmt(c.n), sub: c.n === 1 ? 'item' : 'itens' })) },
          act: () => {
            host.goTab('estoque');
            maxEmit('almox:estoque', { filter: 'todos', query: '', category: '' });
          },
        };
      }
      const list = items.filter((i) => hasCategory(i, cat));
      const act = () => {
        host.goTab('estoque');
        maxEmit('almox:estoque', { filter: 'todos', query: '', category: cat });
      };
      if (!list.length) return { say: `Nenhum item está na categoria ${cat}.`, act };
      let units = 0;
      let atPostos = 0;
      let value = 0;
      let low = 0;
      let zero = 0;
      for (const i of list) {
        units += i.quantity;
        atPostos += i.at_postos;
        if (i.cost !== null) value += i.quantity * i.cost;
        if (isLow(i)) low++;
        if (i.quantity === 0) zero++;
      }
      return {
        say: `${cat} tem ${plural(list.length, 'item', 'itens')}, com ${plural(units, 'unidade', 'unidades')} no almoxarifado e ${fmt(atPostos)} nos postos. ${low ? `${plural(low, 'item está', 'itens estão')} com estoque baixo` : 'Nenhum com estoque baixo'}${zero ? ` e ${plural(zero, 'está sem saldo', 'estão sem saldo')}` : ''}.`,
        card: {
          kind: 'stats',
          title: `Estoque · ${cat}`,
          stats: [
            { label: 'Itens', value: fmt(list.length) },
            { label: 'No almoxarifado', value: fmt(units) },
            { label: 'Nos postos', value: fmt(atPostos) },
            { label: 'Valor', value: brl(value) },
            { label: 'Estoque baixo', value: fmt(low), tone: low ? 'warn' : 'plain' },
            { label: 'Sem saldo', value: fmt(zero), tone: zero ? 'warn' : 'plain' },
          ],
        },
        act,
      };
    },
  },
  {
    id: 'almox-stock-low',
    sector: SECTOR,
    examples: ['Max, o que está com estoque baixo?', 'Max, quais itens estão zerados?'],
    match: (q) => {
      if (q.re(/\b(estoque (baixo|minimo|critico)|abaixo do minimo|no minimo|acabando|esta acabando|estao acabando|em falta|faltando|precis\w+ (repor|comprar)|repor|reposicao|o que comprar|lista de compras?)\b/)) return 0.92;
      if (q.re(/\b(zerad[oa]s?|sem saldo|esgotad[oa]s?|sem estoque|acabou|acabaram)\b/)) return 0.91;
      return 0;
    },
    run: (q, host) => {
      if (!host.can('estoque')) return noAccess('Estoque');
      const items = host.almox?.items();
      if (!items) return loading('o estoque');
      const zero = Boolean(q.re(/\b(zerad[oa]s?|sem saldo|esgotad[oa]s?|sem estoque|acabou|acabaram)\b/));
      const cat = categoryInPhrase(q.norm, countCategories(items).map((c) => c.name));
      const inCat = cat ? ` em ${cat}` : '';
      const list = items.filter((i) => (!cat || hasCategory(i, cat)) && (zero ? i.quantity === 0 : isLow(i))).sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR'));
      const act = () => {
        host.goTab('estoque');
        maxEmit('almox:estoque', { filter: zero ? 'zerado' : 'baixo', query: '', category: cat ?? '' });
      };
      if (!list.length) return { say: zero ? `Nenhum item está sem saldo${inCat}.` : `Nenhum item está com estoque baixo${inCat}. Tudo acima do mínimo.`, act };
      const top = list.slice(0, 3).map((i) => `${itemLabel(i).replace(' · ', ' ')}${zero ? '' : ' ' + withQty(i.quantity)}`);
      return {
        say: `${plural(list.length, zero ? 'item está sem saldo' : 'item está com estoque baixo', zero ? 'itens estão sem saldo' : 'itens estão com estoque baixo')}${inCat}. ${list.length > 3 ? 'Os mais críticos: ' : ''}${listJoin(top)}.`,
        card: {
          kind: 'list',
          title: (zero ? 'Sem saldo' : 'Estoque baixo') + (cat ? ` · ${cat}` : ''),
          rows: list.slice(0, 6).map((i) => ({ label: itemLabel(i), value: fmt(i.quantity), sub: i.min_quantity ? `mínimo ${fmt(i.min_quantity)}` : undefined })),
          foot: list.length > 6 ? `e mais ${fmt(list.length - 6)} no Estoque do almoxarifado` : undefined,
        },
        act,
      };
    },
  },
  {
    id: 'almox-stock-summary',
    sector: SECTOR,
    examples: ['Max, resumo do estoque'],
    match: (q) => {
      // é o retrato de AGORA: pergunta com período ou sobre o que saiu/entrou não é com este resumo
      if (aboutMoves(q) || windowIn(q.norm)) return 0;
      if (!q.any(...STOCK_WORDS, 'itens', 'item', 'unidades')) return 0;
      if (q.re(/\b(resumo|situacao|panorama|visao geral|como (esta|ta|anda)|valor (total|do|em)|quanto vale|quantos itens|quantas unidades|total de (itens|unidades)|tamanho do estoque)\b/)) return 0.88;
      return 0;
    },
    run: (_q, host) => {
      if (!host.can('estoque')) return noAccess('Estoque');
      const items = host.almox?.items();
      if (!items) return loading('o estoque');
      let units = 0;
      let atPostos = 0;
      let value = 0;
      let low = 0;
      let zero = 0;
      for (const i of items) {
        units += i.quantity;
        atPostos += i.at_postos;
        if (i.cost !== null) value += i.quantity * i.cost;
        if (isLow(i)) low++;
        if (i.quantity === 0) zero++;
      }
      return {
        say: `O estoque tem ${plural(items.length, 'item cadastrado', 'itens cadastrados')}, com ${plural(units, 'unidade', 'unidades')} no almoxarifado e ${fmt(atPostos)} nos postos. ${low ? `${plural(low, 'item está', 'itens estão')} com estoque baixo` : 'Nenhum item com estoque baixo'}${zero ? ` e ${plural(zero, 'está sem saldo', 'estão sem saldo')}` : ''}.`,
        card: {
          kind: 'stats',
          title: 'Estoque agora',
          stats: [
            { label: 'Itens', value: fmt(items.length) },
            { label: 'No almoxarifado', value: fmt(units) },
            { label: 'Nos postos', value: fmt(atPostos) },
            { label: 'Valor', value: brl(value) },
            { label: 'Estoque baixo', value: fmt(low), tone: low ? 'warn' : 'plain' },
            { label: 'Sem saldo', value: fmt(zero), tone: zero ? 'warn' : 'plain' },
          ],
        },
        act: () => {
          host.goTab('estoque');
          maxEmit('almox:estoque', { filter: 'todos', query: '', category: '' });
        },
      };
    },
  },
  {
    id: 'almox-stock-lookup',
    sector: SECTOR,
    examples: ['Max, quanto tem de bota 42?', 'Max, procurar camisa social'],
    match: (q, host) => {
      if (aboutMoves(q)) return 0; // "quantas botas saíram ontem" é movimentação, não saldo
      const needle = stockNeedle(q);
      if (!needle) return 0;
      const toks = contentTokens(needle);
      if (!toks.length || toks.every((t) => GENERIC.has(t))) return 0;
      if (toks.some((t) => OTHER_TOPIC.has(t))) return 0;
      const items = host.almox?.items();
      if (items && bestMatches(needle, items, itemLabel, 0.6, 1).length) return 0.9;
      // falou claramente de estoque, mas o item não existe: ainda é assunto daqui
      return q.any(...STOCK_WORDS, 'tamanho') || q.re(/\bquant[oa]s? (tem|temos|ha|sobrou|resta)\b/) ? 0.62 : 0;
    },
    run: (q, host) => {
      if (!host.can('estoque')) return noAccess('Estoque');
      const items = host.almox?.items();
      if (!items) return loading('o estoque');
      const needle = stockNeedle(q) ?? q.norm;
      const hits = bestMatches(needle, items, itemLabel, 0.6, 40);
      const act = () => {
        host.goTab('estoque');
        maxEmit('almox:estoque', { filter: 'todos', query: needle, category: '' });
      };
      if (!hits.length) return { say: `Não encontrei “${needle}” no estoque. Tente o nome como está cadastrado.`, act };
      const best = hits[0].score;
      const close = hits.filter((h) => h.score >= best - 0.08).map((h) => h.item);
      if (close.length === 1) {
        const i = close[0];
        const posto = i.at_postos ? ` e mais ${fmt(i.at_postos)} nos postos` : '';
        const warn = i.quantity === 0 ? ' Está sem saldo.' : isLow(i) ? ' Está abaixo do mínimo.' : '';
        return {
          say: `${itemLabel(i).replace(' · ', ', tamanho ')}: ${plural(i.quantity, 'unidade', 'unidades')} no almoxarifado${posto}.${warn}`,
          card: {
            kind: 'stats',
            title: itemLabel(i),
            stats: [
              { label: 'Almoxarifado', value: fmt(i.quantity), tone: i.quantity === 0 || isLow(i) ? 'warn' : 'in' },
              { label: 'Nos postos', value: fmt(i.at_postos) },
              { label: 'Mínimo', value: fmt(i.min_quantity) },
            ],
          },
          act: () => {
            host.goTab('estoque');
            maxEmit('almox:estoque', { filter: 'todos', query: '', category: '', openId: i.id });
          },
        };
      }
      const total = close.reduce((a, i) => a + i.quantity, 0);
      const sameName = close.every((i) => normalize(i.name) === normalize(close[0].name));
      const sorted = [...close].sort((a, b) => (a.size ?? '').localeCompare(b.size ?? '', 'pt-BR', { numeric: true }) || a.name.localeCompare(b.name, 'pt-BR'));
      const spoken = sorted.slice(0, 4).map((i) => `${sameName ? (i.size ? 'tamanho ' + i.size : 'sem tamanho') : itemLabel(i).replace(' · ', ' ')} ${withQty(i.quantity)}`);
      return {
        say: `Encontrei ${fmt(close.length)} ${sameName ? `variações de ${close[0].name}` : 'itens parecidos'}, somando ${plural(total, 'unidade', 'unidades')} no almoxarifado. ${cap(listJoin(spoken))}${close.length > 4 ? (inSector(host) ? '. O restante está na tela' : ' e outros') : ''}.`,
        card: {
          kind: 'list',
          title: `“${needle}” no estoque`,
          rows: sorted.slice(0, 8).map((i) => ({ label: itemLabel(i), value: fmt(i.quantity), sub: i.at_postos ? `${fmt(i.at_postos)} nos postos` : undefined })),
          foot: close.length > 8 ? `e mais ${fmt(close.length - 8)} no Estoque do almoxarifado` : undefined,
        },
        act,
      };
    },
  },

  /* ---------- postos ---------- */
  {
    id: 'almox-posto-stock',
    sector: SECTOR,
    examples: ['Max, o que tem no posto 01?'],
    match: (q, host) => {
      if (!q.any('posto', 'postos')) return 0;
      const postos = host.almox?.postos();
      if (!postos || !findPosto(q, postos)) return 0;
      return 0.9;
    },
    run: async (q, host) => {
      if (!host.can('postos')) return noAccess('Postos');
      const postos = host.almox?.postos();
      if (!postos) return loading('os postos');
      const p = findPosto(q, postos);
      if (!p) return { say: 'Não identifiquei o posto. Diga o nome como está cadastrado.' };
      const act = () => {
        host.goTab('postos');
        maxEmit('almox:postos', { openId: p.id });
      };
      if (!p.units) return { say: `${thePosto(p.name)} não tem nenhum item no momento.`, act };
      let lines: PostoStockLine[] = [];
      try {
        lines = (await getJson<{ lines: PostoStockLine[] }>(`/api/almoxarifado/postos/${p.id}`)).lines;
      } catch {
        return { say: `${thePosto(p.name)} tem ${plural(p.units, 'unidade', 'unidades')} de ${plural(p.items_count, 'item', 'itens')}. ${inSector(host) ? 'Abri o posto para você ver os detalhes.' : ''}`, act };
      }
      const top = [...lines].sort((a, b) => b.quantity - a.quantity);
      return {
        say: `${thePosto(p.name)} tem ${plural(p.units, 'unidade', 'unidades')} de ${plural(p.items_count, 'item', 'itens')}. ${top.length ? 'Os principais: ' + listJoin(top.slice(0, 3).map((l) => `${itemLabel(l).replace(' · ', ' ')} ${withQty(l.quantity)}`)) + '.' : ''}`,
        card: {
          kind: 'list',
          title: p.name,
          rows: top.slice(0, 8).map((l) => ({ label: itemLabel(l), value: fmt(l.quantity) })),
          foot: top.length > 8 ? `e mais ${fmt(top.length - 8)} no posto` : undefined,
        },
        act,
      };
    },
  },
  {
    id: 'almox-postos-count',
    sector: SECTOR,
    examples: ['Max, quantos postos temos?'],
    match: (q) => (q.any('posto', 'postos') && q.any('quantos', 'quantas', 'total', 'lista', 'listar', 'quais', 'resumo', 'cadastrados') ? 0.86 : 0),
    run: (_q, host) => {
      if (!host.can('postos')) return noAccess('Postos');
      const postos = host.almox?.postos();
      if (!postos) return loading('os postos');
      if (!postos.length) return { say: 'Nenhum posto cadastrado ainda.', act: () => host.goTab('postos') };
      const withStock = postos.filter((p) => p.units > 0);
      const units = postos.reduce((a, p) => a + p.units, 0);
      const top = [...withStock].sort((a, b) => b.units - a.units).slice(0, 5);
      return {
        say: `São ${plural(postos.length, 'posto cadastrado', 'postos cadastrados')}. ${withStock.length ? `${fmt(withStock.length)} ${withStock.length === 1 ? 'tem' : 'têm'} material, somando ${plural(units, 'unidade', 'unidades')}.` : 'Nenhum tem material no momento.'}`,
        card: top.length ? { kind: 'list', title: 'Postos com mais material', rows: top.map((p) => ({ label: p.name, value: fmt(p.units), sub: plural(p.items_count, 'item', 'itens') })) } : undefined,
        act: () => host.goTab('postos'),
      };
    },
  },

  /* ---------- formulário e e-mails ---------- */
  {
    id: 'almox-form-link',
    sector: SECTOR,
    examples: ['Max, copiar o link do formulário'],
    match: (q) => (q.any('link', 'endereco', 'url') && q.any('formulario', 'solicitacao', 'solicitacoes', 'supervisor', 'supervisores') ? 0.9 : 0),
    run: async () => {
      const url = `${typeof window === 'undefined' ? '' : window.location.origin}/solicitacao`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        /* sem permissão de área de transferência */
      }
      return {
        say: copied ? 'Copiei o link do formulário de solicitação. É só colar e enviar aos supervisores.' : 'Este é o link do formulário de solicitação.',
        text: (copied ? 'Link copiado: ' : 'Link do formulário: ') + url,
      };
    },
  },
  {
    id: 'almox-emails-count',
    sector: SECTOR,
    match: (q) => (q.any('email', 'emails', 'e-mail', 'e-mails') && q.any('quantos', 'autorizado', 'autorizados', 'cadastrados', 'liberados', 'total') ? 0.86 : 0),
    run: (_q, host) => {
      if (!host.can('emails') && !host.can('solicitacoes')) return noAccess('E-mails autorizados');
      const n = host.almox?.emailsCount();
      if (n === null || n === undefined) return loading('os e-mails');
      return {
        say: n ? `${plural(n, 'e-mail de supervisor está autorizado', 'e-mails de supervisores estão autorizados')} a enviar solicitações.` : 'Nenhum e-mail autorizado ainda.',
        act: host.can('emails') ? () => host.goTab('emails') : undefined,
      };
    },
  },
];
