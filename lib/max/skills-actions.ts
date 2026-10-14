/**
 * Comandos que ALTERAM o sistema, feitos pela própria Max (sem depender da IA):
 * ela entende o pedido do jeito que a pessoa falar, confere tudo e mostra o que vai fazer.
 * Nada é gravado antes do "sim" (vira uma alteração pendente, executada pelas rotas normais).
 */
import type { Query } from './text';
import { listJoin, normalize } from './text';
import type { MaxHost, MaxMemory, MaxReply, PendingAction, Skill } from './types';
import { V, amountsIn, asksHow, asWritten, emailIn, findItem, findOne, findPerson, findPostoIn, firstUpper, leftovers, sectorIn, sizeIn, titleCase, type Found } from './intent';
import { getSector, SECTORS } from '../sectors';
import { sanitizePermissions, type HubUserRow, type Level } from '../permissions';
import type { StockItem } from '../almoxarifado/types';
import { STATUS_LABEL, type PurchaseStatus } from '../compras/types';
import { maxEmit } from './bus';

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const units = (n: number) => `${fmt(n)} ${n === 1 ? 'unidade' : 'unidades'}`;
const label = (i: { name: string; size: string | null }) => `${i.name}${i.size ? ' ' + i.size : ''}`;
const confirm = (what: string, pending: PendingAction[], extra = ''): MaxReply => ({
  say: `Vou registrar: ${what}.${extra} Confirma?`,
  chips: ['Sim', 'Não'],
  pending,
});
const noEdit = (what: string): MaxReply => ({ say: `Você não tem permissão para ${what}. Fale com o master do setor.` });
/** várias opções parecidas: pergunta qual, já com os pedidos prontos */
function which<T>(found: { many: T[] }, name: (x: T) => string, rebuild: (x: T) => string, kind = 'qual deles', followUp?: string): MaxReply {
  const opts = found.many.slice(0, 4);
  return { say: `Encontrei mais de um: ${listJoin(opts.map(name))}. Diga ${kind}.`, chips: opts.map(rebuild), followUp };
}
const heardOf = (q: Query, mem?: MaxMemory) => mem?.heard ?? q.raw;

/* ------------------------------------------------------------------ */
/* estoque                                                             */
/* ------------------------------------------------------------------ */

type MoveKind = 'entrada' | 'saida' | 'ajuste' | 'transferencia' | 'devolucao' | 'baixa_posto';
const MOVE_LABEL: Record<MoveKind, string> = {
  entrada: 'entrada',
  saida: 'saída',
  ajuste: 'ajuste do saldo',
  transferencia: 'envio ao posto',
  devolucao: 'devolução do posto',
  baixa_posto: 'baixa no posto',
};

/** que movimentação a frase pede */
function moveKind(norm: string, hasPosto: boolean): MoveKind | null {
  if (V.adjust.test(norm)) return 'ajuste';
  if (hasPosto) {
    if (V.giveBack.test(norm)) return 'devolucao';
    if (/\b(consum\w+|gast\w+|perd\w+|usad\w+|usaram|usou|baixa)\b/.test(norm) && /\b(no|na|do|da) posto\b|\bno\b/.test(norm) && !V.send.test(norm)) return 'baixa_posto';
    if (V.send.test(norm)) return 'transferencia';
  }
  if (V.giveBack.test(norm) && !hasPosto) return 'entrada';
  if (V.entry.test(norm)) return 'entrada';
  if (V.exit.test(norm)) return 'saida';
  return null;
}

/** o pedido é de movimentar o estoque? (e não uma pergunta: "quantas botas saíram ontem?") */
function aboutMove(q: Query): boolean {
  if (V.ask.test(q.norm) || asksHow(q.norm)) return false;
  if (/\b(ontem|anteontem|semana|mes|meses|dias|horas|hoje)\b/.test(q.norm) && /\b(quant\w+|sai\w+|entr\w+)\b/.test(q.norm) && !/\b(registr\w+|lanc\w+|dar|de|faz\w*)\b/.test(q.norm)) return false;
  return V.entry.test(q.norm) || V.exit.test(q.norm) || V.adjust.test(q.norm) || V.send.test(q.norm) || V.giveBack.test(q.norm);
}

const MOVE_DROP = [V.entry, V.exit, /\b(ajust\w+|corrig\w+|acert\w+|contei|contamos|contagem|real|certo|correto)\b/, V.send, V.giveBack, /\b(registr\w+|lanc\w+|fazer|faca|dar|de|da|deu|quero|preciso|posto|postos|para|pro|pra|ao|no|na|do|da)\b/];

