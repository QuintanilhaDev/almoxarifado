import { normalize, wordsToDigits } from './text';

/**
 * Calculadora falada: "quanto é 15% de 200", "doze vezes oito", "raiz quadrada de 81",
 * "2 elevado a 10", "(3 + 4) * 2". Não usa eval: a conta é lida token a token.
 */
type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' } | { t: 'fn'; v: 'sqrt' };

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, neg: 4 };

function toExpression(text: string): string {
  let s = normalize(text.replace(/\(/g, ' abre parenteses ').replace(/\)/g, ' fecha parenteses ').replace(/[×·]/g, ' vezes ').replace(/÷/g, ' dividido por '));
  s = wordsToDigits(s, true);
  s = s
    .replace(/\b(quanto e|quanto da|quanto fica|quanto vale|calcule|calcula|calcular|me diga|qual e o resultado de|resultado de|a conta|faz a conta|faca a conta|conta de|igual a|\?)\b/g, ' ')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:por cento|%)\s*(?:de|do|da)\s*/g, '($1/100)*')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:por cento|%)/g, '($1/100)')
    .replace(/\braiz quadrada (?:de|do|da)?\s*/g, ' sqrt ')
    .replace(/\bmetade (?:de|do|da)\s*/g, ' 0.5* ')
    .replace(/\bdobro (?:de|do|da)\s*/g, ' 2* ')
    .replace(/\btriplo (?:de|do|da)\s*/g, ' 3* ')
    .replace(/\b(?:ao quadrado)\b/g, ' ^2 ')
    .replace(/\b(?:ao cubo)\b/g, ' ^3 ')
    .replace(/\b(?:elevado a|elevado ao|elevada a)\b/g, ' ^ ')
    .replace(/\b(?:multiplicado por|vezes)\b/g, ' * ')
    .replace(/(\d)\s*x\s*(?=\d)/g, '$1 * ')
    .replace(/\b(?:dividido por|dividida por|sobre)\b/g, ' / ')
    .replace(/\b(?:mais|somado a|somado com)\b/g, ' + ')
    .replace(/\b(?:menos)\b/g, ' - ')
    .replace(/\b(?:abre parenteses)\b/g, ' ( ')
    .replace(/\b(?:fecha parenteses)\b/g, ' ) ')
    .replace(/(\d),(\d)/g, '$1.$2');
  return s.replace(/\s+/g, ' ').trim();
}

function lex(expr: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ') {
      i++;
    } else if (/\d|\./.test(c)) {
      const m = /^\d*\.?\d+/.exec(expr.slice(i));
      if (!m) return null;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if ('+-*/^'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(') {
      out.push({ t: 'lp' });
      i++;
    } else if (c === ')') {
      out.push({ t: 'rp' });
      i++;
    } else if (expr.startsWith('sqrt', i)) {
      out.push({ t: 'fn', v: 'sqrt' });
      i += 4;
    } else return null; // sobrou palavra: não é uma conta
  }
  return out;
}

function evaluate(tokens: Tok[]): number | null {
  const nums: number[] = [];
  const ops: (string | 'lp' | 'sqrt')[] = [];
  const apply = (): boolean => {
    const op = ops.pop();
    if (op === undefined || op === 'lp') return false;
    if (op === 'neg' || op === 'sqrt') {
      const a = nums.pop();
      if (a === undefined) return false;
      nums.push(op === 'neg' ? -a : Math.sqrt(a));
      return true;
    }
    const b = nums.pop();
    const a = nums.pop();
    if (a === undefined || b === undefined) return false;
    nums.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : Math.pow(a, b));
    return true;
  };
  let prev: Tok | null = null;
  for (const tok of tokens) {
    if (tok.t === 'num') {
      if (prev && (prev.t === 'num' || prev.t === 'rp')) return null;
      nums.push(tok.v);
    } else if (tok.t === 'fn') {
      ops.push('sqrt');
    } else if (tok.t === 'lp') {
      if (prev && (prev.t === 'num' || prev.t === 'rp')) return null;
      ops.push('lp');
    } else if (tok.t === 'rp') {
      while (ops.length && ops[ops.length - 1] !== 'lp') if (!apply()) return null;
      if (ops.pop() !== 'lp') return null;
      if (ops[ops.length - 1] === 'sqrt' && !apply()) return null;
    } else {
      const unary = !prev || prev.t === 'op' || prev.t === 'lp' || prev.t === 'fn';
      if (unary) {
        if (tok.v === '-') ops.push('neg');
        else if (tok.v !== '+') return null;
      } else {
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top === 'lp') break;
          const pt = top === 'sqrt' ? 5 : PREC[top];
          const pc = PREC[tok.v];
          if (pt > pc || (pt === pc && tok.v !== '^')) {
            if (!apply()) return null;
          } else break;
        }
        ops.push(tok.v);
      }
    }
    prev = tok;
  }
  while (ops.length) if (!apply()) return null;
  return nums.length === 1 ? nums[0] : null;
}

export interface CalcResult {
  value: number;
  /** resultado pronto para falar/mostrar, no formato brasileiro */
  text: string;
  expression: string;
}

/** Devolve o resultado se a frase for uma conta; senão, null. */
export function tryCalc(text: string): CalcResult | null {
  const expr = toExpression(text);
  if (!expr || !/\d/.test(expr)) return null;
  const tokens = lex(expr);
  if (!tokens) return null;
  const hasOp = tokens.some((t) => t.t === 'op' || t.t === 'fn');
  if (!hasOp) return null; // um número sozinho não é conta
  const value = evaluate(tokens);
  if (value === null || Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) return { value, text: 'não dá para dividir por zero', expression: expr };
  const rounded = Math.round(value * 1e6) / 1e6;
  return {
    value: rounded,
    text: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(rounded),
    expression: expr,
  };
}
