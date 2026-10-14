import { maxEmit } from './bus';
import { listJoin, type Query } from './text';
import type { MaxHost, MaxReply, Skill } from './types';
import { formatDoc, type Supplier } from '../compras/fornecedores';

/**
 * Fornecedores (setor Compras): a Max conta, procura, diz o contato, abre o cadastro
 * e a importação. Para abrir telas ela corre até a aba e o botão certos e soca.
 */
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const tabSel = '.nav-item[data-tab="fornecedores"], .tab[data-tab="fornecedores"]';
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const aboutSuppliers = (q: Query) => Boolean(q.re(/\bfornecedor(es)?\b|\bquem (fornece|vende)\b/));
const wantsNew = (q: Query) => Boolean(q.re(/\b(cadastr\w+|nov[oa]|adicion\w+|inclu\w+|registr\w+|cri\w+) (um |o |a |uma )?(novo )?fornecedor\b/));
const wantsImport = (q: Query) => Boolean(q.re(/\b(import\w+|carreg\w+|subir|sobe|envi\w+)\b/) && q.re(/\b(planilha|excel|xlsx|csv|lista)\b/));

const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para']);
/** "malharia bahia ltda" → "Malharia Bahia Ltda" */
const properName = (s: string) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : /^(ltda|me|epp|sa|s\/a|eireli)$/.test(w) ? (w === 'ltda' ? 'Ltda' : w.toUpperCase()) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

function press(host: MaxHost, sel: string, opts?: { exec?: () => void; skipActive?: boolean }) {
  if (host.press) return host.press(sel, opts);
  if (opts?.exec) return opts.exec();
  if (typeof document !== 'undefined') (document.querySelector(sel) as HTMLElement | null)?.click();
}

