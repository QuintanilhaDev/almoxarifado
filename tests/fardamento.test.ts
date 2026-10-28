/**
 * Controle de fardamento (Gestão): leitura da planilha do RH/DP e análise.
 * Uso: npx tsx tests/fardamento.test.ts
 * A planilha é montada aqui mesmo, com nomes inventados (nada de dado real no repositório).
 */
import ExcelJS from 'exceljs';
import { lerControleFarda } from '../lib/fardamento/parse';
import { SEM_FILTRO, grade, opcoesFarda, resumir } from '../lib/fardamento/analise';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};

async function planilha() {
  const wb = new ExcelJS.Workbook();
  // abas de resumo que devem ser ignoradas
  wb.addWorksheet('Planilha1').addRow(['EMPRESA', 'QTD', 'Cam M/L']);
  const ws = wb.addWorksheet('Controle_2026');
  ws.addRow([null, null, null, null, null, null, null, null, 999, 999]); // linha de totais em cima
  ws.addRow([
    'Empresa',
    'Data de Solicitação',
    'Solicitante',
    'Funcionário',
    'Função',
    'Posto',
    'mês/ano',
    'Data de Entrega',
    'CAMISA MC',
    'QTD MC',
    'CAMISA ML',
    'QTD ML',
    'CAMISA SOC.',
    'QTD CAM.SOC.',
    'CALÇA',
    'QTD CALÇA',
    'CALÇADOS',
    'QTD CALÇADOS',
    'ITENS A',
    'QTD A',
    'ITENS B',
    'QTD B',
  ]);
  const d = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
  const linhas: unknown[][] = [
    ['MAX SERVIÇOS ', d(2025, 1, 2), 'RH/DP', 'ANA TESTE', 'AGENTE DE PORTARIA', 'POSTO ALFA', 'jan/25', d(2025, 1, 2), 4, 1, 4, 1, null, null, 44, 2, 'BOTINA 40', 1, 'BONÉ', 1, 'APITO C/FIEL', 1],
    ['MAX FORTE', d(2025, 1, 3), 'NARDELE', 'BRUNO TESTE', 'VIGILANTE', 'POSTO BETA', 'jan/25', d(2025, 1, 3), 6, 1, 6, 1, null, null, 50, 2, 'COTURNO 43', 1, 'Apito c/Fiél', 1, 'CINTO', 1],
    ['MAX CONFIAVEL', d(2025, 2, 10), 'RH/DP', 'CARLA TESTE', 'RECEPCIONISTA', 'POSTO ALFA', 'fev/25', d(2025, 2, 10), null, null, null, null, 'G', 2, 42, 2, 'SOCIAL 38', 1, 'GRAVATA', '-', null, null],
    ['MAX SERVIÇOS', d(2026, 1, 5), 'RH/DP', 'ANA TESTE', 'AGENTE DE PORTARIA', 'POSTO ALFA', 'jan/26', d(2026, 1, 5), 4, 1, null, null, null, null, 44, 1, '-', '-', 'BONE', 1, null, null],
    ['MAX SERVIÇOS', null, 'RH/DP', 'ANA TESTE', 'AGENTE DE PORTARIA', 'POSTO ALFA', 'fev/26', null, 4, 1, null, null, null, null, 46, 1, null, null, null, null, null, null],
    ['MAX FORTE', d(2026, 3, 1), 'NARDELE', 'ANA TESTE', 'AGENTE DE PORTARIA', 'POSTO GAMA', 'mar/26', d(2026, 3, 1), 5, 1, 5, 1, null, null, 46, 2, 'BOTINA 41', 1, null, null, null, null],
  ];
  for (const l of linhas) ws.addRow(l);
  ws.addRow([null, null, null, null, null, null, 'jan/00']); // linhas vazias com fórmula no mês
  return Buffer.from(await wb.xlsx.writeBuffer());
}

