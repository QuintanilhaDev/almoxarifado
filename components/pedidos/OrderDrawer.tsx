'use client';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileText,
  Flame,
  Link2,
  PackageCheck,
  SendHorizontal,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime } from '@/lib/format';
import { num } from '@/lib/almoxarifado/stockFormat';
import { canManageSector, hasLevel, type HubUser } from '@/lib/permissions';
import type { OrderScope } from '@/lib/pedidos/access';
import { ORIGIN_LABEL, isRhOrigin, itemStatus, lineLabel, orderLabel, type MaterialOrder, type OrderItem, type OrderStatus } from '@/lib/pedidos/types';
import type { PedidosData } from './usePedidos';
import { ItemPicker, StatusPill, dateBR, type PickItem } from './ui';

interface Delivery {
  id: string;
  group_id: string;
  item_name: string;
  size: string | null;
  qty: number;
  returned_qty: number;
  receiver: string | null;
  by_name: string | null;
  delivered_at: string;
}
interface PlanLine {
  i: number;
  reserve: number;
  purchase: number;
  minimum: boolean;
  pending: boolean;
}
type Mode = 'deliver' | 'reserve';

const PSTATUS: Record<string, string> = { nova: 'nova', em_cotacao: 'em cotação', comprada: 'comprada', entregue: 'entregue', recusada: 'recusada', cancelada: 'cancelada' };

