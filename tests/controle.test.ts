/**
 * Controle do RH: troca por peça, ASO/cursos configuráveis, sem informação separado e estoque por contrato.
 * Uso: npx tsx tests/controle.test.ts  (nomes inventados)
 */
import { apurarColab, linhasDe, porContrato, pontuaPeca, resumir, seAplica, type ColabC, type EntregaC, type Exigencia, type KitC, type RegistroC } from '../lib/rh/controle';

let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? '✓' : '✗'} ${m}`);
  if (!c) fails++;
};
const HOJE = '2026-11-03';
const kit: KitC = {
  role: 'VIGILANTE',
  period_months: 12,
  items: [
    { name: 'Camisa', size_from: 'camisa', qty: 2 },
    { name: 'Calça', size_from: 'calca', qty: 2 },
    { name: 'Coturno', size_from: 'calcado', qty: 1, period_months: 6 },
    { name: 'Boné', size_from: null, qty: 1 },
  ],
};
const ana: ColabC = { id: 'a', name: 'ANA TESTE', matricula: '1', role: 'Vigilante', posto_id: 'p1', posto_name: 'POSTO ALFA', company: 'MAX FORTE', client: 'CLIENTE ALFA', admitted_at: '2025-01-10', sizes: { camisa: 'M', calca: '40' } };
const ent = (item_name: string, qty: number, date: string | null, source: EntregaC['source'] = 'sistema'): EntregaC => ({ collaborator_id: 'a', item_name, size: null, qty, date, source });
const entregas = [ent('CAMISA MC', 1, '2025-01-15'), ent('Camisa manga longa', 1, '2026-10-01'), ent('CALÇA OPERACIONAL', 2, '2026-01-20', 'planilha'), ent('COTURNO 42', 1, '2026-03-01'), ent('LANTERNA', 1, '2026-01-01')];
const exigs: Exigencia[] = [
  { id: 'aso', kind: 'aso', name: 'ASO periódico', roles: [], clients: [], companies: [], validity_months: 12, alert_days: 60, active: true },
  { id: 'rec', kind: 'curso', name: 'Reciclagem de vigilante', roles: ['VIGILANTE'], clients: [], companies: [], validity_months: 24, alert_days: 60, active: true },
  { id: 'nr', kind: 'documento', name: 'Ficha de EPI', roles: ['PORTEIRO'], clients: [], companies: [], validity_months: 12, alert_days: 30, active: true },
];
const regs: RegistroC[] = [
  { id: 'r1', collaborator_id: 'a', requirement_id: 'aso', done_at: '2024-11-20', expires_at: null },
  { id: 'r2', collaborator_id: 'a', requirement_id: 'aso', done_at: '2025-12-01', expires_at: null },
];

ok(pontuaPeca('Camisa', 'CAMISA MC') > 0 && pontuaPeca('Calça', 'CALCA 44') > 0 && pontuaPeca('Camisa MC', 'Camisa ML') === 0 && pontuaPeca('Boné', 'Botina') === 0, 'casa a peça entregue com o item do kit pelo nome');
const c = apurarColab(ana, kit, entregas, exigs, regs, HOJE);
const camisas = c.pecas.filter((p) => p.item === 'Camisa');
ok(camisas.length === 2 && camisas[0].troca_em === '2027-10-01' && camisas[1].troca_em === '2026-01-15', 'cada camisa tem a própria data de entrega e de troca');
ok(camisas[1].status === 'vencida' && camisas[0].status === 'em_dia', 'uma camisa vencida e outra em dia');
const cot = c.pecas.find((p) => p.item === 'Coturno')!;
ok(cot.troca_em === '2026-09-01' && cot.status === 'vencida' && cot.periodo === 6, 'prazo do item no kit (coturno a cada 6 meses) vale em vez do prazo do kit');
const calca = c.pecas.find((p) => p.item === 'Calça')!;
ok(calca.qty === 2 && calca.status === 'em_dia' && calca.troca_em === '2027-01-20' && calca.dias === 78, 'calça da planilha: 2 peças com troca em 20/01/2027: ' + calca.troca_em + ' ' + calca.dias);
const bone = c.pecas.find((p) => p.item === 'Boné')!;
ok(bone.status === 'pendente' && bone.qty === 1, 'boné não entregue fica pendente');
ok(c.faltas.includes('Sem tamanho de calçado'), 'falta o tamanho de calçado no cadastro: ' + c.faltas.join(' | '));
ok(c.exigencias.length === 2 && c.exigencias.find((x) => x.id === 'aso')!.vence_em === '2026-12-01' && c.exigencias.find((x) => x.id === 'aso')!.status === 'a_vencer', 'ASO: vale o registro mais recente (vence 01/12/2026, a vencer)');
ok(c.exigencias.find((x) => x.id === 'rec')!.status === 'sem_registro' && c.faltas.some((f) => /Reciclagem/.test(f)), 'reciclagem sem registro é "sem informação", não regular');
ok(!seAplica(exigs[2], ana), 'exigência de outra função não se aplica');

const bia: ColabC = { id: 'b', name: 'BIA TESTE', matricula: '2', role: 'ASG', posto_id: 'p2', posto_name: 'POSTO BETA', company: 'MAX SERVIÇOS', client: null, admitted_at: null, sizes: {} };
const b = apurarColab(bia, null, [], exigs, [], HOJE);
ok(b.kit === null && b.pecas.length === 0 && b.faltas.some((f) => /sem kit/.test(f)) && b.faltas.includes('Sem data de admissão'), 'função sem kit e sem admissão aparecem como falta de informação');
const cs = [c, b];
const r = Object.fromEntries(resumir(cs).map((x) => [x.id, x]));
ok(r.kit_incompleto.valor === 1 && r.kit_incompleto.semInfo === 1, 'kit incompleto: 1 (e 1 sem informação)');
ok(r.pendentes.valor === 1, 'peças pendentes: 1');
ok(r.vencidas.valor === 2, 'peças com troca vencida: 2 (camisa e coturno)');
ok(r.reposicoes.valor === 0, 'reposições em 60 dias: 0 (calça vence em 78 dias)');
ok(r.aso.valor === 1 && r.aso.semInfo === 1, 'ASOs vencidos ou a vencer: 1 (e 1 sem registro)');
ok(r.cursos.valor === 0 && r.cursos.semInfo === 1, 'cursos: 0 (e 1 sem registro)');
const lv = linhasDe('vencidas', cs);
ok(lv.length === 2 && lv.every((l) => !l.semInfo && l.contrato === 'CLIENTE ALFA'), 'relação das vencidas com o contrato (cliente)');
ok(linhasDe('kit_incompleto', cs).filter((l) => l.semInfo).length === 1, 'sem informação aparece separado na relação');
const semData = apurarColab(ana, kit, [ent('BONÉ', 1, null)], [], [], HOJE);
ok(semData.pecas.find((p) => p.item === 'Boné')!.status === 'sem_data' && linhasDe('vencidas', [semData]).some((l) => l.semInfo), 'peça entregue sem data não é regular: vai para sem informação');

const ct = porContrato(cs, [ana, bia], [{ collaborator_id: 'a', posto_id: 'p1', posto_name: 'POSTO ALFA', reservado: 1 }], [{ posto_id: 'p1', qty: 1 }]);
const alfa = ct.find((x) => x.contrato === 'CLIENTE ALFA')!;
ok(alfa.precisa === 3 && alfa.reservado === 1 && alfa.noPosto === 1 && alfa.falta === 1 && alfa.emUso === 3, `contrato: precisa 3 (1 pendente + 2 vencidas), 1 reservada, 1 no posto, falta 1: ${JSON.stringify(alfa)}`);
ok(ct.find((x) => x.contrato === 'POSTO BETA')?.semKit === 1, 'sem cliente: o contrato é o posto');

ok(pontuaPeca('Botina c/ biqueira', 'BOTINA 40') > 0 && pontuaPeca('Calça operacional', 'CALÇA SOCIAL 42') === 0, 'botina da planilha casa com a botina c/ biqueira; calça social não é operacional');
ok(pontuaPeca('Luva pigmentada', 'LUVA PIGMENTADA G') > pontuaPeca('Luva anticorte', 'LUVA PIGMENTADA G'), 'o item mais específico do kit ganha (luva pigmentada)');
{
  const av = apurarColab(ana, kit, [...entregas, ent('PROTETOR AURICULAR', 1, '2025-12-01'), ent('PROTETOR AURICULAR', 1, '2026-06-01')], [], [], HOJE, undefined, [{ name: 'Protetor auricular', period_months: 6 }]);
  const pa = av.pecas.filter((p) => p.avulso);
  ok(pa.length === 1 && pa[0].entregue_em === '2026-06-01' && pa[0].troca_em === '2026-12-01' && pa[0].status === 'prevista', 'EPI extra: vale a entrega mais recente, com vencimento próprio (6 meses)');
  ok(linhasDe('reposicoes', [av]).some((l) => l.item === 'Protetor auricular' && /avulso/.test(l.obs)) && !linhasDe('pendentes', [av]).some((l) => l.item === 'Protetor auricular'), 'EPI extra entra nas reposições, nunca como pendente do kit');
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO CERTO');
process.exit(fails ? 1 : 0);
