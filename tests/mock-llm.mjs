/**
 * IA de mentira (API "chat/completions") para testar o agente da Max sem internet e sem gastar cota.
 * Uso: node tests/mock-llm.mjs [porta]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 54322);
const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const say = (content) => ({ role: 'assistant', content });

function reply(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  if ((body.tools || []).some((t) => t.type === 'browser_search')) return say('A capital da Austrália é **Canberra**【1†L1-L3】. Veja em https://exemplo.com');
  if (last.role === 'tool') return say('RESPOSTA: ' + String(last.content).slice(0, 160));
  const text = String(last.content || '').toLowerCase();
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
    const body = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: reply(body) }] }));
  })
  .listen(PORT, () => console.log(`IA de teste em http://localhost:${PORT}`));
