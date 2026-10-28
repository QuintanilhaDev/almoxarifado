import 'server-only';
import { parseCsv } from '../almoxarifado/sheetReader';
import type { Sheet } from './parse';

/**
 * Abre o espelho exportado: .xlsx, .csv/.txt, .xls que na verdade é HTML (comum em sistemas
 * web) e PDF (texto com a posição de cada pedaço, para achar as colunas).
 * Datas e horas viram texto como aparecem no espelho ("21/09/2026", "07:00").
 */
export class PontoFileError extends Error {}

const MAX_ROWS = 40000;
const MAX_COLS = 80;
const pad = (n: number) => String(n).padStart(2, '0');

function decode(buf: Buffer) {
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
  return t.replace(/^﻿/, '');
}

function cellText(v: unknown, numFmt?: string): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const y = v.getUTCFullYear();
    const time = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    // só hora (o Excel guarda hora como fração do dia de 30/12/1899)
    if (y <= 1900) return time;
    const date = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${y}`;
    return v.getUTCHours() || v.getUTCMinutes() ? `${date} ${time}` : date;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // número com formato de hora (fração do dia)
    if (numFmt && /h/i.test(numFmt) && !/\[h\]/i.test(numFmt) && v >= 0 && v < 1) {
      const m = Math.round(v * 1440);
      return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    }
    if (numFmt && /d/i.test(numFmt) && /m/i.test(numFmt) && /y/i.test(numFmt) && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
      return cellText(d);
    }
    return String(Number(v.toFixed(6)));
  }
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellText(o.result, numFmt);
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('').trim();
    if ('text' in o) return cellText(o.text, numFmt);
    if ('error' in o) return '';
  }
  return String(v);
}

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Ccedil: 'Ç', Atilde: 'Ã', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ordm: 'º', ordf: 'ª' };
const unent = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k) => ENT[k] ?? m);

/** tabela HTML (o ".xls" de muitos sistemas web) → linhas */
function htmlRows(html: string): string[][] {
  const rows: string[][] = [];
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: string[] = [];
    for (const m of tr.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const text = unent(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      cells.push(text);
      const span = Number(m[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1);
      for (let k = 1; k < Math.min(span, 20); k++) cells.push('');
    }
    rows.push(cells.slice(0, MAX_COLS));
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

/** PDF → linhas de texto, cada pedaço com o x (para casar com as colunas do cabeçalho) */
async function pdfRows(buf: Buffer): Promise<Sheet[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch {
    throw new PontoFileError('Não consegui abrir esse PDF. Confirme que é o espelho exportado (e sem senha).');
  }
  const rows: string[][] = [];
  const xs: number[][] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 400); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    type It = { x: number; y: number; w: number; s: string };
    const items: It[] = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: It[][] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) <= 2.5);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const l of lines.sort((a, b) => b[0].y - a[0].y)) {
      l.sort((a, b) => a.x - b.x);
      // junta pedaços colados (o PDF quebra palavras); separa onde há espaço de coluna
      const cells: { s: string; x0: number; x1: number }[] = [];
      for (const it of l) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.x1 < 3.5) {
          last.s += (it.x - last.x1 > 0.4 ? ' ' : '') + it.s;
          last.x1 = it.x + it.w;
        } else cells.push({ s: it.s, x0: it.x, x1: it.x + it.w });
      }
      rows.push(cells.map((c) => c.s.replace(/\s+/g, ' ').trim()));
      xs.push(cells.map((c) => (c.x0 + c.x1) / 2));
    }
  }
  if (!rows.length) throw new PontoFileError('Esse PDF não tem texto (parece escaneado). Exporte o espelho do GesOper em planilha ou em PDF gerado pelo sistema.');
  return [{ name: 'PDF', rows, xs }];
}

export async function loadEspelho(buf: Buffer, filename: string): Promise<{ sheets: Sheet[]; tipo: string }> {
  if (!buf.length) throw new PontoFileError('O arquivo está vazio.');
  const head = buf.subarray(0, 8);
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return { sheets: await pdfRows(buf), tipo: 'PDF' };
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new PontoFileError('Esse é um Excel antigo (.xls). Abra no Excel e use Arquivo → Salvar como → "Pasta de Trabalho do Excel (.xlsx)", ou exporte em PDF ou CSV.');
  }
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new PontoFileError('Não consegui abrir essa planilha. Confirme que é .xlsx (e sem senha).');
    }
    const sheets: Sheet[] = [];
    // todas as abas, inclusive as ocultas: só vira funcionário o que tiver dias e batidas
    for (const ws of wb.worksheets) {
      const rows: string[][] = [];
      const rc = Math.min(ws.rowCount || 0, MAX_ROWS);
      const cc = Math.min(ws.columnCount || 0, MAX_COLS);
      for (let r = 1; r <= rc; r++) {
        const row = ws.getRow(r);
        const out: string[] = [];
        for (let c = 1; c <= cc; c++) {
          const cell = row.getCell(c);
          // célula mesclada: só a primeira tem o valor
          out.push(cell.isMerged && cell.master && cell.master.address !== cell.address ? '' : cellText(cell.value, cell.numFmt));
        }
        rows.push(out);
      }
      sheets.push({ name: ws.name, rows });
    }
    return { sheets, tipo: 'Excel' };
  }
  const text = decode(buf);
  if (/^\s*</.test(text) && /<table/i.test(text)) return { sheets: [{ name: filename, rows: htmlRows(text) }], tipo: 'Excel (HTML)' };
  if (['png', 'jpg', 'jpeg', 'doc', 'docx', 'zip', 'rar'].includes(ext)) throw new PontoFileError('Envie o espelho em Excel (.xlsx), CSV ou PDF.');
  return { sheets: [{ name: filename, rows: parseCsv(text) }], tipo: 'CSV' };
}
