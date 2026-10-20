'use client';
/**
 * Registro para a Auditoria, no navegador: telas abertas, alterações feitas (com o resultado)
 * e pedidos à Max. Junta os eventos e manda de pouco em pouco para /api/audit.
 * Senhas e conteúdos sensíveis nunca saem daqui.
 */
type Ev = { kind: 'tela' | 'acao' | 'max' | 'erro'; action: string; detail?: string | null; ok?: boolean; path?: string };

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let origFetch: typeof fetch | null = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  const f = origFetch ?? window.fetch.bind(window);
  void f('/api/audit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), keepalive: true }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flush, 300);
}

export function auditLog(ev: Ev, now = false) {
  queue.push({ ...ev, path: ev.path ?? location.pathname + location.hash });
  if (now) {
    if (timer) clearTimeout(timer);
    flush();
  } else if (!timer) timer = setTimeout(flush, 1200);
}

/** pedido feito à Max (e o que ela respondeu) */
export function auditMax(said: string, reply?: string) {
  const clean = said.replace(/^\s*(ol[áa]\s+|oi\s+|ei\s+)?max[,!.:\s]+/i, '').trim();
  auditLog({ kind: 'max', action: `Pediu à Max: “${clean.slice(0, 160)}”`, detail: reply ? reply.slice(0, 220) : null });
}

/* ------------------------------------------------------------------ */
/* o que cada rota do sistema significa                                 */
/* ------------------------------------------------------------------ */

const MOVE: Record<string, string> = {
  entrada: 'Registrou uma entrada no estoque',
  saida: 'Registrou uma saída do estoque',
  ajuste: 'Ajustou o saldo de um item',
  transferencia: 'Enviou itens a um posto',
  devolucao: 'Registrou devolução de um posto',
  baixa_posto: 'Deu baixa de itens num posto',
};
const ORDER_ACT: Record<string, string> = {
  reserve: 'Reservou material de um pedido',
  deliver: 'Entregou material de um pedido (termo de entrega)',
  release: 'Liberou reservas de um pedido',
  cancel: 'Cancelou um pedido de material',
  auto: 'Aplicou a sugestão automática de um pedido',
  purchase: 'Pediu compra pelo pedido de material',
  forward: 'Encaminhou um pedido ao Almoxarifado',
  validate: 'Validou um pedido de troca',
  return: 'Devolveu um pedido para correção',
  edit: 'Editou um pedido de material',
  link: 'Ligou um pedido a uma compra',
};

