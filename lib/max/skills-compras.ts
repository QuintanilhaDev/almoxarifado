import { maxEmit } from './bus';
import { listJoin, plural, type Query } from './text';
import type { MaxHost, Skill } from './types';
import { OPEN_STATUSES, STATUS_LABEL, STATUS_SPOKEN, itemsSummary, purchaseLabel, type PurchaseStatus } from '../compras/types';

/** A frase fala de solicitação/pedido DE COMPRA (e não das solicitações dos postos). */
export const aboutPurchase = (q: Query) => Boolean(q.re(/\bcompras?\b/));
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
/** aba onde as solicitações de compra ficam em cada setor */
const tabOf = (host: MaxHost) => (host.sector?.slug === 'compras' ? 'solicitacoes' : 'compras');
const loading = { say: 'Ainda estou carregando as solicitações de compra. Tente de novo em alguns segundos.' };
const noAccess = { say: 'Você não tem acesso às solicitações de compra. Fale com o master do seu setor.' };
/** a pessoa pode ver as solicitações de compra nesta tela? */
const allowed = (host: MaxHost) => (host.sector?.slug === 'compras' ? host.can('solicitacoes') : host.can('compras'));
/** número da solicitação citado ("solicitação de compra 3", "pedido número 3", "compra 3"); período ("últimos 3 dias") não conta */
function purchaseNumber(q: Query, inCompras: boolean): number | null {
  if (q.re(/\b(dias?|horas?|semanas?|mes|meses|minutos?|ultim[oa]s|primeir[oa]s)\b/)) return null;
  const m =
    q.norm.match(/\b(?:solicitac\w+|pedido)(?: de compras?)? (?:numero |n |no )?(\d+)\b/) ||
    q.norm.match(/\bcompras? (?:numero |n |no )?(\d+)\b/) ||
    q.norm.match(/\bnumero (\d+)\b/);
  if (!m) return null;
  if (!inCompras && !aboutPurchase(q)) return null;
  return Number(m[1]);
}

export const comprasSkills: Skill[] = [
  {
    id: 'purchase-open',
    scopes: ['sector'],
    examples: ['Max, abrir a solicitação de compra 3'],
    match: (q, host) => (host.compras && purchaseNumber(q, host.sector?.slug === 'compras') !== null ? 0.94 : 0),
    run: (q, host) => {
      if (!allowed(host)) return noAccess;
      const list = host.compras?.requests();
      if (!list) return loading;
      const n = purchaseNumber(q, host.sector?.slug === 'compras')!;
      const r = list.find((x) => x.number === n);
      if (!r) return { say: `Não encontrei a solicitação de compra número ${n}.` };
      return {
        say: `Solicitação de compra ${n}, pedida por ${r.requested_by}: ${listJoin(r.items.slice(0, 3).map((i) => `${fmt(i.quantity)} de ${i.name}${i.size ? ' ' + i.size : ''}`))}${r.items.length > 3 ? ` e mais ${r.items.length - 3} itens` : ''}. Está ${STATUS_SPOKEN[r.status]}.${r.response ? ` Compras respondeu: ${r.response}` : ''}`,
        text: `${purchaseLabel(r.number)} · ${STATUS_LABEL[r.status]} · ${itemsSummary(r.items, 3)}`,
        act: () => {
          host.goTab(tabOf(host));
          maxEmit('compras:open', { id: r.id });
        },
      };
    },
  },
  {
    id: 'purchase-count',
    scopes: ['sector'],
    examples: ['Max, tem solicitação de compra nova?', 'Max, como estão os pedidos de compra?'],
    match: (q, host) => {
      if (!host.compras) return 0;
      // no setor Compras, "tem solicitação nova?" já é sobre compras
      const inCompras = host.sector?.slug === 'compras';
      if (!aboutPurchase(q) && !inCompras) return 0;
      if (!q.re(/\b(solicitac\w+|pedidos?|compras?)\b/)) return 0;
      if (purchaseNumber(q, inCompras) !== null) return 0;
      if (q.re(/\b(ultim[oa]|mais recente|quant[oa]s?|tem|temos|ha|existe\w*|chegou|chegaram|nov[oa]s?|abert[oa]s?|pendentes?|andamento|cotacao|comprad[oa]s?|entregues?|status|situacao|como (esta|estao|anda|andam)|resumo|mostr\w+|ver|list\w+)\b/)) return 0.93;
      return 0;
    },
    run: (q, host) => {
      if (!allowed(host)) return noAccess;
      const list = host.compras?.requests();
      if (!list) return loading;
      if (q.re(/\b(ultim[oa]|mais recente)\b/) && !q.re(/\bultim[oa]s\b/)) {
        const r = list[0]; // a lista vem da mais nova para a mais antiga
        if (!r) return { say: 'Ainda não há nenhuma solicitação de compra.' };
        return {
          say: `A mais recente é a solicitação de compra ${r.number}, de ${r.requested_by}: ${itemsSummary(r.items, 2)}. Está ${STATUS_SPOKEN[r.status]}.`,
          act: () => {
            host.goTab(tabOf(host));
            maxEmit('compras:open', { id: r.id });
          },
        };
      }
      const c = {} as Record<PurchaseStatus, number>;
      for (const s of Object.keys(STATUS_LABEL) as PurchaseStatus[]) c[s] = 0;
      list.forEach((r) => c[r.status]++);
      const open = list.filter((r) => OPEN_STATUSES.includes(r.status));
      const urgent = open.filter((r) => r.priority === 'urgente').length;
      const act = () => host.goTab(tabOf(host));
      const card = {
        kind: 'stats' as const,
        title: 'Solicitações de compra',
        stats: [
          { label: 'Novas', value: fmt(c.nova), tone: c.nova ? ('warn' as const) : ('plain' as const) },
          { label: 'Em cotação', value: fmt(c.em_cotacao) },
          { label: 'Compradas', value: fmt(c.comprada) },
          { label: 'Entregues', value: fmt(c.entregue), tone: 'in' as const },
        ],
      };
      if (q.re(/\bnov[oa]s?\b|\bchegou\b|\bchegaram\b/)) {
        return { say: c.nova ? `Sim, ${c.nova === 1 ? 'há 1 solicitação de compra nova' : `há ${fmt(c.nova)} solicitações de compra novas`} esperando${urgent ? `, ${plural(urgent, 'urgente', 'urgentes')} entre as abertas` : ''}.` : 'Nenhuma solicitação de compra nova no momento.', card, act };
      }
      if (!open.length) return { say: `Nenhuma solicitação de compra em aberto. Já foram entregues ${fmt(c.entregue)}.`, card, act };
      const parts = [
        c.nova ? plural(c.nova, 'nova', 'novas') : '',
        c.em_cotacao ? `${fmt(c.em_cotacao)} em cotação` : '',
        c.comprada ? plural(c.comprada, 'comprada', 'compradas') + ' esperando entrega' : '',
      ].filter(Boolean);
      return { say: `Há ${plural(open.length, 'solicitação de compra em aberto', 'solicitações de compra em aberto')}: ${listJoin(parts)}.${urgent ? ` ${plural(urgent, 'é urgente', 'são urgentes')}.` : ''}`, card, act };
    },
  },
];
