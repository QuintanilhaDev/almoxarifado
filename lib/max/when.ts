import { wordsToDigits } from './text';

/**
 * Entende o período citado em uma frase: "nas últimas 15 horas", "ontem", "esta semana",
 * "nos últimos 3 dias", "mês passado"… Os dias começam à meia-noite de Salvador (UTC−3).
 */
export interface TimeWindow {
  fromMs: number;
  toMs: number;
  /** começo de frase para a resposta: "Nas últimas 15 horas" */
  label: string;
  /** quando coincide com um botão da tela de Métricas */
  standard: 'hoje' | 'ultimo-dia' | 'ultima-semana' | 'ultimo-mes' | null;
}

const H = 3_600_000;
const D = 24 * H;
const TZ_SHIFT = -3 * H; // Bahia não tem horário de verão

const dayStart = (ms: number) => Math.floor((ms + TZ_SHIFT) / D) * D - TZ_SHIFT;
function monthStart(ms: number, back = 0): number {
  const d = new Date(ms + TZ_SHIFT);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) - TZ_SHIFT;
}
function weekStart(ms: number): number {
  const start = dayStart(ms);
  const dow = new Date(start + TZ_SHIFT).getUTCDay(); // 0 = domingo
  return start - ((dow + 6) % 7) * D; // segunda-feira
}

const UNIT_MS: Record<string, number> = { minuto: 60_000, hora: H, dia: D, semana: 7 * D, mes: 30 * D };
const UNIT_NAME: Record<string, [string, string, boolean]> = {
  minuto: ['minuto', 'minutos', false],
  hora: ['hora', 'horas', true],
  dia: ['dia', 'dias', false],
  semana: ['semana', 'semanas', true],
  mes: ['mês', 'meses', false],
};

export function windowIn(norm: string, now = Date.now()): TimeWindow | null {
  const t = wordsToDigits(norm, true);
  const win = (fromMs: number, toMs: number, label: string, standard: TimeWindow['standard'] = null): TimeWindow => ({ fromMs, toMs, label, standard });

  if (/\bmeia hora\b/.test(t)) return win(now - 30 * 60_000, now, 'Na última meia hora');

  // "últimas 15 horas", "nos últimos 3 dias", "há 2 horas", "de 5 dias pra cá"
  const m = t.match(/\b(\d{1,4}) (minuto|hora|dia|semana|mes)(?:s|es)?\b/);
  if (m && /\b(ultim[oa]s?|ha|faz|fazem|atras|pra ca|para ca|passad[oa]s?|nas|nos|em|durante|dentro de)\b/.test(t)) {
    const n = Number(m[1]);
    const unit = m[2];
    const span = n * UNIT_MS[unit];
    if (n > 0 && span <= 400 * D) {
      const [one, many, fem] = UNIT_NAME[unit];
      const label = n === 1 ? `${fem ? 'Na última' : 'No último'} ${one}` : `${fem ? 'Nas últimas' : 'Nos últimos'} ${n} ${many}`;
      const standard = span === D ? 'ultimo-dia' : span === 7 * D ? 'ultima-semana' : span === 30 * D ? 'ultimo-mes' : null;
      return win(now - span, now, label, standard);
    }
  }
  if (/\bultima hora\b/.test(t)) return win(now - H, now, 'Na última hora');

  const today = dayStart(now);
  if (/\banteontem\b/.test(t)) return win(today - 2 * D, today - D, 'Anteontem');
  if (/\b(desde ontem|de ontem (pra|para) ca)\b/.test(t)) return win(today - D, now, 'Desde ontem');
  if (/\bontem\b/.test(t)) return win(today - D, today, 'Ontem');
  if (/\b(semana passada|ultima semana completa)\b/.test(t)) return win(weekStart(now) - 7 * D, weekStart(now), 'Na semana passada');
  if (/\b(esta|essa|nesta|nessa|desta|dessa) semana\b/.test(t)) return win(weekStart(now), now, 'Nesta semana');
  if (/\b(mes passado|ultimo mes completo)\b/.test(t)) return win(monthStart(now, 1), monthStart(now), 'No mês passado');
  if (/\b(este|esse|neste|nesse|deste|desse) mes\b/.test(t)) return win(monthStart(now), now, 'Neste mês');
  if (/\b(este|esse|neste|nesse|deste|desse) ano\b/.test(t)) {
    const d = new Date(now + TZ_SHIFT);
    return win(Date.UTC(d.getUTCFullYear(), 0, 1) - TZ_SHIFT, now, 'Neste ano');
  }
  if (/\b(ultimo dia|ultimas horas|24h)\b/.test(t)) return win(now - D, now, 'Nas últimas 24 horas', 'ultimo-dia');
  if (/\b(semana|semanal)\b/.test(t)) return win(now - 7 * D, now, 'Na última semana', 'ultima-semana');
  if (/\b(mes|mensal)\b/.test(t)) return win(now - 30 * D, now, 'No último mês', 'ultimo-mes');
  if (/\b(hoje|do dia|ate agora|neste momento)\b/.test(t)) return win(today, now, 'Hoje', 'hoje');
  return null;
}