const stockMove: Skill = {
  id: 'act-stock-move',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, entrada de 10 botas 42', 'Max, dar baixa em 2 coletes', 'Max, enviar 5 camisas G para o Posto 01', 'Max, o saldo da bota 42 é 15'],
  match: (q, host) => {
    if (!host.almox || !aboutMove(q)) return 0;
    if (/\b(solicitac\w+|usuari\w+|email|fornecedor\w*|nota|nf|xml|compra|pedido)\b/.test(q.norm) && !/\bestoque\b/.test(q.norm)) return 0;
    const items = host.almox.items();
    if (!items?.length) return 0.55;
    const posto = findPostoIn(q.norm, host.almox.postos() ?? []);
    const { qty, target } = amountsIn(q.norm);
    const needle = leftovers(q.norm, MOVE_DROP, posto ? [posto.name] : []).replace(/\b\d+\b/g, (n) => (Number(n) === qty || Number(n) === target ? '' : n));
    const f = findItem(q.norm, needle, items);
    return 'none' in f ? 0 : 0.96;
  },
  run: (q, host) => {
    const items = host.almox?.items();
    if (!items) return { say: 'Ainda estou carregando o estoque. Tente de novo em alguns segundos.' };
    const postos = host.almox?.postos() ?? [];
    const posto = findPostoIn(q.norm, postos);
    const kind = moveKind(q.norm, Boolean(posto));
    if (!kind) return { say: 'Não entendi se é entrada, saída ou ajuste. Diga, por exemplo: "entrada de 10 botas 42" ou "saída de 2 coletes".' };
    if ((kind === 'transferencia' || kind === 'devolucao' || kind === 'baixa_posto') && !posto) return { say: 'Para qual posto? Diga o nome do posto junto.' };
    const needModule = posto ? host.can('estoque', 'edit') || host.can('postos', 'edit') : host.can('estoque', 'edit');
    if (!needModule) return noEdit('movimentar o estoque');
    const { qty, target } = amountsIn(q.norm);
    const needle = leftovers(q.norm, MOVE_DROP, posto ? [posto.name] : []).replace(/\b\d+\b/g, (n) => (Number(n) === qty || Number(n) === target ? '' : n));
    const f = findItem(q.norm, needle, items as StockItem[]);
    if ('none' in f) return { say: `Não achei "${needle}" no estoque. Confira o nome e o tamanho.` };
    if ('many' in f) return which(f, label, (i) => `Max, ${MOVE_LABEL[kind]} de ${qty ?? 1} ${label(i)}${posto ? ' ' + (kind === 'devolucao' ? 'do' : 'para o') + ' ' + posto.name : ''}`, 'qual tamanho ou modelo', q.norm);
    const it = f.one;
    const n = kind === 'ajuste' ? target ?? qty : qty;
    if (n === null || !Number.isFinite(n)) {
      const where = posto ? ` ${kind === 'devolucao' ? 'do' : 'para o'} ${normalize(posto.name)}` : '';
      return kind === 'ajuste'
        ? { say: `Qual é o saldo certo de ${label(it)}? Hoje está ${fmt(it.quantity)}.`, followUp: `o saldo de ${normalize(label(it))} e {x}` }
        : { say: `Quantas unidades de ${label(it)}?`, followUp: `${normalize(MOVE_LABEL[kind])} de {x} ${normalize(label(it))}${where}` };
    }
    if (kind !== 'ajuste' && n < 1) return { say: 'A quantidade precisa ser pelo menos 1.' };
    if ((kind === 'saida' || kind === 'transferencia') && n > it.quantity) return { say: `Só há ${units(it.quantity)} de ${label(it)} no almoxarifado; não dá para tirar ${fmt(n)}.` };
    if (kind === 'ajuste' && n === it.quantity) return { say: `O saldo de ${label(it)} já é ${fmt(n)}. Não há o que ajustar.` };
    const what =
      kind === 'ajuste'
        ? `ajuste do saldo de ${label(it)} para ${fmt(n)} (hoje: ${fmt(it.quantity)})`
        : `${posto ? `${kind === 'transferencia' ? 'envio ao' : kind === 'devolucao' ? 'devolução do' : 'baixa no'} ${/^posto\b/i.test(posto.name) ? posto.name : 'posto ' + posto.name}` : MOVE_LABEL[kind]} de ${units(n)} de ${label(it)}`;
    return confirm(what, [{ method: 'POST', path: '/api/almoxarifado/stock/move', body: { item_id: it.id, kind, quantity: n, posto_id: posto?.id, note: 'Registrado pela Max' }, what }]);
  },
};

const itemCreate: Skill = {
  id: 'act-item-create',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, cadastrar o item lanterna tática com 7 unidades', 'Max, novo item luva de vaqueta tamanho G, mínimo 10'],
  match: (q, host) => {
    if (!host.almox || asksHow(q.norm) || !V.create.test(q.norm)) return 0;
    if (/\b(usuari\w+|posto|postos|e[ -]?mail|fornecedor\w*|colaborador\w*|solicitac\w+|compra|pedido|nota|kit|categoria)\b/.test(q.norm)) return 0;
    // "adiciona 5 bonés no estoque": é entrada de um item que já existe, não cadastro
    if (!/\b(item|produto|material|nov[oa])\b/.test(q.norm) && amountsIn(q.norm).qty !== null) return 0;
    return /\b(item|itens|produto|produtos|material|materiais|no estoque|ao estoque)\b/.test(q.norm) ? 0.95 : 0;
  },
  run: (q, host, mem) => {
    if (!host.can('estoque', 'edit')) return noEdit('cadastrar itens');
    const raw = normalize(heardOf(q, mem));
    const m = wordsToDigitsSafe(q.norm).match(/\b(?:item|produto|material)\s+(?:chamad[oa]\s+|de nome\s+)?(.+?)(?=\s+(?:com|tamanho|tam|numero|quantidade|saldo|minimo|estoque minimo|custo|valor|preco|categoria|no estoque|ao estoque)\b|$)/);
    const name = m?.[1]?.replace(/\b(novo|nova|um|uma)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) {
      // sem o nome: abre o cadastro na tela (ela corre até o botão)
      return {
        say: 'Abrindo o cadastro de item novo no Estoque.',
        act: () => {
          host.press?.('.nav-item[data-tab="estoque"], .tab[data-tab="estoque"]', { skipActive: true });
          host.press?.('[data-max="item-novo"]');
        },
      };
    }
    const t = wordsToDigitsSafe(q.norm);
    const size = sizeIn(t);
    const qty = Number(t.match(/\b(?:com|quantidade|saldo)\s+(?:de\s+)?(\d+)/)?.[1] ?? t.match(/\b(\d+)\s+(?:unidades?|pecas?|pares?)\b/)?.[1] ?? 0);
    const min = t.match(/\bminimo\s+(?:de\s+)?(\d+)/)?.[1];
    const cost = raw.match(/\b(?:custo|valor|preco)\s+(?:de\s+)?(?:r\s*)?(\d+(?:[.,]\d{1,2})?)/)?.[1];
    const cat = t.match(/\bcategoria\s+(.+?)(?=\s+(?:com|tamanho|minimo|custo)\b|$)/)?.[1];
    const cleanName = name.replace(new RegExp(`\\b${(size ?? '#').toLowerCase()}\\b`), '').replace(/\s+/g, ' ').trim();
    const pretty = firstUpper(asWritten(cleanName, heardOf(q, mem)));
    const exists = host.almox?.items()?.find((i) => normalize(i.name) === normalize(pretty) && (i.size ?? '').toUpperCase() === (size ?? ''));
    if (exists) return { say: `${label(exists)} já está cadastrado, com ${units(exists.quantity)}. Se chegou mais, diga "entrada de" e a quantidade.` };
    const body: Record<string, unknown> = { name: pretty, size, quantity: qty, min_quantity: min ? Number(min) : 0, cost: cost ? Number(cost.replace(',', '.')) : '' };
    if (cat) body.categories = [titleCase(asWritten(cat, heardOf(q, mem)))];
    const what = `cadastro do item ${pretty}${size ? ' ' + size : ''} com ${units(qty)}${min ? `, mínimo ${min}` : ''}${cat ? `, categoria ${cat}` : ''}`;
    return confirm(what, [{ method: 'POST', path: '/api/almoxarifado/stock', body, what }]);
  },
};

