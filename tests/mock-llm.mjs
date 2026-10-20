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
  // vínculo nota ↔ pedido: "KIT HT" é o rádio comunicador do pedido
  if (String(msgs[0]?.content || '').startsWith('VINCULO_NF')) {
    const txt = String(last.content || '');
    const links = [];
    for (const m of txt.matchAll(/^L(\d+) \| ([^|]+)/gm)) {
      if (!/\bHT\b/i.test(m[2])) continue;
      const r = txt.match(/^R(\d+) \| [^|]+\| R[áa]dio comunicador/im);
      if (r) links.push({ l: Number(m[1]), r: Number(r[1]), confianca: 0.88 });
    }
    return say(JSON.stringify({ links }));
  }
  // horas extras: transcrição de folha de ponto (foto / escaneado / manuscrito ou texto solto)
  if (String(msgs[0]?.content || '').startsWith('Você transcreve folhas')) {
    const img = Array.isArray(last.content) && last.content.some((c) => c.type === 'image_url');
    const dias = img
      ? [
          { data: '14/09/2026', batidas: ['7h00', '12:00', '13:00', '18:00'], obs: null, duvida: false }, // 10h → 1h extra
          { data: '15/09/2026', batidas: ['08:00', '12:00', '13:00', '17:00'], obs: null, duvida: true },
          { data: '20/09/2026', batidas: ['08:00', '12:00'], obs: null, duvida: false }, // domingo → 4h a 100%
          { data: '16/09/2026', batidas: [], obs: 'FOLGA', duvida: false },
        ]
      : [{ data: '14/09/2026', batidas: ['08:00', '12:00', '13:00', '19:00'], obs: null, duvida: false }];
    if (!img && !/\d{2}:\d{2}/.test(JSON.stringify(last.content))) return say(JSON.stringify({ periodo: null, funcionarios: [] })); // texto sem nada de ponto
    return say(JSON.stringify({ periodo: null, funcionarios: [{ nome: img ? 'Maria Manuscrita' : 'Texto Solto', matricula: img ? '777' : null, cargo: 'PORTEIRA', posto: null, dias }] }));
  }
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
