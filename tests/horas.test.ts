/**
 * Apurador de horas extras (regra 44h semanais / 9h diárias). Uso: npx tsx tests/horas.test.ts
 */
import { apurar, mesDe } from '../lib/horas/calculo';
import { juntar, limparLido } from '../lib/horas/juntar';
import { lerTextoLivre } from '../lib/horas/texto';
import { deduzirMes, iaParaLido } from '../lib/horas/ia';
import type { Lido } from '../lib/pontos/types';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};
const dia = (date: string, ...punches: string[]) => ({ date, punches, marks: [], schedule: null });
const run = (days: ReturnType<typeof dia>[], cfg = {}) => apurar({ funcionarios: [{ name: 'TESTE', matricula: '1', posto: null, cargo: null, days }], periodo: null, formato: 'lista', avisos: [] } as Lido, cfg, { arquivo: '', leitura: '', por: '' }).funcionarios[0];
const d = (f: ReturnType<typeof run>, date: string) => f.dias.find((x) => x.date === date)!;

// semana de 12/10/2026 (segunda, feriado!) — use a de 19/10 a 25/10/2026, sem feriado
console.log('— sábado depois das 44h cumpridas');
let f = run([dia('2026-10-19', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-20', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-21', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-22', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-23', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-24', '08:00', '12:00')]);
ok(f.total.normal === 44 * 60 && d(f, '2026-10-24').extra50 === 240, 'seg–qui 9h + sex 8h = 44h; sábado 4h todo extra');
ok(/sábado/.test(d(f, '2026-10-24').motivo ?? ''), 'o motivo explica: ' + d(f, '2026-10-24').motivo);

console.log('— sábado completando as 44h');
f = run([dia('2026-10-19', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-20', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-21', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-22', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-23', '08:00', '12:00', '13:00', '17:00'), dia('2026-10-24', '08:00', '14:00')]);
ok(d(f, '2026-10-24').normal === 240 && d(f, '2026-10-24').extra50 === 120, '5 × 8h = 40h; sábado 6h: 4h completam as 44h e 2h são extras');

console.log('— excesso no dia');
f = run([dia('2026-10-19', '07:00', '12:00', '13:00', '18:00'), dia('2026-10-20', '08:00', '12:00', '13:00', '18:05')]);
ok(d(f, '2026-10-19').extra50 === 60, '10h num dia: 1h extra');
ok(d(f, '2026-10-20').extra50 === 0 && d(f, '2026-10-20').normal === 545, '9h05: dentro da tolerância de 10 min, sem extra');

console.log('— domingo e feriado');
f = run([dia('2026-10-25', '08:00', '14:00'), dia('2026-10-12', '08:00', '12:00')]);
ok(d(f, '2026-10-25').extra100 === 360 && d(f, '2026-10-12').extra100 === 240 && f.total.extra50 === 0, 'domingo 6h e feriado (12/10) 4h: tudo extra 100%');
f = run([dia('2026-10-13', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-14', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-15', '08:00', '12:00', '13:00', '18:00'), dia('2026-10-16', '08:00', '12:00', '13:00', '18:00')]);
ok(f.total.extra50 === 60 && d(f, '2026-10-16').extra50 === 60, 'semana com feriado na segunda (meta 35h): 4 × 9h = 36h → 1h extra na sexta');

console.log('— noturno e batida faltando');
f = run([dia('2026-10-19', '19:00', '07:00')]);
ok(d(f, '2026-10-19').trabalhado === 720 && d(f, '2026-10-19').extra50 === 180, 'plantão 19h–7h: 12h, 3h acima de 9h');
f = run([dia('2026-10-19', '08:00', '12:00', '13:00')]);
ok(d(f, '2026-10-19').incompleto && d(f, '2026-10-19').trabalhado === 240, 'batida faltando: soma só o par completo e marca o dia');

console.log('— mês de apuração');
ok(mesDe('2026-10-20', 1).chave === '2026-10' && mesDe('2026-10-21', 21).chave === '2026-11' && mesDe('2026-10-20', 21).chave === '2026-10', 'mês do calendário e de 21 a 20');
ok(mesDe('2026-12-25', 21).chave === '2027-01' && /21\/12 a 20\/01/.test(mesDe('2026-12-25', 21).rotulo), 'virada de ano no 21 a 20: ' + mesDe('2026-12-25', 21).rotulo);
f = run([dia('2026-09-30', '07:00', '12:00', '13:00', '18:00'), dia('2026-10-01', '07:00', '12:00', '13:00', '18:00')]);
ok(f.meses.length === 2 && f.meses.every((m) => m.extras === 60), 'extras divididos por mês (set e out)');

console.log('— vários arquivos (pasta)');
{
  const L = (funcs: { name: string; matricula: string | null; days: ReturnType<typeof dia>[] }[]): Lido => ({ funcionarios: funcs.map((f) => ({ ...f, posto: null, cargo: null })), periodo: null, formato: 'lista', avisos: [] });
  const setembro = L([{ name: 'JOÃO SILVA', matricula: '0042', days: [dia('2026-09-28', '07:00', '12:00', '13:00', '18:00')] }]);
  const outubro = L([
    { name: 'Joao Silva', matricula: '42', days: [dia('2026-10-19', '07:00', '12:00', '13:00', '18:00'), dia('2026-09-28', '07:00', '12:00', '13:00', '18:00')] },
    { name: 'MARIA SOUZA', matricula: null, days: [dia('2026-10-25', '08:00', '12:00')] },
  ]);
  const extra = L([{ name: 'maria souza', matricula: null, days: [dia('2026-10-26', '08:00', '12:00', '13:00', '19:00')] }]);
  const j = juntar([{ nome: 'set.pdf', lido: setembro }, { nome: 'out.xlsx', lido: outubro }, { nome: 'maria.jpg', lido: extra }]);
  ok(j.funcionarios.length === 2, 'mesma matrícula (0042 = 42) e mesmo nome sem acento viram uma pessoa só');
  const a = apurar(j, {}, { arquivo: '3 arquivos', leitura: '', por: '' });
  const joao = a.funcionarios.find((f) => /JO/.test(f.name))!;
  ok(joao.total.extras === 120 && joao.meses.length === 2, 'João: 28/09 repetido em dois arquivos conta uma vez só (1h + 1h)');
  ok(j.avisos.some((x) => /mais de um arquivo/.test(x)), 'avisa o dia repetido');
  const maria = a.funcionarios.find((f) => /MARIA/.test(f.name))!;
  ok(maria.total.extra100 === 240 && maria.total.extra50 === 60, 'Maria: domingo de um arquivo + segunda de 10h de outro');
  ok(j.periodo?.from === '2026-09-28' && j.periodo?.to === '2026-10-26', 'período cobre todos os arquivos');
  const sujo = limparLido({ funcionarios: [{ name: 'X', days: [{ date: '2026-10-19', punches: ['08:00', 'abc', '25:00', '17:00'], marks: [] }, { date: 'ontem', punches: [] }] }], avisos: [] });
  ok(sujo?.funcionarios[0].days.length === 1 && sujo.funcionarios[0].days[0].punches.join() === '08:00,17:00', 'dados vindos da tela são filtrados');
}

console.log('— leitor simples de texto (sem IA)');
{
  const a = lerTextoLivre('RELATÓRIO   Período: 01/09/2026 a 30/09/2026\nFuncionário: JOSÉ CARLOS PEREIRA      Matrícula: 00123   Cargo: VIGILANTE\n14/09 seg 07:00 12:00 13:00 18:00\n16/09 FOLGA\nFuncionário: ANA LIMA   Matr.: 77\n14/09 08:00 12:00 13:00 19:30');
  ok(a.funcionarios.length === 2 && a.funcionarios[0].matricula === '00123' && a.funcionarios[0].days[0].punches.length === 4 && a.funcionarios[1].days[0].date === '2026-09-14', 'com rótulos "Funcionário:" e período');
  const b = lerTextoLivre('MARIA DOS SANTOS\n21/09/2026 07:58 12:01 13:00 18:02\nPEDRO ALVES\n21/09/2026 19:00 07:00');
  ok(b.funcionarios.map((f) => f.name).join() === 'MARIA DOS SANTOS,PEDRO ALVES', 'nome sozinho na linha antes dos dias');
  const c = lerTextoLivre('Nome  Data  Ent Sai\nCARLOS SOUZA  21/09/2026  07:00 12:00 13:00 17:00\nJOANA DARC  21/09/2026  08:00 12:00');
  ok(c.funcionarios.length === 2 && c.funcionarios[1].days[0].punches.join() === '08:00,12:00', 'tabela com o nome em cada linha');
}

console.log('— folha à mão só com o número do dia (mês deduzido)');
{
  const F = ['07:00', '12:01', '13:01', '18:01'];
  const H = ['08:02', '12:02'];
  // folha real (setembro/2026): domingos 6, 13, 20, 27 em branco; sábados 12, 19, 26 meio expediente
  const linhas: unknown[][] = [];
  for (let d = 1; d <= 31; d++) linhas.push([String(d).padStart(2, '0'), ...([6, 13, 20, 27, 31].includes(d) ? ['-'] : [12, 19, 26].includes(d) ? H : F)]);
  const hoje = new Date('2026-10-20T12:00:00Z');
  const g = deduzirMes(linhas.map((l) => ({ dia: Number(l[0]), punches: l.slice(1).filter((x) => x !== '-') as string[] })), 2026, hoje);
  ok(g?.mes === '2026-09' && g.certeza >= 4, 'domingos em branco e sábados curtos → setembro/2026: ' + JSON.stringify(g));
  const doc = { mes: null, ano: 2026, funcionarios: [{ nome: 'André Vitor da Paz Souza', matricula: null, cargo: 'AAOP', dias: linhas, duvidas: ['15'] }] };
  const l = iaParaLido([doc], hoje);
  const f = l.funcionarios[0];
  ok(f.days.length === 31 - 5 + 5 - 1 && f.days[0].date === '2026-09-01' && !f.days.some((d) => d.date.startsWith('2026-10')), 'dias montados em setembro (o 31 é ignorado): ' + f.days.length);
  ok(l.avisos.some((a) => /setembro\/2026/.test(a)) && l.avisos.some((a) => /dúvida em 1 dia/.test(a)), 'avisa o mês deduzido e a dúvida: ' + l.avisos.join(' | '));
  const forcado = iaParaLido([doc], hoje, '2026-08');
  ok(forcado.funcionarios[0].days[0].date === '2026-08-01' && forcado.meses[0].certeza === 'escolhido', 'mês escolhido na tela vale');
  const a = apurar(l, {}, { arquivo: '', leitura: '', por: '' });
  ok(a.funcionarios[0].total.extras > 0, 'calcula as extras da folha: ' + a.funcionarios[0].total.extras + ' min');
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
process.exit(fails ? 1 : 0);
