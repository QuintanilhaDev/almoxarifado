import { normalize, similarity } from '../max/text';
import { poLabel, poLeft, type POItem, type PurchaseOrder } from '../compras/pc';
import type { NoteLine } from './server';

/**
 * Vínculo nota fiscal ↔ pedidos de compra.
 *
 * Uma nota pode trazer itens de VÁRIOS pedidos do mesmo fornecedor (ex.: PC 0001 com 5
 * camisas e PC 0002 com 3 apitos faturados juntos), e um mesmo item pode estar em dois
 * pedidos (8 camisas = 5 do PC 0001 + 3 do PC 0002). Aqui cada linha da nota é ligada à
 * linha certa de um dos pedidos em aberto, usando tudo o que a nota diz:
 *
 *  1. o número do pedido que o fornecedor escreveu no item (xPed / nItemPed do XML);
 *  2. pedidos citados nas informações complementares ou no texto do DANFE ("PC 0002");
 *  3. o item do estoque (pela equivalência do fornecedor) e o código do fornecedor no pedido;
 *  4. a quantidade (igual ao que falta receber é sinal forte) e o preço combinado;
 *  5. o pedido mais antigo com saldo, como desempate.
 *
 * Quando a quantidade de uma linha só cabe somando dois pedidos, a linha é DIVIDIDA em
 * partes (mesmo preço unitário, valores rateados ao centavo), e cada parte baixa o seu
 * pedido. O que já entrou, já foi conferido ou foi escolhido à mão nunca é mexido.
 * Cada ligação guarda o motivo, em português, para quem confere entender a escolha.
 */

export interface Candidate {
  po: PurchaseOrder;
  item: POItem;
  index: number;
  score: number;
  why: string[];
  /** a linha está sem item do estoque, mas o pedido diz qual é (código do fornecedor no pedido, ou o fornecedor citou pedido e linha e o nome confere) */
  autoItem: boolean;
}

/**
 * Números citados como pedido de compra num texto ("Pedido 15", "Seu pedido nº 0002 e 0003",
 * "Ordem de compra 7"). As siglas curtas (PC, OC, PED) só valem com o número no formato do
 * Max Hub (com zeros: "PC 0002") ou com "nº"/"#"/":" — "10 PC 25,00" é peça, não pedido.
 */
const NUMS = '((?:\\d{1,6}(?:\\s*(?:[,/;&]|\\be\\b)\\s*)?)+)';
const KW_LONG = new RegExp(`\\b(?:pedidos?(?:\\s+de\\s+compras?|\\s+(?:do\\s+)?cliente)?|ordem\\s+de\\s+compras?|seu\\s+pedido|n\\/?\\s?pedido|xped)\\s*(?:n[º°o.]?|num(?:ero)?\\.?|#|:|-|\\s)*\\s*${NUMS}`, 'gi');
const KW_SHORT = new RegExp(`\\b(?:p\\.?c|o\\.?c|ped)\\.?\\s*(?:(?:n[º°o.]|num(?:ero)?\\.?|#|:)\\s*${NUMS}|-?\\s*(0\\d{1,5}(?:\\s*(?:[,/;&]|\\be\\b)\\s*0\\d{1,5})*)\\b)`, 'gi');
export function orderRefs(text: string | null | undefined): number[] {
  if (!text) return [];
  const out = new Set<number>();
  const t = String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const take = (raw: string | undefined) => {
    if (!raw) return;
    const groups = raw.match(/\d{1,6}/g) ?? [];
    for (const g of groups) {
      const n = Number(g);
      // "pedido 2026/0003": o ano não é o número do pedido
      if (n > 0 && !(g.length === 4 && n >= 2000 && n <= 2100 && groups.length > 1)) out.add(n);
    }
  };
  for (const m of t.matchAll(KW_LONG)) take(m[1]);
  for (const m of t.matchAll(KW_SHORT)) take(m[1] ?? m[2]);
  return [...out];
}

