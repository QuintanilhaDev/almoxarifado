import { EXPLAIN_RE, MANUAL, ORDER_RE, searchManual, spokenSteps, type ManualTopic } from './manual';
import { getSector } from '../sectors';
import type { MaxHost, MaxReply, Skill } from './types';
import type { Query } from './text';

const hereOf = (host: MaxHost) => (host.scope === 'hub' ? 'hub' : host.scope === 'login' ? null : host.sector?.slug ?? null);

/** Resposta de um tópico do manual: fala o resumo e os passos, mostra o cartão e abre a tela certa. */
export function explainTopic(topic: ManualTopic, host: MaxHost, others: ManualTopic[] = [], prefix = ''): MaxReply {
  const here = hereOf(host);
  const sameScreen = topic.sector === null || topic.sector === here;
  const canOpen = sameScreen && topic.tab && host.tabs.some((t) => t.id === topic.tab);
  const elsewhere = !sameScreen && topic.sector && topic.sector !== 'hub' ? getSector(topic.sector) : null;
  const hint = elsewhere ? ` Isso fica no setor ${elsewhere.name}.` : canOpen && host.tab !== topic.tab ? ' Já abri a tela para você acompanhar.' : '';
  const related = (others.length ? others : MANUAL.filter((t) => t.id !== topic.id && t.sector === topic.sector)).slice(0, 3);
  return {
    say: `${prefix}${topic.summary} ${spokenSteps(topic.steps)}${hint}`,
    text: `${prefix}${topic.summary}${hint}`,
    card: { kind: 'list', title: `Passo a passo · ${topic.title}`, rows: topic.steps.map((s, i) => ({ label: `${i + 1}. ${s}` })) },
    act: canOpen ? () => host.goTab(topic.tab!) : undefined,
    chips: [...related.map((t) => t.ask), ...(elsewhere && host.user?.is_master ? [`Max, abrir o setor ${elsewhere.name.toLowerCase()}`] : [])].slice(0, 4),
    source: 'manual',
  };
}

/** "Max, me explique passo a passo como funciona o almoxarifado", "como faço para lançar uma nota?" */
export const manualSkills: Skill[] = [
  {
    id: 'explain',
    scopes: ['hub', 'sector'],
    examples: ['Max, como funciona este setor?', 'Max, me explique passo a passo como lançar uma nota fiscal'],
    match: (q: Query, host) => {
      if (!EXPLAIN_RE.test(q.norm) || ORDER_RE.test(q.norm)) return 0;
      const hits = searchManual(q.norm, hereOf(host));
      if (!hits.length) return 0;
      // "como funciona" + assunto conhecido: o manual responde com certeza
      return hits[0].score >= 0.85 ? 0.97 : hits[0].score >= 0.7 ? 0.9 : 0.62;
    },
    run: (q, host) => {
      const hits = searchManual(q.norm, hereOf(host));
      const top = hits[0].topic;
      return explainTopic(top, host, hits.slice(1, 4).map((h) => h.topic));
    },
  },
];

/** Último recurso antes do "não sei": o manual tem algo bem parecido com a pergunta? */
export function manualFallback(norm: string, host: MaxHost): MaxReply | null {
  if (host.scope === 'login' || ORDER_RE.test(norm)) return null;
  const hits = searchManual(norm, hereOf(host));
  if (!hits.length || hits[0].score < 0.85) return null;
  return explainTopic(hits[0].topic, host, hits.slice(1, 4).map((h) => h.topic), 'Pelo que entendi, você quer saber sobre isto. ');
}