/** "dez" → "10" sem transformar o artigo "um" em número */
function wordsToDigitsSafe(norm: string): string {
  return amountsIn(norm).text.replace(/\b1\s+(?=(?:item|produto|material|posto|novo|nova)\b)/g, 'um ');
}

const itemMin: Skill = {
  id: 'act-item-min',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, o estoque mínimo da bota 42 é 5', 'Max, mudar o mínimo do colete para 3'],
  match: (q, host) => (host.almox && /\bminim[oa]\b/.test(q.norm) && !(/\b(nov[oa]|cadastr\w*|cri[ae]\w*)\b/.test(q.norm) && /\b(item|produto|material)\b/.test(q.norm)) && !V.ask.test(q.norm) && !asksHow(q.norm) && /\d|\b(zero|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta)\b/.test(q.norm) && !/\b(abaixo|no minimo|baixo)\b/.test(q.norm) ? 0.96 : 0),
  run: (q, host) => {
    if (!host.can('estoque', 'edit')) return noEdit('mudar o estoque mínimo');
    const items = host.almox?.items();
    if (!items) return { say: 'Ainda estou carregando o estoque. Tente de novo em alguns segundos.' };
    const { target, qty } = amountsIn(q.norm);
    const n = target ?? qty;
    const needle = leftovers(q.norm, [/\b(estoque )?minim[oa]\b/, V.status, /\b(defin\w+|coloc\w+|mud\w+|alter\w+|ajust\w+|e|eh|seja|fica|para|pra)\b/]).replace(new RegExp(`\\b${n}\\b`), ' ');
    const f = findItem(q.norm, needle, items as StockItem[]);
    if ('none' in f) return { say: 'De qual item? Diga o nome e o tamanho.' };
    if ('many' in f) return which(f, label, (i) => `Max, mínimo de ${label(i)} é ${n ?? 0}`, 'qual tamanho ou modelo', q.norm);
    if (n === null) return { say: `Qual o estoque mínimo de ${label(f.one)}? Hoje é ${fmt(f.one.min_quantity)}.`, followUp: `o minimo de ${normalize(label(f.one))} e {x}` };
    if (n === f.one.min_quantity) return { say: `O mínimo de ${label(f.one)} já é ${fmt(n)}.` };
    const what = `estoque mínimo de ${label(f.one)}: ${fmt(n)} (hoje: ${fmt(f.one.min_quantity)})`;
    return confirm(what, [{ method: 'PATCH', path: `/api/almoxarifado/stock/${f.one.id}`, body: { min_quantity: n }, what }]);
  },
};

const itemCategory: Skill = {
  id: 'act-item-category',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, colocar o colete na categoria EPI', 'Max, tirar o boné da categoria Max Serviços'],
  match: (q, host) => (host.almox && /\bcategoria\b/.test(q.norm) && (V.status.test(q.norm) || V.remove.test(q.norm) || /\b(adicion\w+|inclu\w+|bot\w+|p[oô]e|por)\b/.test(q.norm)) && !V.ask.test(q.norm) ? 0.95 : 0),
  run: (q, host) => {
    if (!host.can('estoque', 'edit')) return noEdit('mudar categorias');
    const items = host.almox?.items();
    if (!items) return { say: 'Ainda estou carregando o estoque.' };
    const m = q.norm.match(/\b(?:na|da|a|para a|pra|de|nas|das) categorias? (.+)$/) ?? q.norm.match(/\bcategorias? (.+?)(?: (?:no|na|ao|do|da) (?:item )?(.+))?$/);
    if (!m) return { say: 'Qual categoria? Diga, por exemplo: "colocar o colete na categoria EPI".' };
    const cat = m[1].trim();
    const before = q.norm.slice(0, q.norm.indexOf(m[0]));
    const removing = V.remove.test(q.norm);
    const needle = leftovers(m[2] ? m[2] : before, [V.status, V.remove, /\b(adicion\w+|inclu\w+|bot\w+|poe|por|item)\b/]);
    const f = findItem(q.norm, needle, items as StockItem[]);
    if ('none' in f) return { say: 'De qual item? Diga o nome e o tamanho.' };
    if ('many' in f) return which(f, label, (i) => `Max, ${removing ? 'tirar' : 'colocar'} ${label(i)} ${removing ? 'da' : 'na'} categoria ${cat}`);
    const it = f.one;
    const known = [...new Set(items.flatMap((i) => i.categories ?? []))];
    const catName = known.find((c) => normalize(c) === normalize(cat)) ?? cat.replace(/\b\w/g, (c) => c.toUpperCase());
    const now = it.categories ?? [];
    const next = removing ? now.filter((c) => normalize(c) !== normalize(catName)) : [...now.filter((c) => normalize(c) !== normalize(catName)), catName];
    if (next.join('|') === now.join('|')) return { say: `${label(it)} ${removing ? 'não está' : 'já está'} na categoria ${catName}.` };
    const what = `categorias de ${label(it)}: ${next.length ? next.join(' e ') : 'nenhuma'}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/almoxarifado/stock/${it.id}`, body: { categories: next }, what }]);
  },
};

/* ------------------------------------------------------------------ */
/* solicitações dos postos                                             */
/* ------------------------------------------------------------------ */

const REQ_STATUS: { re: RegExp; status: 'nova' | 'pendente' | 'resolvida' }[] = [
  { re: /\b(resolvid\w*|resolv\w+|conclu\w+|finaliz\w+|encerr\w+|fech\w+|atendid\w*|entregue|pronta|feita)\b/, status: 'resolvida' },
  { re: /\b(pendente|pendencia|aguardando|em andamento|esperando|espera|segur\w+)\b/, status: 'pendente' },
  { re: /\b(nova|novo|reabr\w+|nao lida)\b/, status: 'nova' },
];

