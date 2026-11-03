import 'server-only';
import ExcelJS from 'exceljs';
import { INDICADORES, type Indicador, type Linha } from './controle';

const pad = (n: number) => String(n).padStart(2, '0');
const agora = () => {
  const w = new Date(Date.now() - 3 * 3_600_000);
  return `${pad(w.getUTCDate())}/${pad(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} às ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
};
const dt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`) : null);

/** A relação de um indicador em Excel: uma aba com as pendências e outra com o que está sem informação. */
export async function controleXlsx(ind: Indicador, linhas: Linha[], filtro: string, por: string): Promise<Buffer> {
  const meta = INDICADORES.find((x) => x.id === ind)!;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  wb.created = new Date();
  const cols = [
    { header: 'Colaborador', width: 36 },
    { header: 'Matrícula', width: 11 },
    { header: 'Função', width: 22 },
    { header: 'Contrato (cliente)', width: 30 },
    { header: 'Posto', width: 30 },
    { header: 'Empresa', width: 16 },
    { header: ind === 'aso' || ind === 'cursos' ? 'Exigência' : 'Peça', width: 30 },
    { header: 'Tamanho', width: 9 },
    { header: 'Qtd.', width: 7 },
    { header: ind === 'aso' || ind === 'cursos' ? 'Realizado em' : 'Entregue em', width: 13 },
    { header: ind === 'aso' || ind === 'cursos' ? 'Vence em' : 'Troca em', width: 13 },
    { header: 'Dias', width: 8 },
    { header: 'Situação', width: 24 },
    { header: 'Observação', width: 36 },
  ];
  const aba = (nome: string, titulo: string, ls: Linha[]) => {
    const ws = wb.addWorksheet(nome);
    ws.mergeCells(1, 1, 1, cols.length);
    const t = ws.getCell(1, 1);
    t.value = titulo;
    t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1430' } };
    t.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, cols.length);
    const s = ws.getCell(2, 1);
    s.value = `${filtro} · ${ls.length} linha(s) · gerado em ${agora()} por ${por}`;
    s.font = { size: 9, color: { argb: 'FF6B6483' } };
    s.alignment = { indent: 1 };
    const h = ws.getRow(4);
    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
      const cell = h.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FF1D1430' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EAFF' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    h.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
    for (const l of ls) {
      const row = ws.addRow([l.name, l.matricula, l.role, l.contrato, l.posto_name, l.company, l.item, l.size, l.qty || null, dt(l.data), dt(l.prazo), l.dias, l.situacao, l.obs || null]);
      row.getCell(10).numFmt = 'dd/mm/yyyy';
      row.getCell(11).numFmt = 'dd/mm/yyyy';
      if (l.dias !== null && l.dias < 0) row.getCell(13).font = { bold: true, color: { argb: 'FFD6455D' } };
    }
  };
  aba('Pendências', meta.titulo, linhas.filter((l) => !l.semInfo));
  aba('Sem informação', `${meta.titulo} · sem informação (${meta.semInfo})`, linhas.filter((l) => l.semInfo));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
