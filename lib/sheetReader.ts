/**
 * Leitor "esperto" de planilhas (.xlsx, .csv, .txt).
 *
 * Não depende de formatação: acha sozinho a linha de cabeçalho (mesmo com
 * títulos, logotipos e linhas vazias no topo), reconhece as colunas pelo nome
 * (com ou sem acento, maiúsculas, abreviações), ignora linhas de título,
 * totais, cabeçalhos repetidos e células com erro de fórmula, e entende
 * números no formato brasileiro (1.234,56 / R$ 10,50).
 * Se não houver cabeçalho nenhum, descobre a coluna de nomes pelo conteúdo.
 *
 * Código puro (sem acesso a banco), para poder ser testado isoladamente.
 */

export interface FieldSpec {
  key: string;
  /** nomes aceitos para o cabeçalho, do mais provável ao menos provável */
  synonyms: string[];
  kind: 'text' | 'int' | 'money' | 'size' | 'unit';
  /** se o cabeçalho tiver uma destas palavras, a coluna NÃO é deste campo */
  exclude?: string[];
}

export interface SchemaSpec {
  fields: FieldSpec[];
  /** "01 - Posto Central" vira código 01 + nome "Posto Central" */
  leadingCode?: boolean;
}

export interface ParsedSheet {
  name: string;
  rows: string[][];
}

export interface ReadRow {
  data: Record<string, string | number | null>;
  source: string;
}

export interface ReadResult {
  rows: ReadRow[];
  sheets: {
    name: string;
    headerRow: number | null;
    columns: { letter: string; header: string; field: string | null }[];
    read: number;
  }[];
  ignored: number;
  warnings: string[];
}

export class SheetError extends Error {}

const MAX_ROWS = 20000;
const MAX_COLS = 120;
const MAX_IMPORT = 5000;

/* ------------------------------------------------------------------ */
/* textos                                                              */
/* ------------------------------------------------------------------ */

export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanText(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ERROR_RE = /^#(VALUE|REF|N\/A|NAME|DIV\/0|NULL|NUM|SPILL|CALC|GETTING_DATA)[!?]?$/i;

function letters(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Converte "1.234,56", "R$ 10,50", "(3)", "12" em número. Devolve null se não for número. */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '')
    .replace(/R\$|\$|€/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    const multiple = s.indexOf(',') !== lastComma;
    s = multiple || after === 3 ? s.split(',').join('') : s.replace(',', '.');
    if (!multiple && after === 3 && s.length - 3 > 3) {
      /* "1234,567" → raro; mantém como milhar */
    }
  } else if (lastDot >= 0) {
    const after = s.length - lastDot - 1;
    const multiple = s.indexOf('.') !== lastDot;
    if (multiple || (after === 3 && lastDot <= 3 && lastDot > 0)) s = s.split('.').join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const KNOWN_SIZES = /^(pp|p|m|g|gg|xg|xgg|eg|egg|exg|exgg|u)$/i;

function cleanSize(raw: string): string | null {
  const s = cleanText(raw);
  if (!s) return null;
  if (/^\d+([.,]0+)?$/.test(s)) return String(parseInt(s, 10));
  if (/^[uú]nico$/i.test(s)) return 'Único';
  if (KNOWN_SIZES.test(s)) return s.toUpperCase();
  return s.slice(0, 40);
}

function cleanUnit(raw: string): string | null {
  const s = cleanText(raw).toLowerCase();
  if (!s) return null;
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* leitura dos arquivos                                                */
/* ------------------------------------------------------------------ */

function decodeText(buf: Buffer): string {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return text.replace(/^﻿/, '');
}

/** CSV com delimitador detectado (, ; tab |) e aspas. */
export function parseCsv(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 8).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => {
    let inQ = false;
    let c = 0;
    for (const ch of sample) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) c++;
    }
    return [d, c] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 0 ? counts[0][0] : ';';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > MAX_ROWS) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.slice(0, MAX_COLS).map(cleanText));
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return ERROR_RE.test(v.trim()) ? '' : cleanText(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toFixed(6))) : '';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const d = v.toISOString().slice(0, 10).split('-');
    return `${d[2]}/${d[1]}/${d[0]}`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('error' in o) return '';
    if ('result' in o) return cellToString(o.result); // fórmula: usa o valor calculado
    if ('formula' in o || 'sharedFormula' in o) return '';
    if (Array.isArray(o.richText)) return cleanText((o.richText as { text?: string }[]).map((t) => t.text ?? '').join(''));
    if ('text' in o) return cellToString(o.text);
    if ('hyperlink' in o) return cleanText(String(o.hyperlink).replace(/^mailto:/i, ''));
  }
  return '';
}

