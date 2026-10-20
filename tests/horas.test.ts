/**
 * Apurador de horas extras (regra 44h semanais / 9h diárias). Uso: npx tsx tests/horas.test.ts
 */
import { apurar, mesDe } from '../lib/horas/calculo';
import { juntar, limparLido } from '../lib/horas/juntar';
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

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
process.exit(fails ? 1 : 0);