const requestStatus: Skill = {
  id: 'act-request-status',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, marcar a solicitação 12 como resolvida', 'Max, deixa a 3 pendente', 'Max, finalizar a solicitação 4'],
  match: (q, host) => {
    if (!host.almox || V.ask.test(q.norm) || asksHow(q.norm) || /\bcompras?\b/.test(q.norm)) return 0;
    const num = q.norm.match(/\b(?:solicitac\w+|protocolo|pedido|numero|n)\s+(\d+)\b/) ?? (/\bsolicitac/.test(q.norm) ? null : q.norm.match(/\b(?:a|o)\s+(\d+)\b/));
    if (!num) return 0;
    const st = REQ_STATUS.find((s) => s.re.test(q.norm));
    if (!st) return 0;
    return V.status.test(q.norm) || V.resolve.test(q.norm) || V.reopen.test(q.norm) ? 0.97 : 0;
  },
  run: (q, host) => {
    if (!host.can('solicitacoes', 'edit')) return noEdit('mudar solicitações');
    const list = host.almox?.requests();
    if (!list) return { say: 'Ainda estou carregando as solicitações.' };
    const n = Number((q.norm.match(/\b(?:solicitac\w+|protocolo|pedido|numero|n)\s+(\d+)\b/) ?? q.norm.match(/\b(?:a|o)\s+(\d+)\b/))![1]);
    const r = list.find((x) => x.protocol === n);
    if (!r) return { say: `Não encontrei a solicitação número ${n}.` };
    const status = REQ_STATUS.find((s) => s.re.test(q.norm))!.status;
    if (r.status === status) return { say: `A solicitação ${n} já está como ${status}.` };
    const what = `solicitação ${n}${r.collaborator ? ` (${r.collaborator})` : ''} marcada como ${status}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/almoxarifado/requests/${r.id}`, body: { status }, what }]);
  },
};

/* ------------------------------------------------------------------ */
/* postos e e-mails                                                    */
/* ------------------------------------------------------------------ */

const postoCreate: Skill = {
  id: 'act-posto-create',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, cadastrar o posto Hospital Central em Salvador', 'Max, novo posto'],
  match: (q, host) => (host.almox && !asksHow(q.norm) && V.create.test(q.norm) && /\bpostos?\b/.test(q.norm) && !/\b(item|itens|solicitac\w+|email|envi\w+|mand\w+)\b/.test(q.norm) ? 0.95 : 0),
  run: (q, host, mem) => {
    if (!host.can('postos', 'edit')) return noEdit('cadastrar postos');
    const heard = heardOf(q, mem);
    const m = heard.match(/posto\s+(?:chamado\s+|de nome\s+)?(.+?)(?=\s*(?:,|;|\bem\b|\bna cidade\b|\bcidade\b|\bsupervisor\b|\bendere[cç]o\b|\bresponsável\b|$))/i);
    const name = m?.[1]?.trim().replace(/[.!?]+$/, '');
    if (!name || /^(novo|nova|um|uma)$/i.test(name)) {
      return {
        say: 'Abrindo o cadastro de posto novo.',
        act: () => {
          host.press?.('.nav-item[data-tab="postos"], .tab[data-tab="postos"]', { skipActive: true });
          host.press?.('[data-max="posto-novo"]');
        },
      };
    }
    const pretty = /^posto\b/i.test(name) || /^\d/.test(name) ? `Posto ${name.replace(/^posto\s*/i, '')}` : name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    if ((host.almox?.postos() ?? []).some((p) => normalize(p.name) === normalize(pretty))) return { say: `O ${pretty} já está cadastrado.` };
    const cityRaw = heard.match(/\b(?:em|na cidade de|cidade)\s+([A-Za-zÀ-ÿ ]{3,40}?)(?=\s*(?:,|;|\bsupervisor\b|\bendere|$))/i)?.[1]?.trim() ?? null;
    const city = cityRaw ? titleCase(cityRaw) : null;
    const supervisor = heard.match(/\b(?:supervisor|responsável|responsavel)\s+(?:é\s+|e\s+)?([A-Za-zÀ-ÿ ]{2,60}?)(?=\s*(?:,|;|\bendere|\bem\b|$))/i)?.[1]?.trim() ?? null;
    const what = `cadastro do posto ${pretty}${city ? ` em ${city}` : ''}${supervisor ? `, supervisor ${supervisor}` : ''}`;
    return confirm(what, [{ method: 'POST', path: '/api/almoxarifado/postos', body: { name: pretty, city, supervisor }, what }]);
  },
};

const postoRemove: Skill = {
  id: 'act-posto-remove',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, remover o posto Condomínio Vila Verde'],
  match: (q, host) => (host.almox && V.remove.test(q.norm) && /\bpostos?\b/.test(q.norm) && !V.ask.test(q.norm) && !/\b(item|itens|unidades?|\d+ \w+ (do|da) posto)\b/.test(q.norm) && findPostoIn(q.norm, host.almox.postos() ?? []) ? 0.95 : 0),
  run: (q, host) => {
    if (!host.can('postos', 'edit')) return noEdit('remover postos');
    const p = findPostoIn(q.norm, host.almox?.postos() ?? [])!;
    const what = `REMOÇÃO do ${p.name} (${units(p.units ?? 0)} voltam ao almoxarifado)`;
    return confirm(what, [{ method: 'DELETE', path: `/api/almoxarifado/postos/${p.id}`, what }]);
  },
};

const emailAuth: Skill = {
  id: 'act-email',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, autorizar o e-mail joao@empresa.com', 'Max, remover o e-mail joao@empresa.com'],
  match: (q, host) => (host.almox && /\b(e[ -]?mails?|emails?|arroba)\b/.test(q.norm) && (V.authorize.test(q.norm) || V.unauthorize.test(q.norm)) && !V.ask.test(q.norm) ? 0.96 : 0),
  run: async (q, host, mem) => {
    if (!host.can('emails', 'edit')) return noEdit('mudar os e-mails autorizados');
    const email = emailIn(heardOf(q, mem));
    const removing = V.unauthorize.test(q.norm) && !/\b(autoriz\w+|liber\w+|permit\w+)\b/.test(q.norm.replace(/desautoriz\w+/g, ''));
    if (!email) {
      return {
        say: removing ? 'Qual e-mail? Diga ou digite o endereço completo.' : 'Abrindo a autorização de e-mail. Digite o endereço do supervisor.',
        followUp: removing ? 'remover o email' : undefined,
        act: removing
          ? undefined
          : () => {
              host.press?.('.nav-item[data-tab="emails"], .tab[data-tab="emails"]', { skipActive: true });
              host.press?.('#em-text');
            },
      };
    }
    if (removing) {
      try {
        const r = await fetch('/api/almoxarifado/emails', { credentials: 'same-origin', cache: 'no-store' });
        const j = (await r.json()) as { emails?: { id: string; email: string }[] };
        const hit = (j.emails ?? []).find((e) => e.email.toLowerCase() === email);
        if (!hit) return { say: `O e-mail ${email} não está na lista de autorizados.` };
        const what = `REMOÇÃO do e-mail autorizado ${email}`;
        return confirm(what, [{ method: 'DELETE', path: `/api/almoxarifado/emails?id=${hit.id}`, what }]);
      } catch {
        return { say: 'Não consegui consultar os e-mails agora. Tente de novo.' };
      }
    }
    const what = `autorização do e-mail ${email} para enviar solicitações`;
    return confirm(what, [{ method: 'POST', path: '/api/almoxarifado/emails', body: { emails: email }, what }]);
  },
};