export async function loadSheets(buf: Buffer, filename: string): Promise<ParsedSheet[]> {
  if (buf.length === 0) throw new SheetError('O arquivo está vazio.');
  const head = buf.subarray(0, 8);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (isOle) {
    throw new SheetError(
      'Esse é um Excel antigo (.xls). Abra no Excel, use Arquivo → Salvar como → "Pasta de Trabalho do Excel (.xlsx)" e envie de novo.',
    );
  }
  if (isZip) {
    if (ext === 'ods' || ext === 'numbers') throw new SheetError('Salve a planilha como .xlsx ou .csv e envie de novo.');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new SheetError('Não consegui abrir esse arquivo. Confirme que é uma planilha .xlsx válida (e sem senha).');
    }
    const all = wb.worksheets;
    const visible = all.filter((w) => w.state === 'visible');
    const use = visible.length ? visible : all;
    const sheets: ParsedSheet[] = [];
    for (const ws of use) {
      const rowCount = Math.min(ws.rowCount || 0, MAX_ROWS);
      const colCount = Math.min(ws.columnCount || 0, MAX_COLS);
      const rows: string[][] = [];
      for (let r = 1; r <= rowCount; r++) {
        const row = ws.getRow(r);
        const out: string[] = [];
        for (let c = 1; c <= colCount; c++) {
          let s = '';
          try {
            s = cellToString(row.getCell(c).value);
          } catch {
            s = '';
          }
          out.push(s);
        }
        rows.push(out);
      }
      sheets.push({ name: ws.name, rows });
    }
    return sheets;
  }
  if (['xlsx', 'xlsm'].includes(ext)) {
    throw new SheetError('Não consegui abrir esse arquivo. Confirme que é uma planilha .xlsx válida.');
  }
  if (['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip'].includes(ext)) {
    throw new SheetError('Esse tipo de arquivo não é uma planilha. Envie um .xlsx ou .csv.');
  }
  return [{ name: filename.replace(/\.[^.]+$/, '') || 'Planilha', rows: parseCsv(decodeText(buf)) }];
}

/* ------------------------------------------------------------------ */
/* reconhecimento de colunas                                           */
/* ------------------------------------------------------------------ */

interface Match {
  field: FieldSpec;
  weight: number; // 3 = exato, 1 = contém
  rank: number; // posição do sinônimo (menor = melhor)
}

function matchHeader(cell: string, schema: SchemaSpec): Match | null {
  const h = norm(cell);
  if (!h || h.length > 40 || /^[0-9 ]+$/.test(h)) return null;
  const words = h.split(' ');
  // 1ª passada: exato
  for (const f of schema.fields) {
    if (f.exclude?.some((x) => words.includes(x))) continue;
    const i = f.synonyms.findIndex((s) => norm(s) === h);
    if (i >= 0) return { field: f, weight: 3, rank: i };
  }
  // 2ª passada: contém (palavra inteira). O campo "name" é sempre o último.
  const order = [...schema.fields].sort((a, b) => (a.key === 'name' ? 1 : 0) - (b.key === 'name' ? 1 : 0));
  for (const f of order) {
    if (f.exclude?.some((x) => words.includes(x))) continue;
    for (let i = 0; i < f.synonyms.length; i++) {
      const s = norm(f.synonyms[i]);
      if (s.length < 3) continue;
      if (` ${h} `.includes(` ${s} `)) return { field: f, weight: 1, rank: i };
    }
  }
  return null;
}

interface HeaderGuess {
  row: number;
  score: number;
  cols: Map<number, Match>;
}

