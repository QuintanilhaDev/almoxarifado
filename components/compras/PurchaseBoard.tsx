'use client';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Flame,
  PackagePlus,
  Plus,
  Search,
  SendHorizontal,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { ConfirmModal } from '../core/Modal';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime, timeAgo } from '@/lib/format';
import { fold, isLow, itemLabel, num } from '@/lib/almoxarifado/stockFormat';
import type { StockItem } from '@/lib/almoxarifado/types';
import {
  CLOSED_STATUSES,
  COMPRAS_STATUSES,
  LIMITS,
  OPEN_STATUSES,
  STATUS_LABEL,
  itemsSummary,
  purchaseLabel,
  type PurchaseRequest,
  type PurchaseStatus,
} from '@/lib/compras/types';
import '../almoxarifado/estoque.css';
import './compras.css';
import '../pedidos/pedidos.css';
import { ReplenishSheet, useReplenishCount } from './Replenish';

export type BoardMode = 'almox' | 'compras';
type Filter = 'abertas' | 'novas' | 'andamento' | 'concluidas' | 'todas';

const TONE: Record<PurchaseStatus, string> = {
  nova: 'lilac',
  em_cotacao: 'amber',
  comprada: 'blue',
  entregue: 'green',
  recusada: 'red',
  cancelada: 'gray',
};
export function StatusBadge({ status }: { status: PurchaseStatus }) {
  return <span className={`pbadge ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const dateBR = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

/**
 * Quadro das solicitações de compra. O mesmo componente serve aos dois lados:
 *  - Almoxarifado: pede compras e acompanha (cancela enquanto está "nova");
 *  - Compras: recebe, muda o andamento e responde.
 */
export function PurchaseBoard({
  mode,
  requests,
  failed,
  canEdit,
  reload,
  items,
  prefill,
  onPrefillUsed,
  openId,
  setOpenId,
}: {
  mode: BoardMode;
  requests: PurchaseRequest[] | null;
  failed: string;
  canEdit: boolean;
  reload: () => Promise<void> | void;
  /** estoque (só no Almoxarifado, para montar o pedido) */
  items?: StockItem[] | null;
  /** abre o formulário já com este item (botão "Pedir compra" do Estoque) */
  prefill?: string | null;
  onPrefillUsed?: () => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<Filter>('abertas');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ itemId?: string } | null>(null);
  const [replenish, setReplenish] = useState(false);
  const repCount = useReplenishCount(mode === 'almox' && canEdit, requests);

  useEffect(() => {
    if (prefill && canEdit && mode === 'almox' && items?.length) {
      setCreating({ itemId: prefill });
      onPrefillUsed?.();
    }
  }, [prefill, canEdit, mode, onPrefillUsed, items]);

  const list = useMemo(() => requests ?? [], [requests]);
  const count = useMemo(() => {
    const c = { abertas: 0, novas: 0, andamento: 0, concluidas: 0, todas: list.length };
    for (const r of list) {
      if (OPEN_STATUSES.includes(r.status)) c.abertas++;
      if (r.status === 'nova') c.novas++;
      if (r.status === 'em_cotacao' || r.status === 'comprada') c.andamento++;
      if (CLOSED_STATUSES.includes(r.status)) c.concluidas++;
    }
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const t = fold(query.trim()).replace(/^#0*/, '');
    return list.filter((r) => {
      if (filter === 'abertas' && !OPEN_STATUSES.includes(r.status)) return false;
      if (filter === 'novas' && r.status !== 'nova') return false;
      if (filter === 'andamento' && r.status !== 'em_cotacao' && r.status !== 'comprada') return false;
      if (filter === 'concluidas' && !CLOSED_STATUSES.includes(r.status)) return false;
      if (!t) return true;
      return fold(`${r.number} ${r.requested_by} ${r.handled_by ?? ''} ${r.reason ?? ''} ${r.items.map((i) => `${i.name} ${i.size ?? ''}`).join(' ')}`).includes(t);
    });
  }, [list, filter, query]);

  const filters: { id: Filter; label: string; n: number }[] =
    mode === 'compras'
      ? [
          { id: 'abertas', label: 'Em aberto', n: count.abertas },
          { id: 'novas', label: 'Novas', n: count.novas },
          { id: 'andamento', label: 'Em andamento', n: count.andamento },
          { id: 'concluidas', label: 'Concluídas', n: count.concluidas },
          { id: 'todas', label: 'Todas', n: count.todas },
        ]
      : [
          { id: 'abertas', label: 'Em aberto', n: count.abertas },
          { id: 'concluidas', label: 'Concluídas', n: count.concluidas },
          { id: 'todas', label: 'Todas', n: count.todas },
        ];

  const open = openId ? list.find((r) => r.id === openId) ?? null : null;

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>{mode === 'compras' ? 'Solicitações de compra' : 'Compras'}</h1>
            <p>
              {mode === 'compras'
                ? 'Pedidos que chegam do Almoxarifado. Atualize o andamento e responda: o Almoxarifado vê na hora.'
                : 'Peça ao setor de Compras o que precisa ser comprado e acompanhe cada pedido até a entrega.'}
            </p>
          </div>
          {mode === 'almox' ? (
            <div className="head-actions">
              <button className="btn btn-ghost edit-only" onClick={() => setReplenish(true)} disabled={!canEdit}>
                <PackagePlus size={18} /> Reposição sugerida{repCount ? ` (${repCount})` : ''}
              </button>
              <button className="btn btn-primary edit-only" onClick={() => setCreating({})} disabled={!canEdit}>
                <Plus size={18} /> Nova solicitação de compra
              </button>
            </div>
          ) : null}
        </div>

        {mode === 'almox' && canEdit && repCount ? (
          <div className="banner">
            <AlertTriangle size={20} color="var(--amber)" />
            <span>
              {repCount === 1 ? '1 item chegou' : `${repCount} itens chegaram`} ao ponto de reposição (consumo médio × prazo, já descontando o que está para chegar).
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setReplenish(true)}>
              Ver sugestão
            </button>
          </div>
        ) : null}
        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Filtrar solicitações de compra">
            {filters.map((f) => (
              <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
                {f.label} <em>{num(f.n)}</em>
              </button>
            ))}
          </div>
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por número, item ou pessoa" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar solicitações de compra" />
          </div>
        </div>

        {failed && requests === null ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar as solicitações de compra</strong>
            <span>{failed}</span>
          </div>
        ) : requests === null ? (
          <div className="p-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 76, borderRadius: 16 }} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <ShoppingCart size={24} />
            </span>
            <strong>{list.length === 0 ? 'Nenhuma solicitação de compra ainda' : 'Nada neste filtro'}</strong>
            <span>
              {list.length === 0
                ? mode === 'compras'
                  ? 'Quando o Almoxarifado pedir uma compra, ela aparece aqui na hora e a Max avisa.'
                  : 'Use “Nova solicitação de compra” para pedir itens ao setor de Compras.'
                : 'Tente outro filtro ou outra busca.'}
            </span>
          </div>
        ) : (
          <div className="p-list">
            {shown.map((r) => (
              <button key={r.id} className={`p-row${r.status === 'nova' && mode === 'compras' ? ' is-new' : ''}`} onClick={() => setOpenId(r.id)} aria-label={`Abrir solicitação de compra ${purchaseLabel(r.number)}`}>
                <span className="p-num">{purchaseLabel(r.number)}</span>
                <span className="p-main">
                  <b>{itemsSummary(r.items)}</b>
                  <small>
                    {r.requested_by} · {timeAgo(r.created_at)}
                    {r.needed_by ? ` · precisa até ${dateBR(r.needed_by)}` : ''}
                  </small>
                </span>
                <span className="p-tags">
                  {r.priority === 'urgente' ? (
                    <span className="pbadge urgent">
                      <Flame size={12} /> Urgente
                    </span>
                  ) : null}
                  <StatusBadge status={r.status} />
                </span>
                <ChevronRight size={18} className="row-chevron" />
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {open ? <PurchaseDrawer key={open.id} mode={mode} req={open} canEdit={canEdit} onClose={() => setOpenId(null)} reload={reload} modalOpen={Boolean(creating)} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {replenish ? (
          <ReplenishSheet
            key="rep"
            onClose={() => setReplenish(false)}
            onSaved={async (id) => {
              setReplenish(false);
              setFilter('abertas');
              await reload();
              setOpenId(id);
            }}
          />
        ) : null}
        {creating ? (
          <NewPurchase
            key="n"
            items={items ?? []}
            initialItemId={creating.itemId}
            onClose={() => setCreating(null)}
            onSaved={async (r) => {
              setCreating(null);
              setFilter('abertas');
              await reload();
              setOpenId(r.id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* detalhe                                                             */
/* ------------------------------------------------------------------ */
function PurchaseDrawer({
  mode,
  req,
  canEdit,
  onClose,
  reload,
  modalOpen,
}: {
  mode: BoardMode;
  req: PurchaseRequest;
  canEdit: boolean;
  onClose: () => void;
  reload: () => Promise<void> | void;
  modalOpen: boolean;
}) {
  const toast = useToast();
  const [response, setResponse] = useState(req.response ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cancelAsk, setCancelAsk] = useState(false);
  const dirty = (req.response ?? '') !== response;

  // outra pessoa respondeu enquanto a gaveta estava aberta: mostra a resposta nova,
  // a não ser que eu já tenha começado a digitar outra coisa
  const lastResp = useRef(req.response);
  useEffect(() => {
    const before = lastResp.current ?? '';
    if (before !== (req.response ?? '')) {
      lastResp.current = req.response;
      setResponse((cur) => (cur === before ? req.response ?? '' : cur));
    }
  }, [req.response]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && !cancelAsk && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen, cancelAsk]);

  const send = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError('');
    try {
      await api(`/api/compras/requests/${req.id}`, { method: 'PATCH', json: { ...body, expected: req.status } });
      toast({ kind: 'success', title: label, text: purchaseLabel(req.number) });
      await reload();
    } catch (e) {
      setError((e as Error).message);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const closed = req.status === 'cancelada';
  const total = req.items.reduce((t, i) => t + i.quantity, 0);
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Solicitação de compra ${purchaseLabel(req.number)}`}
        initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }}
        animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }}
        exit={{ x: 60, opacity: 0, rotateY: deg(-18) }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2 className="p-title">
              Solicitação {purchaseLabel(req.number)} <StatusBadge status={req.status} />
              {req.priority === 'urgente' ? (
                <span className="pbadge urgent">
                  <Flame size={12} /> Urgente
                </span>
              ) : null}
            </h2>
            <p>
              Pedida por {req.requested_by} (Almoxarifado) · {formatDateTime(req.created_at)}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Itens</small>
              <b>{num(req.items.length)}</b>
            </div>
            <div>
              <small>Unidades</small>
              <b>{num(total)}</b>
            </div>
            <div>
              <small>Precisa até</small>
              <b className="p-date">{req.needed_by ? dateBR(req.needed_by) : '—'}</b>
            </div>
          </div>

          {req.supplier || req.expected_date || req.order_ref ? (
            <div className="p-answer" style={{ fontSize: 14 }}>
              {req.supplier ? <div>Fornecedor: <b>{req.supplier}</b></div> : null}
              {req.order_ref ? <div>Pedido de compra: <b>{req.order_ref}</b></div> : null}
              {req.expected_date ? <div>Previsão de entrega: <b>{dateBR(req.expected_date)}</b></div> : null}
            </div>
          ) : null}
          {req.reason ? (
            <div>
              <h3 className="sec-title">Motivo</h3>
              <p className="p-text">{req.reason}</p>
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Itens pedidos</h3>
            <div className="p-items">
              {req.items.map((i, n) => (
                <div className="p-item" key={n}>
                  <span>
                    <b>{itemLabel(i)}</b>
                    <small>
                      {i.item_id ? (i.stock !== null ? `Saldo no pedido: ${num(i.stock)}${i.min ? ` · mín. ${num(i.min)}` : ''}` : 'Item do estoque') : 'Item novo (fora do estoque)'}
                      {i.note ? ` · ${i.note}` : ''}
                    </small>
                    {(i as { orders?: { number: number }[] }).orders?.length ? <small className="o-buy">para o pedido de material {(i as { orders?: { number: number }[] }).orders!.map((o) => '#' + String(o.number).padStart(4, '0')).join(', ')}</small> : null}
                  </span>
                  <strong>
                    {num(i.quantity)} <small>{i.unit}</small>
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {mode === 'compras' && canEdit && !closed ? (
            <div>
              <h3 className="sec-title">Andamento</h3>
              <div className="p-steps" role="group" aria-label="Mudar andamento">
                {COMPRAS_STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`p-step ${TONE[s]}${req.status === s ? ' is-on' : ''}`}
                    disabled={Boolean(busy) || req.status === s}
                    aria-pressed={req.status === s}
                    onClick={() => send(dirty ? { status: s, response } : { status: s }, `Marcada como ${STATUS_LABEL[s].toLowerCase()}`)}
                  >
                    {busy === `Marcada como ${STATUS_LABEL[s].toLowerCase()}` ? <span className="spinner" /> : null}
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <PurchaseInfoFields req={req} disabled={Boolean(busy)} onSave={(body) => send(body, 'Dados da compra salvos')} />
              <label className="label" htmlFor="p-resp" style={{ marginTop: 14 }}>
                Resposta para o Almoxarifado <span className="opt-tag">(opcional)</span>
              </label>
              <textarea
                id="p-resp"
                className="textarea"
                rows={3}
                maxLength={LIMITS.response}
                placeholder="Ex.: Cotado com 3 fornecedores, chega na sexta."
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
              <div className="drawer-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" disabled={!dirty || Boolean(busy)} onClick={() => send({ response }, 'Resposta enviada')}>
                  {busy === 'Resposta enviada' ? <span className="spinner" /> : <SendHorizontal size={15} />} Enviar resposta
                </button>
              </div>
            </div>
          ) : req.response ? (
            <div>
              <h3 className="sec-title">Resposta de Compras</h3>
              <p className="p-text p-answer">
                {req.response}
                {req.handled_by ? <small> — {req.handled_by}</small> : null}
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="sx-error" role="alert">
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Histórico</h3>
            <ol className="p-history">
              {[...req.history].reverse().map((h, n) => (
                <li key={n}>
                  <StatusBadge status={h.status} />
                  <span>
                    {h.by} · {formatDateTime(h.at)}
                    {h.note ? <em>“{h.note}”</em> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {mode === 'almox' && canEdit && req.status === 'nova' ? (
            <div className="drawer-actions" style={{ marginTop: 'auto' }}>
              <button className="btn btn-danger btn-sm" onClick={() => setCancelAsk(true)} disabled={Boolean(busy)}>
                <Trash2 size={15} /> Cancelar solicitação
              </button>
            </div>
          ) : null}
          {mode === 'almox' && req.status !== 'nova' && !closed && OPEN_STATUSES.includes(req.status) ? (
            <p className="help">Compras já está cuidando deste pedido. Para mudar algo, fale com o setor de Compras.</p>
          ) : null}
        </div>
      </motion.aside>
      <ConfirmModal
        open={cancelAsk}
        title={`Cancelar a solicitação ${purchaseLabel(req.number)}?`}
        text="O setor de Compras verá o pedido como cancelado. Não dá para desfazer."
        confirmLabel="Cancelar solicitação"
        danger
        busy={busy === 'Solicitação cancelada'}
        onConfirm={async () => {
          await send({ status: 'cancelada' }, 'Solicitação cancelada');
          setCancelAsk(false);
        }}
        onClose={() => !busy && setCancelAsk(false)}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* nova solicitação (Almoxarifado)                                     */
/* ------------------------------------------------------------------ */
interface Line {
  key: number;
  item_id: string | null;
  name: string;
  size: string;
  quantity: string;
  note: string;
}
/** quanto pedir de um item baixo: o suficiente para chegar a 2× o mínimo */
const suggest = (i: StockItem) => Math.max(1, i.min_quantity * 2 - i.quantity);

function NewPurchase({ items, initialItemId, onClose, onSaved }: { items: StockItem[]; initialItemId?: string; onClose: () => void; onSaved: (r: PurchaseRequest) => void }) {
  const seq = useRef(0);
  const fromItem = (i: StockItem, q?: number): Line => ({ key: ++seq.current, item_id: i.id, name: i.name, size: i.size ?? '', quantity: String(q ?? suggest(i)), note: '' });
  const blank = (): Line => ({ key: ++seq.current, item_id: null, name: '', size: '', quantity: '1', note: '' });
  const [lines, setLines] = useState<Line[]>(() => {
    const it = initialItemId ? items.find((i) => i.id === initialItemId) : null;
    return [it ? fromItem(it) : blank()];
  });
  const [priority, setPriority] = useState<'normal' | 'urgente'>('normal');
  const [neededBy, setNeededBy] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const low = useMemo(() => items.filter(isLow).filter((i) => !lines.some((l) => l.item_id === i.id)), [items, lines]);
  const set = (key: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setError('');
  };
  const addLow = (list: StockItem[]) =>
    setLines((ls) => {
      const keep = ls.filter((l) => l.item_id || l.name.trim()); // troca a linha vazia
      return [...keep, ...list.slice(0, LIMITS.items - keep.length).map((i) => fromItem(i))];
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const filled = lines.filter((l) => l.item_id || l.name.trim());
    if (!filled.length) return setError('Adicione pelo menos um item.');
    // tira as linhas vazias da tela também: assim "Item 2" no aviso de erro é a 2ª linha que a pessoa vê
    if (filled.length !== lines.length) setLines(filled);
    setBusy(true);
    try {
      const j = await api<{ request: PurchaseRequest }>('/api/compras/requests', {
        method: 'POST',
        json: {
          items: filled.map((l) => ({ item_id: l.item_id, name: l.name, size: l.size, quantity: l.quantity.trim(), note: l.note })),
          priority,
          needed_by: neededBy || null,
          reason,
        },
      });
      onSaved(j.request);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  return (
    <Sheet title="Nova solicitação de compra" lead="O setor de Compras recebe na hora, com aviso na tela e da Max." onClose={onClose} wide locked>
      <form onSubmit={submit} noValidate>
        {low.length ? (
          <div className="p-low">
            <span>
              <AlertTriangle size={15} /> {low.length === 1 ? '1 item está' : `${low.length} itens estão`} com estoque baixo:
            </span>
            <div className="p-low-chips">
              {low.slice(0, 6).map((i) => (
                <button type="button" key={i.id} className="cat-chip" onClick={() => addLow([i])} title={`Saldo ${i.quantity} · mínimo ${i.min_quantity}`}>
                  <Plus size={13} /> {itemLabel(i)} <em>{num(i.quantity)}</em>
                </button>
              ))}
              {low.length > 1 ? (
                <button type="button" className="cat-chip is-on" onClick={() => addLow(low)}>
                  Adicionar todos
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="p-lines">
          {lines.map((l, n) => (
            <LineRow key={l.key} n={n} line={l} items={items} taken={lines.filter((x) => x.key !== l.key && x.item_id).map((x) => x.item_id!)} onChange={(p) => set(l.key, p)} onRemove={lines.length > 1 ? () => setLines((ls) => ls.filter((x) => x.key !== l.key)) : undefined} />
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, blank()])} disabled={lines.length >= LIMITS.items} style={{ marginBottom: 16 }}>
          <Plus size={15} /> Adicionar item
        </button>

        <div className="sx-grid">
          <div>
            <span className="label">Prioridade</span>
            <div className="filter-seg" role="group" aria-label="Prioridade">
              <button type="button" className={priority === 'normal' ? 'is-active' : ''} onClick={() => setPriority('normal')} aria-pressed={priority === 'normal'}>
                Normal
              </button>
              <button type="button" className={priority === 'urgente' ? 'is-active' : ''} onClick={() => setPriority('urgente')} aria-pressed={priority === 'urgente'}>
                <Flame size={14} /> Urgente
              </button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="p-needed">
              <CalendarClock size={14} style={{ verticalAlign: '-2px' }} /> Precisa até <span className="opt-tag">(opcional)</span>
            </label>
            <input id="p-needed" type="date" className="input" min={today} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          <div className="full">
            <label className="label" htmlFor="p-reason">
              Motivo <span className="opt-tag">(opcional)</span>
            </label>
            <textarea id="p-reason" className="textarea" rows={2} maxLength={LIMITS.reason} placeholder="Ex.: reposição do estoque mínimo; novo posto no Shopping Barra." value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <PackagePlus size={18} />} Enviar para Compras
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Uma linha do pedido: busca no estoque (ou item novo) + quantidade. */
function LineRow({ n, line, items, taken, onChange, onRemove }: { n: number; line: Line; items: StockItem[]; taken: string[]; onChange: (p: Partial<Line>) => void; onRemove?: () => void }) {
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const text = line.item_id ? itemLabel({ name: line.name, size: line.size || null }) : line.name;
  const hits = useMemo(() => {
    const t = fold(line.name.trim());
    if (!t || line.item_id) return [];
    const words = t.split(/\s+/);
    return items.filter((i) => !taken.includes(i.id) && words.every((w) => fold(`${i.name} ${i.size ?? ''}`).includes(w))).slice(0, 7);
  }, [line.name, line.item_id, items, taken]);
  const pick = (i: StockItem) => {
    onChange({ item_id: i.id, name: i.name, size: i.size ?? '', quantity: line.quantity && line.quantity !== '1' ? line.quantity : String(suggest(i)) });
    setFocus(false);
  };
  const stockItem = line.item_id ? items.find((i) => i.id === line.item_id) : null;
  return (
    <div className="p-line">
      <span className="p-line-n">{n + 1}</span>
      <div className="p-line-item">
        <input
          className="input"
          aria-label={`Item ${n + 1}`}
          placeholder="Busque no estoque ou digite um item novo"
          value={text}
          maxLength={LIMITS.name}
          onChange={(e) => {
            onChange({ item_id: null, name: e.target.value, size: '' });
            setHi(0);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (!hits.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(hits.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(hits[hi] ?? hits[0]);
            }
          }}
        />
        {focus && hits.length ? (
          <div className="p-suggest" role="listbox">
            {hits.map((i, k) => (
              <button type="button" role="option" aria-selected={k === hi} key={i.id} className={k === hi ? 'is-hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                <b>{itemLabel(i)}</b>
                <small>
                  saldo {num(i.quantity)}
                  {i.min_quantity ? ` · mín. ${num(i.min_quantity)}` : ''}
                </small>
              </button>
            ))}
          </div>
        ) : null}
        <small className="p-line-hint">
          {stockItem
            ? `Do estoque · saldo ${num(stockItem.quantity)}${stockItem.min_quantity ? ` · mín. ${num(stockItem.min_quantity)}` : ''}`
            : line.name.trim()
              ? 'Item novo (fora do estoque)'
              : ' '}
        </small>
      </div>
      {/* item do estoque: o tamanho vem do cadastro (só leitura) */}
      <input
        className="input p-line-size"
        aria-label={`Tamanho do item ${n + 1}`}
        placeholder="Tam."
        value={line.item_id ? line.size || '—' : line.size}
        readOnly={Boolean(line.item_id)}
        tabIndex={line.item_id ? -1 : undefined}
        maxLength={40}
        onChange={(e) => onChange({ size: e.target.value })}
      />
      <input className="input p-line-qty" aria-label={`Quantidade do item ${n + 1}`} inputMode="numeric" value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })} max={LIMITS.quantity} />
      {onRemove ? (
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remover item ${n + 1}`}>
          <X size={16} />
        </button>
      ) : (
        <span className="p-line-gap" />
      )}
    </div>
  );
}

/** Compras informa fornecedor, nº do pedido de compra e previsão: o Almoxarifado e os pedidos ligados veem na hora. */
function PurchaseInfoFields({ req, disabled, onSave }: { req: PurchaseRequest; disabled: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [supplier, setSupplier] = useState(req.supplier ?? '');
  const [ref, setRef] = useState(req.order_ref ?? '');
  const [date, setDate] = useState(req.expected_date ?? '');
  useEffect(() => {
    setSupplier(req.supplier ?? '');
    setRef(req.order_ref ?? '');
    setDate(req.expected_date ?? '');
  }, [req.supplier, req.order_ref, req.expected_date]);
  const dirty = supplier !== (req.supplier ?? '') || ref !== (req.order_ref ?? '') || date !== (req.expected_date ?? '');
  return (
    <div className="sx-grid" style={{ marginTop: 14 }}>
      <div>
        <label className="label" htmlFor="p-sup">
          Fornecedor
        </label>
        <input id="p-sup" className="input" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="p-ref">
          Nº do pedido de compra
        </label>
        <input id="p-ref" className="input" value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="p-exp">
          Previsão de entrega
        </label>
        <input id="p-exp" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div style={{ alignSelf: 'end' }}>
        <button className="btn btn-ghost btn-sm" disabled={disabled || !dirty} onClick={() => onSave({ supplier, order_ref: ref, expected_date: date })}>
          Salvar dados da compra
        </button>
      </div>
    </div>
  );
}
