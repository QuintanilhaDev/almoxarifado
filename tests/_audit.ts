/**
 * Bateria de frases da Max: confere se cada pedido cai na habilidade certa.
 * Rodar: npx tsx tests/max-nlu.test.ts
 */
import { hear, think, understand, CONFIDENT } from '../lib/max/engine';
import { getSector } from '../lib/sectors';
import { supplierPrefill } from '../lib/max/skills-fornecedores';
import type { MaxHost, MaxMemory } from '../lib/max/types';
import type { HubUser, HubUserRow } from '../lib/permissions';

const user = (over: Partial<HubUser> = {}): HubUser => ({ id: 'u1', username: 'mateus', display_name: 'Mateus Quintanilha', is_master: true, sector: null, sector_role: 'member', permissions: {}, active: true, ...over });
const CATS: Record<string, string[]> = { 'Bota de segurança': ['Max Forte', 'EPI'], 'Camisa social manga curta': ['Max Serviços'], 'Calça tática': ['Max Forte'], 'Boné': ['Max Forte', 'Max Serviços'], 'Cinto tático': ['Max Forte', 'Acessório'], 'Colete refletivo': ['EPI'], 'Rádio comunicador': ['Equipamento'] };
const item = (name: string, size: string | null, quantity: number, min = 0, at_postos = 0) => ({ id: name + size, ref: 1, name, size, unit: 'Cada', quantity, min_quantity: min, cost: 10, categories: CATS[name] ?? [], at_postos, created_at: '2026-01-01', updated_at: '2026-01-01' });
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
  { id: 'compras', label: 'Compras', aliases: ['compras', 'pedidos de compra', 'solicitacoes de compra', 'aba compras'] },
  { id: 'equipe', label: 'Equipe', aliases: ['equipe', 'permissoes', 'time'] },
  { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'perfil', 'senha', 'minha senha'] },
];
const base = { tab: 'inicio', goTab: () => undefined, can: () => true, navigate: () => undefined, logout: () => undefined };
const almox: MaxHost = { ...base, scope: 'sector', sector: getSector('almoxarifado'), user: user(), tabs: ALMOX_TABS, almox: { requests: () => requests as never, items: () => items as never, postos: () => postos as never, emailsCount: () => 7 } };
const hub: MaxHost = { ...base, scope: 'hub', sector: null, user: user(), tabs: [{ id: 'setores', label: 'Setores', aliases: ['setores', 'visao geral'] }, { id: 'usuarios', label: 'Usuários', aliases: ['usuarios', 'pessoas'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'senha'] }], hub: { users: () => rows }, almox: almox.almox };
const login: MaxHost = { ...base, scope: 'login', sector: null, user: null, tabs: [] };
const rh: MaxHost = { ...base, scope: 'sector', sector: getSector('rh'), user: user({ is_master: false, sector: 'rh' }), tabs: [{ id: 'inicio', label: 'Início', aliases: ['inicio'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta', 'senha'] }] };

const purchases = [
  { id: 'pc1', number: 1, from_sector: 'almoxarifado', status: 'nova', priority: 'urgente', reason: null, needed_by: null, items: [{ item_id: 'x', name: 'Bota de segurança', size: '42', unit: 'Cada', quantity: 20, note: null, stock: 3, min: 5 }], requested_by: 'Neilton', handled_by: null, response: null, history: [], created_at: '2026-10-13T10:00:00Z', updated_at: '' },
  { id: 'pc2', number: 2, from_sector: 'almoxarifado', status: 'em_cotacao', priority: 'normal', reason: null, needed_by: null, items: [{ item_id: null, name: 'Lanterna', size: null, unit: 'Cada', quantity: 5, note: null, stock: null, min: null }], requested_by: 'Neilton', handled_by: 'Carlos', response: 'Cotando', history: [], created_at: '2026-10-13T11:00:00Z', updated_at: '' },
];
const almoxNo: MaxHost = { ...almox, can: (m: string) => m !== 'compras', compras: { requests: () => null } };
const almoxC: MaxHost = { ...almox, compras: { requests: () => purchases as never } };
const compras: MaxHost = { ...base, scope: 'sector', sector: getSector('compras'), user: user({ is_master: false, sector: 'compras', sector_role: 'master' }), tabs: [{ id: 'solicitacoes', label: 'Solicitações', aliases: ['solicitacoes', 'pedidos'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta'] }], compras: { requests: () => purchases as never } };
const SUPS = [
  { id: 's1', name: 'Malharia Bahia Ltda', trade_name: 'Malharia Bahia', cnpj: '11222333000181', phone: '(71) 3333-4444', email: 'vendas@malharia.com', contact: 'Rosa', category: 'fardamento, camisas e calças', city: 'Salvador', uf: 'BA', address: null, notes: null, active: true, created_by: 'Mateus', created_at: '', updated_at: null },
  { id: 's2', name: 'Botas Forte Comércio', trade_name: null, cnpj: null, phone: null, email: null, contact: null, category: 'botas e calçados de segurança', city: null, uf: null, address: null, notes: null, active: true, created_by: null, created_at: '', updated_at: null },
];
const comprasF: MaxHost = { ...compras, tabs: [...compras.tabs, { id: 'fornecedores', label: 'Fornecedores', aliases: ['fornecedores', 'fornecedor'] }], fornecedores: { list: () => SUPS as never, canEdit: true } };
// Projeto 3: pedidos de material
const ord = (n: number, stage: string, extra = {}) => ({ id: 'o' + n, number: n, origin: 'operacao', stage, priority: 'normal', needed_by: null, start_date: null, company: null, posto_id: null, posto_name: 'Posto 01', collaborator_id: null, collaborator_name: 'Caio', matricula: null, role: null, reason: null, requester: 'Uesley', supervisor: null, source_request_id: null, items: [{ item_id: 'x', name: 'Bota', size: '42', unit: 'Cada', qty: 2, reserved: 0, delivered: 0 }], flags: [], history: [], forwarded_by: null, forwarded_at: null, validated_by: null, validated_at: null, closed_at: null, created_at: '2026-10-13T10:00:00Z', updated_at: '', ...extra });
const orders = [ord(1, 'solicitado'), ord(2, 'validacao', { origin: 'rh_troca' }), ord(3, 'encaminhado')];
const almoxP: MaxHost = { ...almoxC, pedidos: { scope: 'almox', orders: () => orders as never } };
const opP: MaxHost = { ...base, scope: 'sector', sector: getSector('operacional'), user: user({ is_master: false, sector: 'operacional', sector_role: 'master' }), tabs: [{ id: 'pedidos', label: 'Pedidos de material', aliases: ['pedidos', 'pedidos de material'] }, { id: 'conta', label: 'Minha conta', aliases: ['conta', 'minha conta'] }], pedidos: { scope: 'operacao', orders: () => orders as never } };

type Case = [MaxHost, string, string | null];

const mem = (): MaxMemory => ({ last: null, lastInput: '', voiceOn: true, setVoice: () => undefined });
(globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false, json: async () => ({ error: 'sem rede' }) });
const P: [MaxHost, string][] = [
  [almox, 'classificar os itens'], [almox, 'gerar os códigos do estoque'], [almox, 'fazer inventário'], [almox, 'vamos começar o inventário'], [almox, 'importar planilha de itens'], [almox, 'quero subir uma planilha com os produtos'],
  [almox, 'importar a planilha de postos'], [almox, 'nova solicitação de compra'], [almox, 'quero fazer um pedido de compra'], [almox, 'adicionar uma pergunta no formulário'],
  [almox, 'importar o xml da nota'], [almox, 'lançar uma nota fiscal'], [almox, 'digitar uma nota'], [almox, 'enviar itens para o shopping barra'],
  [rh, 'abrir uma admissão'], [rh, 'novo pedido'], [rh, 'quero pedir uma troca extraordinária'], [rh, 'cadastrar um colaborador'], [rh, 'importar a planilha de colaboradores'], [rh, 'criar um kit'],
  [hub, 'importar a planilha de itens'], [hub, 'abrir o estoque do almoxarifado'], [hub, 'me leva nos fornecedores'], [almox, 'abrir a gestão'], [almox, 'abrir os colaboradores do rh'], [hub, 'abrir a gestão'],
  [almox, 'trocar minha senha'], [hub, 'quero mudar a minha senha'], [hub, 'nova admissão'],
  [almox, 'abrir o estoque'], [almox, 'mostrar as solicitações novas'], [almox, 'abrir solicitações de compra'], [compras, 'abrir solicitações'],
];
(async () => {
  for (const [h, ph] of P) {
    const heard = hear('Max, ' + ph);
    const u = understand(heard.command, h);
    const r = await think(heard.command, h, { memory: mem(), raw: 'Max, ' + ph });
    console.log(`[${h.scope}/${h.sector?.slug ?? '-'}] ${ph}\n   → ${u.top?.skill.id ?? '-'} (${(u.top?.score ?? 0).toFixed(2)}) ${(r.say || '').slice(0, 110)}`);
  }
})();
