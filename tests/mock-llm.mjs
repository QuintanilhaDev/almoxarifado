/**
 * IA de mentira (API "chat/completions") para testar o agente da Max sem internet e sem gastar cota.
 * Uso: node tests/mock-llm.mjs [porta]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 54322);
let calls = 0; // GET em qualquer caminho devolve quantas vezes a IA foi chamada
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const say = (content) => ({ role: 'assistant', content });

function reply(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  if ((body.tools || []).some((t) => t.type === 'browser_search')) return say('A capital da Austrália é **Canberra**【1†L1-L3】. Veja em https://exemplo.com');
  if (last.role === 'tool') return say('RESPOSTA: ' + String(last.content).slice(0, 160));
  // o pedido atual = última fala da pessoa (ou a anterior, se a última for o "antes de desistir…")
  const said = msgs.filter((m) => m.role === 'user').map((m) => String(m.content || '').toLowerCase());
  const users = said[said.length - 1]?.startsWith('antes de desistir') ? said[said.length - 2] || '' : said[said.length - 1] || '';
  // a IA "desiste" deste pedido, mesmo depois da segunda chance (o navegador deve usar a habilidade local)
  if (users.includes('valor total que tem')) return say('Essa função ainda não existe no Max Hub.');
  const text = String(last.content || '').toLowerCase();
  if (text.includes('grana parada')) return call('comando_max', { frase: 'Max, qual o valor do estoque?' });
  if (text.includes('lembre que')) return call('memoria_guardar', { texto: 'O fornecedor de botas é a Casa do Vigilante.' });
  if (text.includes('fornece as botas')) return say((msgs[0].content || '').includes('Casa do Vigilante') ? 'Quem fornece as botas é a Casa do Vigilante.' : 'Não tenho essa informação.');
  if (text.includes('cadastre o item')) return call('item_cadastrar', { nome: 'Lanterna tática', quantidade: 7 });
  if (text.includes('marque a solicita')) return call('solicitacao_atualizar', { numero: 3, status: 'resolvida' });
  if (text.includes('pesquise')) return call('pesquisar_web', { pergunta: last.content });
  if (text.includes('saldo de camisa')) return call('estoque_consultar', { termo: 'camisa social' });
  if (text.includes('desative o acesso')) return call('usuario_alterar', { usuario: 'pedro', ativo: false });
  return say('');
}

http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ calls }));
    }
    calls++;
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: reply(body) }] }));
  })
  .listen(PORT, () => console.log(`IA de teste em http://localhost:${PORT}`));