(async () => {
  const r = await lerControleFarda(await planilha(), 'FARDAMENTO.xlsx');
  ok(r.aba === 'Controle_2026' && r.entregas.length === 6, 'acha a aba das entregas (ignora resumo e totais): ' + r.aba + ' / ' + r.entregas.length);
  const [a, b, c, , sem] = r.entregas;
  ok(a.e === 'Max Serviços' && c.e === 'Max Confiável' && b.e === 'Max Forte', 'empresas com o nome certo');
  ok(
    JSON.stringify(a.i) ===
      JSON.stringify([
        ['Camisa MC', '4', 1],
        ['Camisa ML', '4', 1],
        ['Calça', '44', 2],
        ['Botina', '40', 1],
        ['Boné', null, 1],
        ['Apito com fiel', null, 1],
      ]),
    'peças com tamanho e quantidade: ' + JSON.stringify(a.i),
  );
  ok(b.i.some((i) => i[0] === 'Coturno' && i[1] === '43') && b.i.some((i) => i[0] === 'Apito com fiel'), 'COTURNO 43 e "Apito c/Fiél" (grafias diferentes juntas)');
  ok(c.i.some((i) => i[0] === 'Sapato social' && i[1] === '38') && c.i.some((i) => i[0] === 'Camisa social' && i[1] === 'G'), 'calçado SOCIAL 38 → Sapato social');
  ok(c.i.some((i) => i[0] === 'Gravata' && i[2] === 1) && r.avisos.some((x) => /sem quantidade/.test(x)), 'peça sem quantidade conta 1 e avisa');
  ok(sem.d === null && sem.m === '2026-02', 'sem data de entrega: usa o mês/ano');

  const op = opcoesFarda(r.entregas);
  ok(op.primeiro === '2025-01' && op.ultimo === '2026-03', 'período da planilha');
  const f = { ...SEM_FILTRO, de: '2025-01', ate: '2026-03' };
  const s = resumir(r.entregas, f);
  ok(s.total.entregas === 6 && s.total.funcionarios === 3 && s.total.postos === 3, 'totais: 6 entregas, 3 funcionários, 3 postos');
  ok(s.porMes.length === 15 && s.porMes[0].entregas === 2, '15 meses no gráfico (meses sem entrega contam como zero)');
  ok(s.pecas[0].peca === 'Calça' && s.pecas[0].qtd === 10, 'peça que mais saiu: calça (10)');
  ok(s.recorrentes.length === 1 && s.recorrentes[0].nome === 'ANA TESTE' && s.recorrentes[0].entregas === 4, 'funcionária com 4 entregas aparece para conferir');
  const so = resumir(r.entregas, { ...f, posto: 'POSTO ALFA', peca: 'Calça' });
  ok(so.total.entregas === 4 && so.total.pecas === 6, 'filtro por posto e peça: 4 entregas, 6 calças');
  const g = grade(r.entregas, f, 'Calça');
  ok(g.map((x) => x.tam).join() === '42,44,46,50' && g.find((x) => x.tam === '44')!.qtd === 3, 'grade da calça em ordem: ' + g.map((x) => `${x.tam}:${x.qtd}`).join(' '));
  const ano = resumir(r.entregas, { ...f, de: '2026-01', ate: '2026-03' });
  ok(ano.anoAnterior !== null && ano.anoAnterior.entregas === 3, 'compara com o mesmo período do ano anterior');

  ok(s.parcial?.mes === '2026-03' && s.parcial.ate === '2026-03-01', 'último mês ainda em andamento (entregas só até 01/03) fica marcado');
  {
    // duas abas: "2025" e "TODAS" (que repete as de 2025 e traz mais uma): lê as duas e não duplica
    const wb = new ExcelJS.Workbook();
    const cab = ['Empresa', 'Funcionário', 'Função', 'Posto', 'Data de Entrega', 'CALÇA', 'QTD CALÇA'];
    const l1 = ['MAX FORTE', 'ANA TESTE', 'VIGIA', 'POSTO A', new Date(Date.UTC(2025, 4, 2)), 44, 2];
    const l2 = ['MAX FORTE', 'BIA TESTE', 'VIGIA', 'POSTO B', new Date(Date.UTC(2026, 0, 9)), 46, 1];
    const a = wb.addWorksheet('2025');
    a.addRow(cab);
    a.addRow(l1);
    const b = wb.addWorksheet('TODAS');
    b.addRow(cab);
    b.addRow(l1);
    b.addRow(l2);
    wb.addWorksheet('Resumo').addRow(['Soma de QTD', 'Total']);
    const r2 = await lerControleFarda(Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx');
    ok(r2.entregas.length === 2 && r2.avisos.some((x) => /repetidas em mais de uma aba/.test(x)), 'lê todas as abas e não duplica a entrega repetida: ' + r2.entregas.length + ' / ' + r2.avisos.join(' '));
  }
  let erro = '';
  try {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('X').addRow(['nada', 'aqui']);
    await lerControleFarda(Buffer.from(await wb.xlsx.writeBuffer()), 'x.xlsx');
  } catch (e) {
    erro = (e as Error).message;
  }
  ok(/Não encontrei nenhuma aba/.test(erro), 'planilha errada: mensagem clara');

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
  process.exit(fails ? 1 : 0);
})();
