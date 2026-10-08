import { TZ } from '../format';

/** Relógio de Salvador/BA (independe do fuso do aparelho). */
export function salvadorParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute') };
}

export type DayPeriod = 'manha' | 'tarde' | 'noite';

export function dayPeriod(date = new Date()): DayPeriod {
  const { hour } = salvadorParts(date);
  if (hour >= 5 && hour < 12) return 'manha';
  if (hour >= 12 && hour < 18) return 'tarde';
  return 'noite';
}

export const PERIOD_GREETING: Record<DayPeriod, string> = { manha: 'Bom dia', tarde: 'Boa tarde', noite: 'Boa noite' };

/** "14h32" para escrever · "14 horas e 32 minutos" para falar */
export function timeText(date = new Date()) {
  const { hour, minute } = salvadorParts(date);
  const written = `${hour}h${String(minute).padStart(2, '0')}`;
  const h = hour === 1 ? '1 hora' : `${hour} horas`;
  const spoken = minute === 0 ? `${h} em ponto` : `${h} e ${minute === 1 ? '1 minuto' : `${minute} minutos`}`;
  return { written, spoken, hour, minute };
}

export function dateText(date = new Date()) {
  const s = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return s.replace(/^./, (c) => c.toUpperCase());
}

export function firstName(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}
