/**
 * Aba Pontos: leitura do espelho e cálculos (sem banco). Uso: npx tsx tests/pontos.test.ts
 */
import { parseEspelho, parseDate, timesIn } from '../lib/pontos/parse';
import { analisar } from '../lib/pontos/analyze';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};
const d2 = (n: number) => String(n).padStart(2, '0');
/** dias de 21/09/2026 a 20/10/2026 */
const DAYS: string[] = [];
for (let i = 0; i < 30; i++) {
  const d = new Date(Date.UTC(2026, 8, 21 + i));
  DAYS.push(`${d2(d.getUTCDate())}/${d2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`);
}
const SEM = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const wd = (i: number) => SEM[new Date(Date.UTC(2026, 8, 21 + i)).getUTCDay()];

/** espelho como o GesOper costuma exportar: bloco por funcionário */
function espelho(): string[][] {
  const rows: string[][] = [['GRUPO MAX FORTE - ESPELHO DE PONTO'], ['Período: 21/09/2026 a 20/10/2026']];
  const block = (nome: string, mat: string, posto: string, dia: (i: number) => string[]) => {
    rows.push([]);
    rows.push(['Funcionário:', nome, '', 'Matrícula:', mat]);
    rows.push(['Posto:', posto, '', 'Cargo:', 'VIGILANTE']);
    rows.push(['Data', 'Dia', 'Entrada 1', 'Saída 1', 'Entrada 2', 'Saída 2', 'Entrada 3', 'Saída 3', 'Horas Trab.', 'Extras', 'Observação']);
    DAYS.forEach((d, i) => {
      const x = dia(i);
      const p = x.filter((v) => /^\d\d:\d\d$/.test(v)).slice(0, 6);
      const obs = x.find((v) => /^[A-Z]{3,}$/.test(v)) ?? '';
      rows.push([d, wd(i), ...p, ...Array(6 - p.length).fill(''), '12:00', '00:00', obs]);
    });
    rows.push(['TOTAL', '', '', '', '', '', '180:00', '00:00']);
  };
  // 12x36 diurno, dias pares; dia 4: sem saída; dia 6: atraso 25 min; dia 10: sem registro; dia 13 (folga): trabalhou
  block('ANA PAULA SOUZA', '1001', 'POSTO 01 - SHOPPING', (i) => {
    if (i % 2 === 1) return i === 13 ? ['07:00', '19:00', 'FOLGA'] : ['FOLGA'];
    if (i === 4) return ['06:58'];
    if (i === 6) return ['07:25', '19:00'];
    if (i === 10) return [];
    return ['06:57', '19:02'];
  });
  // 12x36 noturno, dias ímpares, saída na mesma linha (passa da meia-noite); dia 9: 07:40 (excesso)
  block('BRUNO LIMA', '1002', 'POSTO 01 - SHOPPING', (i) => {
    if (i % 2 === 0) return ['FOLGA'];
    if (i === 9) return ['19:00', '07:40'];
    if (i === 15) return ['ATESTADO'];
    return ['18:55', '07:03'];
  });
  // diária 44h seg–sex 08:00–12:00/13:00–17:48; dia 2 (qua 23/09): intervalo de 30 min; dia 3: duplicada; dia 8: sem intervalo; dia 22: falta
  block('CARLA DIAS', '1003', 'POSTO 02 - BANCO', (i) => {
    const w = new Date(Date.UTC(2026, 8, 21 + i)).getUTCDay();
    if (w === 0 || w === 6) return ['DSR'];
    if (i === 2) return ['08:00', '12:00', '12:30', '17:48'];
    if (i === 3) return ['08:00', '08:01', '12:00', '13:00', '17:48'];
    if (i === 8) return ['08:00', '17:48'];
    if (i === 22) return ['FALTA'];
    return ['07:58', '12:00', '13:00', '17:50'];
  });
  return rows;
}

console.log('— leitura');
ok(parseDate('21/09', { from: '2026-09-21', to: '2026-10-20', year: 2026 }) === '2026-09-21', 'datas sem ano usam o período');
ok(parseDate('05/01', { from: '2025-12-21', to: '2026-01-20', year: 2026 }) === '2026-01-05' && parseDate('25/12', { from: '2025-12-21', to: '2026-01-20', year: 2026 }) === '2025-12-25', 'período que vira o ano');
ok(JSON.stringify(timesIn('07:00 às 19:00 / 7h30')) === '["07:00","19:00","07:30"]', 'horas em vários formatos');
const lido = parseEspelho([{ name: 'Espelho', rows: espelho() }]);
ok(lido.funcionarios.length === 3, '3 funcionários no espelho: ' + lido.funcionarios.map((f) => f.name).join(', '));
ok(lido.periodo?.from === '2026-09-21' && lido.periodo?.to === '2026-10-20', 'período 21/09 a 20/10 lido do cabeçalho');
const ana = lido.funcionarios[0];
ok(ana.matricula === '1001' && ana.posto === 'POSTO 01 - SHOPPING' && ana.days.length === 30, 'matrícula, posto e 30 dias da Ana');
ok(JSON.stringify(ana.days[0].punches) === '["06:57","19:02"]', 'batidas só das colunas Entrada/Saída (Horas Trab. e Extras não entram): ' + JSON.stringify(ana.days[0].punches));
ok(ana.days[1].marks.includes('FOLGA'), 'folga reconhecida');

