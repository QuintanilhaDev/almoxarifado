import { almoxSkills } from './skills-almox';
import { capabilities, coreSkills } from './skills-core';
import { emptySectorSkills, hubSkills } from './skills-hub';
import { makeQuery, normalize, stripWake, tokenize, wantsChange, type Query } from './text';
export { wantsChange };
import { BLOCKED_REPLY, isBlocked } from './moderation';
import type { MaxHost, MaxMemory, MaxReply, PendingAction, Skill } from './types';
import { gaveUp, recall, type Learned } from './learn';

const ALL: Skill[] = [...coreSkills, ...almoxSkills, ...hubSkills, ...emptySectorSkills];

/** Abaixo disto a Max não tem certeza e passa a pergunta adiante (IA/Wikipedia) ou admite que não sabe. */
export const CONFIDENT = 0.6;
/** A partir disto a habilidade local responde direto, sem pedir segunda opinião à IA. */
export const SURE = 0.9;
const LONG_PHRASE = 7;
/**
 * Em frase longa as palavras-chave enganam mais ("quem é o supervisor do posto 01" tem "posto 01",
 * mas não quer o estoque do posto). Havendo IA, ela confere o sentido; a leitura local vai como pista
 * e continua valendo se a IA falhar, desistir ou estiver no limite.
 */
const LONG_SURE = 0.95;
const sureFor = (tokens: number) => (tokens >= LONG_PHRASE ? LONG_SURE : SURE);