/** o campo xPed do item (já é "o pedido"): aceita "0002", "PC 0002", "PC-2/2026" */
export function xpedNumbers(xped: string | null | undefined): number[] {
  if (!xped) return [];
  const kw = orderRefs(xped);
  if (kw.length) return kw;
  const groups = (String(xped).match(/\d{1,9}/g) ?? []).map((g) => ({ g, n: Number(g) }));
  const noYear = groups.filter(({ g, n }) => !(g.length === 4 && n >= 2000 && n <= 2100));
  return [...new Set((noYear.length ? noYear : groups).map((x) => x.n).filter((n) => n > 0))];
}

const fold = (s: string | null | undefined) => normalize(String(s ?? '')).replace(/[^a-z0-9]/g, '');
const unitOf = (l: NoteLine) => {
  const f = l.factor || 1;
  const u = Number(l.unit_value) || (l.total && l.qty ? l.total / l.qty : 0);
  return u > 0 ? u / f : 0;
};
const nameOf = (i: POItem) => `${i.name}${i.size ? ' ' + i.size : ''}`;
const words = (s: string) =>
  normalize(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
/**
 * Quanto do nome do item do pedido aparece na descrição do fornecedor (0 a 1). Aceita as
 * abreviações comuns de nota ("CAM" = camisa, "SOC" = social) e erros de digitação.
 */
export function nameScore(desc: string, it: Pick<POItem, 'name' | 'size'>): number {
  const d = words(desc);
  const want = words(it.name).filter((w) => w.length >= 3 && !['de', 'da', 'do', 'com', 'para'].includes(w));
  if (!want.length || !d.length) return 0;
  const hit = (w: string) => d.some((x) => x === w || (x.length >= 3 && (w.startsWith(x) || x.startsWith(w))) || (x.length >= 4 && similarity(x, w) >= 0.8));
  let s = want.filter(hit).length / want.length;
  // o 1º termo (o que a coisa é: camisa, bota, apito) pesa mais
  if (!hit(want[0])) s *= 0.5;
  if (it.size) {
    const size = normalize(it.size).replace(/[^a-z0-9]/g, '');
    if (size && d.includes(size)) s = Math.min(1, s + 0.15);
  }
  return Math.round(s * 100) / 100;
}

/** a linha já não pode mudar de pedido: entrou no estoque, foi conferida ou escolhida à mão */
export const lineLocked = (l: NoteLine) => (l.received ?? 0) > 0 || Boolean(l.inspected_at) || Boolean(l.po_lock);

/**
 * Candidatos de pedido para uma linha da nota, do melhor para o pior.
 * `refs`: pedidos citados no texto da nota (informações complementares / DANFE).
 */
export function candidatesFor(l: NoteLine, pos: PurchaseOrder[], refs: number[], tolerance = 0.01): Candidate[] {
  const out: Candidate[] = [];
  const xped = xpedNumbers(l.xped);
  const want = l.qty * (l.factor || 1);
  const unit = unitOf(l);
  for (const po of pos) {
    po.items.forEach((it, index) => {
      const why: string[] = [];
      let score = 0;
      const sameItem = Boolean(l.item_id && it.item_id && l.item_id === it.item_id);
      const sameCode = Boolean(l.code && it.ext_code && fold(l.code) === fold(it.ext_code));
      // item do estoque diferente: nunca liga, nem que o fornecedor tenha citado o pedido
      if (l.item_id && it.item_id && l.item_id !== it.item_id) return;
      const cited = xped.includes(po.number);
      const citedLine = cited && l.nitem_ped !== null && l.nitem_ped !== undefined && Number(l.nitem_ped) === index + 1;
      if (!sameItem && !sameCode && !citedLine) return; // sem item ligado: só sugere (veja suggestFromOrders)
      const nameOk = !l.item_id && citedLine && nameScore(l.description, it) >= 0.3;
      if (citedLine && !sameItem && !sameCode && !l.item_id && !nameOk) return; // citou a linha, mas o nome não tem nada a ver: não arrisca
      const autoItem = !l.item_id && Boolean(it.item_id) && (sameCode || nameOk);
      if (sameItem) {
        score += 50;
        why.push('mesmo item do estoque');
      }
      if (sameCode) {
        score += 40;
        why.push('código do fornecedor igual ao do pedido');
      }
      if (cited) {
        score += 100;
        why.push(`o fornecedor escreveu o ${poLabel(po.number)} neste item`);
      }
      if (citedLine) score += 30;
      else if (refs.includes(po.number)) {
        score += 25;
        why.push(`a nota cita o ${poLabel(po.number)}`);
      }
      const room = poLeft(it);
      if (room <= 0) {
        score -= 60;
      } else if (want === room) {
        score += 15;
        why.push('quantidade igual ao que falta receber');
      } else if (want < room) score += 8;
      else score -= 10;
      if (unit > 0 && it.unit_price > 0) {
        const d = Math.abs(unit - it.unit_price);
        if (d <= tolerance) {
          score += 12;
          why.push('preço igual ao combinado');
        } else if (d / it.unit_price <= 0.05) score += 5;
        else score -= 5;
      }
      // desempate: o pedido mais antigo (e a data prometida mais cedo) primeiro
      score -= po.number * 0.0001;
      out.push({ po, item: it, index, score, why, autoItem });
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** junta de volta as partes de uma linha dividida (enquanto nenhuma estiver travada) */
function mergeParts(lines: NoteLine[]): NoteLine[] {
  const out: NoteLine[] = [];
  const groups = new Map<number, NoteLine[]>();
  lines.forEach((l) => {
    if (l.src !== undefined && l.src !== null && (l.parts ?? 1) > 1) groups.set(l.src, [...(groups.get(l.src) ?? []), l]);
  });
  const done = new Set<number>();
  for (const l of lines) {
    const g = l.src !== undefined && l.src !== null ? groups.get(l.src) : undefined;
    if (!g || g.length < 2 || g.some(lineLocked)) {
      out.push(l);
      continue;
    }
    if (done.has(l.src!)) continue;
    done.add(l.src!);
    const sum = (k: keyof NoteLine) => Math.round(g.reduce((t, x) => t + (Number(x[k]) || 0), 0) * 100) / 100;
    out.push({ ...g[0], qty: g.reduce((t, x) => t + x.qty, 0), total: sum('total'), discount: sum('discount'), freight: sum('freight'), insurance: sum('insurance'), other: sum('other'), ipi: sum('ipi'), parts: 1, part: 1, po_id: null, po_key: null, po_why: null });
  }
  return out;
}

/** divide uma linha em partes com as quantidades dadas (valores rateados, centavos na última) */
export function splitLine(l: NoteLine, qtys: number[]): NoteLine[] {
  if (qtys.length < 2) return [l];
  const keys = ['total', 'discount', 'freight', 'insurance', 'other', 'ipi'] as const;
  const used: Record<string, number> = {};
  return qtys.map((q, k) => {
    const part: NoteLine = { ...l, qty: q, parts: qtys.length, part: k + 1, received: 0 };
    for (const key of keys) {
      const v = Number(l[key]) || 0;
      const share = k === qtys.length - 1 ? Math.round((v - (used[key] ?? 0)) * 100) / 100 : Math.round(((v * q) / l.qty) * 100) / 100;
      used[key] = (used[key] ?? 0) + share;
      (part as unknown as Record<string, number>)[key] = share;
    }
    return part;
  });
}

/** liga o item do estoque que o pedido indica (código do fornecedor no pedido / linha citada) */
const withItem = (l: NoteLine, c: Candidate): NoteLine => (c.autoItem && c.item.item_id ? { ...l, item_id: c.item.item_id, via: 'pedido' } : l);
const whyText = (c: Candidate, extra?: string) => [`${poLabel(c.po.number)} · ${nameOf(c.item)}`, [...c.why.slice(0, 3), ...(extra ? [extra] : [])].join(', ')].filter(Boolean).join(': ');

/**
 * Liga as linhas da nota às linhas dos pedidos (podendo dividir uma linha entre pedidos).
 * Devolve as linhas novas; as travadas ficam como estão (e ocupam o saldo do pedido).
 */
export function allocate(input: NoteLine[], pos: PurchaseOrder[], refs: number[] = [], tolerance = 0.01, reshape = true): NoteLine[] {
  // toda linha sabe de que linha original veio (para juntar/dividir de novo e para a tela)
  const marked = input.map((l, i) => (l.src === undefined || l.src === null ? { ...l, src: i } : l));
  // reshape=false: não junta nem divide linhas (as posições não mudam — usado durante a conferência/entrada)
  const lines = reshape ? mergeParts(marked) : marked;
  const room = new Map<string, number>();
  const id = (po: PurchaseOrder, key: string) => `${po.id}|${key}`;
  for (const po of pos) for (const it of po.items) room.set(id(po, it.key), poLeft(it));
  const out: (NoteLine[] | null)[] = lines.map(() => null);

  // 1) travadas: ficam, e o que ainda vão receber ocupa o saldo do pedido
  lines.forEach((l, n) => {
    if (!lineLocked(l)) return;
    const po = l.po_id ? pos.find((o) => o.id === l.po_id) : null;
    const it = po && l.po_key ? po.items.find((x) => x.key === l.po_key) : null;
    if (po && it) {
      const k = id(po, it.key);
      room.set(k, (room.get(k) ?? 0) - Math.max(0, l.qty * (l.factor || 1) - (l.received ?? 0)));
      out[n] = [l];
    } else if (l.po_lock && !l.po_id) out[n] = [{ ...l, po_id: null, po_key: null }]; // "fora de pedido" escolhido à mão
    else if ((l.received ?? 0) > 0 || l.inspected_at) out[n] = [l.po_id && !po ? { ...l, po_id: null, po_key: null, po_why: null } : l];
    else out[n] = null; // po_lock para um pedido que saiu da nota: liga de novo
  });

  // 2) as demais, das mais certas para as menos certas
  const free = lines
    .map((l, n) => ({ l, n, cands: out[n] ? [] : candidatesFor(l, pos, refs, tolerance) }))
    .filter((x) => !out[x.n]);
  free.sort((a, b) => (b.cands[0]?.score ?? -1e9) - (a.cands[0]?.score ?? -1e9) || a.n - b.n);
  for (const { l, n, cands } of free) {
    if (!cands.length) {
      out[n] = [{ ...l, po_id: null, po_key: null, po_why: null, po_lock: false }];
      continue;
    }
    const want = l.qty * (l.factor || 1);
    const left = (c: Candidate) => room.get(id(c.po, c.item.key)) ?? 0;
    const best = cands[0];
    // cabe inteira num pedido quase tão bom quanto o melhor? então não divide
    const whole = cands.find((c) => left(c) >= want && c.score >= best.score - 20);
    if (whole) {
      room.set(id(whole.po, whole.item.key), left(whole) - want);
      out[n] = [{ ...withItem(l, whole), po_id: whole.po.id, po_key: whole.item.key, po_why: whyText(whole), po_lock: false }];
      continue;
    }
    if (!reshape) {
      const roomy = [...cands].filter((c) => c.score >= best.score - 20).sort((a, b) => left(b) - left(a))[0] ?? best;
      room.set(id(roomy.po, roomy.item.key), left(roomy) - want);
      out[n] = [{ ...withItem(l, roomy), po_id: roomy.po.id, po_key: roomy.item.key, po_why: whyText(roomy), po_lock: false }];
      continue;
    }
    // não cabe em nenhum: divide entre os pedidos com saldo (unidades inteiras da nota)
    const factor = l.factor || 1;
    const parts: { c: Candidate; qty: number }[] = [];
    let rest = l.qty;
    for (const c of cands) {
      if (rest <= 0) break;
      const fit = Math.floor(left(c) / factor);
      if (fit <= 0 || c.score < best.score - 60) continue;
      const q = Math.min(rest, fit);
      parts.push({ c, qty: q });
      room.set(id(c.po, c.item.key), left(c) - q * factor);
      rest -= q;
    }
    if (!parts.length) {
      // nenhum saldo: liga ao melhor mesmo assim (vira divergência de quantidade para Compras)
      out[n] = [{ ...withItem(l, best), po_id: best.po.id, po_key: best.item.key, po_why: whyText(best, 'pedido sem saldo para esta quantidade'), po_lock: false }];
      continue;
    }
    if (rest > 0) parts[0].qty += rest; // o excedente fica na primeira parte (divergência de quantidade)
    if (parts.length === 1) {
      out[n] = [{ ...withItem(l, parts[0].c), po_id: parts[0].c.po.id, po_key: parts[0].c.item.key, po_why: whyText(parts[0].c, rest > 0 ? 'mais do que o pedido tem a receber' : undefined), po_lock: false }];
      continue;
    }
    const split = splitLine(l, parts.map((p) => p.qty));
    out[n] = split.map((s, k) => ({ ...withItem(s, parts[k].c), po_id: parts[k].c.po.id, po_key: parts[k].c.item.key, po_why: `${whyText(parts[k].c)} (parte ${k + 1} de ${parts.length}: ${parts[k].qty} de ${l.qty})`, po_lock: false }));
  }
  return out.flatMap((x, n) => x ?? [lines[n]]);
}

/** pedidos usados pelas linhas (o principal primeiro) */
export function usedOrders(lines: NoteLine[], keep: string[] = []): string[] {
  const ids = [...keep];
  for (const l of lines) if (l.po_id && !ids.includes(l.po_id)) ids.push(l.po_id);
  return ids;
}

/**
 * Linhas ainda SEM item do estoque: o pedido aberto do fornecedor diz qual item deve ser
 * (nome parecido, quantidade e preço batendo). Isso vira a primeira sugestão — ligar
 * continua exigindo a confirmação de alguém.
 */
export function suggestFromOrders(l: NoteLine, pos: PurchaseOrder[], tolerance = 0.01): { item_id: string; label: string; score: number; po_id: string; po_key: string; why: string } | null {
  if (l.item_id) return null;
  const open = pos.flatMap((po) => po.items.filter((i) => i.item_id && poLeft(i) > 0).map((i) => ({ po, i })));
  if (!open.length) return null;
  const want = l.qty * (l.factor || 1);
  const unit = unitOf(l);
  const xped = xpedNumbers(l.xped);
  const scored = open
    .map(({ po, i }) => {
      const name = nameScore(l.description, i);
      let s = name;
      const why: string[] = [];
      if (xped.includes(po.number)) {
        s += 0.35;
        why.push(`o fornecedor citou o ${poLabel(po.number)}`);
      }
      if (want === poLeft(i)) {
        s += 0.15;
        why.push('mesma quantidade');
      }
      if (unit > 0 && Math.abs(unit - i.unit_price) <= tolerance) {
        s += 0.15;
        why.push('mesmo preço');
      }
      return { po, i, s, name, why };
    })
    .filter((x) => x.name >= 0.34 || x.s >= 0.6)
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 0.55) return null;
  if (scored[1] && scored[1].i.item_id !== top.i.item_id && top.s - scored[1].s < 0.1) return null; // empate: não chuta
  return { item_id: top.i.item_id!, label: nameOf(top.i), score: Math.min(0.99, top.s), po_id: top.po.id, po_key: top.i.key, why: [`está no ${poLabel(top.po.number)}`, ...top.why].join(', ') };
}

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por', 'tam', 'tamanho', 'cor', 'unid', 'und']);
/**
 * O item do pedido aparece no texto do DANFE? (código do fornecedor, ou as palavras do nome
 * perto umas das outras — o texto do PDF vem embaralhado em colunas)
 */
export function itemInText(text: string, it: Pick<POItem, 'name' | 'size' | 'ext_code'>): boolean {
  const t = ` ${normalize(text).replace(/[^a-z0-9]+/g, ' ')} `;
  if (it.ext_code && fold(it.ext_code).length >= 3 && t.includes(` ${normalize(it.ext_code).replace(/[^a-z0-9]+/g, ' ').trim()} `)) return true;
  const toks = normalize(it.name)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w));
  if (!toks.length) return false;
  // a palavra mais rara ancora; as outras precisam estar a até 120 letras dela (prefixo vale: "CAM" ~ "camisa")
  const near = (w: string, at: number) => {
    const win = t.slice(Math.max(0, at - 120), at + 120);
    return win.includes(` ${w}`) || (w.length > 4 && win.includes(` ${w.slice(0, 3)}`));
  };
  const anchor = [...toks].sort((a, b) => t.split(` ${a}`).length - t.split(` ${b}`).length)[0];
  let at = t.indexOf(` ${anchor}`);
  while (at >= 0) {
    if (toks.every((w) => near(w, at))) return true;
    at = t.indexOf(` ${anchor}`, at + 1);
  }
  return false;
}
