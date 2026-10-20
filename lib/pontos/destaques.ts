import { ORDEM, SITUACAO, hhmm, type Analise, type Situacao } from './types';

/**
 * Frases objetivas para a diretoria, escritas a partir dos números (sem opinião):
 * conformidade, a ocorrência que mais pesa, faltas, concentração, extras, intervalo e posto.
 */
export function destaques(a: Analise): string[] {
  const r = a.resumo;
  const out: string[] = [];
  if (!r.funcionarios) return out;
  const pct = (x: number) => `${(Math.round(x * 10) / 10).toLocaleString('pt-BR')}%`;
  const quem = (t: Situacao) => a.funcionarios.filter((f) => (f.totais.porTipo[t] ?? 0) > 0).length;
  const pl = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

  out.push(`${pct(r.conformidade)} dos dias de trabalho sem ocorrência relevante (${pl(r.dias, 'dia avaliado', 'dias avaliados')}, ${pl(r.funcionarios, 'funcionário', 'funcionários')}).`);

  const sem = (r.porTipo.sem_registro ?? 0) + (r.porTipo.falta ?? 0);
  if (sem) {
    const k = a.funcionarios.filter((f) => (f.totais.porTipo.sem_registro ?? 0) + (f.totais.porTipo.falta ?? 0) > 0).length;
    out.push(`${pl(sem, 'dia escalado', 'dias escalados')} sem registro de ponto ou com falta, em ${pl(k, 'funcionário', 'funcionários')}.`);
  }
  if (r.porTipo.incompleta) out.push(`${pl(r.porTipo.incompleta, 'dia', 'dias')} com batida faltando (entrada ou saída), em ${pl(quem('incompleta'), 'funcionário', 'funcionários')}.`);
  const semInt = (r.porTipo.sem_intervalo ?? 0) + (r.porTipo.intervalo_curto ?? 0);
  if (semInt) out.push(`Intervalo não feito ou menor que o mínimo em ${pl(semInt, 'jornada', 'jornadas')} (${pl(a.funcionarios.filter((f) => (f.totais.porTipo.sem_intervalo ?? 0) + (f.totais.porTipo.intervalo_curto ?? 0) > 0).length, 'funcionário', 'funcionários')}).`);
  if (r.porTipo.atraso) {
    const min = a.funcionarios.reduce((t, f) => t + f.totais.atrasos, 0);
    out.push(`${pl(r.porTipo.atraso, 'atraso', 'atrasos')} além da tolerância, somando ${hhmm(min)} (${pl(quem('atraso'), 'funcionário', 'funcionários')}).`);
  }
  if (r.extras > 0) out.push(`${hhmm(r.extras)} trabalhadas além da jornada prevista, em ${pl(a.funcionarios.filter((f) => f.totais.extras > 0).length, 'funcionário', 'funcionários')}.`);
  if (r.porTipo.interjornada) out.push(`${pl(r.porTipo.interjornada, 'caso', 'casos')} de descanso menor que 11h entre jornadas.`);
  if (r.porTipo.dia_folga) out.push(`${pl(r.porTipo.dia_folga, 'dia trabalhado', 'dias trabalhados')} em folga da escala (dobra ou troca de plantão).`);

  // concentração: quem responde pela maior parte das ocorrências graves e de atenção
  const peso = (f: Analise['funcionarios'][number]) => ORDEM.reduce((t, k) => t + (SITUACAO[k].nivel !== 'baixa' ? f.totais.porTipo[k] ?? 0 : 0), 0);
  const total = a.funcionarios.reduce((t, f) => t + peso(f), 0);
  if (total > 0 && a.funcionarios.length >= 6) {
    const top = [...a.funcionarios].sort((x, y) => peso(y) - peso(x)).slice(0, 3);
    const share = (top.reduce((t, f) => t + peso(f), 0) / total) * 100;
    if (share >= 40) out.push(`Os 3 funcionários com mais ocorrências concentram ${pct(share)} delas: ${top.map((f) => f.name.split(' ').slice(0, 2).join(' ')).join(', ')}.`);
  }
  const postos = r.postos.filter((p) => p.ocorrencias > 0);
  if (postos.length >= 2) {
    const soma = postos.reduce((t, p) => t + p.ocorrencias, 0);
    const p0 = postos[0];
    if (p0.ocorrencias / soma >= 0.5) out.push(`O posto ${p0.posto} concentra ${pct((p0.ocorrencias / soma) * 100)} das ocorrências.`);
  }
  if (!r.ocorrencias) out.push('Nenhuma ocorrência no período: todos os registros conferem.');
  return out;
}
