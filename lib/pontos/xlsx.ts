import 'server-only';
import { ORDEM, SEMANA, SITUACAO, dataBR, hhmm, type Analise } from './types';

/** Planilha de controle: resumo por funcionário, ocorrências (uma por linha) e todos os dias. */
export async function pontoXlsx(a: Analise): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Max Hub';
  const head = (ws: import('exceljs').Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17112A' } };
    r.alignment = { vertical: 'middle', wrapText: true };
    r.height = 30;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  };
  const status = { ok: 'Regular', atencao: 'Atenção', critico: 'Crítico' };

  const r = wb.addWorksheet('Resumo');
  r.columns = [
    { header: 'Funcionário', key: 'name', width: 34 },
    { header: 'Matrícula', key: 'mat', width: 12 },
    { header: 'Posto', key: 'posto', width: 28 },
    { header: 'Escala', key: 'escala', width: 9 },
    { header: 'Dias trabalhados', key: 'trab', width: 11 },
    { header: 'Dias previstos', key: 'prev', width: 10 },
    { header: 'Horas trabalhadas', key: 'horas', width: 12 },
    { header: 'Horas extras', key: 'extras', width: 10 },
    { header: 'Atrasos', key: 'atrasos', width: 10 },
    ...ORDEM.map((t) => ({ header: SITUACAO[t].short, key: t, width: 11 })),
    { header: 'Ocorrências', key: 'oc', width: 11 },
    { header: 'Conformidade', key: 'conf', width: 12 },
    { header: 'Situação', key: 'status', width: 11 },
  ];
  for (const f of a.funcionarios) {
    const row = r.addRow({
      name: f.name,
      mat: f.matricula ?? '',
      posto: f.posto ?? '',
      escala: f.escala === '12x36' ? '12x36' : 'Diária',
      trab: f.totais.trabalhados,
      prev: f.totais.previstos,
      horas: hhmm(f.totais.minutos),
      extras: hhmm(f.totais.extras),
      atrasos: hhmm(f.totais.atrasos),
      ...Object.fromEntries(ORDEM.map((t) => [t, f.totais.porTipo[t] ?? 0])),
      oc: f.totais.ocorrencias,
      conf: f.totais.conformidade / 100,
      status: status[f.status],
    });
    row.getCell('conf').numFmt = '0.0%';
    const sc = row.getCell('status');
    sc.font = { bold: true, color: { argb: f.status === 'ok' ? 'FF1E9E6A' : f.status === 'atencao' ? 'FFC98612' : 'FFD6455D' } };
  }
  head(r);

  const o = wb.addWorksheet('Ocorrências');
  o.columns = [
    { header: 'Funcionário', key: 'name', width: 34 },
    { header: 'Matrícula', key: 'mat', width: 12 },
    { header: 'Posto', key: 'posto', width: 26 },
    { header: 'Data', key: 'data', width: 11 },
    { header: 'Dia', key: 'dia', width: 6 },
    { header: 'Batidas', key: 'bat', width: 28 },
    { header: 'Situação', key: 'tipo', width: 30 },
    { header: 'Gravidade', key: 'nivel', width: 10 },
    { header: 'Detalhe', key: 'texto', width: 60 },
    { header: 'Minutos', key: 'min', width: 9 },
  ];
  for (const f of a.funcionarios)
    for (const d of f.dias)
      for (const x of d.ocorrencias)
        o.addRow({ name: f.name, mat: f.matricula ?? '', posto: f.posto ?? '', data: dataBR(d.date), dia: SEMANA[d.weekday], bat: d.punches.join(' ') || d.marks.join(', '), tipo: SITUACAO[x.tipo].label, nivel: { alta: 'Grave', media: 'Atenção', baixa: 'Informativo' }[SITUACAO[x.tipo].nivel], texto: x.texto, min: x.min ?? '' });
  head(o);

  const d = wb.addWorksheet('Dias');
  d.columns = [
    { header: 'Funcionário', key: 'name', width: 34 },
    { header: 'Data', key: 'data', width: 11 },
    { header: 'Dia', key: 'dia', width: 6 },
    { header: 'Previsto', key: 'prev', width: 9 },
    { header: 'Batidas', key: 'bat', width: 30 },
    { header: 'Entrada', key: 'ini', width: 9 },
    { header: 'Saída', key: 'fim', width: 9 },
    { header: 'Trabalhado', key: 'trab', width: 11 },
    { header: 'Intervalo', key: 'int', width: 10 },
    { header: 'Marcação', key: 'marks', width: 16 },
    { header: 'Ocorrências', key: 'oc', width: 50 },
  ];
  for (const f of a.funcionarios)
    for (const x of f.dias)
      d.addRow({ name: f.name, data: dataBR(x.date), dia: SEMANA[x.weekday], prev: x.previsto ? 'Sim' : 'Não', bat: x.punches.join(' '), ini: x.inicio ?? '', fim: x.fim ? x.fim + (x.virada ? ' (+1)' : '') : '', trab: x.trabalhado ? hhmm(x.trabalhado) : '', int: x.intervalo !== null ? hhmm(x.intervalo) : '', marks: x.marks.join(', '), oc: x.ocorrencias.map((y) => SITUACAO[y.tipo].short).join(', ') });
  head(d);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