/* ------------------------------------------------------------------ */
/* usuários e permissões (master geral; permissões: master do setor)    */
/* ------------------------------------------------------------------ */

async function usersFor(host: MaxHost): Promise<HubUserRow[] | null> {
  const l = host.hub?.users();
  if (l) return l;
  try {
    const r = await fetch('/api/hub/users', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return null;
    return ((await r.json()) as { users: HubUserRow[] }).users;
  } catch {
    return null;
  }
}
const aboutUser = (q: Query) => /\b(usuari\w+|acesso|acessos|login|conta d[aoe]|senha d[aoe]|master)\b/.test(q.norm);
const who = (u: HubUserRow) => `${u.display_name} (@${u.username})`;

function personOr(found: Found<HubUserRow>, rebuild: (u: HubUserRow) => string, base?: string): HubUserRow | MaxReply {
  if ('one' in found) return found.one;
  if ('many' in found) return which(found, (u) => u.display_name, rebuild, 'qual pessoa', base);
  return { say: 'De qual pessoa? Diga o nome ou o usuário de login.', followUp: base };
}

const userChange: Skill = {
  id: 'act-user',
  scopes: ['hub', 'sector'],
  examples: ['Max, desativar o usuário da Juliana', 'Max, mudar o Pedro para o setor financeiro', 'Max, tornar a Carla master do RH', 'Max, redefinir a senha do neilton para nova123'],
  match: (q, host) => {
    if (!host.user?.is_master || V.ask.test(q.norm) || asksHow(q.norm)) return 0;
    if (/\b(minha senha|meu acesso|minha conta)\b/.test(q.norm)) return 0;
    if (/\bfornecedor\w*|colaborador\w*|item|itens|posto\b/.test(q.norm)) return 0;
    const sector = sectorIn(q.norm);
    const actsOnUser =
      V.deactivate.test(q.norm) ||
      V.activate.test(q.norm) ||
      /\b(senha)\b/.test(q.norm) ||
      (/\bmaster\b/.test(q.norm) && /\b(torn\w+|faz\w*|fac\w+|promov\w+|vir\w+|coloc\w+|defin\w+|tir\w+|remov\w+|rebaix\w+|deix\w+ de ser)\b/.test(q.norm)) ||
      (Boolean(sector) && /\b(mud\w+|mov\w+|transfer\w+|pass\w+|coloc\w+|realoc\w+|aloc\w+|troc\w+)\b/.test(q.norm) && /\b(para|pro|pra|no|na|ao)\b/.test(q.norm)) ||
      (V.remove.test(q.norm) && aboutUser(q));
    return actsOnUser && (aboutUser(q) || /\b(o|a|do|da)\s+[a-z]{3,}/.test(q.norm)) ? 0.94 : 0;
  },
  run: async (q, host, mem) => {
    const users = await usersFor(host);
    if (!users) return { say: 'Não consegui carregar os usuários agora.' };
    const sector = sectorIn(q.norm);
    const f = findPerson(q.norm, users.filter((u) => u.id !== host.user?.id || /\bmeu\b|\bminha\b/.test(q.norm)));
    const u = personOr(f, (x) => `Max, ${q.norm.replace(/^max\s+/, '')} ${x.username}`, q.norm);
    if (!('id' in u)) return u;
    const body: Record<string, unknown> = {};
    const parts: string[] = [];
    if (/\bsenha\b/.test(q.norm)) {
      // a senha pode vir sozinha, como resposta à pergunta dela
      const solo = heardOf(q, mem).trim().match(/^\S{6,64}$/)?.[0];
      const pw = solo ?? heardOf(q, mem).match(/\bsenha\b.*?\b(?:para|pra|como|:|=|é|e)\s+(\S{6,64})\s*$/i)?.[1] ?? heardOf(q, mem).match(/\bnova senha\s+(\S{6,64})/i)?.[1];
      if (!pw) return { followUp: `redefinir a senha de ${u.username} para`, say: `Qual a nova senha de ${u.display_name}? Diga junto, com pelo menos 6 caracteres, por exemplo: "redefinir a senha d${/a$/.test(u.display_name.split(' ')[0]) ? 'a' : 'o'} ${u.display_name.split(' ')[0]} para nova1234".` };
      body.new_password = pw;
      parts.push('nova senha');
    } else if (V.remove.test(q.norm) && /\b(usuari\w+|acesso|login|conta)\b/.test(q.norm) && /\b(exclu\w+|apag\w+|delet\w+)\b/.test(q.norm)) {
      if (u.is_master) return { say: 'Um master geral não é excluído por aqui. Tire o master geral dele antes.' };
      const what = `EXCLUSÃO do usuário ${who(u)}`;
      return confirm(what, [{ method: 'DELETE', path: `/api/hub/users/${u.id}`, what }], ' Isso apaga o acesso de vez; para só bloquear, prefira desativar.');
    } else if (V.deactivate.test(q.norm)) {
      if (!u.active) return { say: `O acesso de ${u.display_name} já está desativado.` };
      body.active = false;
      parts.push('acesso DESATIVADO');
    } else if (V.activate.test(q.norm) && !/\bmaster\b/.test(q.norm)) {
      if (u.active) return { say: `O acesso de ${u.display_name} já está ativo.` };
      body.active = true;
      parts.push('acesso reativado');
    } else if (/\bmaster\b/.test(q.norm)) {
      const off = /\b(tir\w+|remov\w+|rebaix\w+|deix\w+ de ser|nao (e|seja) mais)\b/.test(q.norm);
      if (/\bmaster geral\b/.test(q.norm)) {
        body.is_master = !off;
        parts.push(off ? 'deixa de ser master geral' : 'vira master geral (acesso a tudo)');
      } else {
        if (sector && sector.slug !== u.sector) {
          body.sector = sector.slug;
          parts.push(`setor ${sector.name}`);
        }
        if (!sector && !u.sector) return { say: `${u.display_name} não está em nenhum setor. De qual setor ele deve ser master?` };
        body.sector_role = off ? 'member' : 'master';
        parts.push(off ? 'deixa de ser master do setor' : `master do setor ${getSector((body.sector as string) ?? u.sector)?.name ?? ''}`.trim());
      }
    } else if (sector) {
      if (u.sector === sector.slug) return { say: `${u.display_name} já está no setor ${sector.name}.` };
      body.sector = sector.slug;
      parts.push(`passa para o setor ${sector.name}`);
    }
    if (!parts.length) return { say: `O que você quer mudar em ${u.display_name}? Posso desativar, reativar, trocar de setor, tornar master ou redefinir a senha.` };
    const what = `alteração de ${who(u)}: ${parts.join(', ')}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/hub/users/${u.id}`, body, what }]);
  },
};

