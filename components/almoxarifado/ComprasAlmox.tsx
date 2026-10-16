'use client';
import { AlertTriangle, ClipboardList, PackageCheck, PackageOpen, ShieldAlert, ShoppingCart, Timer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useRealtime } from '@/lib/realtime';
import { num, itemLabel } from '@/lib/almoxarifado/stockFormat';
import type { StockItem } from '@/lib/almoxarifado/types';
import type { PurchaseRequest } from '@/lib/compras/types';
import { PO_OPEN, poDue, poLabel, poLate, poLeft, type PurchaseOrder } from '@/lib/compras/pc';
import type { FiscalNote } from '@/lib/notas/server';
import { PurchaseBoard } from '../compras/PurchaseBoard';
import { PedidosCompra } from '../compras/PedidosCompra';
import { dateBR } from '../pedidos/ui';
import '../compras/compras.css';

type View = 'painel' | 'pedidos' | 'solicitacoes';
type OnOrder = Record<string, { qty: number; next: string | null; late: boolean }>;

/**
 * Compras no Almoxarifado (Juliana): painel do recebimento, os pedidos de compra com as
 * condições (sem precisar perguntar a Compras) e as solicitações de compra.
 */
export function ComprasAlmox({
  requests,
  failed,
  canEdit,
  canNotes,
  reload,
  items,
  prefill,
  onPrefillUsed,
  openId,
  setOpenId,
  toRelease,
  onReceive,
  onRelease,
  onNote,
  poOpen,
  setPoOpen,
  onBuy,
}: {
  /** pedir compra deste item (abre a solicitação já preenchida) */
  onBuy: (itemId: string) => void;
  requests: PurchaseRequest[] | null;
  failed: string;
  canEdit: boolean;
  canNotes: boolean;
  reload: () => Promise<void> | void;
  items: StockItem[] | null;
  prefill: string | null;
  onPrefillUsed: () => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** pedidos de material encaminhados, esperando o Almoxarifado */
  toRelease: number;
  onReceive: (o: PurchaseOrder) => void;
  onRelease: () => void;
  onNote: (id: string) => void;
  poOpen: string | null;
  setPoOpen: (id: string | null) => void;
}) {
  const [view, setView] = useState<View>(prefill || openId ? 'solicitacoes' : poOpen ? 'pedidos' : 'painel');
  useEffect(() => {
    if (prefill || openId) setView('solicitacoes');
  }, [prefill, openId]);
  useEffect(() => {
    if (poOpen) setView('pedidos');
  }, [poOpen]);
  const [newSignal, setNewSignal] = useState(0);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [setupMsg, setSetupMsg] = useState('');
  const [notes, setNotes] = useState<FiscalNote[] | null>(null);
  const [onOrder, setOnOrder] = useState<OnOrder>({});
  const load = useCallback(async () => {
    try {
      setOrders((await api<{ orders: PurchaseOrder[] }>('/api/compras/pedidos')).orders);
      setSetupMsg('');
    } catch (e) {
      setSetupMsg((e as Error).message);
      setOrders([]);
    }
    if (canNotes) api<{ notes: FiscalNote[] }>('/api/almoxarifado/notas').then((j) => setNotes(j.notes)).catch(() => setNotes([]));
    api<{ on_order: OnOrder }>('/api/almoxarifado/stock/a-receber').then((j) => setOnOrder(j.on_order)).catch(() => undefined);
  }, [canNotes]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((ev) => (ev === 'purchase:update' || ev === 'purchase:new' || ev === 'note:update' || ev === 'stock:update') && void load(), () => void load(), 60_000);

  const live = useMemo(() => (orders ?? []).filter((o) => PO_OPEN.includes(o.status)), [orders]);
  const late = live.filter((o) => poLate(o));
  const arriving = [...live].sort((a, b) => String(poDue(a) ?? '9999').localeCompare(String(poDue(b) ?? '9999')));
  const partial = (notes ?? []).filter((n) => n.status === 'parcial');
  const pendingNotes = (notes ?? []).filter((n) => ['aberta', 'conferencia', 'divergencia'].includes(n.status));
  const divergent = (notes ?? []).filter((n) => (n.divergences ?? []).some((d) => d.status !== 'resolvida'));
  const low = (items ?? []).filter((i) => i.active !== false && i.min_quantity > 0 && i.quantity - (i.reserved ?? 0) <= i.min_quantity);
  const lowNoBuy = low.filter((i) => !onOrder[i.id]?.qty);

  return (
    <div className="pc-almox">
      <div className="section-pad wide pc-almox-tabs">
        <div className="filter-seg o-segs" role="tablist" aria-label="Compras">
          <button className={view === 'painel' ? 'is-active' : ''} onClick={() => setView('painel')}>
            Painel do recebimento
          </button>
          <button className={view === 'pedidos' ? 'is-active' : ''} onClick={() => setView('pedidos')}>
            Pedidos de compra <em>{num(live.length)}</em>
          </button>
          <button className={view === 'solicitacoes' ? 'is-active' : ''} onClick={() => setView('solicitacoes')}>
            Solicitações de compra
          </button>
        </div>
        {view !== 'solicitacoes' ? (
          <button
            data-max="compra-nova"
            className="btn btn-ghost btn-sm edit-only pc-new-req"
            disabled={!canEdit}
            onClick={() => {
              setView('solicitacoes');
              setNewSignal((n) => n + 1);
            }}
          >
            <ShoppingCart size={15} /> Nova solicitação de compra
          </button>
        ) : null}
      </div>
      {view === 'painel' ? (
        <div className="section-scroll">
        <div className="section-pad wide" style={{ paddingTop: 0 }}>
          {setupMsg ? <div className="banner">{setupMsg}</div> : null}
          <div className="stat-grid pc-stats">
            {(
              [
                ['Requisições a liberar', toRelease, ClipboardList, false],
                ['Abaixo do mínimo', low.length, AlertTriangle, low.length > 0],
                ['Pedidos a receber', live.length, PackageOpen, false],
                ['Entregas atrasadas', late.length, Timer, late.length > 0],
                ['Notas a conferir', pendingNotes.length, PackageCheck, false],
                ['Divergências de nota', divergent.length, ShieldAlert, divergent.length > 0],
              ] as const
            ).map(([label, v, I, bad]) => (
              <div className="stat" key={label}>
                <small>
                  <I size={13} style={{ verticalAlign: '-2px' }} /> {label}
                </small>
                <b style={{ color: bad ? 'var(--danger)' : undefined }}>{num(v)}</b>
              </div>
            ))}
          </div>
          <div className="pc-grid">
            <section className="pc-card">
              <h3 className="sec-title">Chegando</h3>
              {!orders ? (
                <div className="skeleton" style={{ height: 70, borderRadius: 12 }} />
              ) : !arriving.length ? (
                <p className="help">Nenhum pedido de compra esperando entrega.</p>
              ) : (
                <ul className="pc-todo">
                  {arriving.slice(0, 10).map((o) => (
                    <li key={o.id} className={poLate(o) ? 'is-red' : ''}>
                      <PackageOpen size={16} />
                      <span>
                        {poDue(o) ? dateBR(poDue(o)) : 'sem data'} · {poLabel(o.number)} · {o.supplier_name} ({num(o.items.reduce((t, i) => t + poLeft(i), 0))} un.)
                        {poLate(o) ? ' · atrasado' : ''}
                      </span>
                      {canNotes ? (
                        <button className="btn btn-primary btn-sm" onClick={() => onReceive(o)}>
                          Receber
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setPoOpen(o.id)}>
                          Ver
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="pc-card">
              <h3 className="sec-title">Requer atenção</h3>
              <ul className="pc-todo">
                {toRelease ? (
                  <li>
                    <ClipboardList size={16} />
                    <span>
                      {toRelease === 1 ? '1 pedido de material' : `${toRelease} pedidos de material`} esperando reserva ou entrega
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={onRelease}>
                      Abrir
                    </button>
                  </li>
                ) : null}
                {divergent.map((n) => (
                  <li key={n.id} className="is-red">
                    <ShieldAlert size={16} />
                    <span>
                      NF {n.number} · {n.supplier_name}: {(n.divergences ?? []).filter((d) => d.status !== 'resolvida').length} divergência(s){(n.divergences ?? []).some((d) => d.status !== 'resolvida' && d.blocking) ? ' — esperando Compras' : ''}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => onNote(n.id)}>
                      Abrir
                    </button>
                  </li>
                ))}
                {partial.map((n) => (
                  <li key={n.id}>
                    <PackageCheck size={16} />
                    <span>
                      NF {n.number} · {n.supplier_name}: recebimento parcial
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => onNote(n.id)}>
                      Abrir
                    </button>
                  </li>
                ))}
                {pendingNotes
                  .filter((n) => !divergent.includes(n))
                  .map((n) => (
                    <li key={n.id}>
                      <PackageCheck size={16} />
                      <span>
                        NF {n.number} · {n.supplier_name}: falta conferir e dar entrada
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => onNote(n.id)}>
                        Abrir
                      </button>
                    </li>
                  ))}
                {!toRelease && !divergent.length && !partial.length && !pendingNotes.length ? <p className="help">Nada pendente.</p> : null}
              </ul>
            </section>
            <section className="pc-card">
              <h3 className="sec-title">Abaixo do ponto de reposição</h3>
              {!low.length ? (
                <p className="help">Nenhum item abaixo do mínimo.</p>
              ) : (
                <ul className="pc-todo">
                  {[...lowNoBuy, ...low.filter((i) => !lowNoBuy.includes(i))].slice(0, 12).map((i) => {
                    const oo = onOrder[i.id];
                    return (
                      <li key={i.id} className={!oo?.qty || oo.late ? 'is-red' : ''}>
                        <AlertTriangle size={16} />
                        <span>
                          {itemLabel(i)}: disponível {num(i.quantity - (i.reserved ?? 0))}, mínimo {num(i.min_quantity)}
                          {oo?.qty ? ` · ${num(oo.qty)} a receber${oo.next ? ` em ${dateBR(oo.next)}` : ''}${oo.late ? ' (atrasado)' : ''}` : ' · sem compra'}
                        </span>
                        {!oo?.qty && canEdit ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setOpenId(null);
                              onBuy(i.id);
                            }}
                          >
                            <ShoppingCart size={13} /> Pedir
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
        </div>
      ) : view === 'pedidos' ? (
        <PedidosCompra mode="almox" orders={orders} config={null} canEdit={false} canApprove={false} me="" reload={load} openId={poOpen} setOpenId={setPoOpen} onReceive={canNotes ? onReceive : undefined} />
      ) : (
        <PurchaseBoard mode="almox" requests={requests} failed={failed} canEdit={canEdit} reload={reload} items={items} prefill={prefill} onPrefillUsed={onPrefillUsed} openId={openId} setOpenId={setOpenId} newSignal={newSignal} />
      )}
    </div>
  );
}
