'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, ClipboardList, Download, Flame, Plus, Search, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { timeAgo } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { canManageSector, type HubUser } from '@/lib/permissions';
import type { OrderScope } from '@/lib/pedidos/access';
import { ORIGIN_LABEL, STATUS_LABEL, atRisk, isLate, lineLabel, orderLabel, orderStatus, type MaterialOrder, type OrderOrigin, type OrderStatus, type PurchaseInfo } from '@/lib/pedidos/types';
import { useMaxBus } from '@/lib/max/bus';
import type { PedidosData } from './usePedidos';
import { OrderDrawer } from './OrderDrawer';
import { NewOrderSheet } from './NewOrderSheet';
import { StatusPill, dateBR, downloadPost, todayLocal, type PickItem } from './ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import './pedidos.css';

type Seg = 'abertos' | 'acao' | 'compra' | 'parciais' | 'atrasados' | 'concluidos' | 'cancelados' | 'todos';
const PERIODS = [
  { id: '0', label: 'Qualquer data' },
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
  { id: '90', label: 'Últimos 90 dias' },
];

const TITLE: Record<OrderScope, { h: string; p: string; action: string }> = {
  almox: { h: 'Pedidos de material', p: 'Pedidos da Operação e do RH/DP: reserve, entregue com termo e acompanhe o que falta comprar.', action: 'Para separar' },
  operacao: { h: 'Pedidos de material', p: 'Confira as solicitações dos supervisores, encaminhe ao Almoxarifado e valide as trocas anuais.', action: 'Para conferir' },
  rh: { h: 'Pedidos do RH/DP', p: 'Kits de admissão e trocas de fardamento: o Almoxarifado recebe na hora e você acompanha até a entrega.', action: 'Em andamento' },
};

export function itemsSummary(o: MaterialOrder) {
  const first = o.items.slice(0, 2).map((l) => `${l.qty} ${lineLabel(l)}`);
  return first.join(', ') + (o.items.length > 2 ? ` e mais ${o.items.length - 2}` : '');
}

/**
 * Painel de acompanhamento dos pedidos (Projeto 3, seção 14). O mesmo componente serve às três áreas;
 * cada uma vê a sua parte e as ações que lhe cabem.
 */
