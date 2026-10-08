/**
 * Agente da Max (IA com ferramentas), com a IA simulada e o banco de mentira.
 * Rodar: npx tsx --conditions=react-server tests/max-agent.test.ts
 */
import { spawn } from 'node:child_process';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54399';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJteste';
process.env.MAX_LLM_API_KEY = 'k';
process.env.MAX_LLM_BASE_URL = 'https://api.groq.com/openai/v1';
process.env.MAX_LLM_MODEL = 'openai/gpt-oss-120b';

let fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) fail++;
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : JSON.stringify(extra)?.slice(0, 400));
};

type Msg = { role: string; content: string | null; tool_calls?: unknown[] };
type Body = { messages: Msg[]; tools?: { type: string; function?: { name: string } }[]; tool_choice?: string };
let script: ((b: Body) => unknown)[] = [];
let sent: Body[] = [];
let status = 200;
const realFetch = globalThis.fetch;
(globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('chat/completions')) {
    const body = JSON.parse(String(init?.body)) as Body;
    sent.push(body);
    if (status !== 200) return { ok: false, status, text: async () => 'limite', json: async () => ({}) };
    const next = script.shift();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: next ? next(body) : { role: 'assistant', content: '' } }] }) };
  }
  if (u.includes('open-meteo')) return { ok: true, status: 200, json: async () => ({ current: { temperature_2m: 28, apparent_temperature: 30, weather_code: 1, relative_humidity_2m: 70 }, daily: { temperature_2m_max: [30, 29], temperature_2m_min: [24, 23], precipitation_probability_max: [10, 20], weather_code: [1, 2] } }) };
  return realFetch(url, init);
};
const call = (name: string, args: object) => () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const say = (content: string) => () => ({ role: 'assistant', content });
const toolNames = (b: Body) => (b.tools ?? []).map((t) => t.function?.name ?? t.type);
const lastTool = (b: Body) => String(b.messages[b.messages.length - 1].content);

