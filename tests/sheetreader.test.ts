/**
 * Leitor de planilhas: lê TODAS as abas, ignora resumos e junta o mesmo registro de várias abas.
 * Uso: npx tsx tests/sheetreader.test.ts
 */
import ExcelJS from 'exceljs';
import { COLLAB_SCHEMA, ITEM_SCHEMA, loadSheets, readSheets } from '../lib/almoxarifado/sheetReader';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};

(async () => {
  // colaboradores: "SEM O TRE" + "TODOS" (repete e completa) + aba de resumo + aba oculta com lista auxiliar
  const wb = new ExcelJS.Workbook();
  const cab = ['Mat', 'Nome', 'Admissão', 'Descrição cargo', 'Descrição Serviço'];
  const a = wb.addWorksheet('SEM O TRE');
  a.addRow(cab);
  a.addRow(['0101', 'ANA TESTE', '01/02/2023', 'VIGIA', null]);
  a.addRow(['0102', 'BIA TESTE', '01/03/2023', 'ASG', 'CLIENTE B']);
  const b = wb.addWorksheet('TODOS');
  b.addRow(cab);
  b.addRow(['101', 'ANA TESTE', '01/02/2023', 'VIGIA', 'CLIENTE A']); // mesma pessoa (matrícula sem zero), completa o cliente
  b.addRow(['0102', 'BIA TESTE', '01/03/2023', 'PORTEIRA', 'CLIENTE B']); // função diferente: fica a da 1ª aba e avisa
  b.addRow(['0103', 'CAIO TESTE', '05/05/2024', 'VIGILANTE', 'TRE']);
  const r = wb.addWorksheet('Resumo');
  r.addRow(['Rótulos de Linha', 'Contagem']);
  r.addRow(['VIGIA', 2]);
  const h = wb.addWorksheet('Listas');
  h.state = 'hidden';
  h.addRow(['FUNÇÕES']);
  h.addRow(['VIGIA']);
  const sheets = await loadSheets(Buffer.from(await wb.xlsx.writeBuffer()), 'colab.xlsx');
  ok(sheets.length === 4 && sheets.find((s) => s.name === 'Listas')?.hidden, 'carrega todas as abas, inclusive a oculta');
  const res = readSheets(sheets, COLLAB_SCHEMA);
  ok(res.rows.length === 3, 'três pessoas, sem duplicar: ' + res.rows.map((x) => x.data.name).join(', '));
  const ana = res.rows.find((x) => x.data.name === 'ANA TESTE')!;
  ok(ana.data.client === 'CLIENTE A' && ana.sources?.length === 2, 'a mesma pessoa em duas abas é juntada e completada');
  ok(res.rows.find((x) => x.data.name === 'BIA TESTE')!.data.role === 'ASG' && res.warnings.some((w) => /diferentes entre abas/.test(w)), 'valor diferente: fica o da primeira aba, com aviso');
  ok(res.merged === 2 && res.sheets.find((s) => s.name === 'Resumo')?.skipped && res.sheets.find((s) => s.name === 'Listas')?.skipped, 'resumo e lista oculta ficam de fora, com o motivo');

  // estoque: o mesmo item em duas abas não soma o saldo
  const w2 = new ExcelJS.Workbook();
  const e1 = w2.addWorksheet('Almox');
  e1.addRow(['Descrição', 'Tam', 'Saldo']);
  e1.addRow(['Camisa', 'M', 10]);
  const e2 = w2.addWorksheet('Geral');
  e2.addRow(['Descrição', 'Tam', 'Saldo']);
  e2.addRow(['Camisa', 'M', 10]);
  e2.addRow(['Calça', '44', 5]);
  const r2 = readSheets(await loadSheets(Buffer.from(await w2.xlsx.writeBuffer()), 'estoque.xlsx'), ITEM_SCHEMA);
  ok(r2.rows.length === 2 && r2.rows[0].data.quantity === 10, 'estoque: item repetido em duas abas entra uma vez (saldo 10, não 20)');

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
  process.exit(fails ? 1 : 0);
})();