function findHeader(rows: string[][], schema: SchemaSpec): HeaderGuess | null {
  let best: HeaderGuess | null = null;
  const limit = Math.min(rows.length, 60);
  for (let r = 0; r < limit; r++) {
    const cols = new Map<number, Match>();
    // Células mescladas (ex.: o título "ESTOQUE ATUAL" em A1:K3) chegam repetidas em
    // todas as colunas. Cada texto só conta UMA vez, senão o título vence o cabeçalho de verdade.
    const seenText = new Set<string>();
    rows[r].forEach((cell, c) => {
      const key = norm(cell);
      if (key && seenText.has(key)) return;
      const m = matchHeader(cell, schema);
      if (m) {
        cols.set(c, m);
        seenText.add(key);
      }
    });
    if (!cols.size) continue;
    const fields = new Set([...cols.values()].map((m) => m.field.key));
    const exact = [...cols.values()].filter((m) => m.weight === 3).length;
    // uma linha só com 1 campo só vale se for exato (evita confundir "Posto Central" com cabeçalho)
    if (fields.size < 2 && exact < 1) continue;
    const score = [...cols.values()].reduce((a, m) => a + m.weight, 0) + fields.size * 2;
    if (!best || score > best.score) best = { row: r, score, cols };
  }
  return best;
}

function hasLetters(s: string) {
  return /[a-zà-ÿ]/i.test(s);
}

/* ------------------------------------------------------------------ */
/* leitura de uma aba                                                  */
/* ------------------------------------------------------------------ */

const TOTAL_RE = /^(sub ?total|total( geral)?|soma|totais)\b/;