type B = Record<string, unknown>;
const RULES: { re: RegExp; m?: string; say: (b: B, mt: RegExpMatchArray, method: string) => string }[] = [
  { re: /^\/api\/almoxarifado\/stock\/move$/, say: (b) => MOVE[String(b.kind)] ?? 'Movimentou o estoque' },
  { re: /^\/api\/almoxarifado\/stock\/import$/, say: () => 'Importou ou atualizou itens por planilha' },
  { re: /^\/api\/almoxarifado\/stock\/[\w-]+$/, say: (_b, _m, me) => (me === 'DELETE' ? 'Excluiu um item do estoque' : 'Editou um item do estoque') },
  { re: /^\/api\/almoxarifado\/stock$/, say: () => 'Cadastrou um item no estoque' },
  { re: /^\/api\/almoxarifado\/(inventario|inventory)/, say: () => 'Lançou um inventário' },
  { re: /^\/api\/almoxarifado\/requests\/[\w-]+/, say: (b, _m, me) => (me === 'DELETE' ? 'Excluiu uma solicitação' : b.status ? `Marcou uma solicitação como ${b.status}` : 'Respondeu uma solicitação') },
  { re: /^\/api\/almoxarifado\/postos\/import$/, say: () => 'Importou postos por planilha' },
  { re: /^\/api\/almoxarifado\/postos\/[\w-]+/, say: (_b, _m, me) => (me === 'DELETE' ? 'Removeu um posto' : 'Editou um posto') },
  { re: /^\/api\/almoxarifado\/postos$/, say: () => 'Cadastrou um posto' },
  { re: /^\/api\/almoxarifado\/emails/, say: (_b, _m, me) => (me === 'DELETE' ? 'Removeu um e-mail autorizado' : 'Autorizou e-mail de supervisor') },
  { re: /^\/api\/almoxarifado\/form/, say: () => 'Editou o formulário de solicitação' },
  { re: /^\/api\/almoxarifado\/notas\/parse$/, say: () => 'Leu o XML de uma nota fiscal' },
  { re: /^\/api\/almoxarifado\/notas\/[\w-]+\/post$/, say: () => 'Deu entrada de uma nota fiscal no estoque' },
  { re: /^\/api\/almoxarifado\/notas\/[\w-]+\/reverse$/, say: () => 'Estornou uma nota fiscal' },
  { re: /^\/api\/almoxarifado\/notas\/[\w-]+\/conferencia$/, say: () => 'Registrou a conferência física de uma nota' },
  { re: /^\/api\/almoxarifado\/notas\/[\w-]+\/divergencia$/, say: (b) => (b.decision === 'autorizada' ? 'Autorizou uma divergência de nota' : 'Tratou uma divergência de nota') },
  { re: /^\/api\/almoxarifado\/notas\/[\w-]+\/parcelas$/, say: (b) => (b.validate ? 'Validou as parcelas de uma nota' : 'Alterou as parcelas de uma nota') },
  { re: /^\/api\/almoxarifado\/notas/, say: () => 'Registrou uma nota fiscal' },
  { re: /^\/api\/almoxarifado\/catalog|^\/api\/almoxarifado\/classif/, say: () => 'Classificou itens do catálogo' },
  { re: /^\/api\/compras\/fornecedores\/import$/, say: () => 'Leu uma planilha de fornecedores' },
  { re: /^\/api\/compras\/fornecedores\/[\w-]+$/, say: (b) => (b.active === false ? 'Desativou um fornecedor' : b.active === true ? 'Reativou um fornecedor' : 'Editou um fornecedor') },
  { re: /^\/api\/compras\/fornecedores$/, say: (b) => (Array.isArray(b.rows) ? 'Importou fornecedores por planilha' : 'Cadastrou um fornecedor') },
  { re: /^\/api\/compras\/cotacoes$/, say: () => 'Abriu uma cotação' },
  { re: /^\/api\/compras\/cotacoes\/[\w-]+$/, say: (b) => (b.action === 'decide' ? 'Decidiu o mapa de cotação (gerou pedido de compra)' : b.action === 'proposal' ? 'Registrou a proposta de um fornecedor' : b.action === 'cancel' ? 'Cancelou uma cotação' : 'Alterou uma cotação') },
  { re: /^\/api\/compras\/pedidos$/, say: () => 'Criou um pedido de compra direto' },
  {
    re: /^\/api\/compras\/pedidos\/[\w-]+$/,
    say: (b) =>
      ({ submit: 'Mandou um pedido de compra para aprovação', approve: 'Aprovou um pedido de compra', reject: 'Recusou/devolveu um pedido de compra', send: 'Enviou um pedido de compra ao fornecedor', confirm: 'Registrou a confirmação do fornecedor', cancel: 'Cancelou um pedido de compra', edit: 'Alterou um pedido de compra', attach: 'Anexou arquivos ao pedido de compra' } as Record<string, string>)[String(b.action)] ?? 'Mexeu num pedido de compra',
  },
  { re: /^\/api\/compras\/config$/, say: () => 'Mudou as regras de Compras (alçada)' },
  { re: /^\/api\/compras\/fornecedores\/[\w-]+\/perfil$/, say: (b) => (b.homologation === 'homologado' ? 'Homologou um fornecedor' : b.homologation === 'bloqueado' ? 'Bloqueou um fornecedor' : 'Alterou prazos/condições de um fornecedor') },
  { re: /^\/api\/almoxarifado\/equivalencias/, say: (_b, _m, me) => (me === 'DELETE' ? 'Apagou uma equivalência de código' : 'Validou uma equivalência de código de fornecedor') },
  { re: /^\/api\/anexos$/, say: () => 'Anexou um arquivo' },
  { re: /^\/api\/compras\/requests\/[\w-]+$/, say: (b) => (b.status === 'cancelada' ? 'Cancelou uma solicitação de compra' : b.status ? `Mudou uma compra para ${String(b.status).replace('_', ' ')}` : 'Respondeu uma solicitação de compra') },
  { re: /^\/api\/compras\/requests$/, say: () => 'Pediu uma compra ao setor de Compras' },
  { re: /^\/api\/pedidos\/[\w-]+\/(\w+)$/, say: (_b, m) => ORDER_ACT[m[1]] ?? 'Mexeu num pedido de material' },
  { re: /^\/api\/pedidos\/[\w-]+$/, say: (b) => ORDER_ACT[String(b.action)] ?? 'Alterou um pedido de material' },
  { re: /^\/api\/pedidos\/export$/, say: () => 'Baixou a planilha de pedidos' },
  { re: /^\/api\/pedidos$/, say: () => 'Abriu um pedido de material' },
  { re: /^\/api\/rh\/colaboradores\/import$/, say: () => 'Leu uma planilha de colaboradores' },
  { re: /^\/api\/rh\/colaboradores\/[\w-]+$/, say: (b) => (b.active === false ? 'Desligou um colaborador' : 'Editou um colaborador') },
  { re: /^\/api\/rh\/colaboradores$/, say: (b) => (Array.isArray(b.rows) ? 'Importou colaboradores por planilha' : 'Cadastrou um colaborador') },
  { re: /^\/api\/rh\/kits/, say: () => 'Salvou um kit por função' },
  { re: /^\/api\/rh\/trocas/, say: () => 'Abriu trocas anuais' },
  { re: /^\/api\/hub\/users\/[\w-]+$/, say: (b, _m, me) => (me === 'DELETE' ? 'Excluiu um usuário' : b.active === false ? 'Desativou um usuário' : b.active === true ? 'Reativou um usuário' : 'new_password' in b ? 'Redefiniu a senha de um usuário' : 'Alterou um usuário') },
  { re: /^\/api\/hub\/users$/, say: () => 'Criou um usuário' },
  { re: /^\/api\/setor\/[\w-]+\/equipe/, say: () => 'Mudou permissões da equipe' },
  { re: /^\/api\/account/, say: (b) => ('new_password' in b || 'password' in b ? 'Trocou a própria senha' : 'Alterou a própria conta') },
  { re: /^\/api\/max\/memoria/, say: () => 'Ensinou algo à Max' },
  { re: /^\/api\/pontos\/analisar$/, say: () => 'Analisou um espelho de ponto' },
  { re: /^\/api\/pontos\/relatorio$/, say: () => 'Baixou o relatório de ponto' },
];