const LEVEL_WORDS: { re: RegExp; level: Level; label: string }[] = [
  { re: /\b(sem acesso|nenhum acesso|tir\w+ (o |a )?(acesso|permiss\w+)|remov\w+ (o |a )?(acesso|permiss\w+)|bloque\w+|cort\w+|nao (pode|deve) (ver|mexer|acessar))\b/, level: 'none', label: 'sem acesso' },
  { re: /\b(edit\w+|alter\w+|mexer|mexa|mudar|gerenci\w+|controle total|acesso total|tudo)\b/, level: 'edit', label: 'editar' },
  { re: /\b(ver|visualiz\w+|consult\w+|so ver|somente ver|leitura|olhar|enxergar|acompanhar)\b/, level: 'view', label: 'só visualizar' },
];

const permission: Skill = {
  id: 'act-permission',
  scopes: ['hub', 'sector'],
  examples: ['Max, dar permissão de editar o estoque para a Juliana', 'Max, a Juliana só pode ver as métricas', 'Max, tirar o acesso do Pedro aos postos'],
  match: (q, host) => {
    if (V.ask.test(q.norm) || asksHow(q.norm)) return 0;
    const manager = host.user?.is_master || host.user?.sector_role === 'master';
    if (!manager) return 0;
    const perm = /\b(permiss\w+|acesso|pode (ver|editar|mexer|visualizar)|so pode|somente|consegue (ver|editar))\b/.test(q.norm) || /\b(liber\w+|deix\w+|autoriz\w+)\b.*\b(para|pra) (mexer|editar|ver|visualizar|usar|acessar|alterar)\b/.test(q.norm);
    if (!perm || !LEVEL_WORDS.some((l) => l.re.test(q.norm))) return 0;
    const sectorSlug = host.sector?.slug ?? null;
    const modules = SECTORS.flatMap((s) => (sectorSlug && s.slug !== sectorSlug ? [] : s.modules));
    const hasModule = modules.some((m) => q.norm.includes(normalize(m.label).split(' ')[0]) || q.norm.includes(m.id));
    return hasModule ? 0.95 : 0;
  },
  run: async (q, host) => {
    const isGlobal = Boolean(host.user?.is_master);
    let users: HubUserRow[] | null = null;
    if (isGlobal) users = await usersFor(host);
    else if (host.sector) {
      try {
        const r = await fetch(`/api/setor/${host.sector.slug}/equipe`, { credentials: 'same-origin', cache: 'no-store' });
        users = r.ok ? ((await r.json()) as { users: HubUserRow[] }).users : null;
      } catch {
        users = null;
      }
    }
    if (!users) return { say: 'Não consegui carregar a equipe agora.' };
    const f = findPerson(q.norm, users.filter((u) => !u.is_master));
    const u = personOr(f, (x) => `Max, ${q.norm.replace(/^max\s+/, '')} ${x.username}`, q.norm);
    if (!('id' in u)) return u;
    const def = getSector(u.sector);
    if (!def) return { say: `${u.display_name} não está em nenhum setor, então não há permissões por módulo para mudar.` };
    if (!isGlobal && host.sector?.slug !== def.slug) return { say: `${u.display_name} é de outro setor; só o master dele muda as permissões.` };
    if (u.sector_role === 'master') return { say: `${u.display_name} é master do setor ${def.name} e já pode tudo nele.` };
    const mod = def.modules.find((m) => q.norm.includes(m.id) || q.norm.includes(normalize(m.label)) || q.norm.includes(normalize(m.label).split(' ')[0]));
    if (!mod) return { say: `Em qual parte do setor ${def.name}? ${listJoin(def.modules.map((m) => m.label))}.`, followUp: q.norm };
    const lv = LEVEL_WORDS.find((l) => l.re.test(q.norm))!;
    const permissions = { ...sanitizePermissions(def.slug, u.permissions), [mod.id]: lv.level };
    const what = `permissão de ${u.display_name} em ${mod.label} (${def.name}): ${lv.label}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/setor/${def.slug}/equipe/${u.id}`, body: { permissions }, what }]);
  },
};

/* ------------------------------------------------------------------ */
/* compras                                                             */
/* ------------------------------------------------------------------ */

const PURCHASE_WORDS: { re: RegExp; status: PurchaseStatus }[] = [
  { re: /\b(em cotacao|cotacao|cotando|cot\w+)\b/, status: 'em_cotacao' },
  { re: /\b(comprad\w+|compramos|comprei|comprou|pedid\w+ feito|fech\w+ (a )?compra)\b/, status: 'comprada' },
  { re: /\b(entregue|entregues|chegou|chegaram|recebid\w+|recebemos)\b/, status: 'entregue' },
  { re: /\b(recusad\w+|recus\w+|negad\w+|neg\w+|reprovad\w+)\b/, status: 'recusada' },
  { re: /\b(cancel\w+)\b/, status: 'cancelada' },
];

