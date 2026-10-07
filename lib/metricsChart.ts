/**
 * Desenho do gráfico de métricas em SVG (texto puro, sem React).
 * A mesma função desenha o gráfico na tela e o PNG baixado, então os dois sempre coincidem.
 */
import { formatDateTime } from './format';
import type { MetricsData } from './metrics';

export const COLORS = {
  bg: '#0c0c0e',
  card: '#131317',
  tile: '#1a1a20',
  line: '#2a2a33',
  grid: '#262630',
  text: '#f6f4fb',
  muted: '#a19eb2',
  faint: '#6c6979',
  in: '#8fe3bb',
  out: '#c6a8ff',
  amber: '#f2c879',
  danger: '#ff8f9e',
};
export const FONT = "'Figtree','Segoe UI','Helvetica Neue',Arial,sans-serif";
export const FONT_DISPLAY = "'Bricolage Grotesque','Segoe UI','Helvetica Neue',Arial,sans-serif";

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 1234567 → "1.234.567" */
export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

/** Escala "redonda" para o eixo Y: 0, 5, 10, 15, 20… */
export function niceScale(max: number): { max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] };
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  let step = pow;
  for (const m of [1, 2, 2.5, 5, 10]) {
    step = m * pow;
    if (max / step <= 5) break;
  }
  if (step < 1) step = 1;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max: top, step, ticks };
}

export interface Pt {
  x: number;
  y: number;
}

/** Curva suave que nunca passa dos pontos (sem "barriga" abaixo de zero). Fritsch–Carlson. */
export function monotonePath(p: Pt[]): string {
  const n = p.length;
  if (n === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (n === 1) return `M${f(p[0].x)},${f(p[0].y)}`;
  if (n === 2) return `M${f(p[0].x)},${f(p[0].y)}L${f(p[1].x)},${f(p[1].y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1].x - p[i].x);
    m.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x));
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }
  }
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(p[i].x + h)},${f(p[i].y + t[i] * h)} ${f(p[i + 1].x - h)},${f(p[i + 1].y - t[i + 1] * h)} ${f(p[i + 1].x)},${f(p[i + 1].y)}`;
  }
  return d;
}

export interface Geometry {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  innerW: number;
  innerH: number;
  n: number;
  /** centro do intervalo i */
  x: (i: number) => number;
  y: (v: number) => number;
  scale: ReturnType<typeof niceScale>;
  /** índices de intervalos já ocorridos */
  live: number;
}

export function chartGeometry(data: Pick<MetricsData, 'buckets'>, width: number, height: number): Geometry {
  const maxV = Math.max(0, ...data.buckets.map((b) => Math.max(b.in, b.out)));
  const scale = niceScale(maxV);
  const labelW = fmt(scale.max).length * 7.2 + 14;
  const padL = Math.max(34, Math.round(labelW));
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const innerW = Math.max(40, width - padL - padR);
  const innerH = Math.max(40, height - padT - padB);
  const n = data.buckets.length;
  const live = data.buckets.filter((b) => !b.future).length;
  return {
    width,
    height,
    padL,
    padR,
    padT,
    padB,
    innerW,
    innerH,
    n,
    x: (i) => padL + ((i + 0.5) * innerW) / n,
    y: (v) => padT + innerH - (v / scale.max) * innerH,
    scale,
    live,
  };
}

export interface ChartOpts {
  /** classes para a animação de entrada (só na tela) */
  animate?: boolean;
  /** prefixo dos ids do SVG (evita conflito entre dois gráficos na mesma página) */
  id?: string;
  /** tamanho base da fonte do eixo */
  fontSize?: number;
}

