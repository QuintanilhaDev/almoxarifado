/**
 * Dados de teste do Max Hub (os mesmos para o banco de mentira em memória e para o Postgres de teste).
 */
import { randomUUID } from 'node:crypto';

export function buildSeed({ LEGACY = false, NOCAT = false } = {}) {
  const HASH = '$2b$10$c3tnk4UPkHj9.kv9pl7KsuDlaHAWcXU2EzcaZSKcTtwSADSM2pAIW'; // 123456
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const full = { solicitacoes: 'edit', estoque: 'edit', postos: 'edit', metricas: 'edit', formulario: 'edit', emails: 'edit' };
  const admin = (username, display_name, extra = {}) => ({
    id: randomUUID(), username, display_name, password_hash: HASH, created_at: iso(50000), updated_at: iso(50000),
    ...(LEGACY ? { is_master: Boolean(extra.is_master) } : { is_master: false, sector: null, sector_role: 'member', permissions: {}, active: true, created_by: null, last_login_at: null, ...extra }),
  });
  const CATS = { 'Bota de segurança': ['Max Forte', 'EPI'], 'Camisa social manga curta': ['Max Serviços'], 'Calça tática': ['Max Forte'], 'Boné': ['Max Forte', 'Max Serviços'], 'Cinto tático': ['Acessório'], 'Colete refletivo': ['EPI'] };
  const item = (ref, name, size, quantity, min_quantity = 0, cost = 25) => ({ id: randomUUID(), ref, name, size, unit: 'Cada', quantity, min_quantity, cost, ...(NOCAT ? {} : { categories: CATS[name] ?? [] }), name_key: name.toLowerCase(), size_key: (size || '').toLowerCase(), created_by: 'Neilton', created_at: iso(9000), updated_at: iso(100) });
  const posto = (name, city) => ({ id: randomUUID(), name, name_key: name.toLowerCase(), code: null, city, address: null, supervisor: 'Sup. ' + name, notes: null, created_by: 'Neilton', created_at: iso(9000), updated_at: iso(9000) });

  const items = [item(1, 'Bota de segurança', '40', 12, 5), item(2, 'Bota de segurança', '42', 3, 5), item(3, 'Bota de segurança', '44', 0, 5), item(4, 'Camisa social manga curta', 'G', 40, 10), item(5, 'Camisa social manga curta', 'M', 22, 10), item(6, 'Calça tática', '44', 9, 10), item(7, 'Boné', null, 70), item(8, 'Cinto tático', null, 15), item(9, 'Colete refletivo', null, 0, 2), item(10, 'Rádio comunicador', null, 6, 0, 480)];
  const postos = [posto('Posto 01', 'Salvador'), posto('Posto 02', 'Lauro de Freitas'), posto('Shopping Barra', 'Salvador'), posto('Hospital Aliança', 'Salvador')];
  const req = (protocol, status, collaborator, p, minAgo) => ({ id: randomUUID(), protocol, email: 'sup1@empresa.com.br', collaborator, posto: p, answers: [{ fieldId: 'motivo', label: 'Motivo', type: 'textarea', value: 'Reposição de fardamento' }], attachments: [], status, handled_by: status === 'nova' ? null : 'Neilton', created_at: iso(minAgo), updated_at: iso(minAgo), stock_applications: [] });
  const mov = (i, kind, quantity, minAgo, p = null) => ({ id: randomUUID(), item_id: items[i].id, item_name: items[i].name + (items[i].size ? ' · ' + items[i].size : ''), posto_id: p ? p.id : null, posto_name: p ? p.name : null, kind, quantity, before_qty: 10, after_qty: 10, note: null, by_name: 'Neilton', created_at: iso(minAgo) });

  const db = {
    admins: [
      admin('mateus', 'Mateus Quintanilha', { is_master: true }),
      admin('neilton', 'Neilton', { sector: 'almoxarifado', sector_role: 'master', permissions: full }),
      admin('juliana', 'Juliana Souza', { sector: 'almoxarifado', permissions: { ...full, estoque: 'view', postos: 'none', formulario: 'none', emails: 'none' } }),
      admin('carla', 'Carla Dias', { sector: 'rh', sector_role: 'master' }),
      admin('pedro', 'Pedro Alves', {}),
      admin('carlos', 'Carlos Compras', { sector: 'compras', sector_role: 'master' }),
      admin('lucas', 'Lucas Compras', { sector: 'compras', permissions: { solicitacoes: 'view' } }),
      admin('inativo', 'Usuário Inativo', { sector: 'financeiro', active: false }),
    ],
    hub_meta: [],
    ...(process.env.NOCOMPRAS === '1' ? {} : { purchase_requests: [] }),
    ...(process.env.NOMEM === '1' ? {} : { max_learned: [], max_notes: [], max_misses: [] }),
    authorized_emails: [{ id: randomUUID(), email: 'sup1@empresa.com.br', supervisor_name: 'Marcos', posto: 'Posto 01', created_by: 'Neilton', created_at: iso(8000) }],
    form_config: [],
    requests: [req(1, 'resolvida', 'Ana Lima', 'Posto 01', 6000), req(2, 'pendente', 'Bruno Reis', 'Posto 02', 2800), req(3, 'nova', 'Caio Melo', 'Shopping Barra', 300), req(4, 'nova', 'Dani Rocha', 'Posto 01', 40), req(12, 'pendente', 'Edu Santos', 'Hospital Aliança', 1500)],
    stock_items: items,
    postos,
    posto_stock: [{ posto_id: postos[0].id, item_id: items[0].id, quantity: 4, updated_at: iso(500) }, { posto_id: postos[0].id, item_id: items[6].id, quantity: 10, updated_at: iso(500) }, { posto_id: postos[2].id, item_id: items[3].id, quantity: 6, updated_at: iso(500) }],
    stock_movements: [mov(0, 'entrada', 20, 7000), mov(3, 'entrada', 50, 5000), mov(0, 'transferencia', 4, 2000, postos[0]), mov(6, 'transferencia', 10, 1900, postos[0]), mov(1, 'saida', 7, 900), mov(3, 'transferencia', 6, 700, postos[2]), mov(4, 'saida', 3, 200), mov(5, 'entrada', 5, 100), mov(1, 'saida', 2, 30)],
  };
  return db;
}
