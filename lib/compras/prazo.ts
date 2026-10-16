/**
 * Prazos em dias úteis (segunda a sexta, sem feriados nacionais, a Sexta-feira Santa
 * e o 2 de Julho da Bahia). Datas sempre como "AAAA-MM-DD", no horário de Salvador.
 */
const FIXED = ['01-01', '04-21', '05-01', '07-02', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T12:00:00Z`);
const goodFriday = new Map<number, string>();

export function isHoliday(s: string): boolean {
  if (FIXED.includes(s.slice(5))) return true;
  const y = Number(s.slice(0, 4));
  if (!goodFriday.has(y)) {
    const e = easter(y);
    e.setUTCDate(e.getUTCDate() - 2);
    goodFriday.set(y, iso(e));
  }
  return goodFriday.get(y) === s;
}

export function isBusinessDay(s: string): boolean {
  const wd = parse(s).getUTCDay();
  return wd !== 0 && wd !== 6 && !isHoliday(s);
}

/** hoje em Salvador */
export const todayBahia = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

/** soma dias (úteis ou corridos) a uma data; a contagem começa no dia seguinte */
export function addDays(from: string, days: number, business: boolean): string {
  const d = parse(from);
  if (!business) {
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  }
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(iso(d))) left--;
  }
  return iso(d);
}

/** quantos dias (úteis ou corridos) de a até b (b > a = positivo) */
export function daysBetween(a: string, b: string, business: boolean): number {
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  const [x, y] = sign > 0 ? [a, b] : [b, a];
  const d = parse(x);
  let n = 0;
  while (iso(d) < y) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!business || isBusinessDay(iso(d))) n++;
  }
  return n * sign;
}

export const leadText = (days: number | null | undefined, business = true) =>
  days === null || days === undefined ? 'sem prazo' : days === 0 ? 'pronta entrega' : `${days} dia${days === 1 ? '' : 's'} ${business ? (days === 1 ? 'útil' : 'úteis') : days === 1 ? 'corrido' : 'corridos'}`;