export function OrdersPanel({
  scope,
  user,
  data,
  failed,
  setup,
  reload,
  canEdit,
  openId,
  setOpenId,
  stockItems,
}: {
  scope: OrderScope;
  user: HubUser | null;
  data: PedidosData | null;
  failed: string;
  setup?: boolean;
  reload: () => Promise<void>;
  canEdit: boolean;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** estoque completo (só no Almoxarifado) para ligar linhas a itens */
  stockItems?: PickItem[] | null;
}) {
  const toast = useToast();
  const [seg, setSeg] = useState<Seg>(scope === 'rh' ? 'abertos' : 'acao');
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<'' | OrderOrigin>('');
  const [priority, setPriority] = useState('');
  const [period, setPeriod] = useState('0');
  const [posto, setPosto] = useState('');
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);

  useMaxBus('pedidos:open', (p) => {
    if (p.filter) setSeg(p.filter as Seg);
    if (p.query !== undefined) setQuery(p.query);
    if (p.id) setOpenId(p.id);
    if (p.number && data) {
      const o = data.orders.find((x) => x.number === p.number);
      if (o) setOpenId(o.id);
    }
  });

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const purchases = useMemo(() => new Map(Object.entries(data?.purchases ?? {}).map(([k, v]) => [k, v as PurchaseInfo])), [data]);
  const freeOf = useMemo(() => (id: string) => data?.free[id] ?? null, [data]);
  const statusOf = useMemo(() => {
    const m = new Map<string, OrderStatus>();
    for (const o of orders) m.set(o.id, orderStatus(o, purchases, freeOf));
    return m;
  }, [orders, purchases, freeOf]);

  const needsAction = (o: MaterialOrder) =>
    scope === 'operacao' ? o.stage === 'solicitado' || o.stage === 'validacao' : scope === 'almox' ? o.stage === 'encaminhado' : o.stage !== 'concluido' && o.stage !== 'cancelado';
  const waitingBuy = (o: MaterialOrder) => ['aguardando_compra', 'compra_solicitada', 'comprado'].includes(statusOf.get(o.id)!);
  const open = (o: MaterialOrder) => o.stage !== 'concluido' && o.stage !== 'cancelado';

  const counts = useMemo(() => {
    const c = { abertos: 0, acao: 0, compra: 0, parciais: 0, atrasados: 0, concluidos: 0, cancelados: 0, todos: orders.length, risco: 0 };
    for (const o of orders) {
      if (open(o)) c.abertos++;
      if (needsAction(o)) c.acao++;
      if (open(o) && waitingBuy(o)) c.compra++;
      if (open(o) && o.items.some((l) => l.delivered > 0)) c.parciais++;
      if (isLate(o)) c.atrasados++;
      if (atRisk(o)) c.risco++;
      if (o.stage === 'concluido') c.concluidos++;
      if (o.stage === 'cancelado') c.cancelados++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, statusOf, scope]);

  const postos = useMemo(() => [...new Set(orders.map((o) => o.posto_name).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [orders]);
  const origins = useMemo(() => [...new Set(orders.map((o) => o.origin))], [orders]);

  const shown = useMemo(() => {
    const t = fold(query.trim()).replace(/^#0*/, '');
    const since = period !== '0' ? new Date(Date.now() - Number(period) * 86_400_000).toISOString() : '';
    return orders.filter((o) => {
      if (seg === 'abertos' && !open(o)) return false;
      if (seg === 'acao' && !needsAction(o)) return false;
      if (seg === 'compra' && !(open(o) && waitingBuy(o))) return false;
      if (seg === 'parciais' && !(open(o) && o.items.some((l) => l.delivered > 0))) return false;
      if (seg === 'atrasados' && !isLate(o)) return false;
      if (seg === 'concluidos' && o.stage !== 'concluido') return false;
      if (seg === 'cancelados' && o.stage !== 'cancelado') return false;
      if (origin && o.origin !== origin) return false;
      if (priority && o.priority !== priority) return false;
      if (posto && o.posto_name !== posto) return false;
      if (since && o.created_at < since) return false;
      if (!t) return true;
      return fold(`${o.number} ${o.collaborator_name ?? ''} ${o.matricula ?? ''} ${o.posto_name ?? ''} ${o.requester} ${o.supervisor ?? ''} ${o.role ?? ''} ${o.company ?? ''} ${o.items.map((l) => lineLabel(l)).join(' ')}`).includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, seg, query, origin, priority, posto, period, statusOf]);

  const segs: { id: Seg; label: string; n: number }[] = [
    { id: 'acao', label: TITLE[scope].action, n: counts.acao },
    ...(scope === 'rh' ? [] : [{ id: 'abertos' as Seg, label: 'Em aberto', n: counts.abertos }]),
    { id: 'compra', label: 'Aguardando compra', n: counts.compra },
    { id: 'parciais', label: 'Parciais', n: counts.parciais },
    { id: 'atrasados', label: 'Atrasados', n: counts.atrasados },
    { id: 'concluidos', label: 'Entregues', n: counts.concluidos },
    { id: 'cancelados', label: 'Cancelados', n: counts.cancelados },
    { id: 'todos', label: 'Todos', n: counts.todos },
  ];

  const current = openId ? orders.find((o) => o.id === openId) ?? null : null;
  useEffect(() => {
    if (openId && data && !orders.some((o) => o.id === openId)) setOpenId(null);
  }, [openId, data, orders, setOpenId]);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const statuses = Object.fromEntries(shown.map((o) => [o.id, STATUS_LABEL[statusOf.get(o.id)!]]));
      await downloadPost('/api/pedidos/export', { ids: shown.map((o) => o.id), statuses }, `pedidos-${todayLocal()}.xlsx`);
    } catch (e) {
      toast({ kind: 'error', title: 'Planilha não gerada', text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const routingOwner = canManageSector(user, 'operacional') || canManageSector(user, 'almoxarifado');
  const setRouting = async (on: boolean) => {
    setRoutingBusy(true);
    try {
      await api('/api/pedidos/config', { method: 'PUT', json: { routing: on } });
      toast({ kind: 'success', title: on ? 'Solicitações dos supervisores passam pela Operação' : 'Solicitações dos supervisores vão direto ao Almoxarifado' });
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível mudar', text: (e as Error).message });
    } finally {
      setRoutingBusy(false);
    }
  };

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>{TITLE[scope].h}</h1>
            <p>{TITLE[scope].p}</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={exportXlsx} disabled={!shown.length || exporting}>
              {exporting ? <span className="spinner" /> : <Download size={18} />} Planilha
            </button>
            {scope !== 'almox' ? (
              <button className="btn btn-primary edit-only" onClick={() => setCreating(true)} disabled={!canEdit}>
                <Plus size={18} /> {scope === 'rh' ? 'Novo pedido do RH' : 'Novo pedido'}
              </button>
            ) : null}
          </div>
        </div>

        {setup ? (
          <div className="empty">
            <span className="empty-icon">
              <Settings2 size={24} />
            </span>
            <strong>Os pedidos de material ainda não foram ativados</strong>
            <span>{failed}</span>
          </div>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <small>Em aberto</small>
                <b>{data ? num(counts.abertos) : '…'}</b>
              </div>
              <div className="stat">
                <small>Aguardando compra</small>
                <b style={{ color: counts.compra ? 'var(--amber)' : undefined }}>{data ? num(counts.compra) : '…'}</b>
              </div>
              <div className="stat">
                <small>Atrasados</small>
                <b style={{ color: counts.atrasados ? 'var(--danger)' : undefined }}>{data ? num(counts.atrasados) : '…'}</b>
              </div>
              <div className="stat">
                <small>Entregues</small>
                <b>{data ? num(counts.concluidos) : '…'}</b>
              </div>
            </div>

            {counts.risco > 0 ? (
              <div className="banner">
                <AlertTriangle size={20} color="var(--amber)" />
                <span>
                  {counts.risco === 1 ? '1 admissão começa' : `${counts.risco} admissões começam`} em até 3 dias e ainda falta separar material.
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setSeg('abertos')}>
                  Ver
                </button>
              </div>
            ) : null}

            {scope === 'operacao' && data ? (
              <div className="o-routing">
                <div>
                  <b>Solicitações do formulário dos supervisores</b>
                  <small>
                    {data.config.routing
                      ? 'Chegam aqui primeiro: a Operação confere e encaminha ao Almoxarifado.'
                      : 'Vão direto ao Almoxarifado (a Operação não precisa conferir).'}
                  </small>
                </div>
                <div className="filter-seg" role="group" aria-label="Caminho das solicitações">
                  <button className={data.config.routing ? 'is-active' : ''} disabled={!routingOwner || routingBusy} onClick={() => !data.config.routing && setRouting(true)} aria-pressed={data.config.routing}>
                    Passam pela Operação
                  </button>
                  <button className={!data.config.routing ? 'is-active' : ''} disabled={!routingOwner || routingBusy} onClick={() => data.config.routing && setRouting(false)} aria-pressed={!data.config.routing}>
                    Direto ao Almoxarifado
                  </button>
                </div>
              </div>
            ) : null}

            <div className="toolbar o-toolbar">
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar por nº, colaborador, posto, material ou pessoa" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar pedidos" />
              </div>
              {origins.length > 1 ? (
                <div className="select-wrap">
                  <select className="select" value={origin} onChange={(e) => setOrigin(e.target.value as OrderOrigin)} aria-label="Origem">
                    <option value="">Todas as origens</option>
                    {origins.map((x) => (
                      <option key={x} value={x}>
                        {ORIGIN_LABEL[x]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              ) : null}
              {postos.length > 1 ? (
                <div className="select-wrap">
                  <select className="select" value={posto} onChange={(e) => setPosto(e.target.value)} aria-label="Posto">
                    <option value="">Todos os postos</option>
                    {postos.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              ) : null}
              <div className="select-wrap">
                <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Prioridade">
                  <option value="">Toda prioridade</option>
                  <option value="urgente">Só urgentes</option>
                  <option value="normal">Só normais</option>
                </select>
                <ChevronDown size={16} />
              </div>
              <div className="select-wrap">
                <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
                  {PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
            </div>
            <div className="filter-seg o-segs" role="tablist" aria-label="Filtrar pedidos">
              {segs.map((s) => (
                <button key={s.id} className={seg === s.id ? 'is-active' : ''} onClick={() => setSeg(s.id)}>
                  {s.label} <em>{num(s.n)}</em>
                </button>
              ))}
            </div>

            {failed && !data ? (
              <div className="empty">
                <span className="empty-icon">
                  <AlertCircle size={24} />
                </span>
                <strong>Não foi possível carregar os pedidos</strong>
                <span>{failed}</span>
              </div>
            ) : !data ? (
              <div className="p-list">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 76, borderRadius: 16 }} />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <ClipboardList size={24} />
                </span>
                <strong>{orders.length === 0 ? 'Nenhum pedido ainda' : 'Nada neste filtro'}</strong>
                <span>
                  {orders.length === 0
                    ? scope === 'almox'
                      ? 'Quando a Operação ou o RH/DP pedirem material, o pedido aparece aqui na hora.'
                      : 'Use o botão “Novo pedido” para pedir material ao Almoxarifado.'
                    : 'Tente outro filtro ou outra busca.'}
                </span>
              </div>
            ) : (
              <div className="p-list">
                {shown.map((o) => {
                  const st = statusOf.get(o.id)!;
                  const late = isLate(o);
                  return (
                    <button key={o.id} className={`p-row${needsAction(o) && seg !== 'acao' ? ' is-new' : ''}`} onClick={() => setOpenId(o.id)} aria-label={`Abrir pedido ${orderLabel(o.number)}`}>
                      <span className="p-num">{orderLabel(o.number)}</span>
                      <span className="p-main">
                        <b>{o.collaborator_name ?? o.posto_name ?? o.requester}</b>
                        <small>
                          {itemsSummary(o)} · {ORIGIN_LABEL[o.origin]} · {timeAgo(o.created_at)}
                          {o.needed_by || o.start_date ? ` · ${o.start_date && o.origin === 'rh_admissao' ? 'início' : 'até'} ${dateBR(o.start_date && o.origin === 'rh_admissao' ? o.start_date : o.needed_by)}` : ''}
                        </small>
                      </span>
                      <span className="p-tags">
                        {o.priority === 'urgente' ? (
                          <span className="pbadge urgent">
                            <Flame size={12} /> Urgente
                          </span>
                        ) : null}
                        {late ? <span className="pbadge red">Atrasado</span> : atRisk(o) ? <span className="pbadge amber">Começa logo</span> : null}
                        {o.flags.length ? (
                          <span className="pbadge amber" title={o.flags.join('\n')}>
                            <AlertTriangle size={12} /> Alerta
                          </span>
                        ) : null}
                        {o.items.some((l) => l.check) && o.stage !== 'concluido' && o.stage !== 'cancelado' ? <span className="pbadge lilac">Conferir item</span> : null}
                        <StatusPill status={st} />
                      </span>
                      <ChevronRight size={18} className="row-chevron" />
                    </button>
                  );
                })}
              </div>
            )}
            {data && shown.length ? (
              <p className="help" style={{ marginTop: 12 }}>
                {num(shown.length)} {shown.length === 1 ? 'pedido' : 'pedidos'}
                {shown.length !== orders.length ? ` de ${num(orders.length)}` : ''}.
              </p>
            ) : null}
          </>
        )}
      </div>

      <AnimatePresence>
        {current && data ? (
          <OrderDrawer
            key={current.id}
            scope={scope}
            user={user}
            order={current}
            status={statusOf.get(current.id)!}
            data={data}
            canEdit={canEdit}
            stockItems={stockItems ?? null}
            onClose={() => setOpenId(null)}
            reload={reload}
            modalOpen={creating}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {creating ? (
          <NewOrderSheet
            key="new"
            scope={scope === 'rh' ? 'rh' : 'operacao'}
            onClose={() => setCreating(false)}
            onSaved={async (o) => {
              setCreating(false);
              setSeg(scope === 'rh' ? 'abertos' : 'todos');
              await reload();
              setOpenId(o.id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