function available(host: MaxHost): Skill[] {
  return ALL.filter((s) => {
    if (s.scopes && !s.scopes.includes(host.scope)) return false;
    if (s.sector && host.sector?.slug !== s.sector) {
      // no painel master, o master geral também consulta os dados dos setores
      const fromHub = host.scope === 'hub' && Boolean(host.user?.is_master) && s.sector === 'almoxarifado' && Boolean(host.almox);
      if (!fromHub) return false;
    }
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


/** Resposta do agente (IA com ferramentas) do servidor. */
export interface AgentAnswer {
  say?: string;
  text?: string;
  route?: string;
  pending?: PendingAction[];
  source?: string;
  /** a IA disse que não sabe/não consegue */
  gaveUp?: boolean;
}

/** Comandos locais que continuam valendo mesmo quando a frase tem verbo de ação ("desative a voz", "trocar minha senha"). */
const SAFE_LOCAL = new Set(['stop', 'repeat', 'voice-off', 'voice-on', 'logout', 'go-tab', 'go-sector', 'hub-create-user', 'calc', 'almox-form-link', 'download-metrics', 'say-hello']);

/** comandos que nunca são disparados pela memória (a pessoa precisa pedir com clareza) */
const NO_RECALL = new Set(['logout', 'stop', 'bye', 'voice-off', 'voice-on', 'say-hello', 'go-sector', 'hub-create-user']);

const YES_RE = /^(sim|s|isso|isso mesmo|confirm\w*|pode|pode sim|pode fazer|pode confirmar|pode registrar|ok|okay|certo|claro|com certeza|positivo|manda|manda ver|faz|faca|execute|exato|correto|bora|vai|afirmativo|autorizo|autorizado)( sim| pode| confirmar| confirmo| confirmado| por favor| max| isso| faz| manda)*$/;
const NO_RE = /^(nao|n|cancel\w*|deixa|deixa pra la|esquece|esqueca|negativo|para|pare|melhor nao|errado|nada|desist\w*)\b/;

/** Executa as alterações confirmadas, chamando as rotas normais do sistema (com as permissões de quem está logado). */
async function executePending(list: PendingAction[]): Promise<MaxReply> {
  const done: string[] = [];
  for (const a of list) {
    if (!/^\/api\/(almoxarifado|hub|setor)\//.test(a.path) && a.path !== '/api/max/memoria') continue; // só rotas internas conhecidas
    let error = '';
    try {
      const r = await fetch(a.path, {
        method: a.method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: a.body ? { 'Content-Type': 'application/json' } : undefined,
        body: a.body ? JSON.stringify(a.body) : undefined,
      });
      if (!r.ok) error = String(((await r.json().catch(() => ({}))) as { error?: string }).error || 'O sistema recusou a alteração.');
    } catch {
      error = 'Sem conexão com o servidor.';
    }
    if (error) {
      return { say: `${done.length ? `Fiz ${done.length === 1 ? 'uma parte' : `${done.length} partes`}, mas parei em: ` : 'Não consegui registrar: '}${a.what}. ${error}`, source: 'ia' };
    }
    done.push(a.what);
  }
  if (!done.length) return { say: 'Não havia nada para registrar.' };
  return { say: `Pronto: ${done.join('; ')}.`, source: 'ia' };
}

export interface ThinkOptions {
  memory: MaxMemory;
  /** a frase original, como foi ouvida/digitada (o `command` chega sem acentos nem maiúsculas) */
  raw?: string;
  /** agente do servidor: IA com ferramentas (consulta, altera com confirmação, pesquisa na web). Só para quem está logado. */
  agent?: (text: string, examples: string[], hint?: string) => Promise<AgentAnswer | null>;
  /** comandos que a Max já aprendeu com o uso (pedido muito parecido é atendido na hora, sem IA) */
  learned?: Learned[];
  /** avisa o servidor: pedido não entendido, ou um aprendizado que não funcionou */
  report?: (e: { type: 'falha'; reason: 'nao_entendeu' | 'desistiu'; answer?: string } | { type: 'feedback'; good: false }) => void;
  /**
   * consulta o servidor (clima, câmbio, IA, Wikipédia).
   * mode 'route' = só pede à IA para dizer qual comando a frase quer (segunda opinião).
   */
  remote?: (text: string, examples: string[], mode?: 'route') => Promise<RemoteAnswer | null>;
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
  const mem = opts.memory;
  mem.heard = opts.raw ?? command;
  if (isBlocked(command)) {
    mem.pending = null;
    return { say: BLOCKED_REPLY, source: 'bloqueio' };
  }
  // havia uma alteração esperando o "sim"?
  if (mem.pending?.length) {
    const waiting = mem.pending;
    const answer = normalize(command);
    mem.pending = null;
    if (YES_RE.test(answer)) return executePending(waiting);
    if (NO_RE.test(answer)) return { say: 'Tudo bem, não alterei nada.' };
    // mudou de assunto: a alteração é descartada e o novo pedido segue normalmente
  }

  const { q, top: best } = understand(command, host);
  // tamanho do pedido sem as cortesias ("por favor", "você pode…"): elas não tornam a frase mais difícil
  const words = Math.min(q.tokens.length, tokenize(politeTrim(q.norm)).length || q.tokens.length);

  // Memória: um pedido praticamente igual já foi resolvido antes por um comando da tela.
  if (opts.learned?.length && !(best && best.score >= sureFor(words)) && !wantsChange(q.norm)) {
    const hit = recall(command, opts.learned);
    if (hit) {
      const routed = understand(hear(hit.route).command, host);
      if (routed.top && routed.top.score >= CONFIDENT && !NO_RECALL.has(routed.top.skill.id)) {
        const r = await runSkill(routed.top, routed.q, host, mem);
        return { ...r, source: r.source ?? 'memoria' };
      }
    }
  }

  // Agente (IA com ferramentas): entra quando o pedido é de alteração, quando nenhuma habilidade
  // local entende, ou quando a frase é longa e a habilidade local não tem tanta certeza.
  let agentTried = false;
  if (opts.agent) {
    const safeLocal = Boolean(best && SAFE_LOCAL.has(best.skill.id) && best.score >= 0.8);
    // comando de tela reconhecido com clareza (abrir setor, trocar de aba, sair, baixar…) é da Max local:
    // a IA não executa nada na tela e só atrapalharia
    const clearAction = Boolean(best && SAFE_LOCAL.has(best.skill.id) && best.score >= SURE);
    const go = wantsChange(q.norm) ? !safeLocal : !best || best.score < CONFIDENT || (!clearAction && best.score < LONG_SURE && words >= LONG_PHRASE);
    if (go) {
      agentTried = true;
      let ans: AgentAnswer | null = null;
      try {
        ans = await opts.agent(command, examplesFor(host), best && best.score >= 0.5 ? best.skill.examples?.[0] : undefined);
      } catch {
        ans = null;
      }
      if (ans?.pending?.length) {
        mem.pending = ans.pending;
        return { say: ans.say || 'Confirma?', chips: ['Sim, confirmar', 'Cancelar'], source: 'ia' };
      }
      if (ans?.route) {
        const routed = understand(hear(ans.route).command, host);
        if (routed.top && routed.top.score >= CONFIDENT) return runSkill(routed.top, routed.q, host, mem);
        opts.report?.({ type: 'feedback', good: false }); // a IA apontou um comando que não existe: desaprende
      }
      if (ans?.say) {
        if (!(ans.gaveUp || gaveUp(ans.say))) return { say: ans.say, text: ans.text, source: ans.source };
        // a IA desistiu, mas a leitura local tem um palpite: ele vale mais do que um "não sei"
        if (best && best.score >= 0.5) return runSkill(best, q, host, mem);
        return { say: ans.say, text: ans.text, source: ans.source, chips: capabilities(host), unknown: true };
      }
      if (ans?.source === 'limite' && !(best && best.score >= CONFIDENT)) {
        return { say: 'A inteligência artificial atingiu o limite de uso por agora. Tente de novo em um minuto; os comandos prontos continuam funcionando.', chips: capabilities(host), unknown: true };
      }
    }
  }

  if (best && best.score >= CONFIDENT) {
    // Frase longa em que a habilidade local não tem tanta certeza: palavras-chave soltas enganam
    // ("deslogar da minha conta" tem "minha conta"). Se houver IA configurada, ela confere o pedido.
    if (opts.remote && !agentTried && best.score < SURE && words >= LONG_PHRASE) {
      let second: RemoteAnswer | null = null;
      try {
        second = await opts.remote(command, examplesFor(host), 'route');
      } catch {
        second = null;
      }
      if (second?.route) {
        const routed = understand(hear(second.route).command, host);
        if (routed.top && routed.top.score >= CONFIDENT && routed.top.skill.id !== best.skill.id) return runSkill(routed.top, routed.q, host, opts.memory);
      }
    }
    return runSkill(best, q, host, opts.memory);
  }

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

  opts.report?.({ type: 'falha', reason: 'nao_entendeu' });
  return {
    say: host.scope === 'login' ? 'Essa eu ainda não sei responder por aqui. Entre com seu usuário e senha, que lá dentro eu ajudo com o seu setor.' : 'Ainda não sei responder isso. Veja alguns pedidos que eu entendo.',
    chips: capabilities(host),
    unknown: true,
  };
}
