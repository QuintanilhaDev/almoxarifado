import { almoxSkills } from './skills-almox';
import { capabilities, coreSkills } from './skills-core';
import { emptySectorSkills, hubSkills } from './skills-hub';
import { makeQuery, normalize, stripWake, type Query } from './text';
import type { MaxHost, MaxMemory, MaxReply, Skill } from './types';

const ALL: Skill[] = [...coreSkills, ...almoxSkills, ...hubSkills, ...emptySectorSkills];

/** Abaixo disto a Max não tem certeza e passa a pergunta adiante (IA/Wikipedia) ou admite que não sabe. */
export const CONFIDENT = 0.6;

function available(host: MaxHost): Skill[] {
  return ALL.filter((s) => {
    if (s.scopes && !s.scopes.includes(host.scope)) return false;
    if (s.sector && host.sector?.slug !== s.sector) return false;
    return true;
  });
}

export interface Ranked {
  skill: Skill;
  score: number;
}

export function rank(q: Query, host: MaxHost): Ranked[] {
  const out: Ranked[] = [];
  for (const skill of available(host)) {
    let score = 0;
    try {
      score = skill.match(q, host);
    } catch {
      score = 0;
    }
    if (score > 0) out.push({ skill, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Tira cortesias que não mudam o pedido ("por favor", "você pode…"). */
function politeTrim(norm: string): string {
  return norm
    .replace(/^(por favor|por gentileza|pfv|pf)\s+/, '')
    .replace(/\s+(por favor|por gentileza|pfv|pf|obrigad[oa]|valeu)$/, '')
    .replace(/^(voce|vc) (pode|poderia|consegue|sabe) (me )?/, '')
    .replace(/^(pode|poderia|consegue) (me )?/, '')
    .replace(/^(eu )?(gostaria|queria|quero|preciso|desejo) (de )?(que voce |que vc )?(saber |ver |me )?/, (m) => (/(ver|saber)/.test(m) ? 'ver ' : 'quero '))
    .replace(/^(me )?(diga|diz|dizer|fala|fale|conta|conte|contar|informe|informa|informar)( me| ai| pra mim)? /, '')
    .trim();
}

export interface Heard {
  /** texto ouvido/digitado, como veio */
  raw: string;
  /** 'strong' | 'weak' | 'none' — se a pessoa chamou "Max" */
  wake: 'strong' | 'weak' | 'none';
  /** o pedido, já sem a chamada */
  command: string;
  query: Query;
}

export function hear(raw: string): Heard {
  const norm = normalize(raw);
  const w = stripWake(norm);
  return { raw, wake: w.wake, command: w.rest, query: bestQuery(w.rest).q };
}

/**
 * A mesma frase lida de dois jeitos (como veio e sem as cortesias); vale a leitura em que
 * alguma habilidade tem mais certeza. Assim "pode falar" e "você pode abrir o estoque?"
 * funcionam as duas.
 */
function readings(norm: string): Query[] {
  const trimmed = politeTrim(norm);
  const list = [makeQuery(norm, norm)];
  if (trimmed && trimmed !== norm) list.push(makeQuery(trimmed, trimmed));
  return list;
}

function bestQuery(norm: string, host?: MaxHost): { q: Query; ranked: Ranked[] } {
  const all = readings(norm);
  if (!host) return { q: all[all.length - 1], ranked: [] };
  let best = { q: all[0], ranked: rank(all[0], host) };
  for (const q of all.slice(1)) {
    const r = rank(q, host);
    if ((r[0]?.score ?? 0) > (best.ranked[0]?.score ?? 0)) best = { q, ranked: r };
  }
  return best;
}

/** Melhor habilidade para a frase nesta tela (ou null). */
export function understand(command: string, host: MaxHost): { q: Query; top: Ranked | null } {
  const { q, ranked } = bestQuery(normalize(command), host);
  return { q, top: ranked[0] ?? null };
}

/** Frases-modelo do que a Max sabe fazer nesta tela (ajuda e guia da IA opcional). */
export function examplesFor(host: MaxHost): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of available(host)) for (const e of s.examples ?? []) if (!seen.has(e)) {
    seen.add(e);
    out.push(e);
  }
  return out;
}

export interface RemoteAnswer {
  say?: string;
  text?: string;
  /** frase canônica que a Max local sabe executar (a IA "traduz" o pedido) */
  route?: string;
  source?: string;
}

export interface ThinkOptions {
  memory: MaxMemory;
  /** consulta o servidor (clima, câmbio, IA, Wikipedia). Fora do login. */
  remote?: (text: string, examples: string[]) => Promise<RemoteAnswer | null>;
}

async function runSkill(r: Ranked, q: Query, host: MaxHost, mem: MaxMemory): Promise<MaxReply> {
  try {
    return await r.skill.run(q, host, mem);
  } catch (e) {
    console.error('[max]', r.skill.id, e);
    return { say: 'Tive um problema ao buscar essa informação. Tente de novo em instantes.' };
  }
}

/**
 * Cérebro da Max:
 *  1. habilidades locais (instantâneas, sem custo, funcionam offline);
 *  2. se nenhuma tiver certeza, pergunta ao servidor (clima, câmbio, IA opcional, Wikipedia);
 *     a IA pode devolver uma "rota": o mesmo pedido em palavras que as habilidades entendem;
 *  3. se nada servir, admite e sugere o que sabe fazer.
 */
export async function think(command: string, host: MaxHost, opts: ThinkOptions): Promise<MaxReply> {
  if (!normalize(command)) {
    return { say: 'Estou ouvindo. O que você precisa?', chips: capabilities(host) };
  }
  const { q, top: best } = understand(command, host);
  if (best && best.score >= CONFIDENT) return runSkill(best, q, host, opts.memory);

  if (opts.remote) {
    let ans: RemoteAnswer | null = null;
    try {
      ans = await opts.remote(command, examplesFor(host));
    } catch {
      ans = null;
    }
    if (ans?.route) {
      const routed = understand(hear(ans.route).command, host);
      if (routed.top && routed.top.score >= CONFIDENT) return runSkill(routed.top, routed.q, host, opts.memory);
    }
    if (ans?.say) return { say: ans.say, text: ans.text, source: ans.source };
  }

  // palpite local com menos certeza ainda é melhor do que "não entendi"
  if (best && best.score >= 0.5) return runSkill(best, q, host, opts.memory);

  return {
    say: host.scope === 'login' ? 'Essa eu ainda não sei responder por aqui. Entre com seu usuário e senha, que lá dentro eu ajudo com o seu setor.' : 'Ainda não sei responder isso. Veja alguns pedidos que eu entendo.',
    chips: capabilities(host),
    unknown: true,
  };
}
