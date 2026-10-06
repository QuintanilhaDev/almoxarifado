export const TZ = 'America/Bahia';

export function protocolLabel(n: number) {
  return '#' + String(n).padStart(4, '0');
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function timeAgo(iso: string, now = Date.now()) {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'agora';
  const min = Math.round(diff / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(iso));
}

export function initials(name: string | null | undefined) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function answerToText(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Saudação conforme o horário de Salvador/BA. */
export function greetingFor(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(date),
  );
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}
