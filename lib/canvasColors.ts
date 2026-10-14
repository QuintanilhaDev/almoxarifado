'use client';
/**
 * Cores dos desenhos em canvas (fundo 3D, traços do login) para o tema atual.
 * No escuro: traços claros; no claro: traços escuros e lilás mais forte, para continuarem visíveis.
 */
export interface CanvasColors {
  fg: [number, number, number];
  lilac: [number, number, number];
  mint: [number, number, number];
  /** multiplica a opacidade (no claro os traços precisam de um pouco mais) */
  boost: number;
}
const DARK: CanvasColors = { fg: [246, 244, 251], lilac: [198, 168, 255], mint: [143, 227, 187], boost: 1 };
const LIGHT: CanvasColors = { fg: [52, 38, 92], lilac: [116, 70, 220], mint: [19, 138, 85], boost: 1.35 };

export function canvasColors(): CanvasColors {
  if (typeof document === 'undefined') return DARK;
  return document.documentElement.dataset.theme === 'light' ? LIGHT : DARK;
}
export const rgb = (c: [number, number, number]) => `${c[0]},${c[1]},${c[2]}`;