const purchaseStatus: Skill = {
  id: 'act-purchase-status',
  scopes: ['sector'],
  examples: ['Max, marcar a solicitação de compra 2 como comprada', 'Max, a compra 3 chegou', 'Max, cancelar a solicitação de compra 5'],
  match: (q, host) => {
    if (!host.compras || V.ask.test(q.norm) || asksHow(q.norm)) return 0;
    const inCompras = host.sector?.slug === 'compras';
    const num = q.norm.match(/\b(?:solicitac\w+|pedido|compra)(?: de compras?)? (?:numero |n )?(\d+)\b/);
    if (!num || (!inCompras && !/\bcompras?\b/.test(q.norm))) return 0;
    return PURCHASE_WORDS.some((w) => w.re.test(q.norm)) && (V.status.test(q.norm) || /\b(foi|esta|ja|chegou|chegaram|cancel\w+|recus\w+|comprei|compramos)\b/.test(q.norm)) ? 0.97 : 0;
  },
  run: (q, host) => {
    const list = host.compras?.requests();
    if (!list) return { say: 'Ainda estou carregando as solicitações de compra.' };
    const n = Number(q.norm.match(/\b(?:solicitac\w+|pedido|compra)(?: de compras?)? (?:numero |n )?(\d+)\b/)![1]);
    const r = list.find((x) => x.number === n);
    if (!r) return { say: `Não encontrei a solicitação de compra número ${n}.` };
    const status = PURCHASE_WORDS.find((w) => w.re.test(q.norm))!.status;
    const inCompras = host.sector?.slug === 'compras';
    if (status === 'cancelada') {
      if (inCompras) return { say: 'Quem cancela é o Almoxarifado. Em Compras, marque como recusada se não for comprar.' };
      if (!host.can('compras', 'edit')) return noEdit('cancelar compras');
      if (r.status !== 'nova') return { say: `Compras já começou a cuidar da solicitação ${n}. Para cancelar agora, fale com o setor de Compras.` };
    } else {
      if (!inCompras) return { say: 'Quem muda o andamento das compras é o setor de Compras.' };
      if (!host.can('solicitacoes', 'edit')) return noEdit('mudar o andamento das compras');
    }
    if (r.status === status) return { say: `A solicitação de compra ${n} já está como ${STATUS_LABEL[status].toLowerCase()}.` };
    const what = `solicitação de compra ${n} marcada como ${STATUS_LABEL[status].toLowerCase()}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/compras/requests/${r.id}`, body: { status, expected: r.status }, what }]);
  },
};

const supplierActive: Skill = {
  id: 'act-supplier-active',
  scopes: ['sector'],
  sector: 'compras',
  examples: ['Max, desativar o fornecedor Lanterna & Cia'],
  match: (q, host) => (host.fornecedores && /\bfornecedor\w*\b/.test(q.norm) && (V.deactivate.test(q.norm) || V.activate.test(q.norm) || /\b(exclu\w+|apag\w+|remov\w+)\b/.test(q.norm)) ? 0.95 : 0),
  run: async (q, host) => {
    if (!host.fornecedores?.canEdit) return noEdit('mudar fornecedores');
    let list = host.fornecedores.list();
    if (!list) {
      try {
        list = ((await (await fetch('/api/compras/fornecedores', { credentials: 'same-origin' })).json()) as { suppliers: NonNullable<typeof list> }).suppliers;
      } catch {
        return { say: 'Não consegui carregar os fornecedores agora.' };
      }
    }
    const off = !V.activate.test(q.norm) || V.deactivate.test(q.norm);
    const needle = leftovers(q.norm, [V.deactivate, V.activate, V.remove, /\bfornecedor\w*\b/]);
    const f = findOne(needle, list, (s) => `${s.trade_name ?? ''} ${s.name}`, 0.6);
    if ('none' in f) return { say: 'De qual fornecedor? Diga o nome.' };
    if ('many' in f) return which(f, (s) => s.trade_name || s.name, (s) => `Max, ${off ? 'desativar' : 'reativar'} o fornecedor ${s.trade_name || s.name}`);
    const s = f.one;
    if (s.active === !off) return { say: `${s.trade_name || s.name} já está ${off ? 'inativo' : 'ativo'}.` };
    const what = `fornecedor ${s.trade_name || s.name} ${off ? 'desativado (as notas continuam ligadas a ele)' : 'reativado'}`;
    return confirm(what, [{ method: 'PATCH', path: `/api/compras/fornecedores/${s.id}`, body: { active: !off }, what }]);
  },
};

/* ------------------------------------------------------------------ */
/* pedidos de material                                                 */
/* ------------------------------------------------------------------ */

type OrderAct = 'forward' | 'validate' | 'cancel' | 'auto' | 'deliver';
const ORDER_ACTS: { re: RegExp; act: OrderAct }[] = [
  { re: /\b(cancel\w+)\b/, act: 'cancel' },
  { re: /\b(valid\w+|aprov\w+|autoriz\w+)\b/, act: 'validate' },
  { re: /\b(encaminh\w+|envi\w+ (ao|pro|para o) almoxarifado|mand\w+ (ao|pro|para o) almoxarifado)\b/, act: 'forward' },
  { re: /\b(sugest\w+|automatic\w+|reserv\w+|separ\w+|atend\w+ (o |a )?(pedido|troca))\b/, act: 'auto' },
  { re: /\b(entreg\w+)\b/, act: 'deliver' },
];
const orderNum = (norm: string) => {
  const m = norm.match(/\b(?:pedido|troca|admissao)(?: de material)? (?:numero |n )?(\d+)\b/);
  return m ? Number(m[1]) : null;
};