console.log('— cálculos');
const r = analisar(lido, {}, { arquivo: 'espelho.xlsx', por: 'Evelyn' });
const A = r.funcionarios.find((f) => f.name.startsWith('ANA'))!;
const B = r.funcionarios.find((f) => f.name.startsWith('BRUNO'))!;
const C = r.funcionarios.find((f) => f.name.startsWith('CARLA'))!;
ok(A.escala === '12x36' && B.escala === '12x36' && C.escala === 'diaria', 'escala detectada: Ana e Bruno 12x36, Carla diária');
const day = (f: typeof A, i: number) => f.dias.find((d) => d.date === `2026-${DAYS[i].slice(3, 5)}-${DAYS[i].slice(0, 2)}`)!;
const tipos = (f: typeof A, i: number) => day(f, i).ocorrencias.map((o) => o.tipo);
ok(tipos(A, 4).includes('incompleta'), 'Ana dia 25/09: só a entrada → marcação incompleta');
ok(day(A, 6).ocorrencias.find((o) => o.tipo === 'atraso')?.min === 28, 'Ana 27/09: entrada 07:25 contra o habitual 06:57 → 28 min de atraso');
ok(tipos(A, 10).includes('sem_registro'), 'Ana 01/10: dia de plantão sem batida → sem registro');
ok(tipos(A, 13).includes('dia_folga'), 'Ana 04/10: trabalhou na folga da escala');
ok(tipos(A, 1).length === 0 && !day(A, 1).previsto, 'folga do 12x36 não vira falta');
ok(day(B, 1).trabalhado === 728 && day(B, 1).virada, 'Bruno noturno 18:55 → 07:03: 12h08 trabalhadas, passando da meia-noite');
ok(day(B, 9).ocorrencias.find((o) => o.tipo === 'excesso')?.min === 40, 'Bruno 30/09: 12h40 → 40 min acima do plantão');
ok(JSON.stringify(tipos(B, 15)) === '["justificada"]', 'atestado: ausência justificada (informativo, não é falta)');
ok(day(C, 2).ocorrencias.find((o) => o.tipo === 'intervalo_curto')?.min === 30, 'Carla 23/09: intervalo de 30 min');
ok(tipos(C, 3).includes('repetida') && day(C, 3).trabalhado === 528, 'Carla 24/09: batida repetida descartada, jornada 8h48 certa');
ok(tipos(C, 8).includes('sem_intervalo'), 'Carla 29/09: entrada e saída sem intervalo');
ok(tipos(C, 22).includes('falta'), 'Carla 13/10: falta marcada no espelho');
ok(!tipos(C, 5).length && !day(C, 5).previsto, 'sábado/domingo (DSR) não é dia de trabalho na diária');
ok(C.totais.trabalhados === 21 && C.totais.previstos === 22, `Carla: 21 dias trabalhados de 22 previstos (${C.totais.trabalhados}/${C.totais.previstos})`);
ok(r.resumo.funcionarios === 3 && r.resumo.ocorrencias === r.funcionarios.reduce((t, f) => t + f.totais.ocorrencias, 0), 'resumo soma os funcionários');
ok(r.funcionarios[0].status !== 'ok', 'quem tem mais problema vem primeiro: ' + r.funcionarios.map((f) => `${f.name} (${f.status})`).join(', '));

console.log('— plantão partido em duas linhas');
{
  const rows = [['Funcionário: DIEGO ROCHA   Matrícula: 2001'], ['Data', 'Entrada', 'Saída'], ['21/09/2026', '19:00', ''], ['22/09/2026', '07:00', ''], ['23/09/2026', '19:02', ''], ['24/09/2026', '07:05', '']];
  const l = parseEspelho([{ name: 'x', rows }]);
  ok(l.funcionarios[0]?.name === 'DIEGO ROCHA' && l.funcionarios[0].matricula === '2001', 'nome e matrícula na mesma linha (como no PDF)');
  const a = analisar(l, {}, { arquivo: '', por: '' }).funcionarios[0];
  ok(a.dias[0].trabalhado === 720 && !a.dias[0].ocorrencias.some((o) => o.tipo === 'incompleta') && a.dias[1].punches.length === 0, '19:00 de um dia + 07:00 do outro = um plantão de 12h');
}

