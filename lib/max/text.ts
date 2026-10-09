/**
 * Ferramentas de texto da Max: normalização, comparação tolerante a erros
 * (o reconhecimento de voz erra letras e acentos), números por extenso e
 * a palavra de ativação "Max, …".
 */

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”"'`´]/g, '')
    .replace(/(\d)[.](?=\d{3}\b)/g, '$1') // 1.250 -> 1250
    .replace(/[^a-z0-9%+\-*/^=.,#@ ]+/g, ' ')
    .replace(/([a-z])[.,]+/g, '$1 ')
    .replace(/[.,]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(norm: string): string[] {
  return norm.split(' ').filter(Boolean);
}

/** Radical simplificado do português: tira plural e alguns sufixos comuns. */
export function stem(w: string): string {
  if (w.length <= 3 || /^\d/.test(w)) return w;
  let s = w;
  if (s.endsWith('coes')) s = s.slice(0, -4) + 'cao';
  else if (s.endsWith('oes')) s = s.slice(0, -3) + 'ao';
  else if (s.endsWith('aes')) s = s.slice(0, -3) + 'ao';
  else if (s.endsWith('ais') && s.length > 4) s = s.slice(0, -2) + 'l';
  else if (s.endsWith('eis') && s.length > 4) s = s.slice(0, -2) + 'l';
  else if (s.endsWith('res') && s.length > 5) s = s.slice(0, -2);
  else if (s.endsWith('ns')) s = s.slice(0, -2) + 'm';
  else if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) s = s.slice(0, -1);
  return s;
}

/** Distância de edição (com troca de letras vizinhas contando 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** 0..1 — quão parecidas são duas palavras. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - editDistance(a, b) / max;
}

/** Duas palavras "são a mesma" para a Max? Palavras curtas precisam ser idênticas. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  const len = Math.min(sa.length, sb.length);
  if (len < 5) return false;
  if (sa[0] !== sb[0]) return false; // o começo da palavra quase sempre é ouvido certo
  return similarity(sa, sb) >= (len >= 8 ? 0.78 : 0.8);
}

/* ---------- números ---------- */

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/**
 * Troca números por extenso por algarismos: "vinte e cinco" -> "25", "dois mil e cem" -> "2100".
 * "um/uma" só vira número quando faz parte de um número maior ou quando `loneOne` é true
 * (em "abrir uma solicitação" o "uma" é artigo).
 */
export function wordsToDigits(norm: string, loneOne = false): string {
  const toks = tokenize(norm);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (!(t in UNITS) && t !== 'mil') {
      out.push(t);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let used = 0;
    let j = i;
    while (j < toks.length) {
      const w = toks[j];
      if (w in UNITS) {
        current += UNITS[w];
        used++;
        j++;
      } else if (w === 'mil') {
        total += (current || 1) * 1000;
        current = 0;
        used++;
        j++;
      } else if (w === 'e' && used > 0 && j + 1 < toks.length && (toks[j + 1] in UNITS || toks[j + 1] === 'mil')) {
        j++;
      } else break;
    }
    const value = total + current;
    const isLoneOne = used === 1 && (t === 'um' || t === 'uma');
    if (isLoneOne && !loneOne) {
      out.push(t);
      i++;
    } else {
      out.push(String(value));
      i = j;
    }
  }
  return out.join(' ');
}

/** Números inteiros citados na frase (por extenso ou em algarismos). */
export function numbersIn(norm: string): number[] {
  const out: number[] = [];
  for (const m of wordsToDigits(norm).matchAll(/(?:^|[^a-z0-9.,])#?(\d{1,7})(?:[.,]\d+)?(?![a-z0-9])/g)) out.push(Number(m[1]));
  return out;
}

/* ---------- palavra de ativação ---------- */

/** Como o reconhecimento de voz costuma escrever "Max". */
const WAKE_STRONG = ['max', 'maks', 'macs', 'mex', 'marx', 'maxi', 'macks', 'mac', 'mack', 'maques', 'maquis', 'makes', 'maxx', 'mach', 'mags'];
/** Palavras comuns que às vezes são "Max" mal ouvido: só valem se o resto fizer sentido. */
const WAKE_WEAK = ['mas', 'mais', 'match', 'mes', 'ma', 'mae', 'marques', 'marcos', 'marte', 'max.', 'matt', 'mat'];
const LEAD_IN = ['ok', 'okay', 'oi', 'ola', 'ei', 'hey', 'e', 'ai', 'fala', 'opa', 'alo', 'eai', 'escuta', 'olha'];

export interface Wake {
  /** 'strong' = disse "Max" com clareza · 'weak' = talvez · 'none' = não chamou */
  wake: 'strong' | 'weak' | 'none';
  /** a frase sem a chamada */
  rest: string;
}

export function stripWake(norm: string): Wake {
  const toks = tokenize(norm);
  if (!toks.length) return { wake: 'none', rest: '' };
  // chamada no começo: "max …", "ok max …", "ei, max …"
  let i = 0;
  while (i < toks.length && i < 2 && LEAD_IN.includes(toks[i]) && toks.length > i + 1) {
    if (WAKE_STRONG.includes(toks[i + 1]) || WAKE_WEAK.includes(toks[i + 1])) {
      i++;
      break;
    }
    i++;
  }
  const head = toks[i] ?? '';
  if (WAKE_STRONG.includes(head)) {
    const rest = toks.slice(i + 1).join(' ');
    // "oi, Max" / "e aí, Max": sem mais nada, a saudação é o próprio pedido
    return { wake: 'strong', rest: rest || toks.slice(0, i).join(' ') };
  }
  // chamada no fim: "bom dia, max"
  const last = toks[toks.length - 1];
  if (toks.length > 1 && WAKE_STRONG.includes(last)) return { wake: 'strong', rest: toks.slice(0, -1).join(' ') };
  // chamada no meio, logo depois de uma saudação: "bom dia max tudo bem"
  const mid = toks.findIndex((t, k) => k > 0 && k <= 3 && WAKE_STRONG.includes(t));
  if (mid > 0) return { wake: 'strong', rest: [...toks.slice(0, mid), ...toks.slice(mid + 1)].join(' ') };
  if (WAKE_WEAK.includes(toks[0]) && toks.length > 1) return { wake: 'weak', rest: toks.slice(1).join(' ') };
  return { wake: 'none', rest: norm };
}

/* ---------- consulta ---------- */

export interface Query {
  raw: string;
  norm: string;
  tokens: string[];
  /** alguma destas palavras/expressões aparece? (tolerante a erro de digitação/voz) */
  any: (...terms: string[]) => boolean;
  /** todas aparecem? */
  all: (...terms: string[]) => boolean;
  /** quantos dos termos aparecem */
  count: (...terms: string[]) => number;
  /** a frase bate com a expressão regular (já sem acentos)? */
  re: (r: RegExp) => RegExpMatchArray | null;
  numbers: number[];
}

export function makeQuery(raw: string, normalized?: string): Query {
  const norm = normalized ?? normalize(raw);
  const tokens = tokenize(norm);
  const padded = ` ${norm} `;
  const hit = (term: string): boolean => {
    const t = normalize(term);
    if (!t) return false;
    if (t.includes(' ')) {
      if (padded.includes(` ${t} `)) return true;
      // expressão com mais de uma palavra: todas em sequência, tolerando erro em cada uma
      const parts = t.split(' ');
      for (let i = 0; i + parts.length <= tokens.length; i++) {
        if (parts.every((p, k) => sameWord(tokens[i + k], p))) return true;
      }
      return false;
    }
    return tokens.some((tok) => sameWord(tok, t));
  };
  return {
    raw,
    norm,
    tokens,
    any: (...terms) => terms.some(hit),
    all: (...terms) => terms.every(hit),
    count: (...terms) => terms.filter(hit).length,
    re: (r) => norm.match(r),
    numbers: numbersIn(norm),
  };
}

/* ---------- busca tolerante em listas (itens, postos, pessoas) ---------- */

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra', 'pro', 'com', 'um', 'uma', 'tam', 'tamanho', 'numero', 'n', 'tipo', 'por', 'ao', 'que']);

export function contentTokens(norm: string): string[] {
  return tokenize(norm).filter((t) => !STOP.has(t));
}

/**
 * Nota 0..1 de quanto `needle` (o que a pessoa falou) descreve `hay` (um nome da lista).
 * Cada palavra falada precisa achar uma palavra parecida no nome.
 */
export function matchScore(needleTokens: string[], hay: string): number {
  if (!needleTokens.length) return 0;
  const hayTokens = contentTokens(normalize(hay));
  if (!hayTokens.length) return 0;
  let sum = 0;
  for (const n of needleTokens) {
    let best = 0;
    for (const h of hayTokens) {
      let s = 0;
      if (h === n) s = 1;
      else if (stem(h) === stem(n)) s = 0.95;
      else if (/^\d+$/.test(n) || /^\d+$/.test(h)) s = 0;
      else if (n.length >= 4 && h.startsWith(n)) s = 0.85;
      else if (n.length >= 5 && h.length >= 5) {
        const sim = similarity(stem(n), stem(h));
        s = sim >= 0.75 ? sim * 0.9 : 0;
      }
      if (s > best) best = s;
    }
    sum += best;
  }
  const coverage = sum / needleTokens.length;
  // leve bônus quando o nome não tem muito mais palavras do que o que foi dito
  const tight = Math.min(1, needleTokens.length / hayTokens.length);
  return coverage * (0.85 + 0.15 * tight);
}

export function bestMatches<T>(needle: string, list: T[], label: (x: T) => string, min = 0.6, max = 6): { item: T; score: number }[] {
  const toks = contentTokens(normalize(needle));
  if (!toks.length) return [];
  return list
    .map((item) => ({ item, score: matchScore(toks, label(item)) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

export function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** "1 item" / "3 itens" */
export function plural(n: number, one: string, many: string): string {
  return `${new Intl.NumberFormat('pt-BR').format(n)} ${n === 1 ? one : many}`;
}

export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}

/** A frase pede para ALTERAR algo (registrar, cadastrar, excluir, mudar…), e não só consultar. */
export function wantsChange(norm: string): boolean {
  return /\b(registr\w+|lance|lanca|lancar|(de|da|dar|deem) (uma |a )?(entrada|saida|baixa)|adicion\w+|acrescent\w+|inclua|incluir|cadastre|cadastra|cadastrar|crie|cria|criar|exclua|excluir|exclui|apague|apaga|apagar|delete|deleta|deletar|remova|remove|remover|marque|marca|marcar|mude|muda|mudar|altere|altera|alterar|troque|troca|trocar|atualize|atualiza|atualizar|transfira|transferir|envie|enviar|mande|mandar|devolva|devolver|autorize|autoriza|autorizar|desautoriz\w+|desative|desativa|desativar|reative|reativar|ative|ativar|bloqueie|bloquear|promova|promover|rebaixe|rebaixar|defina|definir|ajuste|ajusta|ajustar|zere|zerar|renomeie|renomear|coloque|colocar|tire|tirar|faca|resolva|resolver|conclua|concluir|finalize|finalizar|aloque|alocar|mova|mover|libere|liberar|redefin\w+|reset\w+|lembre|lembre-se|anote|anota|anotar|memorize|memorizar|aprenda|guarde)\b/.test(
    norm,
  );
}

