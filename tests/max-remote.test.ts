/**
 * Segunda camada da Max (clima, câmbio, Wikipédia, IA) com a internet simulada.
 * Rodar: npx tsx --conditions=react-server tests/max-remote.test.ts
 */
import { isWeatherQuestion, weatherAnswer } from '../lib/max/server/weather';
import { currencyAnswer, currencyIn } from '../lib/max/server/currency';
import { looksLikeQuestion, topicOf, wikiAnswer } from '../lib/max/server/wiki';
import { askLlm, llmConfigured } from '../lib/max/server/llm';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = want instanceof RegExp ? want.test(String(got)) : got === want;
  if (!ok) fail++;
  console.log(ok ? '  ✓' : '  ✗', name, ok ? '' : `→ ${JSON.stringify(got)}`);
};

let llmReply = '{"say":"Canberra é a capital da Austrália."}';
let down = false;
const calls: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  calls.push(String(url));
  if (down) throw new Error('offline');
  const json = (o: unknown, status = 200) => ({ ok: status < 400, status, json: async () => o });
  const u = String(url);
  if (u.includes('geocoding-api')) return json({ results: [{ name: 'Feira de Santana', latitude: -12.26, longitude: -38.96 }] });
  if (u.includes('api.open-meteo.com')) return json({ current: { temperature_2m: 28.4, apparent_temperature: 31.2, weather_code: 2, relative_humidity_2m: 70 }, daily: { temperature_2m_max: [30.1, 29.2], temperature_2m_min: [24.3, 23.8], precipitation_probability_max: [40, 75], weather_code: [2, 63] } });
  if (u.includes('awesomeapi')) return json({ USDBRL: { bid: '5.4321' }, EURBRL: { bid: '6.10' } });
  if (u.includes('w/api.php')) return json({ query: { search: u.includes('xyzqq') ? [] : [{ title: 'Descoberta do Brasil' }] } });
  if (u.includes('page/summary')) return json({ type: 'standard', title: 'Descoberta do Brasil', extract: 'O descobrimento do Brasil (em português europeu: descoberta) refere-se à chegada, em 22 de abril de 1500, da frota comandada por Pedro Álvares Cabral ao território onde hoje se localiza o Brasil. O termo é contestado por historiadores. Mais uma frase longa que não deve entrar no resumo falado porque passaria do limite combinado de tamanho para a voz.' });
  if (u.includes('chat/completions')) {
    const body = JSON.parse(String(init?.body));
    if (!/Max/.test(body.messages[0].content) || !body.messages[0].content.includes('- Max, métricas da última semana')) throw new Error('prompt sem exemplos');
    return json({ choices: [{ message: { content: llmReply } }] });
  }
  return json({}, 404);
};

(async () => {
  console.log('clima');
  eq('"como está o tempo hoje" é clima', isWeatherQuestion('como está o tempo hoje'), true);
  eq('"vai chover amanhã?" é clima', isWeatherQuestion('vai chover amanhã?'), true);
  eq('"quanto tempo falta" NÃO é clima', isWeatherQuestion('quanto tempo falta para o almoço'), false);
  eq('"tempo de entrega do pedido" NÃO é clima', isWeatherQuestion('qual o tempo de entrega do pedido'), false);
  eq('agora em Salvador', (await weatherAnswer('como está o tempo hoje'))?.say, /Agora em Salvador faz 28 graus, com parcialmente nublado e sensação de 31\. Hoje a mínima é de 24 e a máxima de 30 graus\. A chance de chuva é de 40 por cento\./);
  eq('amanhã, outra cidade', (await weatherAnswer('vai chover em Feira de Santana amanhã'))?.say, /Amanhã em Feira de Santana: chuva, com mínima de 24 e máxima de 29 graus\. A chance de chuva é de 75 por cento\./);
  console.log('câmbio');
  eq('detecta dólar', currencyIn('qual a cotação do dólar')?.code, 'USD');
  eq('frase sem relação não vira câmbio', currencyIn('o cliente pagou em dólar a fatura de março do contrato'), null);
  eq('cotação falada', (await currencyAnswer('qual a cotação do dólar hoje'))?.say, 'O dólar está cotado a 5 reais e 43 centavos.');
  eq('conversão', (await currencyAnswer('quanto é 100 dólares em reais'))?.text, /100 USD = R\$\s543,21/);
  console.log('wikipédia');
  eq('é pergunta', looksLikeQuestion('quem descobriu o Brasil'), true);
  eq('não é pergunta', looksLikeQuestion('abrir o estoque'), false);
  eq('assunto', topicOf('me fale sobre a ISO 9001'), 'iso 9001');
  const w = await wikiAnswer('quem descobriu o Brasil');
  eq('resumo curto, sem parênteses', w?.say, /^O descobrimento do Brasil refere-se à chegada.*Cabral.*historiadores\.$/);
  eq('resumo cabe na fala', (w?.say.length ?? 999) < 340, true);
  eq('sem resultado → null', await wikiAnswer('o que é xyzqq'), null);
  console.log('IA opcional');
  eq('sem variáveis = desligada', llmConfigured(), false);
  eq('desligada não chama nada', await askLlm('oi', { userName: 'A', sectorName: null, scope: 'hub', examples: [] }), null);
  process.env.MAX_LLM_API_KEY = 'k'; process.env.MAX_LLM_BASE_URL = 'https://llm.exemplo/v1/'; process.env.MAX_LLM_MODEL = 'm';
  const ctx = { userName: 'Mateus', sectorName: 'Almoxarifado', scope: 'sector', examples: ['Max, métricas da última semana'] };
  eq('resposta falada', (await askLlm('capital da Austrália', ctx))?.say, 'Canberra é a capital da Austrália.');
  eq('url sem barra dupla', calls[calls.length - 1], 'https://llm.exemplo/v1/chat/completions');
  llmReply = '```json\n{"route":"Max, métricas do último mês"}\n```';
  eq('rota dentro de bloco de código', (await askLlm('como tá a parada esse mês', ctx))?.route, 'Max, métricas do último mês');
  llmReply = 'Claro! **Canberra** é a capital.';
  eq('texto solto vira fala limpa', (await askLlm('x', ctx))?.say, 'Claro! Canberra é a capital.');
  llmReply = '{"outra":1}';
  eq('JSON sem say/route → null', await askLlm('x', ctx), null);
  console.log('serviços fora do ar');
  down = true;
  eq('clima → null', await weatherAnswer('como está o tempo'), null);
  eq('câmbio → null', await currencyAnswer('cotação do euro'), null);
  eq('wikipédia → null', await wikiAnswer('quem foi Santos Dumont'), null);
  eq('IA → null', await askLlm('x', ctx), null);
  console.log(fail ? `\n${fail} falha(s)` : '\nOK');
  process.exit(fail ? 1 : 0);
})();