function readSheet(sheet: ParsedSheet, schema: SchemaSpec): { rows: ReadRow[]; info: ReadResult['sheets'][number]; ignored: number; warning?: string } {
  const rows = sheet.rows;
  const nonEmpty = rows.some((r) => r.some((c) => c));
  const empty = {
    rows: [] as ReadRow[],
    info: { name: sheet.name, headerRow: null as number | null, columns: [] as ReadResult['sheets'][number]['columns'], read: 0 },
    ignored: 0,
  };
  if (!nonEmpty) return empty;

  let guess = findHeader(rows, schema);
  let headerIdx = guess ? guess.row : -1;
  const colMap = new Map<number, FieldSpec>(); // coluna → campo

  if (guess) {
    // cada campo fica com a melhor coluna (peso maior, depois sinônimo mais provável, depois mais à esquerda)
    const byField = new Map<string, { col: number; m: Match }>();
    [...guess.cols.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([col, m]) => {
        const cur = byField.get(m.field.key);
        if (!cur || m.weight > cur.m.weight || (m.weight === cur.m.weight && m.rank < cur.m.rank)) {
          byField.set(m.field.key, { col, m });
        }
      });
    byField.forEach(({ col, m }) => colMap.set(col, m.field));
  }

  const dataStart = headerIdx + 1;
  const body = rows.slice(dataStart);

  // sem coluna de nome? descobre pelo conteúdo
  const nameSpec = schema.fields.find((f) => f.key === 'name')!;
  let nameCol = [...colMap.entries()].find(([, f]) => f.key === 'name')?.[0] ?? -1;
  let inferred = false;
  if (nameCol < 0) {
    const width = Math.max(0, ...rows.map((r) => r.length));
    let bestCol = -1;
    let bestScore = 0;
    for (let c = 0; c < width; c++) {
      // colunas já reconhecidas ficam de fora, exceto "código" quando guarda texto (ex.: "001 - Posto Central")
      if (colMap.has(c) && colMap.get(c)!.key !== 'code') continue;
      const vals = body.map((r) => r[c] || '').filter(Boolean);
      if (vals.length < 1) continue;
      const textual = vals.filter((v) => hasLetters(v) && v.length >= 2 && v.length <= 90 && parseNumber(v) === null);
      if (textual.length < Math.max(1, vals.length * 0.5)) continue;
      const distinct = new Set(textual.map(norm)).size;
      const score = textual.length + distinct * 0.5 - c * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestCol = c;
      }
    }
    if (bestCol >= 0) {
      nameCol = bestCol;
      colMap.set(bestCol, nameSpec); // se era "código", passa a ser o nome
      inferred = true;
    }
  }
  if (nameCol < 0) return { ...empty, warning: `Na aba "${sheet.name}" não encontrei uma coluna com os nomes.` };

  const headerRow = headerIdx >= 0 ? rows[headerIdx] : [];
  const headerNorms = new Set(headerRow.map(norm).filter(Boolean));
  const mappedFields = new Set([...colMap.values()].map((f) => f.key));

  const out: ReadRow[] = [];
  let ignored = 0;
  const specByKey = new Map(schema.fields.map((f) => [f.key, f]));

  body.forEach((row, i) => {
    const rowNo = dataStart + i + 1;
    const filled = row.map((c, idx) => [idx, c] as const).filter(([, c]) => c);
    if (!filled.length) return;

    // título mesclado (mesmo texto repetido em várias células)
    const distinctVals = new Set(filled.map(([, c]) => c));
    if (filled.length > 1 && distinctVals.size === 1) {
      ignored++;
      return;
    }
    // cabeçalho repetido (quebra de página, várias tabelas na mesma aba)
    if (headerNorms.size && filled.length >= 2 && filled.every(([, c]) => headerNorms.has(norm(c)))) {
      ignored++;
      return;
    }
    const name = cleanText(row[nameCol] || '');
    if (!name) {
      ignored++;
      return;
    }
    if (TOTAL_RE.test(norm(name)) || (filled.length >= 1 && TOTAL_RE.test(norm(filled[0][1])) && filled[0][0] < nameCol)) {
      ignored++;
      return;
    }
    // linha só com um número (ex.: contador no rodapé) não é um registro
    if (parseNumber(name) !== null && !hasLetters(name)) {
      ignored++;
      return;
    }
    if (name.length > 160) {
      ignored++;
      return;
    }
    // várias colunas mapeadas mas a linha só tem a célula do nome em CAIXA ALTA e nada mais: é um subtítulo de seção
    if (!inferred && mappedFields.size >= 3 && filled.length === 1 && name === name.toUpperCase() && /[A-ZÀ-Ý]{4,}/.test(name) && /^(regiao|setor|grupo|categoria|area|zona|bloco|cliente)\b/.test(norm(name))) {
      ignored++;
      return;
    }

    const data: Record<string, string | number | null> = {};
    colMap.forEach((f, col) => {
      const raw = row[col] || '';
      switch (f.kind) {
        case 'int': {
          const n = parseNumber(raw);
          data[f.key] = n === null ? null : Math.min(1_000_000, Math.max(0, Math.round(n)));
          break;
        }
        case 'money': {
          const n = parseNumber(raw);
          data[f.key] = n === null || n < 0 ? null : Math.round(n * 100) / 100;
          break;
        }
        case 'size':
          data[f.key] = cleanSize(raw);
          break;
        case 'unit':
          data[f.key] = cleanUnit(raw);
          break;
        default:
          data[f.key] = cleanText(raw).slice(0, f.key === 'notes' ? 400 : 160) || null;
      }
    });
    // garante todas as chaves do esquema
    schema.fields.forEach((f) => {
      if (!(f.key in data)) data[f.key] = null;
    });
    data.name = name;

    if (schema.leadingCode && specByKey.has('code') && !data.code) {
      const m = name.match(/^(\d{1,6})\s*[-–—.)]\s+(?=\S)/);
      if (m) {
        data.code = m[1];
        data.name = name.slice(m[0].length).trim();
      }
    }
    if (!data.name) {
      ignored++;
      return;
    }
    out.push({ data, source: `${sheet.name}, linha ${rowNo}` });
  });

  const columns = (headerIdx >= 0 ? headerRow : rows[dataStart] || []).map((h, c) => ({
    letter: letters(c),
    header: headerIdx >= 0 ? h : '',
    field: colMap.get(c)?.key ?? null,
  }));
  const shown = columns.filter((c) => c.header || c.field);
  return {
    rows: out,
    ignored,
    info: { name: sheet.name, headerRow: headerIdx >= 0 ? headerIdx + 1 : null, columns: shown, read: out.length },
    warning:
      headerIdx < 0 && out.length
        ? `A aba "${sheet.name}" não tem cabeçalho. Usei a coluna ${letters(nameCol)} como nome e ignorei as demais.`
        : inferred && out.length
          ? `Na aba "${sheet.name}" não achei uma coluna chamada "nome", então usei a coluna ${letters(nameCol)}.`
          : undefined,
  };
}

