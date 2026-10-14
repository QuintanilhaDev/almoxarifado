import ExcelJS from 'exceljs';

export interface SheetCol {
  header: string;
  width?: number;
  /** formato numérico do Excel (ex.: '#,##0.00', 'dd/mm/yyyy') */
  fmt?: string;
}
export interface SheetDef {
  name: string;
  cols: SheetCol[];
  rows: (string | number | Date | null | undefined)[][];
}

/** Planilha simples: cabeçalho lilás, filtro automático e linha congelada (uma aba por tabela). */
export async function simpleWorkbook(sheets: SheetDef[], meta: { by: string; title: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `Max Hub · ${meta.by}`;
  wb.title = meta.title;
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.cols.map((c) => ({ header: c.header, width: c.width ?? 16, style: c.fmt ? { numFmt: c.fmt } : {} }));
    const h = ws.getRow(1);
    h.height = 24;
    h.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B3FD6' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const r of s.rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.cols.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const xlsxResponseHeaders = (file: string) => ({
  'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition': `attachment; filename="${file}"`,
  'Cache-Control': 'no-store',
});
/** 'AAAA-MM-DD' → Date do Excel (meio-dia, para não virar o dia anterior) */
export const xDate = (d: string | null | undefined) => (d ? new Date(d.slice(0, 10) + 'T12:00:00Z') : null);