/** a lista (da tela, ou buscada agora se a aba ainda não abriu) */
async function suppliers(host: MaxHost): Promise<Supplier[] | null> {
  const l = host.fornecedores?.list();
  if (l) return l;
  try {
    const r = await fetch('/api/compras/fornecedores', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return ((await r.json()) as { suppliers: Supplier[] }).suppliers;
  } catch {
    return null;
  }
}

/** o que a pessoa procura: "o fornecedor X", "quem fornece botas", "telefone da Malharia" */
function target(q: Query): string {
  const t = fold(q.raw)
    .replace(/^(ola |oi )?max\b/, '')
    .replace(/\b(por favor|pra mim|para mim)\b/g, ' ');
  const m =
    t.match(/\bquem (?:fornece|vende) (.+)$/) ||
    t.match(/\bfornecedor(?:es)? (?:de|do|da|dos|das) (.+)$/) ||
    t.match(/\b(?:telefone|contato|email|e mail|cnpj|endereco|whatsapp|celular) (?:do|da|de) (?:fornecedor )?(.+)$/) ||
    t.match(/\b(?:abr\w*|mostr\w*|ver|veja) (?:o |a )?(?:fornecedor|cadastro do fornecedor|cadastro da|cadastro do) (.+)$/) ||
    t.match(/\bfornecedor (.+)$/);
  return (m?.[1] ?? '')
    .replace(/\b(cadastrad\w*|ativo|ativos|por favor|agora|ai|aqui)\b/g, ' ')
    .replace(/^(o|a|os|as) /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function find(list: Supplier[], t: string): { exact: Supplier[]; byCategory: Supplier[] } {
  const k = fold(t);
  if (!k) return { exact: [], byCategory: [] };
  const words = k.split(' ').filter((w) => w.length > 2);
  const nameHit = (s: Supplier) => {
    const n = fold(`${s.name} ${s.trade_name ?? ''}`);
    return n.includes(k) || (words.length > 0 && words.every((w) => n.includes(w)));
  };
  const stem = (w: string) => w.replace(/(oes|aes|es|s)$/, '');
  const catHit = (s: Supplier) => {
    const c = fold(s.category ?? '');
    return Boolean(c) && words.some((w) => c.includes(stem(w)));
  };
  const active = list.filter((s) => s.active);
  return { exact: active.filter(nameHit), byCategory: active.filter((s) => !nameHit(s) && catHit(s)) };
}

const label = (s: Supplier) => s.trade_name || s.name;
const contactLine = (s: Supplier) =>
  [s.contact ? `contato ${s.contact}` : null, s.phone ? `telefone ${s.phone}` : null, s.email ? `e-mail ${s.email}` : null].filter(Boolean).join(', ');

function openOne(host: MaxHost, s: Supplier) {
  press(host, tabSel, { skipActive: true });
  press(host, `[data-max-fornecedor="${s.id}"]`, { exec: () => maxEmit('fornecedores:open', { id: s.id }) });
}

/** O que a pessoa disse ao pedir o cadastro vira o começo do formulário (ela confere e salva). */
export function supplierPrefill(raw: string): Record<string, string> {
  // A frase chega normalizada (minúsculas, sem vírgulas), então tudo é lido pelas palavras-chave.
  const t = raw.toLowerCase();
  const STOP = '(?:telefone|fone|celular|whatsapp|cnpj|cpf|e ?-?mail|email|contato|que (?:fornece|vende)|de cnpj|com cnpj|com telefone|com o telefone|cidade)';
  const prefill: Record<string, string> = {};
  const nm = t.match(new RegExp(`fornecedor(?:a)?\\s+(?:chamad[oa]\\s+|de nome\\s+|com o nome(?: de)?\\s+)?(.+?)(?=\\s*[,;]|\\s+${STOP}\\b|\\s+com\\b|$)`));
  const name = nm?.[1]?.replace(/[.!?]+$/, '').trim();
  if (name && name.length >= 2 && !/^(novo|nova|um|uma|o|a)$/.test(name)) prefill.name = properName(name);
  const doc = t.match(/\b(?:cnpj|cpf)\s*(?:e|é|:)?\s*([\d.\/\s-]{11,22})/)?.[1]?.replace(/\D/g, '');
  if (doc && (doc.length === 14 || doc.length === 11)) prefill.cnpj = formatDoc(doc);
  const phone = t.match(/\b(?:telefone|fone|celular|whatsapp)\s*(?:e|é|:)?\s*([\d\s()+-]{8,20}\d)/)?.[1];
  if (phone) prefill.phone = phone.replace(/\s+/g, ' ').trim();
  const email = raw.match(/[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i)?.[0];
  if (email) prefill.email = email.toLowerCase();
  const cat = t.match(/\bque (?:fornece|vende)\s+(.+?)(?=\s*[,;]|\s+(?:telefone|fone|celular|cnpj|cpf|email|contato)\b|$)/)?.[1];
  if (cat) prefill.category = cat.trim();
  return prefill;
}

const noAccess: MaxReply = { say: 'Você não tem acesso aos fornecedores. Fale com o master do setor Compras.' };

export const fornecedoresSkills: Skill[] = [
  /* ---------- novo fornecedor (abre o cadastro, já preenchido com o que foi dito) ---------- */
  {
    id: 'supplier-new',
    scopes: ['sector'],
    sector: 'compras',
    examples: ['Max, cadastrar um novo fornecedor', 'Max, novo fornecedor Malharia Bahia, telefone 71 3333-4444'],
    match: (q) => (wantsNew(q) ? 0.97 : 0),
    run: (q, host) => {
      if (!host.fornecedores) return noAccess;
      if (!host.fornecedores.canEdit) return { say: 'Você só pode consultar os fornecedores. Para cadastrar, peça a permissão de edição ao master do setor.' };
      const prefill = supplierPrefill(q.raw);
      const said = Object.keys(prefill).length;
      return {
        say: said ? `Abrindo o cadastro de fornecedor com o que você disse. Confira e toque em Cadastrar.` : 'Abrindo o cadastro de fornecedor. Só a razão social é obrigatória.',
        act: () => {
          press(host, tabSel, { skipActive: true });
          press(host, '[data-max="fornecedor-novo"]', { exec: () => maxEmit('fornecedores:new', { prefill }) });
        },
      };
    },
  },

  /* ---------- importar a planilha de fornecedores ---------- */
  {
    id: 'supplier-import',
    scopes: ['sector'],
    sector: 'compras',
    examples: ['Max, importar a planilha de fornecedores'],
    match: (q) => (aboutSuppliers(q) && wantsImport(q) ? 0.97 : 0),
    run: (_q, host) => {
      if (!host.fornecedores) return noAccess;
      if (!host.fornecedores.canEdit) return { say: 'Você só pode consultar os fornecedores. Para importar, peça a permissão de edição ao master do setor.' };
      return {
        say: 'Abrindo a importação. É só escolher ou arrastar a planilha: eu reconheço as colunas sozinha e mostro tudo antes de gravar.',
        act: () => {
          press(host, tabSel, { skipActive: true });
          press(host, '[data-max="fornecedor-importar"]');
        },
      };
    },
  },

  /* ---------- quantos fornecedores / quem fornece X / contato do fornecedor X ---------- */
  {
    id: 'supplier-info',
    scopes: ['sector'],
    sector: 'compras',
    examples: ['Max, quantos fornecedores temos?', 'Max, quem fornece botas?', 'Max, qual o telefone do fornecedor Malharia Bahia?'],
    match: (q) => {
      if (!aboutSuppliers(q) || wantsNew(q) || wantsImport(q)) return 0;
      // "abrir fornecedores" é só trocar de aba
      if (q.re(/\b(abr\w+|ir|va|vai|mostr\w+|ver|veja|acess\w+|entr\w+)\b/) && !target(q)) return 0;
      return 0.93;
    },
    run: async (q, host) => {
      if (!host.fornecedores) return noAccess;
      const list = await suppliers(host);
      if (!list) return { say: 'Não consegui carregar os fornecedores agora. Tente de novo em alguns segundos.' };
      const active = list.filter((s) => s.active);
      const t = target(q);
      const counting = q.re(/\b(quant[oa]s|numero de|total de)\b/);
      if (!t || (counting && !q.re(/\bquem\b/))) {
        if (t && counting) {
          const { exact, byCategory } = find(list, t);
          const hits = [...exact, ...byCategory];
          return { say: hits.length ? `Temos ${fmt(hits.length)} ${hits.length === 1 ? 'fornecedor' : 'fornecedores'} de ${t}: ${listJoin(hits.slice(0, 5).map(label))}${hits.length > 5 ? ' e outros' : ''}.` : `Não achei fornecedor de ${t} no cadastro.` };
        }
        const noDoc = active.filter((s) => !s.cnpj).length;
        const noContact = active.filter((s) => !s.phone && !s.email).length;
        return {
          say: active.length
            ? `Temos ${fmt(active.length)} ${active.length === 1 ? 'fornecedor ativo' : 'fornecedores ativos'}.${noContact ? ` ${fmt(noContact)} ${noContact === 1 ? 'está' : 'estão'} sem telefone e sem e-mail.` : ''}${noDoc ? ` ${fmt(noDoc)} sem CNPJ.` : ''}`
            : 'Ainda não há fornecedores cadastrados. Você pode importar uma planilha ou cadastrar um por um.',
          chips: active.length ? ['Max, quem fornece botas?'] : ['Max, importar a planilha de fornecedores', 'Max, cadastrar um novo fornecedor'],
          act: () => press(host, tabSel, { skipActive: true }),
        };
      }
      const found = find(list, t);
      // "quem fornece X": vale o nome e o que cada um fornece
      const who = Boolean(q.re(/\bquem (fornece|vende)\b/));
      const exact = who ? [] : found.exact;
      const byCategory = who ? [...found.exact, ...found.byCategory] : found.byCategory;
      if (exact.length === 1) {
        const s = exact[0];
        const asks = q.re(/\b(telefone|contato|email|e mail|whatsapp|celular)\b/);
        const asksDoc = q.re(/\bcnpj\b/);
        const info = asksDoc ? (s.cnpj ? `CNPJ ${formatDoc(s.cnpj)}` : 'sem CNPJ cadastrado') : contactLine(s) || 'sem telefone nem e-mail cadastrados';
        return {
          say: `${label(s)}${s.category && !asks && !asksDoc ? `, fornece ${s.category}` : ''}: ${info}.`,
          act: () => openOne(host, s),
        };
      }
      const hits = exact.length ? exact : byCategory;
      if (!hits.length) return { say: `Não encontrei fornecedor para "${t}". Posso abrir o cadastro de um novo, se quiser.`, chips: ['Max, cadastrar um novo fornecedor'] };
      if (hits.length === 1) {
        const s = hits[0];
        return { say: `Quem fornece ${t} é ${label(s)}${contactLine(s) ? `: ${contactLine(s)}` : ''}.`, act: () => openOne(host, s) };
      }
      return {
        say: `Encontrei ${fmt(hits.length)} fornecedores${exact.length ? ` com "${t}" no nome` : ` de ${t}`}: ${listJoin(hits.slice(0, 5).map(label))}${hits.length > 5 ? ' e outros' : ''}. Deixei a busca aberta na tela.`,
        act: () => {
          press(host, tabSel, { skipActive: true });
          press(host, '.toolbar .search input', { exec: () => maxEmit('fornecedores:search', { q: t }) });
        },
      };
    },
  },
];