export function readSheets(sheets: ParsedSheet[], schema: SchemaSpec): ReadResult {
  const result: ReadResult = { rows: [], sheets: [], ignored: 0, warnings: [] };
  for (const sheet of sheets) {
    const r = readSheet(sheet, schema);
    result.rows.push(...r.rows);
    result.ignored += r.ignored;
    result.sheets.push(r.info);
    if (r.warning) result.warnings.push(r.warning);
    else if (!r.rows.length && sheets.length > 1 && sheet.rows.some((x) => x.some(Boolean))) {
      result.warnings.push(`Nada reconhecível na aba "${sheet.name}".`);
    }
  }
  if (result.rows.length > MAX_IMPORT) {
    result.warnings.push(`A planilha tem ${result.rows.length} linhas. Só as primeiras ${MAX_IMPORT} serão consideradas.`);
    result.rows = result.rows.slice(0, MAX_IMPORT);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* esquemas                                                            */
/* ------------------------------------------------------------------ */

export const POSTO_SCHEMA: SchemaSpec = {
  leadingCode: true,
  fields: [
    {
      key: 'code',
      kind: 'text',
      synonyms: ['codigo do posto', 'cod posto', 'codigo', 'cod', 'cód', 'id', 'numero', 'num', 'nº', 'n', 'centro de custo', 'cc', 'contrato'],
    },
    { key: 'city', kind: 'text', synonyms: ['cidade', 'municipio', 'localidade', 'regiao'] },
    { key: 'address', kind: 'text', synonyms: ['endereco', 'logradouro', 'localizacao', 'rua'] },
    {
      key: 'supervisor',
      kind: 'text',
      synonyms: ['supervisor', 'responsavel', 'gestor', 'gerente', 'encarregado', 'coordenador', 'contato'],
    },
    { key: 'notes', kind: 'text', synonyms: ['observacao', 'observacoes', 'obs', 'notas', 'nota', 'comentario', 'detalhes'] },
    {
      key: 'name',
      kind: 'text',
      synonyms: ['nome do posto', 'posto', 'postos', 'nome', 'nome posto', 'unidade', 'filial', 'local', 'loja', 'cliente', 'site', 'descricao'],
    },
  ],
};

export const ITEM_SCHEMA: SchemaSpec = {
  fields: [
    {
      key: 'quantity',
      kind: 'int',
      // "saldo" vem primeiro: em planilhas com ENTRADA/SAÍDA/QUANT/SALDO, QUANT é só o
      // valor inicial e o saldo real (já com entradas e saídas) está em SALDO.
      synonyms: ['saldo', 'saldo atual', 'estoque atual', 'em estoque', 'quant', 'quantidade', 'qtd', 'qtde', 'qte', 'estoque'],
      exclude: ['valor', 'total', 'custo', 'preco', 'min', 'minimo', 'maximo', 'max'],
    },
    {
      key: 'min_quantity',
      kind: 'int',
      synonyms: ['estoque min', 'estoque minimo', 'minimo', 'min', 'qtd minima', 'quantidade minima', 'ponto de pedido'],
    },
    {
      key: 'cost',
      kind: 'money',
      synonyms: ['custo', 'custo unitario', 'preco', 'preco unitario', 'valor unitario', 'valor unit', 'vlr unit', 'valor'],
      exclude: ['estoque', 'total'],
    },
    { key: 'size', kind: 'size', synonyms: ['tam', 'tamanho', 'numero', 'num', 'numeracao', 'medida'] },
    { key: 'unit', kind: 'unit', synonyms: ['unid', 'unidade', 'un', 'und', 'unidade de medida'] },
    {
      key: 'name',
      kind: 'text',
      synonyms: ['descricao produto', 'descricao do produto', 'descricao', 'produto', 'item', 'material', 'nome', 'nome do item', 'artigo'],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* comparação com o que já existe                                      */
/* ------------------------------------------------------------------ */

export function postoKey(name: unknown) {
  return norm(name);
}
export function itemKey(name: unknown, size: unknown) {
  return `${norm(name)}|${norm(size)}`;
}

export function classify(
  rows: ReadRow[],
  keyOf: (data: ReadRow['data']) => string,
  existing: Set<string>,
): { rows: { data: ReadRow['data']; status: 'new' | 'exists' | 'duplicate'; source: string }[] } {
  const seen = new Set<string>();
  return {
    rows: rows.map((r) => {
      const k = keyOf(r.data);
      let status: 'new' | 'exists' | 'duplicate' = 'new';
      if (existing.has(k)) status = 'exists';
      else if (seen.has(k)) status = 'duplicate';
      seen.add(k);
      return { data: r.data, status, source: r.source };
    }),
  };
}