/** Conteúdo do gráfico (defs + grupos), sem a tag <svg>. */
export function chartInner(data: MetricsData, g: Geometry, o: ChartOpts = {}): string {
  const id = o.id ?? 'mc';
  const fs = o.fontSize ?? 12;
  const anim = o.animate ? ' class="mt-draw"' : '';
  const areaAnim = o.animate ? ' class="mt-fade"' : '';
  const out: string[] = [];
  out.push(
    `<defs>` +
      `<linearGradient id="${id}-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${COLORS.in}" stop-opacity="0.38"/><stop offset="100%" stop-color="${COLORS.in}" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="${id}-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${COLORS.out}" stop-opacity="0.38"/><stop offset="100%" stop-color="${COLORS.out}" stop-opacity="0"/></linearGradient>` +
      `</defs>`,
  );

  // grade e eixo Y
  for (const v of g.scale.ticks) {
    const y = g.y(v);
    out.push(
      `<line x1="${g.padL}" x2="${g.padL + g.innerW}" y1="${y}" y2="${y}" stroke="${v === 0 ? COLORS.line : COLORS.grid}" stroke-width="1"${v === 0 ? '' : ' stroke-dasharray="3 5"'}/>`,
      `<text x="${g.padL - 10}" y="${y + 4}" text-anchor="end" font-size="${fs}" fill="${COLORS.faint}" font-family="${FONT}">${fmt(v)}</text>`,
    );
  }

  // eixo X (rótulos espaçados para nunca encavalar)
  const longest = Math.max(...data.buckets.map((b) => b.label.length), 3);
  const per = longest * (fs * 0.62) + 16;
  const step = Math.max(1, Math.ceil(per / (g.innerW / g.n)));
  data.buckets.forEach((b, i) => {
    if (i % step !== 0) return;
    out.push(
      `<text x="${g.x(i)}" y="${g.padT + g.innerH + 20}" text-anchor="middle" font-size="${fs}" fill="${b.future ? COLORS.line : COLORS.muted}" font-family="${FONT}">${esc(b.label)}</text>`,
    );
  });

  const total = data.totals.in + data.totals.out;
  if (total === 0) {
    out.push(
      `<text x="${g.padL + g.innerW / 2}" y="${g.padT + g.innerH / 2}" text-anchor="middle" font-size="${fs + 3}" fill="${COLORS.muted}" font-family="${FONT}">Sem entradas nem saídas neste período</text>`,
    );
    return out.join('');
  }

  const series: { key: 'in' | 'out'; color: string }[] = [
    { key: 'in', color: COLORS.in },
    { key: 'out', color: COLORS.out },
  ];
  const base = g.y(0);
  for (const s of series) {
    const pts: Pt[] = [];
    for (let i = 0; i < g.live; i++) pts.push({ x: g.x(i), y: g.y(data.buckets[i][s.key]) });
    if (!pts.length) continue;
    const line = monotonePath(pts);
    if (pts.length > 1) {
      out.push(
        `<path${areaAnim} d="${line}L${pts[pts.length - 1].x},${base}L${pts[0].x},${base}Z" fill="url(#${id}-${s.key})" stroke="none"/>`,
        `<path${anim} pathLength="1" d="${line}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
    if (pts.length <= 12) {
      for (const p of pts) {
        out.push(`<circle cx="${p.x}" cy="${p.y}" r="3.6" fill="${COLORS.card}" stroke="${s.color}" stroke-width="2"/>`);
      }
    }
  }
  return out.join('');
}

/** SVG completo do gráfico (largura/altura em pixels reais). */
export function chartSvg(data: MetricsData, width: number, height: number, o: ChartOpts = {}): string {
  const g = chartGeometry(data, width, height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de entradas e saídas do almoxarifado">${chartInner(data, g, o)}</svg>`;
}

/* ------------------------------------------------------------------------ */
/* PNG: cartão completo (título, números e gráfico) para baixar               */
/* ------------------------------------------------------------------------ */

export const REPORT_W = 1280;
export const REPORT_H = 860;

export function reportSvg(data: MetricsData): { svg: string; width: number; height: number } {
  const W = REPORT_W;
  const H = REPORT_H;
  const M = 48; // margem do cartão
  const P = 40; // respiro interno
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  o.push(`<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`);
  o.push(`<rect x="${M - 16}" y="${M - 16}" width="${W - 2 * (M - 16)}" height="${H - 2 * (M - 16)}" rx="28" fill="${COLORS.card}" stroke="${COLORS.line}"/>`);

  const L = M + P - 16;
  const R = W - (M + P - 16);
  let y = M + 38;
  o.push(`<text x="${L}" y="${y}" font-size="15" font-weight="700" letter-spacing="2.4" fill="${COLORS.out}" font-family="${FONT}">ALMOXARIFADO · MÉTRICAS</text>`);
  y += 50;
  o.push(`<text x="${L}" y="${y}" font-size="46" font-weight="700" fill="${COLORS.text}" font-family="${FONT_DISPLAY}">${esc(data.periodLabel)}</text>`);
  y += 32;
  o.push(`<text x="${L}" y="${y}" font-size="20" fill="${COLORS.muted}" font-family="${FONT}">${esc(data.rangeLabel)}</text>`);

  // legenda (canto direito)
  const lg = [
    { c: COLORS.in, t: 'Entradas' },
    { c: COLORS.out, t: 'Saídas' },
  ];
  let lx = R;
  for (const it of [...lg].reverse()) {
    const tw = it.t.length * 10.2 + 8;
    lx -= tw;
    o.push(`<text x="${lx}" y="${M + 38 + 4}" font-size="18" fill="${COLORS.muted}" font-family="${FONT}">${esc(it.t)}</text>`);
    lx -= 20;
    o.push(`<circle cx="${lx + 6}" cy="${M + 38 - 2}" r="6" fill="${it.c}"/>`);
    lx -= 26;
  }

  // números
  y += 36;
  const t = data.totals;
  const tiles = [
    { label: 'Entradas', value: fmt(t.in), sub: 'unidades', color: COLORS.in },
    { label: 'Saídas', value: fmt(t.out), sub: 'unidades', color: COLORS.out },
    { label: 'Saldo líquido', value: fmtSigned(t.net), sub: 'entradas − saídas', color: t.net < 0 ? COLORS.danger : COLORS.text },
    { label: 'Movimentações', value: fmt(t.moves), sub: 'registros', color: COLORS.text },
    { label: 'Solicitações', value: fmt(t.requests), sub: 'recebidas', color: COLORS.amber },
  ];
  const gap = 14;
  const tw = (R - L - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tl, i) => {
    const x = L + i * (tw + gap);
    o.push(`<rect x="${x}" y="${y}" width="${tw}" height="108" rx="16" fill="${COLORS.tile}"/>`);
    o.push(`<text x="${x + 20}" y="${y + 32}" font-size="16" fill="${COLORS.muted}" font-family="${FONT}">${esc(tl.label)}</text>`);
    o.push(`<text x="${x + 20}" y="${y + 74}" font-size="40" font-weight="700" fill="${tl.color}" font-family="${FONT_DISPLAY}">${esc(tl.value)}</text>`);
    o.push(`<text x="${x + 20}" y="${y + 96}" font-size="14" fill="${COLORS.faint}" font-family="${FONT}">${esc(tl.sub)}</text>`);
  });
  y += 108 + 28;

  // gráfico
  const cw = R - L;
  const ch = H - y - 96;
  const g = chartGeometry(data, cw, ch);
  o.push(`<g transform="translate(${L},${y})">${chartInner(data, g, { id: 'rp', fontSize: 14 })}</g>`);

  // rodapé
  const fy = H - M - 12;
  o.push(`<line x1="${L}" x2="${R}" y1="${fy - 28}" y2="${fy - 28}" stroke="${COLORS.line}"/>`);
  o.push(
    `<text x="${L}" y="${fy}" font-size="14" fill="${COLORS.faint}" font-family="${FONT}">Gerado em ${esc(formatDateTime(data.generatedAt))} · horário da Bahia (UTC−3)</text>`,
    `<text x="${R}" y="${fy}" text-anchor="end" font-size="14" fill="${COLORS.faint}" font-family="${FONT}">Entradas = entrada + devolução · Saídas = saída + transferência</text>`,
  );
  o.push('</svg>');
  return { svg: o.join(''), width: W, height: H };
}
