/**
 * Bateria de frases da Max: confere se cada pedido cai na habilidade certa.
 * Rodar: npx tsx tests/max-nlu.test.ts
 */
import { hear, think, understand, CONFIDENT } from '../lib/max/engine';
import { getSector } from '../lib/sectors';
import type { MaxHost, MaxMemory } from '../lib/max/types';
import type { HubUser, HubUserRow } from '../lib/permissions';

const user = (over: Partial<HubUser> = {}): HubUser => ({ id: 'u1', username: 'mateus', display_name: 'Mateus Quintanilha', is_master: true, sector: null, sector_role: 'member', permissions: {}, active: true, ...over });
const item = (name: string, size: string | null, quantity: number, min = 0, at_postos = 0) => ({ id: name + size, ref: 1, name, size, unit: 'Cada', quantity, min_quantity: min, cost: 10, at_postos, created_at: '2026-01-01', updated_at: '2026-01-01' });
const items = [
  item('Bota de segurança', '40', 12, 5), item('Bota de segurança', '42', 3, 5), item('Bota de segurança', '44', 0, 5),
  item('Camisa social manga curta', 'G', 40), item('Camisa social manga curta', 'M', 22), item('Calça tática', '44', 9, 10),
  item('Boné', null, 70), item('Cinto tático', null, 15), item('Coturno', '41', 8), item('Colete refletivo', null, 0, 2), item('Rádio comunicador', null, 6),
];
const postos = ['Posto 01', 'Posto 02', 'Shopping Barra', 'Hospital Aliança', 'Condomínio Vila Verde'].map((name, i) => ({ id: 'p' + i, name, code: null, city: null, address: null, supervisor: null, notes: null, created_by: null, created_at: '', items_count: 2, units: 10 + i }));
const requests = [1, 2, 3, 4, 12].map((n, i) => ({ id: 'r' + n, protocol: n, email: 'a@b.c', collaborator: 'Fulano ' + n, posto: 'Posto 01', answers: [], attachments: [], status: (['nova', 'pendente', 'resolvida'] as const)[i % 3], handled_by: null, created_at: `2026-10-0${i + 1}T10:00:00Z`, updated_at: '' }));
const rows: HubUserRow[] = [
  { ...user(), created_at: '', last_login_at: null },
  { ...user({ id: 'u2', username: 'neilton', display_name: 'Neilton', is_master: false, sector: 'almoxarifado', sector_role: 'master' }), created_at: '', last_login_at: null },
  { ...user({ id: 'u3', username: 'juliana', display_name: 'Juliana Souza', is_master: false, sector: 'almoxarifado' }), created_at: '', last_login_at: null },
  { ...user({ id: 'u4', username: 'carla', display_name: 'Carla', is_master: false, sector: 'rh' }), created_at: '', last_login_at: null },
];

