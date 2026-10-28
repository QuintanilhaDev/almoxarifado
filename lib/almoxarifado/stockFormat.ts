import type { StockItem } from './types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const int = new Intl.NumberFormat('pt-BR');

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : brl.format(n));
export const num = (n: number | null | undefined) => int.format(n ?? 0);

export const itemLabel = (i: { name: string; size: string | null }) => i.name + (i.size ? ` · ${i.size}` : '');
export const refLabel = (n: number) => String(n).padStart(4, '0');

/** Estoque baixo = tem mínimo definido e o disponível (saldo menos o reservado) chegou nele ou abaixo. */
export const isLow = (i: Pick<StockItem, 'quantity' | 'min_quantity'> & { reserved?: number | null }) =>
  i.min_quantity > 0 && i.quantity - (Number(i.reserved) || 0) <= i.min_quantity;

/**
 * Inteiro escrito do jeito brasileiro: "1.000" é mil, "12,00" é 12. Número com casas decimais
 * de verdade ("2,7") não é arredondado: devolve null, como qualquer texto inválido.
 */
export function parseIntBR(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = String(v).replace(/\s+/g, '');
  const m = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,0+)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1] + m[2].replace(/\./g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

/** O texto parece número com casas decimais (ex.: "2,7" ou "2.5")? Serve para a mensagem de erro. */
export const hasDecimals = (v: unknown) => /^\s*-?\d+[.,]\d+\s*$/.test(String(v ?? '')) && parseIntBR(v) === null;

export function compareItems(a: { name: string; size: string | null }, b: { name: string; size: string | null }) {
  return (
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true }) ||
    (a.size ?? '').localeCompare(b.size ?? '', 'pt-BR', { sensitivity: 'base', numeric: true })
  );
}

/** Texto sem acento e em minúsculas, para busca. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Baixa um CSV que abre direto no Excel (separador ";", acentos corretos). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s; // evita fórmulas vindas de texto
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
