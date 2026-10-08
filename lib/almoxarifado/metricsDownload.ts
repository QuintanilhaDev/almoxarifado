'use client';
import { exportBaseName, type MetricsData, type Period } from './metrics';
import { COLORS, reportSvg } from './metricsChart';

/** Baixa um arquivo no computador da pessoa. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** SVG do relatório → PNG (2x, fundo opaco). PNG abre em qualquer lugar, inclusive no Power BI. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Não foi possível desenhar o gráfico.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Seu navegador não conseguiu gerar a imagem.');
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getMetrics(period: Period): Promise<MetricsData> {
  const r = await fetch(`/api/almoxarifado/metrics?period=${period}`, { cache: 'no-store', credentials: 'same-origin' });
  const j = (await r.json().catch(() => ({}))) as { data?: MetricsData; error?: string };
  if (!r.ok || !j.data) throw new Error(j.error || 'Não consegui ler as métricas agora.');
  return j.data;
}

/**
 * Baixa as métricas do almoxarifado como gráfico (.png) ou planilha (.xlsx), sem precisar abrir a tela.
 * Os dois saem do mesmo instante dos dados, então os números batem com a tela de Métricas.
 */
export async function downloadAlmoxMetrics(format: 'png' | 'xlsx', period: Period): Promise<{ filename: string; periodLabel: string }> {
  const data = await getMetrics(period);
  const base = exportBaseName(data);
  if (format === 'png') {
    const { svg, width, height } = reportSvg(data);
    saveBlob(await svgToPng(svg, width, height), `${base}.png`);
    return { filename: `${base}.png`, periodLabel: data.periodLabel };
  }
  const res = await fetch(`/api/almoxarifado/metrics/export?period=${data.period}&at=${encodeURIComponent(data.generatedAt)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Não consegui gerar a planilha agora.');
  saveBlob(await res.blob(), `${base}.xlsx`);
  return { filename: `${base}.xlsx`, periodLabel: data.periodLabel };
}