(async () => {
  const db = spawn('node', ['tests/mock-supabase.mjs', '54399'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  try {
    const { runAgent } = await import('../lib/max/server/agent');
    const { listUsers } = await import('../lib/auth');
    const { isBlocked } = await import('../lib/max/moderation');
    const users = await listUsers();
    const who = (n: string) => users.find((u) => u.username === n)!;
    const EX = ['Max, métricas da última semana', 'Max, sair'];
    const run = (u: string, text: string, steps: ((b: Body) => unknown)[], scope: 'hub' | 'sector' = 'sector', sector: string | null = 'almoxarifado') => {
      script = steps;
      sent = [];
      status = 200;
      return runAgent(who(u), { text, scope, sector, examples: EX, history: [] });
    };

    console.log('ferramentas conforme a permissão');
    await run('juliana', 'oi', [say('Olá!')]);
    let names = toolNames(sent[0]);
    ok('Juliana (só visualiza o estoque) não recebe ferramentas de alterar estoque nem de usuários', !names.includes('estoque_movimentar') && !names.includes('item_cadastrar') && !names.includes('usuario_criar') && names.includes('estoque_consultar') && names.includes('solicitacao_atualizar'), names);
    await run('carla', 'oi', [say('Olá!')], 'sector', 'rh');
    names = toolNames(sent[0]);
    ok('Carla (RH) não enxerga nada do almoxarifado', !names.some((n) => /estoque|solicitac|posto|item|email|usuario/.test(n)) && names.includes('permissao_definir') && names.includes('pesquisar_web'), names);
    await run('mateus', 'oi', [say('Olá!')], 'hub', null);
    names = toolNames(sent[0]);
    ok('master geral recebe tudo', ['estoque_movimentar', 'usuario_criar', 'usuario_excluir', 'permissao_definir', 'comando_max', 'pesquisar_web'].every((n) => names.includes(n)), names);
    let r = await run('juliana', 'tire 5 bonés', [call('estoque_movimentar', { item: 'boné', tipo: 'saida', quantidade: 5 }), say('Você não tem permissão.')]);
    ok('ferramenta que a pessoa não tem é recusada mesmo se a IA tentar', !r.pending && /inexistente ou sem permissão/.test(lastTool(sent[1])), r);

    console.log('alterações viram ações pendentes (nada é gravado aqui)');
    r = await run('neilton', 'registre a saída de 5 bonés', [call('estoque_movimentar', { item: 'boné', tipo: 'saida', quantidade: 5 })]);
    ok('saída de estoque', r.pending?.length === 1 && r.pending[0].path === '/api/almoxarifado/stock/move' && r.pending[0].body?.kind === 'saida' && r.pending[0].body?.quantity === 5 && r.say === 'Vou registrar: saída de 5 unidades de Boné. Confirma?' && sent.length === 1, r);
    r = await run('neilton', 'envie 2 botas 40 para o shopping barra', [call('estoque_movimentar', { item: 'bota 40', tipo: 'enviar_posto', quantidade: 2, posto: 'shopping barra' })]);
    ok('envio a posto resolve item e posto', r.pending?.[0].body?.kind === 'transferencia' && Boolean(r.pending?.[0].body?.posto_id) && /envio ao posto Shopping Barra de 2 unidades de Bota de segurança 40/.test(r.say ?? ''), r);
    r = await run('neilton', 'dê entrada de 10 bonés e 4 cintos', [() => ({ role: 'assistant', content: null, tool_calls: [{ id: 'a', function: { name: 'estoque_movimentar', arguments: '{"item":"boné","tipo":"entrada","quantidade":10}' } }, { id: 'b', function: { name: 'estoque_movimentar', arguments: '{"item":"cinto","tipo":"entrada","quantidade":4}' } }] })]);
    ok('duas ações no mesmo pedido', r.pending?.length === 2 && /Vou registrar 2 ações/.test(r.say ?? ''), r);
    r = await run('neilton', 'tire 3 botas', [call('estoque_movimentar', { item: 'bota', tipo: 'saida', quantidade: 3 }), say('Qual tamanho: 40, 42 ou 44?')]);
    ok('item ambíguo: a IA recebe as opções e pergunta', !r.pending && /mais de um cadastro: (Bota de segurança 4[024](; )?){3}\./.test(lastTool(sent[1])) && r.say === 'Qual tamanho: 40, 42 ou 44?', lastTool(sent[1]));
    r = await run('neilton', 'tire 10 botas 42', [call('estoque_movimentar', { item: 'bota 42', tipo: 'saida', quantidade: 10 }), say('Só há 3.')]);
    ok('saída maior que o saldo é barrada antes de confirmar', !r.pending && /Só há 3 de Bota de segurança 42/.test(lastTool(sent[1])), lastTool(sent[1]));
    r = await run('neilton', 'tire uns bonés', [call('estoque_movimentar', { item: 'boné', tipo: 'saida' }), say('Quantos?')]);
    ok('sem quantidade: pergunta em vez de chutar', !r.pending && /Faltou a quantidade/.test(lastTool(sent[1])), r);
    r = await run('neilton', 'resolva a 3', [call('solicitacao_atualizar', { numero: 3, status: 'resolvida' })]);
    ok('status de solicitação', r.pending?.[0].method === 'PATCH' && /requests\//.test(r.pending[0].path) && /solicitação 3 \(Caio Melo\) marcada como resolvida/.test(r.say ?? ''), r);
    r = await run('neilton', 'apague o item colete', [call('item_excluir', { item: 'colete refletivo' })]);
    ok('exclusão avisa em destaque', r.pending?.[0].method === 'DELETE' && /EXCLUSÃO do item Colete refletivo/.test(r.say ?? ''), r);

    console.log('usuários e permissões');
    r = await run('mateus', 'passe a juliana para o financeiro', [call('usuario_alterar', { usuario: 'juliana', setor: 'financeiro' })], 'hub', null);
    ok('trocar setor', r.pending?.[0].path === `/api/hub/users/${who('juliana').id}` && r.pending[0].body?.sector === 'financeiro' && /Juliana Souza \(@juliana\): setor Financeiro/.test(r.say ?? ''), r);
    r = await run('mateus', 'crie o usuário', [call('usuario_criar', { nome: 'Rita Lopes', usuario: 'rita' }), say('Qual senha?')], 'hub', null);
    ok('criar usuário sem senha: pergunta', !r.pending && /Faltou a senha/.test(lastTool(sent[1])), r);
    r = await run('neilton', 'deixe a juliana editar o estoque', [call('permissao_definir', { usuario: 'juliana', modulo: 'Estoque', nivel: 'edit' })]);
    const perms = r.pending?.[0].body?.permissions as Record<string, string> | undefined;
    ok('master do setor define permissão (mantendo as outras)', r.pending?.[0].path === `/api/setor/almoxarifado/equipe/${who('juliana').id}` && perms?.estoque === 'edit' && perms?.solicitacoes === 'edit' && perms?.postos === 'none', r);
    r = await run('neilton', 'crie um usuário', [call('usuario_criar', { nome: 'X Y', usuario: 'xyz', senha: '123456' }), say('Sem permissão.')]);
    ok('master do setor não cria usuário', !r.pending, r);

    console.log('consultas, comandos e web');
    r = await run('neilton', 'qual o saldo de camisa social', [call('estoque_consultar', { termo: 'camisa social' }), say('G tem 40 e M tem 22.')]);
    ok('consulta volta para a IA redigir', r.say === 'G tem 40 e M tem 22.' && /"saldo":40/.test(lastTool(sent[1])) && sent.length === 2, lastTool(sent[1]));
    r = await run('neilton', 'quanto temos de EPI', [call('estoque_consultar', { categoria: 'epis' }), say('São 4 itens.')]);
    ok('consulta por categoria', /"categoria":"EPI"/.test(lastTool(sent[1])) && /"itens_cadastrados":4/.test(lastTool(sent[1])), lastTool(sent[1]));
    r = await run('neilton', 'resumo', [call('estoque_consultar', {}), say('ok')]);
    ok('resumo geral lista as categorias', /"categorias":\[\{"categoria":"Max Forte","itens":5\}/.test(lastTool(sent[1])), lastTool(sent[1]));
    r = await run('neilton', 'itens de xpto', [call('estoque_consultar', { categoria: 'xpto' }), say('Não existe.')]);
    ok('categoria que não existe é avisada', /Não há itens na categoria .{0,3}xpto/.test(lastTool(sent[1])), lastTool(sent[1]));
    r = await run('neilton', 'o cinto tático também é Max Forte', [call('item_categorias', { item: 'cinto tático', adicionar: 'max forte' })]);
    ok('categoria: soma à que já existe e pede confirmação', r.pending?.length === 1 && r.pending[0].method === 'PATCH' && JSON.stringify(r.pending[0].body) === '{"categories":["Max Forte","Acessório"]}' && /Confirma\?/.test(r.say ?? ''), r);
    r = await run('neilton', 'tire o boné da max serviços', [call('item_categorias', { item: 'boné', remover: 'Max Serviço' })]);
    ok('categoria: remove só a pedida', JSON.stringify(r.pending?.[0]?.body) === '{"categories":["Max Forte"]}', r);
    r = await run('juliana', 'o cinto é max forte', [call('item_categorias', { item: 'cinto', adicionar: 'max forte' }), say('Sem permissão.')]);
    ok('quem só visualiza não muda categoria', !r.pending && /inexistente ou sem permissão/.test(lastTool(sent[1])), r);
    r = await run('neilton', 'o que saiu nas últimas 15 horas', [call('movimentacoes_consultar', { horas: 15 }), say('Saíram 11.')]);
    ok('movimentação por horas', /"unidades_que_sairam":11/.test(lastTool(sent[1])), lastTool(sent[1]));
    r = await run('neilton', 'me mostra as métricas do mês', [call('comando_max', { frase: 'Max, métricas do último mês' })]);
    ok('comando pronto da tela', r.route === 'Max, métricas do último mês' && sent.length === 1, r);
    r = await run('neilton', 'quem ganhou o jogo ontem', [call('pesquisar_web', { pergunta: 'quem ganhou o jogo ontem' }), say('O **Bahia** venceu por 2 a 1【3†L4-L9】. Fonte: https://ge.globo.com/x')]);
    ok('pesquisa na web: usa browser_search, limpa citações e links', r.source === 'web' && r.say === 'O Bahia venceu por 2 a 1.' && !/【|http|\*/.test(r.say ?? '') && sent[1].tools?.[0].type === 'browser_search' && sent[1].tool_choice === 'required', r);
    r = await run('neilton', 'como está o tempo hoje', []);
    ok('clima não gasta a IA', r.source === 'clima' && sent.length === 0, r);
    status = 429;
    script = [];
    sent = [];
    r = await runAgent(who('neilton'), { text: 'me ajude com algo', scope: 'sector', sector: 'almoxarifado', examples: EX, history: [] });
    ok('limite da IA é sinalizado', r.source === 'limite', r);

    console.log('filtro de linguagem');
    ok('palavrão', isBlocked('Max, vai tomar no cu') && isBlocked('que merda de sistema') && isBlocked('seu filho da puta'));
    ok('frases de trabalho passam', !isBlocked('o que rola no estoque hoje') && !isBlocked('quantas picaretas temos') && !isBlocked('calcule 12 vezes 8') && !isBlocked('abrir a solicitação 12') && !isBlocked('curso de computação') && !isBlocked('sexo do colaborador no cadastro'));
  } catch (e) {
    fail++;
    console.log('EXCEÇÃO', e);
  } finally {
    db.kill();
  }
  console.log(fail ? `\n${fail} falha(s)` : '\nOK');
  process.exit(fail ? 1 : 0);
})();