/** campos que ajudam a entender a ação (nunca senhas, arquivos ou textos enormes) */
function summary(b: B): string | null {
  const parts: string[] = [];
  const pick = (k: string, label = '') => {
    const v = b[k];
    if (v === undefined || v === null || v === '' || typeof v === 'object') return;
    parts.push(`${label}${String(v).slice(0, 60)}`);
  };
  pick('name');
  pick('display_name');
  pick('username', '@');
  pick('quantity', 'qtd. ');
  pick('size', 'tam. ');
  pick('status', 'status ');
  pick('number', 'nº ');
  pick('supplier_name', 'fornecedor ');
  pick('emails', '');
  pick('reason', 'motivo: ');
  pick('note', '');
  if (Array.isArray(b.rows)) parts.push(`${b.rows.length} linha(s)`);
  if (Array.isArray(b.items)) parts.push(`${b.items.length} item(ns)`);
  return parts.length ? parts.join(' · ') : null;
}

const SKIP = /^\/api\/(audit|geo|auth\/me|max\/(ask|agent|publico))\b/;

export function describe(method: string, path: string, body: unknown): { action: string; detail: string | null } | null {
  if (SKIP.test(path)) return null;
  const b: B = body && typeof body === 'object' ? (body as B) : {};
  for (const r of RULES) {
    const m = path.match(r.re);
    if (m) return { action: r.say(b, m, method), detail: summary(b) };
  }
  const verb = method === 'DELETE' ? 'Removeu' : method === 'POST' ? 'Registrou' : 'Alterou';
  return { action: `${verb} dados (${path.replace(/^\/api\//, '').replace(/\/[0-9a-f-]{36}/g, '/…')})`, detail: summary(b) };
}

/** observa as chamadas do sistema: cada alteração vira um registro, com o resultado */
export function watchFetch() {
  const w = window as Window & { __auditFetch?: boolean };
  if (w.__auditFetch) return;
  w.__auditFetch = true;
  origFetch = window.fetch.bind(window);
  const inner = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const res = await inner(input, init);
    try {
      const path = new URL(url, location.href).pathname;
      if (method !== 'GET' && path.startsWith('/api/')) {
        let body: unknown = null;
        if (typeof init?.body === 'string') {
          try {
            body = JSON.parse(init.body);
          } catch {
            body = null;
          }
        }
        const d = describe(method, path, body);
        if (d) {
          let err: string | null = null;
          if (!res.ok) err = ((await res.clone().json().catch(() => ({}))) as { error?: string }).error ?? `erro ${res.status}`;
          auditLog({ kind: res.ok ? 'acao' : 'erro', action: d.action, detail: err ? `${err}${d.detail ? ' · ' + d.detail : ''}` : d.detail, ok: res.ok });
        }
      } else if (method === 'GET' && /\/(export|pdf)\b|xml=1/.test(url) && res.ok) {
        auditLog({ kind: 'acao', action: 'Baixou um arquivo', detail: path.replace(/^\/api\//, '') });
      }
    } catch {
      /* o registro nunca atrapalha a tela */
    }
    return res;
  };
}