export function OrderDrawer({
  scope,
  user,
  order: o,
  status,
  data,
  canEdit,
  stockItems,
  onClose,
  reload,
  modalOpen,
}: {
  scope: OrderScope;
  user: HubUser | null;
  order: MaterialOrder;
  status: OrderStatus;
  data: PedidosData;
  canEdit: boolean;
  stockItems: PickItem[] | null;
  onClose: () => void;
  reload: () => Promise<void>;
  modalOpen: boolean;
}) {
  const toast = useToast();
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [plan, setPlan] = useState<PlanLine[] | null>(null);
  const [planHidden, setPlanHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<Mode | null>(null);
  const [ask, setAsk] = useState<null | 'cancel' | 'return' | 'release'>(null);
  const [minAsk, setMinAsk] = useState<{ action: string; body: Record<string, unknown>; message: string } | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  const [giveBack, setGiveBack] = useState<Delivery | null>(null);

  const almox = scope === 'almox';
  const almoxMaster = canManageSector(user, 'almoxarifado');
  const open = o.stage !== 'concluido' && o.stage !== 'cancelado';
  const withAlmox = o.stage === 'encaminhado';
  const anyModal = modalOpen || Boolean(sheet || ask || minAsk || giveBack);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !anyModal && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, anyModal]);

  // entregas (termos) do pedido
  useEffect(() => {
    let alive = true;
    api<{ deliveries: Delivery[] }>(`/api/pedidos/${o.id}`)
      .then((j) => alive && setDeliveries(j.deliveries))
      .catch(() => alive && setDeliveries([]));
    return () => {
      alive = false;
    };
  }, [o.id, o.updated_at]);

  // sugestão automática do Almoxarifado: calcula sozinha, mas só grava com a confirmação
  const openBuy = (l: OrderItem) => {
    const p = l.purchase_id ? data.purchases[l.purchase_id] : null;
    return Boolean(p && (p.status === 'nova' || p.status === 'em_cotacao' || p.status === 'comprada'));
  };
  // há o que reservar agora (saldo livre) ou o que pedir (sem compra aberta)
  const needsPlan = almox && canEdit && withAlmox && o.items.some((l) => l.qty - l.delivered - l.reserved > 0 && (!openBuy(l) || (l.item_id ? (data.free[l.item_id] ?? 0) > 0 : false)));
  useEffect(() => {
    if (!needsPlan) {
      setPlan(null);
      return;
    }
    let alive = true;
    api<{ plan: PlanLine[] }>(`/api/pedidos/${o.id}/auto`, { method: 'POST', json: {} })
      .then((j) => alive && setPlan(j.plan))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [needsPlan, o.id, o.updated_at]);

  const act = useCallback(
    async (action: string, body: Record<string, unknown>, done: string) => {
      setBusy(action);
      setError('');
      try {
        const j = await api<{ result: { group_id?: string; units?: number; done?: boolean; purchase?: { number: number } | null; reserved?: number } }>(`/api/pedidos/${o.id}/${action}`, { method: 'POST', json: body });
        const r = j.result ?? {};
        if (action === 'deliver' && r.group_id) {
          toast(
            { kind: 'success', title: r.done ? `Pedido ${orderLabel(o.number)} entregue por completo` : 'Entrega registrada', text: `${num(r.units ?? 0)} unidade(s) · termo pronto para assinar`, action: { label: 'Abrir termo', onClick: () => window.open(`/termo/${r.group_id}`, '_blank') } },
            12000,
          );
        } else if (action === 'auto') {
          toast({ kind: 'success', title: 'Pedido atualizado', text: [r.reserved ? `${num(r.reserved)} unidade(s) reservada(s)` : '', r.purchase ? `compra nº ${r.purchase.number} enviada ao setor de Compras` : ''].filter(Boolean).join(' · ') || done });
        } else toast({ kind: 'success', title: done, text: orderLabel(o.number) });
        setSheet(null);
        setAsk(null);
        setMinAsk(null);
        await reload();
        return true;
      } catch (e) {
        const err = e as ApiError;
        if (err.data?.minimum) setMinAsk({ action, body, message: err.message });
        else setError(err.message);
        await reload();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [o.id, o.number, reload, toast],
  );

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(String(body.action));
    setError('');
    try {
      await api(`/api/pedidos/${o.id}`, { method: 'PATCH', json: body });
      toast({ kind: 'success', title: done, text: orderLabel(o.number) });
      setAsk(null);
      setLinking(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const units = o.items.reduce((t, l) => t + l.qty, 0);
  const delivered = o.items.reduce((t, l) => t + l.delivered, 0);
  const due = o.origin === 'rh_admissao' ? o.start_date : o.needed_by;
  const owner = scope === 'operacao' ? o.origin === 'operacao' : scope === 'rh' ? isRhOrigin(o.origin) : true;
  const canCancel = open && owner && (almox ? canEdit : canEdit && !o.items.some((l) => l.delivered > 0));
  const readyToDeliver = withAlmox && o.items.some((l) => l.reserved > 0);
  const terms = useMemo(() => {
    const g = new Map<string, Delivery[]>();
    for (const d of deliveries ?? []) g.set(d.group_id, [...(g.get(d.group_id) ?? []), d]);
    return [...g.entries()];
  }, [deliveries]);

  const planReserve = plan?.filter((p) => p.reserve > 0) ?? [];
  const planBuy = plan?.filter((p) => p.purchase > 0) ?? [];
  const planMin = plan?.filter((p) => p.minimum) ?? [];
  const showPlan = Boolean(plan && !planHidden && (planReserve.length || planBuy.length));

  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer o-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Pedido ${orderLabel(o.number)}`}
        initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }}
        animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }}
        exit={{ x: 60, opacity: 0, rotateY: deg(-18) }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2 className="p-title">
              Pedido {orderLabel(o.number)} <StatusPill status={status} />
              {o.priority === 'urgente' ? (
                <span className="pbadge urgent">
                  <Flame size={12} /> Urgente
                </span>
              ) : null}
            </h2>
            <p>
              {ORIGIN_LABEL[o.origin]} · aberto por {o.requester} · {formatDateTime(o.created_at)}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Unidades</small>
              <b>{num(units)}</b>
            </div>
            <div>
              <small>Entregues</small>
              <b style={{ color: delivered === units ? 'var(--mint)' : undefined }}>{num(delivered)}</b>
            </div>
            <div>
              <small>{o.origin === 'rh_admissao' ? 'Início' : 'Precisa até'}</small>
              <b className="p-date">{dateBR(due)}</b>
            </div>
          </div>

          {o.flags.length && open ? (
            <div className="o-flags" role="note">
              <AlertTriangle size={16} />
              <ul>
                {o.flags.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ---------- sugestão automática (confirmação manual) ---------- */}
          {showPlan ? (
            <div className="o-plan">
              <div className="o-plan-head">
                <Sparkles size={16} /> <b>Sugestão</b>
              </div>
              {planReserve.length ? (
                <p>
                  <span>Reservar:</span> {planReserve.map((p) => `${p.reserve} ${lineLabel(o.items[p.i])}`).join(', ')}
                </p>
              ) : null}
              {planBuy.length ? (
                <p>
                  <span>Comprar:</span> {planBuy.map((p) => `${p.purchase} ${lineLabel(o.items[p.i])}`).join(', ')}
                </p>
              ) : null}
              {planMin.length ? (
                <p className="o-plan-warn">
                  <AlertTriangle size={14} /> {planMin.map((p) => lineLabel(o.items[p.i])).join(', ')}: o saldo ficaria abaixo do mínimo.
                  {almoxMaster ? ' Você pode liberar na reserva ou na entrega.' : ' Só o master do Almoxarifado pode liberar.'}
                </p>
              ) : null}
              <div className="drawer-actions">
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => act('auto', { confirm: true }, 'Pedido atualizado')}>
                  {busy === 'auto' ? <span className="spinner" /> : <CheckCircle2 size={15} />} Confirmar sugestão
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPlanHidden(true)} disabled={Boolean(busy)}>
                  Ignorar
                </button>
              </div>
            </div>
          ) : null}

          {/* ---------- ações ---------- */}
          {canEdit && open ? (
            <div className="drawer-actions o-actions">
              {scope === 'operacao' && o.stage === 'solicitado' ? (
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || o.origin !== 'operacao'} onClick={() => patch({ action: 'forward' }, 'Encaminhado ao Almoxarifado')}>
                  {busy === 'forward' ? <span className="spinner" /> : <SendHorizontal size={15} />} Encaminhar ao Almoxarifado
                </button>
              ) : null}
              {scope === 'operacao' && o.stage === 'validacao' ? (
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => patch({ action: 'validate' }, 'Troca validada e encaminhada')}>
                  {busy === 'validate' ? <span className="spinner" /> : <ShieldCheck size={15} />} Validar troca
                </button>
              ) : null}
              {almox && withAlmox ? (
                <>
                  <button data-max="pedido-entregar" className={`btn btn-sm ${readyToDeliver ? 'btn-primary' : 'btn-ghost'}`} disabled={Boolean(busy)} onClick={() => setSheet('deliver')}>
                    <PackageCheck size={15} /> Entregar
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setSheet('reserve')}>
                    <Link2 size={15} /> Reservar
                  </button>
                  {o.items.some((l) => l.reserved > 0) ? (
                    <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setAsk('release')}>
                      <Unlock size={15} /> Liberar reservas
                    </button>
                  ) : null}
                  {!o.items.some((l) => l.reserved > 0 || l.delivered > 0) ? (
                    <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setAsk('return')}>
                      <Undo2 size={15} /> Devolver para correção
                    </button>
                  ) : null}
                </>
              ) : null}
              {canCancel ? (
                <button className="btn btn-ghost btn-sm o-danger" disabled={Boolean(busy)} onClick={() => setAsk('cancel')}>
                  <Ban size={15} /> Cancelar pedido
                </button>
              ) : null}
            </div>
          ) : null}
          {!almox && withAlmox && open ? <p className="help">O Almoxarifado está cuidando deste pedido. Para mudar algo, peça a devolução para correção.</p> : null}

          {error ? (
            <div className="sx-error" role="alert">
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}

          {/* ---------- itens ---------- */}
          <div>
            <h3 className="sec-title">Itens</h3>
            <div className="o-items">
              {o.items.map((l, i) => {
                const pur = l.purchase_id ? data.purchases[l.purchase_id] : null;
                const free = l.item_id ? data.free[l.item_id] ?? null : null;
                const st = o.stage === 'cancelado' ? 'cancelado' : itemStatus(l, pur ?? null, free);
                const missing = Math.max(0, l.qty - l.delivered);
                return (
                  <div key={i} className={`o-item${l.check ? ' is-check' : ''}`}>
                    <div className="o-item-top">
                      <b>{lineLabel(l)}</b>
                      <StatusPill status={st as OrderStatus} />
                    </div>
                    <div className="o-nums">
                      <span>
                        Pedido <b>{num(l.qty)}</b>
                      </span>
                      <span>
                        Reservado <b>{num(l.reserved)}</b>
                      </span>
                      <span>
                        Entregue <b>{num(l.delivered)}</b>
                      </span>
                      <span className={missing ? 'warn' : ''}>
                        Falta <b>{num(missing)}</b>
                      </span>
                      {almox && free !== null && open ? (
                        <span>
                          Disponível <b>{num(free)}</b>
                        </span>
                      ) : null}
                    </div>
                    {pur ? (
                      <small className="o-buy">
                        <ShoppingCart size={13} /> Compra nº {pur.number} · {PSTATUS[pur.status]}
                        {pur.supplier ? ` · ${pur.supplier}` : ''}
                        {pur.expected_date ? ` · previsão ${dateBR(pur.expected_date)}` : ''}
                      </small>
                    ) : null}
                    {l.note ? <small className="o-note">{l.note}</small> : null}
                    {l.check || !l.item_id ? (
                      almox && canEdit && open && !l.reserved && !l.delivered && stockItems ? (
                        linking === i ? (
                          <div className="o-link">
                            <LinkPicker items={stockItems} initial={l.name} onPick={(it) => patch({ action: 'link', i, item_id: it.id }, 'Item ligado ao estoque')} onCancel={() => setLinking(null)} />
                          </div>
                        ) : (
                          <button className="btn btn-ghost btn-sm o-link-btn" onClick={() => setLinking(i)}>
                            <Link2 size={14} /> {l.item_id ? 'Confirmar ou trocar o item do estoque' : 'Ligar a um item do estoque'}
                          </button>
                        )
                      ) : (
                        <small className="o-note">{l.item_id ? 'Item a conferir.' : 'Item fora do estoque, a conferir.'}</small>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---------- dados ---------- */}
          <div>
            <h3 className="sec-title">Dados do pedido</h3>
            {[
              ['Colaborador', o.collaborator_name],
              ['Matrícula', o.matricula],
              ['Função', o.role],
              ['Posto', o.posto_name],
              ['Empresa', o.company],
              ['Supervisor', o.supervisor],
              ['Motivo', o.reason],
              ['Encaminhado por', o.forwarded_by ? `${o.forwarded_by} · ${formatDateTime(o.forwarded_at!)}` : null],
              ['Validado por', o.validated_by ? `${o.validated_by} · ${formatDateTime(o.validated_at!)}` : null],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div className="kv-row" key={k as string}>
                  <span>{k}</span>
                  <b className="o-kv">{v}</b>
                </div>
              ))}
          </div>

          {/* ---------- termos ---------- */}
          {terms.length ? (
            <div>
              <h3 className="sec-title">Entregas e termos</h3>
              <div className="o-terms">
                {terms.map(([g, ds]) => (
                  <div key={g} className="o-term">
                    <div className="o-term-top">
                      <span>
                        <b>{formatDateTime(ds[0].delivered_at)}</b>
                        <small>
                          {ds[0].receiver ? `Recebido por ${ds[0].receiver}` : 'Entrega'} · {ds[0].by_name}
                        </small>
                      </span>
                      <a className="btn btn-ghost btn-sm" href={`/termo/${g}`} target="_blank" rel="noreferrer">
                        <FileText size={14} /> Termo
                      </a>
                    </div>
                    {ds.map((d) => (
                      <div key={d.id} className="o-term-line">
                        <span>
                          {d.qty} {d.item_name}
                          {d.size ? ` ${d.size}` : ''}
                          {d.returned_qty ? <em> · {d.returned_qty} devolvido(s)</em> : null}
                        </span>
                        {almox && canEdit && d.returned_qty < d.qty ? (
                          <button className="link-btn" onClick={() => setGiveBack(d)}>
                            Devolução
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Histórico</h3>
            <ol className="p-history o-history">
              {[...o.history].reverse().map((h, n) => (
                <li key={n}>
                  <span>
                    <em>{h.what}</em>
                    {h.by} · {formatDateTime(h.at)}
                    {h.term ? (
                      <>
                        {' · '}
                        <a href={`/termo/${h.term}`} target="_blank" rel="noreferrer">
                          termo
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.aside>

      <AnimatePresence>
        {sheet ? <QtySheet key={sheet} mode={sheet} order={o} data={data} busy={busy === sheet} error={error} onClose={() => setSheet(null)} onSubmit={(lines, receiver) => act(sheet, sheet === 'deliver' ? { lines, receiver } : { lines }, sheet === 'deliver' ? 'Entrega registrada' : 'Reserva feita')} /> : null}
        {ask ? (
          <AskSheet
            key={ask}
            kind={ask}
            busy={Boolean(busy)}
            error={error}
            onClose={() => setAsk(null)}
            onSubmit={(text) =>
              ask === 'cancel' ? act('cancel', { reason: text }, 'Pedido cancelado') : ask === 'release' ? act('release', {}, 'Reservas liberadas') : patch({ action: 'return', note: text }, 'Devolvido para correção')
            }
          />
        ) : null}
        {minAsk ? (
          <Sheet key="min" title="Liberação abaixo do mínimo" onClose={() => setMinAsk(null)}>
            <p className="o-min-text">{minAsk.message}</p>
            {almoxMaster ? (
              <p className="help">A liberação fica registrada no histórico do pedido com o seu nome.</p>
            ) : (
              <p className="help">Só o master do Almoxarifado pode autorizar. Peça a ele para abrir este pedido e confirmar.</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setMinAsk(null)} disabled={Boolean(busy)}>
                Voltar
              </button>
              {almoxMaster ? (
                <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => act(minAsk.action, { ...minAsk.body, force: true }, 'Liberação excepcional registrada')}>
                  {busy ? <span className="spinner" /> : <Unlock size={16} />} Liberar mesmo assim
                </button>
              ) : null}
            </div>
          </Sheet>
        ) : null}
        {giveBack ? <GiveBackSheet key="gb" d={giveBack} onClose={() => setGiveBack(null)} onDone={async () => { setGiveBack(null); await reload(); setDeliveries(null); }} /> : null}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
function LinkPicker({ items, initial, onPick, onCancel }: { items: PickItem[]; initial: string; onPick: (i: PickItem) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial.split(/\s+/).slice(0, 2).join(' '));
  return (
    <div className="o-link-row">
      <ItemPicker label="Item do estoque" value={{ item_id: null, text }} items={items} onPick={onPick} onText={setText} />
      <button className="icon-btn" onClick={onCancel} aria-label="Cancelar">
        <X size={16} />
      </button>
    </div>
  );
}

/** Entregar ou reservar: uma linha por item, já com a quantidade sugerida. */
function QtySheet({
  mode,
  order: o,
  data,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: Mode;
  order: MaterialOrder;
  data: PedidosData;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (lines: { i: number; qty: number }[], receiver: string) => Promise<boolean>;
}) {
  const rows = o.items
    .map((l, i) => ({ l, i, free: l.item_id ? Math.max(0, data.free[l.item_id] ?? 0) : 0, min: l.item_id ? data.mins?.[l.item_id] ?? 0 : 0 }))
    .filter(({ l }) => l.item_id && l.qty - l.delivered > (mode === 'reserve' ? l.reserved : 0));
  // a sugestão não fura o estoque mínimo (dá para digitar mais: aí pede a liberação excepcional)
  const above = (free: number, min: number) => Math.max(0, free - min);
  const suggest = (l: OrderItem, free: number, min: number) => (mode === 'deliver' ? Math.min(l.qty - l.delivered, l.reserved + above(free, min)) : Math.min(l.qty - l.delivered - l.reserved, above(free, min)));
  const [qty, setQty] = useState<Record<number, string>>(() => Object.fromEntries(rows.map(({ l, i, free, min }) => [i, String(Math.max(0, suggest(l, free, min)))])));
  const [receiver, setReceiver] = useState(o.collaborator_name ?? '');
  const unlinked = o.items.filter((l) => !l.item_id && l.qty > l.delivered);
  const total = Object.values(qty).reduce((t, v) => t + (Number(v) || 0), 0);
  return (
    <Sheet title={mode === 'deliver' ? `Entregar · pedido ${orderLabel(o.number)}` : `Reservar · pedido ${orderLabel(o.number)}`} lead={mode === 'deliver' ? 'Gera o termo de entrega.' : 'O material fica separado para este pedido.'} onClose={onClose} wide locked>
      {rows.length === 0 ? (
        <p className="help">{mode === 'deliver' ? 'Nada a entregar agora.' : 'Nada a reservar: tudo já está reservado ou entregue.'}</p>
      ) : (
        <div className="o-qty-list">
          {rows.map(({ l, i, free, min }) => (
            <div key={i} className="o-qty-row">
              <span>
                <b>{lineLabel(l)}</b>
                <small>
                  falta {num(l.qty - l.delivered)}
                  {l.reserved ? ` · reservado ${num(l.reserved)}` : ''} · disponível {num(free)}
                  {min && free - min < l.qty - l.delivered - l.reserved ? ` · mínimo ${num(min)}` : ''}
                </small>
              </span>
              <input className="input" inputMode="numeric" aria-label={`Quantidade de ${lineLabel(l)}`} value={qty[i] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [i]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
            </div>
          ))}
        </div>
      )}
      {unlinked.length ? <p className="help">Ligue ao estoque antes: {unlinked.map(lineLabel).join(', ')}.</p> : null}
      {mode === 'deliver' && rows.length ? (
        <div style={{ marginTop: 12 }}>
          <label className="label" htmlFor="o-recv">
            Quem está recebendo
          </label>
          <input id="o-recv" className="input" value={receiver} maxLength={120} onChange={(e) => setReceiver(e.target.value)} placeholder="Nome de quem assina o termo" />
        </div>
      ) : null}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={busy || !total} onClick={() => onSubmit(Object.entries(qty).map(([i, v]) => ({ i: Number(i), qty: Number(v) || 0 })).filter((x) => x.qty > 0), receiver)}>
          {busy ? <span className="spinner" /> : mode === 'deliver' ? <PackageCheck size={17} /> : <Link2 size={17} />} {mode === 'deliver' ? `Entregar ${num(total)}` : `Reservar ${num(total)}`}
        </button>
      </div>
    </Sheet>
  );
}

function AskSheet({ kind, busy, error, onClose, onSubmit }: { kind: 'cancel' | 'return' | 'release'; busy: boolean; error: string; onClose: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const cfg = {
    cancel: { title: 'Cancelar este pedido?', lead: 'As reservas voltam a ficar disponíveis. O que já foi entregue continua registrado.', label: 'Motivo do cancelamento', btn: 'Cancelar pedido', need: true },
    return: { title: 'Devolver para correção', lead: 'O pedido volta para quem abriu.', label: 'O que precisa ser corrigido', btn: 'Devolver', need: true },
    release: { title: 'Liberar as reservas?', lead: 'As unidades reservadas voltam a ficar disponíveis para outros pedidos.', label: '', btn: 'Liberar', need: false },
  }[kind];
  return (
    <Sheet title={cfg.title} lead={cfg.lead} onClose={onClose} locked={Boolean(text)}>
      {cfg.need ? (
        <>
          <label className="label" htmlFor="o-ask">
            {cfg.label}
          </label>
          <textarea id="o-ask" className="textarea" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </>
      ) : null}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Voltar
        </button>
        <button className={`btn ${kind === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (cfg.need && !text.trim())} onClick={() => onSubmit(text.trim())}>
          {busy ? <span className="spinner" /> : null} {cfg.btn}
        </button>
      </div>
    </Sheet>
  );
}

function GiveBackSheet({ d, onClose, onDone }: { d: Delivery; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const left = d.qty - d.returned_qty;
  const [qty, setQty] = useState(String(left));
  const [good, setGood] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/pedidos/entregas/${d.id}`, { method: 'POST', json: { qty: Number(qty), good, reason } });
      toast({ kind: 'success', title: 'Devolução registrada', text: good ? 'Voltou ao saldo do almoxarifado.' : 'Registrada como avariada (não volta ao saldo).' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Devolução do colaborador" lead={`${d.item_name}${d.size ? ' ' + d.size : ''} · recebeu ${d.qty}${d.returned_qty ? `, já devolveu ${d.returned_qty}` : ''}`} onClose={onClose} locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="gb-q">
            Quantidade
          </label>
          <input id="gb-q" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          <small className="help">até {left}</small>
        </div>
        <div>
          <span className="label">Estado</span>
          <div className="filter-seg" role="group" aria-label="Estado do item">
            <button type="button" className={good ? 'is-active' : ''} onClick={() => setGood(true)} aria-pressed={good}>
              Bom (volta ao saldo)
            </button>
            <button type="button" className={!good ? 'is-active' : ''} onClick={() => setGood(false)} aria-pressed={!good}>
              Avariado
            </button>
          </div>
        </div>
        <div className="full">
          <label className="label" htmlFor="gb-r">
            Motivo
          </label>
          <input id="gb-r" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: tamanho errado, desligamento, desgaste" />
        </div>
      </div>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !Number(qty) || !reason.trim()}>
          {busy ? <span className="spinner" /> : <Undo2 size={16} />} Registrar devolução
        </button>
      </div>
    </Sheet>
  );
}

/** quem pode ver o painel de cada área */
export const panelAccess = (u: HubUser | null, scope: OrderScope, lvl: 'view' | 'edit' = 'view') =>
  scope === 'almox' ? hasLevel(u, 'almoxarifado', 'pedidos', lvl) : scope === 'operacao' ? hasLevel(u, 'operacional', 'pedidos', lvl) : hasLevel(u, 'rh', 'pedidos', lvl);
export { isRhOrigin };
