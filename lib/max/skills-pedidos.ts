import { maxEmit } from './bus';
import { listJoin, plural, type Query } from './text';
import type { MaxHost, Skill } from './types';
import { aboutPurchase } from './skills-compras';
import { ORIGIN_LABEL, isLate, lineLabel, orderLabel, type MaterialOrder } from '../pedidos/types';

/** Pedidos de material (Projeto 3): a Max conta, resume e abre pedidos do painel da área. */
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const loading = { say: 'Ainda estou carregando os pedidos de material. Tente de novo em alguns segundos.' };
const noAccess = { say: 'Você não tem acesso aos pedidos de material. Fale com o master do seu setor.' };
/** a frase é sobre pedido de material (no Almoxarifado, "pedido" sozinho ainda é a solicitação do formulário) */
function aboutOrders(q: Query, host: MaxHost): boolean {
  if (!host.pedidos || aboutPurchase(q)) return false;
  if (q.re(/\b(pedidos? de materia\w*|admiss\w+|trocas? (anua\w+|de fardamento|extraordinari\w+)|kit de admissao)\b/)) return true;
  return Boolean(host.pedidos.scope !== 'almox' && q.re(/\b(pedidos?|trocas?)\b/) && !q.re(/\bsolicitac\w+\b/));
}
function orderNumber(q: Query): number | null {
  if (q.re(/\b(dias?|horas?|semanas?|mes|meses|minutos?|ultim[oa]s|primeir[oa]s)\b/)) return null;
  const m = q.norm.match(/\b(?:pedido|troca|admissao)(?: de material)? (?:numero |n |no )?(\d+)\b/) || q.norm.match(/\bnumero (\d+)\b/);
  return m ? Number(m[1]) : null;
}
const stageSpoken = (o: MaterialOrder) =>
  o.stage === 'solicitado' ? 'está com a Operação para conferir' : o.stage === 'validacao' ? 'espera a validação da Operação' : o.stage === 'concluido' ? 'já foi entregue por completo' : o.stage === 'cancelado' ? 'foi cancelado' : 'está com o Almoxarifado';

export const pedidosSkills: Skill[] = [
  {
    id: 'order-open',
    scopes: ['sector'],
    examples: ['Max, abrir o pedido de material 3'],
    match: (q, host) => (aboutOrders(q, host) && orderNumber(q) !== null ? 0.95 : 0),
    run: (q, host) => {
      const list = host.pedidos?.orders();
      if (list === null || list === undefined) return host.pedidos ? loading : noAccess;
      const n = orderNumber(q)!;
      const o = list.find((x) => x.number === n);
      if (!o) return { say: `Não encontrei o pedido de material número ${n}.` };
      const missing = o.items.filter((l) => l.delivered < l.qty);
      return {
        say: `Pedido ${n}, ${ORIGIN_LABEL[o.origin]}${o.collaborator_name ? `, para ${o.collaborator_name}` : o.posto_name ? `, do ${o.posto_name}` : ''}: ${stageSpoken(o)}.${missing.length && o.stage === 'encaminhado' ? ` Falta entregar ${listJoin(missing.slice(0, 3).map((l) => `${fmt(l.qty - l.delivered)} ${lineLabel(l)}`))}${missing.length > 3 ? ` e mais ${missing.length - 3} itens` : ''}.` : ''}`,
        text: `${orderLabel(o.number)} · ${ORIGIN_LABEL[o.origin]}`,
        act: () => {
          host.goTab('pedidos');
          maxEmit('pedidos:open', { id: o.id });
        },
      };
    },
  },
  {
    id: 'order-count',
    scopes: ['sector'],
    examples: ['Max, quantos pedidos de material estão em aberto?', 'Max, tem troca para validar?'],
    match: (q, host) => {
      if (!aboutOrders(q, host) || orderNumber(q) !== null) return 0;
      return q.re(/\b(quant[oa]s?|tem|temos|ha|existe\w*|chegou|chegaram|nov[oa]s?|abert[oa]s?|pendentes?|atrasad[oa]s?|separar|conferir|validar|status|situacao|como (esta|estao|anda|andam)|resumo|mostr\w+|ver|list\w+)\b/) ? 0.93 : 0;
    },
    run: (q, host) => {
      const list = host.pedidos?.orders();
      if (list === null || list === undefined) return host.pedidos ? loading : noAccess;
      const scope = host.pedidos!.scope;
      const open = list.filter((o) => o.stage !== 'concluido' && o.stage !== 'cancelado');
      const toAct = scope === 'operacao' ? open.filter((o) => o.stage === 'solicitado' || o.stage === 'validacao') : scope === 'almox' ? open.filter((o) => o.stage === 'encaminhado') : open;
      const buying = open.filter((o) => o.items.some((l) => l.purchase_id && l.delivered < l.qty));
      const late = open.filter(isLate);
      const act = () => host.goTab('pedidos');
      const card = {
        kind: 'stats' as const,
        title: 'Pedidos de material',
        stats: [
          { label: 'Em aberto', value: fmt(open.length) },
          { label: scope === 'operacao' ? 'Para conferir' : scope === 'almox' ? 'Para separar' : 'Em andamento', value: fmt(toAct.length), tone: toAct.length ? ('warn' as const) : ('plain' as const) },
          { label: 'Aguardando compra', value: fmt(buying.length) },
          { label: 'Atrasados', value: fmt(late.length), tone: late.length ? ('warn' as const) : ('plain' as const) },
        ],
      };
      if (q.re(/\batrasad[oa]s?\b/)) {
        return { say: late.length ? `${plural(late.length, 'pedido está atrasado', 'pedidos estão atrasados')}: ${listJoin(late.slice(0, 3).map((o) => `${orderLabel(o.number)}${o.collaborator_name ? ' de ' + o.collaborator_name : ''}`))}.` : 'Nenhum pedido atrasado.', card, act };
      }
      if (scope === 'operacao' && q.re(/\b(validar|conferir|nov[oa]s?|chegou|chegaram)\b/)) {
        const val = toAct.filter((o) => o.stage === 'validacao').length;
        const conf = toAct.length - val;
        return { say: toAct.length ? `Há ${listJoin([conf ? plural(conf, 'pedido para conferir', 'pedidos para conferir') : '', val ? plural(val, 'troca para validar', 'trocas para validar') : ''].filter(Boolean))}.` : 'Nada esperando a Operação agora.', card, act };
      }
      if (!open.length) return { say: 'Nenhum pedido de material em aberto.', card, act };
      return {
        say: `Há ${plural(open.length, 'pedido de material em aberto', 'pedidos de material em aberto')}${toAct.length && scope !== 'rh' ? `, ${fmt(toAct.length)} ${scope === 'operacao' ? 'esperando a Operação' : 'para separar'}` : ''}${buying.length ? `, ${fmt(buying.length)} aguardando compra` : ''}${late.length ? ` e ${plural(late.length, 'atrasado', 'atrasados')}` : ''}.`,
        card,
        act,
      };
    },
  },
];