console.log('— lista de batidas (uma tabela só)');
{
  const rows = [['Nome', 'Matrícula', 'Data', 'Marcações'], ['ELIS SANTOS', '3001', '21/09/2026', '08:00 12:00 13:00 17:00'], ['ELIS SANTOS', '3001', '22/09/2026', '08:20 12:00 13:00 17:00'], ['FABIO REIS', '3002', '21/09/2026', '08:00 17:00']];
  const l = parseEspelho([{ name: 'x', rows }]);
  ok(l.formato === 'lista' && l.funcionarios.length === 2 && l.funcionarios[0].days[1].punches.length === 4, 'colunas Nome/Data/Marcações');
}

console.log('— PDF (colunas pela posição)');
{
  const rows = [['Funcionário: GABI MOTA', 'Matrícula: 4001'], ['Data', 'Entrada', 'Saída', 'Entrada', 'Saída', 'Trab.'], ['21/09/2026', '08:00', '17:00', '08:00'], ['22/09/2026', '08:00', '12:00', '13:00', '17:00', '08:00']];
  const xs = [[50, 300], [50, 150, 200, 250, 300, 350], [50, 150, 200, 350], [50, 150, 200, 250, 300, 350]];
  const l = parseEspelho([{ name: 'pdf', rows, xs }]);
  ok(JSON.stringify(l.funcionarios[0]?.days[0].punches) === '["08:00","17:00"]', 'célula vazia no PDF: o total (08:00) não vira batida');
}

console.log('— Folha Ponto do GesOper (versão auditada)');
{
  // dois funcionários com PIS zerado, cargo VIGILANTE e colunas Noturnas/Intervalares preenchidas
  const bloco = (mat: string, nome: string, dias: [string, string][]) => {
    const rows: string[][] = [
      ['Folha Ponto', 'Período 21/08/2026 até 20/09/2026'],
      ['Empregado:', `${mat} - ${nome}`, 'Data Admissão:', '13/03/2026'],
      ['Cargo:', 'VIGILANTE', 'Tipo Salário:', 'Mensalista'],
      ['Posto Trabalho:', 'POSTO TESTE (SALVADOR)'],
      ['CPF:', '000.000.000-00', 'PIS:', '00000000000', 'CTPS:'],
      ['Data', 'Dia', 'Horário', 'Marcações', 'Trabalhadas', 'Extras', 'Noturnas', 'Intervalares', 'Faltas', 'Afastamentos'],
      ...dias.map(([d, m]) => (m === 'Folga' ? [d, 'Sex', 'Folga'] : [d, 'Sex', '38', m, '12:00', '07:00', '01:00'])),
      [nome, 'Chefia'],
      ['07/10/2026 10:01'],
    ];
    const xs = rows.map((r) => (r[0] === 'Data' ? [51, 80, 110, 147, 286, 342, 397, 453, 508, 564] : r.length === 7 ? [51, 80, 110, 151, 286, 397, 453] : r.map((_, i) => 60 + i * 100)));
    return { rows, xs };
  };
  const a = bloco('12012', 'ANA TESTE', [['21/08', '17:52 05:57'], ['22/08', 'Folga']]);
  const b = bloco('12010', 'BIA TESTE', [['21/08', 'Folga'], ['22/08', '05:45 17:57']]);
  const l = parseEspelho([{ name: 'pdf', rows: [...a.rows, ...b.rows], xs: [...a.xs, ...b.xs] }]);
  ok(l.funcionarios.map((f) => `${f.matricula}:${f.name}`).join() === '12012:ANA TESTE,12010:BIA TESTE', 'cada "Empregado: 123 - NOME" é uma pessoa (PIS zerado não junta e cargo VIGILANTE não vira nome): ' + l.funcionarios.map((f) => f.name).join());
  ok(JSON.stringify(l.funcionarios[0]?.days[0].punches) === '["17:52","05:57"]', 'noturnas e intervalares não viram batida: ' + JSON.stringify(l.funcionarios[0]?.days[0].punches));
  ok(l.funcionarios[0]?.posto === 'POSTO TESTE (SALVADOR)', '"Posto Trabalho:" é o posto: ' + l.funcionarios[0]?.posto);
}

// gera o PDF e a planilha de exemplo (para conferir o visual): PONTO_OUT=pasta
async function gerar() {
  if (!process.env.PONTO_OUT) return;
  const { pontoPdf } = await import('../lib/pontos/pdf');
  const { pontoXlsx } = await import('../lib/pontos/xlsx');
  const fs = await import('node:fs');
  fs.writeFileSync(process.env.PONTO_OUT + '/relatorio.pdf', await pontoPdf(r));
  fs.writeFileSync(process.env.PONTO_OUT + '/controle.xlsx', await pontoXlsx(r));
  console.log('arquivos em', process.env.PONTO_OUT);
}

void gerar().then(() => {
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
  process.exit(fails ? 1 : 0);
});