const ALMOX_TABS = [
  { id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'pedidos', 'caixa de entrada'] },
  { id: 'estoque', label: 'Estoque', aliases: ['estoque', 'itens', 'inventario'] },
  { id: 'postos', label: 'Postos', aliases: ['postos'] },
  { id: 'metricas', label: 'Métricas', aliases: ['metricas', 'relatorios'] },
  { id: 'formulario', label: 'Formulário', aliases: ['formulario', 'editor do formulario'] },
  { id: 'emails', label: 'E-mails autorizados', aliases: ['emails', 'e-mails'] },
  { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time'] },
  { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
];
const base = { tab: 'inicio', goTab: () => undefined, can: () => true, navigate: () => undefined, logout: () => undefined };
const almox: MaxHost = { ...base, scope: 'sector', sector: getSector('almoxarifado'), user: user(), tabs: ALMOX_TABS, almox: { requests: () => requests as never, items: () => items as never, postos: () => postos as never, emailsCount: () => 7 } };
const hub: MaxHost = { ...base, scope: 'hub', sector: null, user: user(), tabs: [{ id: 'setores', label: 'Setores', aliases: ['setores', 'visao geral'] }, { id: 'usuarios', label: 'Usuários', aliases: ['usuarios', 'pessoas'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'senha'] }], hub: { users: () => rows }, almox: almox.almox };
const login: MaxHost = { ...base, scope: 'login', sector: null, user: null, tabs: [] };
const rh: MaxHost = { ...base, scope: 'sector', sector: getSector('rh'), user: user({ is_master: false, sector: 'rh' }), tabs: [{ id: 'inicio', label: 'Início', aliases: ['inicio'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'senha'] }] };

type Case = [MaxHost, string, string | null];
const CASES: Case[] = [
  // login
  [login, 'Max, apresente-se', 'introduce'], [login, 'Max, bom dia', 'greet'], [login, 'boa noite Max', 'greet'], [login, 'Max quem é você', 'introduce'],
  [login, 'Max, que horas são?', 'time'], [login, 'Max que dia é hoje', 'date'], [login, 'Max, como faço para entrar?', 'login-help'], [login, 'Max esqueci minha senha', 'login-help'],
  [login, 'Max, quero fazer uma solicitação', 'open-request-form'], [login, 'Max o que você sabe fazer', 'help'], [login, 'Max, quanto é doze vezes oito', 'calc'],
  [login, 'Max, se apresenta aí', 'introduce'], [login, 'Max, o que é o Max Hub?', 'introduce'], [login, 'Max conta uma piada', 'smalltalk'], [login, 'oi Max', 'greet'],
  [login, 'Max, métricas da semana', null], [login, 'Max obrigado', 'thanks'], [login, 'Max tudo bem?', 'how-are-you'], [login, 'Max, sair', null],
  // almoxarifado
  [almox, 'Max, desejo ver as métricas da última semana', 'almox-metrics'], [almox, 'Max métricas', 'almox-metrics'], [almox, 'Max, como foi o mês?', 'almox-metrics'],
  [almox, 'Max entradas e saídas de hoje', 'almox-metrics'], [almox, 'Max me mostra o relatório do último mês', 'almox-metrics'], [almox, 'Max quantas solicitações chegaram na última semana', 'almox-metrics'],
  [almox, 'Max, tem solicitação nova?', 'almox-request-count'], [almox, 'Max quantos pedidos pendentes', 'almox-request-count'], [almox, 'Max mostrar solicitações resolvidas', 'almox-request-count'],
  [almox, 'Max, abrir a solicitação 12', 'almox-request-open'], [almox, 'Max abre o pedido número quatro', 'almox-request-open'], [almox, 'Max qual foi a última solicitação', 'almox-request-latest'],
  [almox, 'Max, quanto tem de bota 42?', 'almox-stock-lookup'], [almox, 'Max saldo de camisa social', 'almox-stock-lookup'], [almox, 'Max tem boné no estoque?', 'almox-stock-lookup'],
  [almox, 'Max procurar coturno', 'almox-stock-lookup'], [almox, 'Max quantas botas temos', 'almox-stock-lookup'], [almox, 'Max quanto tem de unicórnio no estoque', 'almox-stock-lookup'],
  [almox, 'Max, o que está com estoque baixo?', 'almox-stock-low'], [almox, 'Max quais itens estão zerados', 'almox-stock-low'], [almox, 'Max o que está acabando', 'almox-stock-low'], [almox, 'Max o que precisa repor', 'almox-stock-low'],
  [almox, 'Max, resumo do estoque', 'almox-stock-summary'], [almox, 'Max qual o valor do estoque', 'almox-stock-summary'], [almox, 'Max quantos itens temos no estoque', 'almox-stock-summary'],
  [almox, 'Max, o que tem no posto 01?', 'almox-posto-stock'], [almox, 'Max estoque do posto shopping barra', 'almox-posto-stock'], [almox, 'Max, quantos postos temos?', 'almox-postos-count'],
  [almox, 'Max copiar o link do formulário', 'almox-form-link'], [almox, 'Max quantos e-mails autorizados', 'almox-emails-count'],
  [almox, 'Max, abrir estoque', 'go-tab'], [almox, 'Max ir para postos', 'go-tab'], [almox, 'Max abrir minha conta', 'go-tab'], [almox, 'Max quero trocar minha senha', 'go-tab'], [almox, 'Max estoque', 'go-tab'], [almox, 'Max abre as métricas', 'almox-metrics'],
  [almox, 'Max, abrir o setor financeiro', 'go-sector'], [almox, 'Max voltar ao painel master', 'go-sector'], [almox, 'Max, sair', 'logout'], [almox, 'Max qual é o meu setor', 'whoami'],
  [almox, 'Max, quanto é 15% de 2400', 'calc'], [almox, 'Max bom dia', 'greet'], [almox, 'Max repete', 'repeat'], [almox, 'Max para', 'stop'], [almox, 'Max modo silencioso', 'voice-off'], [almox, 'Max pode falar', 'voice-on'],
  [almox, 'Max quem descobriu o Brasil', null], [almox, 'Max como está o tempo hoje', null], [almox, 'Max qual a cotação do dólar', null], [almox, 'Max me explica o que é ISO 9001', null],
  // painel master
  [hub, 'Max, quantos usuários temos?', 'hub-users-count'], [hub, 'Max, quem está no almoxarifado?', 'hub-users-of-sector'], [hub, 'Max quem é o master do almoxarifado', 'hub-sector-master'],
  [hub, 'Max, criar usuário', 'hub-create-user'], [hub, 'Max novo usuário chamado Pedro Alves no financeiro', 'hub-create-user'], [hub, 'Max, abrir o setor financeiro', 'go-sector'], [hub, 'Max abrir almoxarifado', 'go-sector'],
  [hub, 'Max em que setor está a Juliana', 'hub-find-user'], [hub, 'Max abrir usuários', 'go-tab'], [hub, 'Max quantas pessoas no RH', 'hub-users-of-sector'], [hub, 'Max ir para recursos humanos', 'go-sector'],
  [hub, 'Max quais setores existem', 'hub-users-count'], [hub, 'Max métricas', 'hub-users-count'],
  // o master pede dados do almoxarifado sem sair do painel master
  [hub, 'Max Me apresente as métricas da última semana do almoxarifado', 'almox-metrics'], [hub, 'Max métricas do almoxarifado', 'almox-metrics'], [hub, 'Max como foi o mês no almoxarifado', 'almox-metrics'],
  [hub, 'Max me mostre as métricas do almoxarifado de hoje', 'almox-metrics'], [hub, 'Max o que está com estoque baixo', 'almox-stock-low'], [hub, 'Max quanto tem de bota 42', 'almox-stock-lookup'],
  [hub, 'Max tem solicitação nova', 'almox-request-count'], [hub, 'Max quantos postos temos', 'almox-postos-count'], [hub, 'Max resumo do estoque', 'almox-stock-summary'],
  [hub, 'Max apresente-se', 'introduce'], [hub, 'Max se apresente', 'introduce'], [hub, 'Max apresente', 'introduce'], [hub, 'Max abrir o almoxarifado', 'go-sector'],
  [hub, 'Max quantos usuários temos no setor financeiro', 'hub-users-of-sector'], [hub, 'Max Quantos usuários temos no setor Financeiro?', 'hub-users-of-sector'], [hub, 'Max quantos usuários tem no financeiro', 'hub-users-of-sector'], [hub, 'Max quantos usuários há no setor de recursos humanos', 'hub-users-of-sector'],
  [hub, 'Max quantas pessoas trabalham no comercial', 'hub-users-of-sector'], [hub, 'Max usuários do setor operacional', 'hub-users-of-sector'], [hub, 'Max me mostre os usuários do financeiro', 'hub-users-of-sector'], [hub, 'Max tem alguém no financeiro', 'hub-users-of-sector'],
  [hub, 'Max quantos funcionários o financeiro tem', 'hub-users-of-sector'], [hub, 'Max me diga quantos usuários existem no setor financeiro', 'hub-users-of-sector'], [hub, 'Max quantos estão no almoxarifado', 'hub-users-of-sector'],
  [hub, 'Max métricas do financeiro', 'hub-sector-not-ready'], [hub, 'Max me apresente o relatório do RH', 'hub-sector-not-ready'], [hub, 'Max quantas solicitações pendentes no almoxarifado', 'almox-request-count'],
  [login, 'Max, apresente-se a todos da sala, por favor', 'introduce'], [login, 'Max se apresente para todos', 'introduce'], [login, 'Max apresente se', 'introduce'], [login, 'Max se apresenta pra galera', 'introduce'],
  [almox, 'Max me apresente as métricas da última semana', 'almox-metrics'], [almox, 'Max apresente o relatório do mês', 'almox-metrics'], [almox, 'Max me apresenta o estoque baixo', 'almox-stock-low'],
  [rh, 'Max me apresente as métricas da semana', 'sector-not-ready'], [login, 'Max, pode se apresentar?', 'introduce'], [login, 'Max apresente-se por favor', 'introduce'],
  // perguntas sobre o que aconteceu em um período (não é o retrato de agora)
  [hub, 'Max quantos itens saíram do estoque do almoxarifado nas últimas 15 horas', 'almox-moves'], [almox, 'Max quantos itens saíram nas últimas 15 horas', 'almox-moves'], [almox, 'Max o que saiu do estoque hoje', 'almox-moves'],
  [almox, 'Max quantas botas saíram ontem', 'almox-moves'], [almox, 'Max o que entrou no estoque essa semana', 'almox-moves'], [almox, 'Max quantas unidades foram enviadas aos postos nos últimos três dias', 'almox-moves'],
  [almox, 'Max quais itens mais saíram no mês passado', 'almox-moves'], [almox, 'Max teve saída de colete hoje', 'almox-moves'], [almox, 'Max quantas camisas entraram e saíram esta semana', 'almox-moves'],
  [almox, 'Max métricas das últimas 15 horas', 'almox-metrics'], [almox, 'Max como foi ontem', 'almox-metrics'], [almox, 'Max entradas e saídas dos últimos 3 dias', 'almox-metrics'], [almox, 'Max quantos itens temos no estoque', 'almox-stock-summary'],
  [almox, 'Max quantas solicitações recebemos na semana passada', 'almox-metrics'], [hub, 'Max quantas unidades saíram do almoxarifado ontem', 'almox-moves'], [rh, 'Max quantos itens saíram ontem', null],
  // sair da conta dito de qualquer jeito
  [almox, 'Max deslog da minha conta e me leve diretamente para a tela de login por favor', 'logout'], [hub, 'Max deslog da minha conta e me leve diretamente para a tela de login por favor', 'logout'], [almox, 'Max me desloga', 'logout'],
  [almox, 'Max quero sair da minha conta', 'logout'], [almox, 'Max faz logout pra mim', 'logout'], [almox, 'Max me leva para a tela de login', 'logout'], [almox, 'Max encerre minha sessão por favor', 'logout'], [rh, 'Max desconectar', 'logout'],
  [almox, 'Max abrir minha conta', 'go-tab'], [almox, 'Max quero trocar a senha da minha conta', 'go-tab'], [almox, 'Max o que saiu', 'almox-moves'], [almox, 'Max sair', 'logout'],
  // baixar o arquivo das métricas
  [hub, 'Max, desejo baixar as métricas do almoxarifado', 'download-metrics'], [almox, 'Max, desejo baixar as métricas', 'download-metrics'], [almox, 'Max baixe a planilha das métricas do último mês', 'download-metrics'],
  [hub, 'Max desejo baixar as métricas do financeiro', 'download-metrics'], [rh, 'Max quero baixar as métricas de recursos humanos', 'download-metrics'], [almox, 'Max me envie o gráfico das métricas', 'download-metrics'],
  [almox, 'Max exportar relatório em excel', 'download-metrics'], [hub, 'Max baixar métricas', 'download-metrics'], [almox, 'Max fazer download do gráfico de hoje', 'download-metrics'],
  [almox, 'Max métricas da última semana', 'almox-metrics'], [almox, 'Max o que está com estoque baixo', 'almox-stock-low'],
  // setor ainda vazio
  [rh, 'Max, desejo ver as métricas da última semana', 'sector-not-ready'], [rh, 'Max abrir o setor financeiro', null], [rh, 'Max minha conta', 'go-tab'], [rh, 'Max que horas são', 'time'],
];

let fail = 0;
for (const [host, phrase, expected] of CASES) {
  const h = hear(phrase);
  const top = understand(h.command, host).top;
  const got = top && top.score >= CONFIDENT ? top.skill.id : null;
  if (got !== expected || h.wake !== 'strong') {
    fail++;
    console.log(`FALHOU  [${host.scope}/${host.sector?.slug ?? '-'}] "${phrase}" → ${got} (${top?.score ?? 0}) · esperado ${expected} · wake=${h.wake} · cmd="${h.command}"`);
  }
}

// respostas completas (sem rede): não podem lançar erro nem voltar vazias
const mem: MaxMemory = { last: null, lastInput: '', voiceOn: true, setVoice: () => undefined };
(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
  if (String(url).includes('/metrics/range')) {
    return { ok: true, json: async () => ({ from: '', to: '', totals: { in: 5, out: 11, inMoves: 1, outMoves: 3, itemsIn: 1, itemsOut: 3, toPostos: 6, returned: 0, consumed: 0, adjustments: 0 }, items: [{ name: 'Camisa social manga curta · G', in: 0, out: 6 }, { name: 'Calça tática · 44', in: 5, out: 0 }, { name: 'Camisa social manga curta · M', in: 0, out: 3 }, { name: 'Bota de segurança · 42', in: 0, out: 2 }], postos: [{ name: 'Shopping Barra', received: 6 }], requests: { total: 2, nova: 2, pendente: 0, resolvida: 0 }, truncated: false }) };
  }
  return { ok: false, json: async () => ({ error: 'sem rede no teste' }) };
};
(async () => {
  for (const [host, phrase] of CASES) {
    const r = await think(hear(phrase).command, host, { memory: mem });
    if (typeof r.say !== 'string' || (!r.say && !r.text)) {
      fail++;
      console.log('RESPOSTA VAZIA', phrase, r);
    }
    if (/undefined|NaN|\[object/.test(r.say + (r.text ?? '') + JSON.stringify(r.card ?? ''))) {
      fail++;
      console.log('RESPOSTA COM LIXO', phrase, r.say, r.text);
    }
  }
  // segunda opinião da IA: só em frase longa com pouca certeza local
  {
    let calls = 0;
    let route: string | null = 'Max, sair';
    const remote = async (_t: string, _e: string[], mode?: 'route') => {
      calls++;
      if (mode !== 'route') return null;
      return route ? { route } : null;
    };
    const long = 'abrir aquela parte da minha conta onde fica tudo isso';
    const check = (name: string, ok: boolean) => {
      if (!ok) {
        fail++;
        console.log('FALHOU segunda opinião:', name);
      }
    };
    let r = await think(long, almox, { memory: mem, remote });
    check('IA corrige o palpite local', /Encerrando a sua sessão/.test(r.say) && calls === 1);
    route = null;
    r = await think(long, almox, { memory: mem, remote });
    check('sem resposta da IA, vale o palpite local', /Minha conta/.test(r.say));
    route = 'Max, frase que nenhuma habilidade entende xyz';
    r = await think(long, almox, { memory: mem, remote });
    check('rota inválida da IA é ignorada', /Minha conta/.test(r.say));
    calls = 0;
    await think('abrir minha conta', almox, { memory: mem, remote });
    await think('quantos itens saíram do estoque do almoxarifado nas últimas 15 horas', almox, { memory: mem, remote });
    check('frase curta ou com certeza não consulta a IA', calls === 0);
  }
  // agente: alterações com confirmação, e quando ele é (ou não) chamado
  {
    const check = (name: string, ok: boolean, extra?: unknown) => {
      if (!ok) {
        fail++;
        console.log('FALHOU agente:', name, extra ?? '');
      }
    };
    const calls: string[] = [];
    const done: { url: string; method?: string; body?: string }[] = [];
    let apiOk = true;
    const prevFetch = (globalThis as { fetch: unknown }).fetch;
    (globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; body?: string }) => {
      if (!String(url).includes('/metrics')) done.push({ url: String(url), method: init?.method, body: init?.body });
      if (String(url).includes('/metrics')) return { ok: false, json: async () => ({ error: 'sem rede no teste' }) };
      return { ok: apiOk, json: async () => (apiOk ? { ok: true } : { error: 'Saldo insuficiente.' }) };
    };
    const pending = [{ method: 'POST' as const, path: '/api/almoxarifado/stock/move', body: { item_id: 'x', kind: 'saida', quantity: 5 }, what: 'saída de 5 unidades de Boné' }];
    const agent = async (text: string) => {
      calls.push(text);
      if (/bon[eé]s/.test(text)) return { say: 'Vou registrar: saída de 5 unidades de Boné. Confirma?', pending, source: 'ia' };
      if (/capital/.test(text)) return { say: 'Canberra.', source: 'ia' };
      if (/parada/.test(text)) return { route: 'Max, métricas do último mês', source: 'ia' };
      if (/limite/.test(text)) return { source: 'limite' };
      return { source: 'nenhuma' };
    };
    const m2: MaxMemory = { last: null, lastInput: '', voiceOn: true, setVoice: () => undefined };
    const t = (p: string) => think(hear(p).command || p, almox, { memory: m2, agent });
    let r = await t('Max, registre a saída de 5 bonés');
    check('pedido de alteração vai ao agente e pede confirmação', /Confirma\?/.test(r.say) && m2.pending?.length === 1 && done.length === 0, r);
    r = await t('sim, pode confirmar');
    check('"sim" executa pela rota normal do sistema', r.say === 'Pronto: saída de 5 unidades de Boné.' && done.length === 1 && done[0].url === '/api/almoxarifado/stock/move' && done[0].method === 'POST' && !m2.pending, [r, done]);
    await t('Max, registre a saída de 5 bonés');
    r = await t('não, cancela');
    check('"não" descarta', r.say === 'Tudo bem, não alterei nada.' && done.length === 1 && !m2.pending, r);
    await t('Max, registre a saída de 5 bonés');
    r = await t('Max, que horas são');
    check('mudar de assunto descarta a alteração', /Agora são/.test(r.say) && !m2.pending && done.length === 1, r);
    r = await t('sim');
    check('"sim" solto depois disso não executa nada', done.length === 1, r);
    apiOk = false;
    await t('Max, registre a saída de 5 bonés');
    r = await t('confirmo');
    check('erro do sistema é dito à pessoa', /Não consegui registrar: saída de 5 unidades de Boné\. Saldo insuficiente\./.test(r.say), r);
    apiOk = true;
    r = await t('Max, qual é a capital da Austrália');
    check('pergunta geral vai ao agente', r.say === 'Canberra.', r);
    r = await t('Max, como é que tá a parada toda desse mês aí');
    check('agente devolve um comando da tela', /No último mês|métricas/i.test(r.say), r);
    calls.length = 0;
    await t('Max, abrir estoque');
    await t('Max, quanto tem de bota 42');
    await t('Max, desative a voz');
    await t('Max, sair');
    await t('Max, quero trocar minha senha');
    check('comandos claros continuam locais (sem gastar a IA)', calls.length === 0, calls);
    await t('Max, marque a solicitação 12 como resolvida');
    check('"marque a solicitação 12 como resolvida" vai ao agente (não só abre)', calls.length === 1, calls);
    r = await t('Max, me explique o limite disso');
    check('limite da IA: avisa', /limite de uso/.test(r.say), r);
    r = await think('vai tomar no cu', almox, { memory: m2, agent });
    check('palavrão é barrado antes de tudo', /conversa profissional/.test(r.say), r);
    (globalThis as { fetch: unknown }).fetch = prevFetch;
  }
  const show = async (host: MaxHost, p: string) => console.log(`\n> ${p}\n  ${(await think(hear(p).command, host, { memory: mem })).say}`);
  if (process.argv.includes('--show')) {
    await show(hub, 'Max quantos itens saíram do estoque do almoxarifado nas últimas 15 horas'); await show(almox, 'Max o que entrou no estoque ontem'); await show(almox, 'Max quantas botas saíram ontem'); await show(almox, 'Max quantas camisas saíram esta semana'); await show(almox, 'Max quantos coturnos saíram hoje'); await show(almox, 'Max métricas das últimas 15 horas'); await show(almox, 'Max o que saiu'); await show(almox, 'Max deslog da minha conta e me leve diretamente para a tela de login por favor');
    await show(hub, 'Max desejo baixar as métricas do financeiro'); await show(rh, 'Max quero baixar as métricas'); await show(hub, 'Max baixar métricas'); await show({ ...rh, user: user({ is_master: false, sector: 'rh' }) }, 'Max baixar as métricas do almoxarifado');
    await show(login, 'Max, apresente-se'); await show(login, 'Max, bom dia'); await show(login, 'Max boa noite'); await show(almox, 'Max, quanto tem de bota 42?');
    await show(almox, 'Max quantas botas temos'); await show(almox, 'Max, o que está com estoque baixo?'); await show(almox, 'Max, resumo do estoque'); await show(almox, 'Max tem solicitação nova?');
    await show(almox, 'Max qual foi a última solicitação'); await show(hub, 'Max, quantos usuários temos?'); await show(hub, 'Max em que setor está a Juliana'); await show(hub, 'Max novo usuário chamado Pedro Alves no financeiro');
    await show(rh, 'Max, desejo ver as métricas da última semana'); await show(almox, 'Max quem descobriu o Brasil'); await show(almox, 'Max, quantos postos temos?'); await show(almox, 'Max que horas são');
  }
  console.log(fail ? `\n${fail} falha(s) em ${CASES.length} frases` : `\nOK: ${CASES.length} frases`);
  process.exit(fail ? 1 : 0);
})();