const orderAction: Skill = {
  id: 'act-order',
  scopes: ['sector'],
  examples: ['Max, validar a troca 3', 'Max, encaminhar o pedido 5 ao almoxarifado', 'Max, cancelar o pedido 4 porque a pessoa desistiu', 'Max, aplicar a sugestão do pedido 2', 'Max, entregar o pedido 2'],
  match: (q, host) => {
    if (!host.pedidos || V.ask.test(q.norm) || asksHow(q.norm) || /\bcompras?\b/.test(q.norm)) return 0;
    if (orderNum(q.norm) === null) return 0;
    return ORDER_ACTS.some((a) => a.re.test(q.norm)) ? 0.96 : 0;
  },
  run: (q, host, mem) => {
    const list = host.pedidos?.orders();
    if (!list) return { say: 'Ainda estou carregando os pedidos de material.' };
    const n = orderNum(q.norm)!;
    const o = list.find((x) => x.number === n);
    if (!o) return { say: `Não encontrei o pedido de material número ${n}.` };
    const act = ORDER_ACTS.find((a) => a.re.test(q.norm))!.act;
    const scope = host.pedidos!.scope;
    const who = o.collaborator_name ? ` (${o.collaborator_name})` : o.posto_name ? ` (${o.posto_name})` : '';
    if (!host.can('pedidos', 'edit')) return noEdit('mexer nos pedidos de material');
    if (act === 'deliver') {
      if (scope !== 'almox') return { say: 'Quem entrega o material é o Almoxarifado.' };
      return {
        say: `Abrindo a entrega do pedido ${n}${who}. Confira as quantidades: o termo de entrega sai pronto para assinar.`,
        act: () => {
          host.press?.('.nav-item[data-tab="pedidos"], .tab[data-tab="pedidos"]', { skipActive: true });
          host.press?.(`[data-max-pedido="${o.id}"]`, { exec: () => maxEmit('pedidos:open', { id: o.id }) });
          host.press?.('[data-max="pedido-entregar"]');
        },
      };
    }
    if (act === 'validate') {
      if (scope !== 'operacao') return { say: 'Quem valida as trocas é a Operação.' };
      if (o.stage !== 'validacao') return { say: `O pedido ${n} não está esperando validação.` };
      const what = `pedido ${n}${who} validado e encaminhado ao Almoxarifado`;
      return confirm(what, [{ method: 'PATCH', path: `/api/pedidos/${o.id}`, body: { action: 'validate' }, what }]);
    }
    if (act === 'forward') {
      if (o.stage !== 'solicitado') return { say: `O pedido ${n} já foi encaminhado.` };
      const what = `pedido ${n}${who} encaminhado ao Almoxarifado`;
      return confirm(what, [{ method: 'PATCH', path: `/api/pedidos/${o.id}`, body: { action: 'forward' }, what }]);
    }
    if (act === 'auto') {
      if (scope !== 'almox') return { say: 'Quem reserva e pede compra pelo pedido é o Almoxarifado.' };
      if (o.stage !== 'encaminhado') return { say: `O pedido ${n} não está com o Almoxarifado agora.` };
      const what = `sugestão automática do pedido ${n}${who}: reservar o que há (sem furar o mínimo) e pedir compra do que falta`;
      return confirm(what, [{ method: 'POST', path: `/api/pedidos/${o.id}/auto`, body: { confirm: true }, what }]);
    }
    // cancelar: precisa do motivo
    if (o.stage === 'concluido' || o.stage === 'cancelado') return { say: `O pedido ${n} já está ${o.stage === 'concluido' ? 'concluído' : 'cancelado'}.` };
    const heard = heardOf(q, mem);
    const reason = heard.match(/\b(?:porque|pois|por causa d[eoa]|motivo:?|já que|ja que)\s+(.{3,200})$/i)?.[1]?.trim() ?? (/^\s*\S/.test(heard) && !/\bpedido\b/i.test(heard) ? heard.trim() : null);
    if (!reason) return { say: `Qual o motivo do cancelamento do pedido ${n}?`, followUp: `cancelar o pedido ${n} porque` };
    const what = `CANCELAMENTO do pedido ${n}${who}. Motivo: ${reason}`;
    return confirm(what, [{ method: 'POST', path: `/api/pedidos/${o.id}/cancel`, body: { reason }, what }], ' As reservas voltam para o estoque.');
  },
};

/** "pedir compra de 20 botas 42", "comprar 10 coletes, urgente": solicitação de compra já com o item */
const purchaseCreate: Skill = {
  id: 'act-purchase-create',
  scopes: ['sector'],
  sector: 'almoxarifado',
  examples: ['Max, pedir compra de 20 botas 42', 'Max, solicitar compra de 10 coletes, é urgente'],
  match: (q, host) => {
    if (!host.almox || V.ask.test(q.norm) || asksHow(q.norm) || /\b(cancel\w+|status|andamento)\b/.test(q.norm) || /\b(solicitac\w+|compra) (numero )?\d+( (como|foi|esta|ja|chegou|chegaram|para|pra|em)\b|$)/.test(q.norm)) return 0;
    if (!/\b((ped\w+|solicit\w+|faz\w*|fac\w+|abr\w+|cri\w+|lanc\w+) (uma |a |um )?(solicitac\w+ de |pedido de )?compras? (de|para|pra)|compr(ar|e|a|em) \d+|precis\w+ comprar)\b/.test(q.norm)) return 0;
    const items = host.almox.items() ?? [];
    const { qty } = amountsIn(q.norm);
    const needle = leftovers(q.norm, [/\b(ped\w+|solicit\w+|faz\w*|fac\w+|abr\w+|cri\w+|lanc\w+|compr\w+|precis\w+|urgente|urgencia|solicitac\w+|pedido)\b/]).replace(/\b\d+\b/g, (n) => (Number(n) === qty ? '' : n));
    return qty !== null && !('none' in findItem(q.norm, needle, items as StockItem[])) ? 0.96 : 0;
  },
  run: (q, host) => {
    if (!host.can('compras', 'edit')) return noEdit('pedir compras');
    const items = (host.almox?.items() ?? []) as StockItem[];
    const { qty } = amountsIn(q.norm);
    const needle = leftovers(q.norm, [/\b(ped\w+|solicit\w+|faz\w*|fac\w+|abr\w+|cri\w+|lanc\w+|compr\w+|precis\w+|urgente|urgencia|solicitac\w+|pedido)\b/]).replace(/\b\d+\b/g, (n) => (Number(n) === qty ? '' : n));
    const f = findItem(q.norm, needle, items);
    if ('many' in f) return which(f, label, (i) => `Max, pedir compra de ${qty} ${label(i)}`, 'qual tamanho ou modelo', q.norm);
    if ('none' in f || !qty) return { say: 'Qual item e quantas unidades? Por exemplo: "pedir compra de 20 botas 42".' };
    const it = f.one;
    const urgent = /\burgen\w+|pra ontem|o quanto antes|rapido\b/.test(q.norm);
    const what = `solicitação de compra${urgent ? ' URGENTE' : ''} de ${units(qty)} de ${label(it)} para o setor de Compras (hoje há ${fmt(it.quantity)}${it.min_quantity ? `, mínimo ${fmt(it.min_quantity)}` : ''})`;
    return confirm(what, [{ method: 'POST', path: '/api/compras/requests', body: { items: [{ item_id: it.id, quantity: qty }], priority: urgent ? 'urgente' : 'normal', reason: 'Pedido pela Max' }, what }]);
  },
};

export const actionSkills: Skill[] = [purchaseCreate, orderAction, stockMove, itemCreate, itemMin, itemCategory, requestStatus, postoCreate, postoRemove, emailAuth, userChange, permission, purchaseStatus, supplierActive];
export const ACTION_IDS = actionSkills.map((s) => s.id);
