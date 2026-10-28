'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, CalendarCheck2, CheckCircle2, ChevronRight, FileText, PackageCheck, PackageOpen, Pencil, Plus, Search, Send, ShoppingBag, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime, timeAgo } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { PO_OPEN, PO_STATUS, brl, paymentText, poDue, poGoods, poLabel, poLate, poLeft, poTotal, type Attachment, type ComprasConfig, type POItem, type PurchaseOrder } from '@/lib/compras/pc';
import { leadText, todayBahia } from '@/lib/compras/prazo';
import { formatDoc } from '@/lib/compras/fornecedores';
import { Attachments, Drawer, DrawerTop, POBadge, moneyIn, parseMoney } from './pcui';
import { ItemPicker, dateBR, type PickItem } from '../pedidos/ui';
import { SupplierPicker } from './SupplierPicker';

type Filter = 'andamento' | 'aprovar' | 'receber' | 'atrasados' | 'concluidos' | 'todos';

export interface DirectDraft {
  supplier?: { id: string; name: string } | null;
  items?: { item_id: string | null; name: string; size: string | null; unit: string; qty: number; unit_price?: number | null }[];
  reason?: string;
  request_ids?: string[];
}

/**
 * Pedidos de compra.
 *  - Compras: emite, manda para aprovação, envia, registra a confirmação e acompanha.
 *  - Quem aprova: aprova ou devolve.
 *  - Almoxarifado: consulta tudo (itens, condições, previsão) e recebe pelo pedido.
 */
export function PedidosCompra({
  mode,
  orders,
  config,
  canEdit,
  canApprove,
  me,
  reload,
  openId,
  setOpenId,
  onReceive,
  direct,
  setDirect,
}: {
  mode: 'compras' | 'almox';
  orders: PurchaseOrder[] | null;
  config: ComprasConfig | null;
  canEdit: boolean;
  canApprove: boolean;
  me: string;
  reload: () => Promise<void> | void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onReceive?: (o: PurchaseOrder) => void;
  direct?: DirectDraft | null;
  setDirect?: (d: DirectDraft | null) => void;
}) {
  const [filter, setFilter] = useState<Filter>(mode === 'almox' ? 'receber' : canApprove && !canEdit ? 'aprovar' : 'andamento');
  const [query, setQuery] = useState('');
  const today = todayBahia();
  const list = useMemo(() => orders ?? [], [orders]);
  const test = (o: PurchaseOrder, f: Filter) =>
    f === 'todos' ||
    (f === 'andamento' && !['concluido', 'cancelado'].includes(o.status)) ||
    (f === 'aprovar' && o.status === 'aguardando_aprovacao') ||
    (f === 'receber' && PO_OPEN.includes(o.status)) ||
    (f === 'atrasados' && poLate(o, today)) ||
    (f === 'concluidos' && ['concluido', 'cancelado'].includes(o.status));
  const shown = list.filter((o) => test(o, filter) && (!query.trim() || fold(`${o.number} ${o.supplier_name} ${o.items.map((i) => i.name).join(' ')}`).includes(fold(query.trim()))));
  const filters: { id: Filter; label: string }[] =
    mode === 'almox'
      ? [
          { id: 'receber', label: 'A receber' },
          { id: 'atrasados', label: 'Atrasados' },
          { id: 'concluidos', label: 'Concluídos' },
          { id: 'todos', label: 'Todos' },
        ]
      : [
          { id: 'andamento', label: 'Em andamento' },
          { id: 'aprovar', label: 'Para aprovar' },
          { id: 'receber', label: 'A receber' },
          { id: 'atrasados', label: 'Atrasados' },
          { id: 'concluidos', label: 'Encerrados' },
          { id: 'todos', label: 'Todos' },
        ];
  const open = openId ? list.find((o) => o.id === openId) ?? null : null;
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Pedidos de compra</h1>
            <p>{mode === 'almox' ? 'O que foi comprado, as condições e quando chega. Para receber, abra o pedido.' : 'Pedidos aos fornecedores, da aprovação à entrega.'}</p>
          </div>
          {mode === 'compras' && setDirect ? (
            <div className="head-actions">
              <button data-max="pedido-compra-novo" className="btn btn-ghost edit-only" onClick={() => setDirect({})} disabled={!canEdit}>
                <Plus size={18} /> Pedido direto
              </button>
            </div>
          ) : null}
        </div>
        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Filtrar pedidos de compra">
            {filters.map((f) => (
              <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
                {f.label} <em>{num(list.filter((o) => test(o, f.id)).length)}</em>
              </button>
            ))}
          </div>
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por número, fornecedor ou item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar pedidos de compra" />
          </div>
        </div>
        {!orders ? (
          <div className="p-list">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 70, borderRadius: 16 }} />
            ))}
          </div>
        ) : !shown.length ? (
          <div className="empty">
            <span className="empty-icon">
              <ShoppingBag size={24} />
            </span>
            <strong>{list.length ? 'Nada neste filtro' : 'Nenhum pedido de compra ainda'}</strong>
            <span>{list.length ? 'Tente outro filtro.' : mode === 'almox' ? 'Quando Compras emitir um pedido, ele aparece aqui.' : 'Os pedidos nascem da decisão de uma cotação, ou como pedido direto.'}</span>
          </div>
        ) : (
          <div className="p-list">
            {shown.map((o) => {
              const left = o.items.reduce((t, i) => t + poLeft(i), 0);
              return (
                <button key={o.id} className="p-row" onClick={() => setOpenId(o.id)} aria-label={`Abrir ${poLabel(o.number)}`} data-max-pc={o.number}>
                  <span className="p-num">{poLabel(o.number)}</span>
                  <span className="p-main">
                    <b>{o.supplier_name}</b>
                    <small>
                      {brl(o.total)} · {o.items.map((i) => `${i.name}${i.size ? ' ' + i.size : ''}`).slice(0, 2).join(', ')}
                      {o.items.length > 2 ? ` e mais ${o.items.length - 2}` : ''}
                      {PO_OPEN.includes(o.status) ? ` · ${num(left)} a receber${poDue(o) ? ` até ${dateBR(poDue(o))}` : ''}` : ` · ${timeAgo(o.updated_at)}`}
                    </small>
                  </span>
                  <span className="p-tags">
                    <POBadge o={o} />
                  </span>
                  <ChevronRight size={18} className="row-chevron" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <AnimatePresence>
        {open ? <OrderDrawer key={open.id} o={open} mode={mode} config={config} canEdit={canEdit} canApprove={canApprove} me={me} reload={reload} onClose={() => setOpenId(null)} onReceive={onReceive} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {direct && setDirect ? (
          <DirectOrderSheet
            key="direct"
            draft={direct}
            config={config}
            onClose={() => setDirect(null)}
            onDone={async (o) => {
              setDirect(null);
              await reload();
              setOpenId(o.id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function OrderDrawer({
  o,
  mode,
  config,
  canEdit,
  canApprove,
  me,
  reload,
  onClose,
  onReceive,
}: {
  o: PurchaseOrder;
  mode: 'compras' | 'almox';
  config: ComprasConfig | null;
  canEdit: boolean;
  canApprove: boolean;
  me: string;
  reload: () => Promise<void> | void;
  onClose: () => void;
  onReceive?: (o: PurchaseOrder) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState<null | 'reject' | 'cancel' | 'confirm' | 'send'>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(o.promised_date ?? o.expected_date ?? '');
  const [via, setVia] = useState('e-mail');
  const [notes, setNotes] = useState<{ id: string; number: string; status: string; received_date: string | null }[]>([]);
  useEffect(() => {
    api<{ notes: typeof notes }>(`/api/compras/pedidos/${o.id}`)
      .then((j) => setNotes(j.notes))
      .catch(() => undefined);
  }, [o.id, o.updated_at]);
  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError('');
    try {
      // version: o servidor recusa se o pedido mudou depois que a tela carregou (não aprova versão não vista)
      const j = await api<{ order?: PurchaseOrder }>(`/api/compras/pedidos/${o.id}`, { method: 'PATCH', json: { ...body, expected: o.status, version: o.updated_at } });
      const title = body.action === 'submit' && j.order?.status === 'aprovado' ? 'Aprovado pela alçada' : label;
      toast({ kind: 'success', title, text: poLabel(o.number) });
      setAsk(null);
      setText('');
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      await reload();
      return false;
    } finally {
      setBusy(null);
    }
  };
  const edit = mode === 'compras' && canEdit;
  const left = o.items.reduce((t, i) => t + poLeft(i), 0);
  const due = poDue(o);
  const mailto = () => {
    const body = `Olá, ${o.supplier_name}!\n\nSegue o pedido de compra ${poLabel(o.number)} (PDF em anexo), total ${brl(o.total)}.\nPor favor, confirme o recebimento e a data de entrega.\nA nota fiscal deve citar o número ${poLabel(o.number)}.\n\nObrigado,\n${me}\n${config?.company.name ?? ''}`;
    window.open(`mailto:?subject=${encodeURIComponent(`Pedido de compra ${poLabel(o.number)} — ${config?.company.name ?? ''}`)}&body=${encodeURIComponent(body)}`, '_self');
  };
  return (
    <Drawer label={poLabel(o.number)} onClose={onClose} wide blockEsc={Boolean(editing || ask)}>
      <DrawerTop
        title={
          <>
            {poLabel(o.number)} <POBadge o={o} />
          </>
        }
        sub={`${o.supplier_name}${o.cnpj ? ` · CNPJ ${formatDoc(o.cnpj)}` : ''}`}
        onClose={onClose}
      />
      <div className="drawer-body">
        <div className="mini-stats">
          <div>
            <small>Total</small>
            <b className="p-date">{brl(o.total)}</b>
          </div>
          <div>
            <small>{o.promised_date ? 'Entrega confirmada' : 'Previsão'}</small>
            <b className={`p-date${poLate(o) ? ' t-short' : ''}`}>{due ? dateBR(due) : '—'}</b>
          </div>
          <div>
            <small>A receber</small>
            <b>{num(left)}</b>
          </div>
        </div>

        {o.status === 'aguardando_aprovacao' ? (
          <div className="banner pc-approve">
            <span>
              <b>Aguardando aprovação.</b> {o.approval ? 'O pedido foi alterado depois de aprovado; a alteração precisa de nova autorização.' : `Emitido por ${o.created_by ?? '—'}.`}
            </span>
            {canApprove ? (
              <span className="pc-approve-act">
                <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => act({ action: 'approve' }, 'Pedido aprovado')}>
                  {busy === 'Pedido aprovado' ? <span className="spinner" /> : <ThumbsUp size={14} />} Aprovar
                </button>
                <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setAsk('reject')}>
                  <ThumbsDown size={14} /> {o.approval ? 'Recusar alteração' : 'Devolver'}
                </button>
              </span>
            ) : null}
          </div>
        ) : o.approval ? (
          <p className="help">
            <CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} color="var(--mint)" /> Aprovado {o.approval.auto ? 'pela alçada' : `por ${o.approval.by}`} em {formatDateTime(o.approval.at)}
            {o.approval.note ? ` — ${o.approval.note}` : ''}
          </p>
        ) : null}

        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}

        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="n">Pedido</th>
                <th className="n">Recebido</th>
                <th className="n">Falta</th>
                <th className="n">Preço</th>
                <th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.key}>
                  <td>
                    <b>
                      {i.name}
                      {i.size ? ` · ${i.size}` : ''}
                    </b>
                    {i.brand || i.spec || i.ext_code ? <small style={{ display: 'block' }}>{[i.brand, i.spec, i.ext_code ? `cód. ${i.ext_code}` : ''].filter(Boolean).join(' · ')}</small> : null}
                  </td>
                  <td className="n">
                    {num(i.qty)} <small>{i.unit}</small>
                  </td>
                  <td className="n">{num(i.received)}</td>
                  <td className={`n${poLeft(i) && poLate(o) ? ' t-short' : ''}`}>{num(poLeft(i))}</td>
                  <td className="n">{brl(i.unit_price)}</td>
                  <td className="n">{brl(i.qty * i.unit_price)}</td>
                </tr>
              ))}
              {o.freight || o.other_costs || o.discount ? (
                <tr className="pc-foot">
                  <td colSpan={5}>Frete {brl(o.freight)} · outros {brl(o.other_costs)} · desconto {brl(o.discount)}</td>
                  <td className="n">{brl(o.freight + o.other_costs - o.discount)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="sec-title">Condições</h3>
          <div className="kv-row">
            <span>Pagamento</span>
            <b className="o-kv">
              {paymentText(o.payment)}
              {o.payment.note ? ` · ${o.payment.note}` : ''}
            </b>
          </div>
          <div className="kv-row">
            <span>Entrega</span>
            <b className="o-kv">
              {o.delivery.date ? dateBR(o.delivery.date) : leadText(o.delivery.days, o.delivery.business)} · {o.delivery.mode === 'producao' ? 'sob produção' : 'pronta entrega'}
            </b>
          </div>
          <div className="kv-row">
            <span>Local</span>
            <b className="o-kv">{o.delivery.location ?? config?.delivery_location ?? '—'}</b>
          </div>
          {o.sent_at ? (
            <div className="kv-row">
              <span>Enviado</span>
              <b className="o-kv">
                {formatDateTime(o.sent_at)} por {o.sent_via ?? '—'}
              </b>
            </div>
          ) : null}
          {o.notes ? <p className="p-text">{o.notes}</p> : null}
        </div>

        <div className="drawer-actions pc-actions">
          <a className="btn btn-ghost btn-sm" href={`/api/compras/pedidos/${o.id}/pdf`} target="_blank" rel="noreferrer" data-max="pedido-compra-pdf">
            <FileText size={14} /> PDF do pedido
          </a>
          {edit && ['rascunho', 'aguardando_aprovacao', 'aprovado', 'enviado', 'confirmado', 'parcial'].includes(o.status) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={Boolean(busy)}>
              <Pencil size={14} /> Editar
            </button>
          ) : null}
          {edit && o.status === 'rascunho' ? (
            <button className="btn btn-primary btn-sm" onClick={() => act({ action: 'submit' }, 'Enviado para aprovação')} disabled={Boolean(busy)}>
              {busy ? <span className="spinner" /> : <Send size={14} />} Mandar para aprovação
            </button>
          ) : null}
          {edit && o.status === 'aprovado' ? (
            <button className="btn btn-primary btn-sm" onClick={() => setAsk('send')} disabled={Boolean(busy)}>
              <Send size={14} /> Enviar ao fornecedor
            </button>
          ) : null}
          {edit && ['aprovado', 'enviado'].includes(o.status) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk('confirm')} disabled={Boolean(busy)}>
              <CalendarCheck2 size={14} /> Fornecedor confirmou
            </button>
          ) : null}
          {mode === 'almox' && onReceive && PO_OPEN.includes(o.status) && left > 0 ? (
            <button className="btn btn-primary btn-sm" onClick={() => onReceive(o)} data-max="receber-pedido">
              <PackageCheck size={14} /> Receber mercadoria
            </button>
          ) : null}
          {edit && !['concluido', 'cancelado'].includes(o.status) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk('cancel')} disabled={Boolean(busy)}>
              <X size={14} /> {o.items.some((i) => i.received > 0) ? 'Encerrar saldo' : 'Cancelar'}
            </button>
          ) : null}
        </div>

        {notes.length ? (
          <div>
            <h3 className="sec-title">Recebimentos</h3>
            {notes.map((n) => (
              <div className="kv-row" key={n.id}>
                <span>
                  <PackageOpen size={14} style={{ verticalAlign: '-2px' }} /> NF {n.number}
                </span>
                <b className="o-kv">
                  {n.status === 'lancada' ? 'entrada confirmada' : n.status === 'parcial' ? 'recebimento parcial' : n.status === 'divergencia' ? 'com divergência' : n.status === 'estornada' ? 'estornada' : 'em conferência'}
                  {n.received_date ? ` · ${dateBR(n.received_date)}` : ''}
                </b>
              </div>
            ))}
          </div>
        ) : null}

        <Attachments list={o.attachments} scope="pedido" canEdit={edit} onChange={(l: Attachment[]) => act({ action: 'attach', attachments: l }, 'Anexos salvos')} label="Anexos (proposta, pedido assinado…)" />

        <div>
          <h3 className="sec-title">Histórico</h3>
          <ol className="p-history o-history">
            {[...o.history].reverse().map((h, i) => (
              <li key={i}>
                <span>
                  <em>{h.what}</em>
                  {h.by} · {formatDateTime(h.at)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <AnimatePresence>
        {editing ? <EditOrderSheet key="ed" o={o} onClose={() => setEditing(false)} onSave={async (b) => (await act({ action: 'edit', ...b }, o.approval && PO_OPEN.includes(o.status) ? 'Alteração enviada para aprovação' : 'Pedido salvo')) && setEditing(false)} busy={Boolean(busy)} error={error} /> : null}
        {ask ? (
          <Sheet
            key="ask"
            title={ask === 'reject' ? (o.approval ? 'Recusar a alteração?' : 'Devolver para ajuste?') : ask === 'cancel' ? (o.items.some((i) => i.received > 0) ? 'Encerrar o saldo a receber?' : `Cancelar o ${poLabel(o.number)}?`) : ask === 'send' ? 'Enviar ao fornecedor' : 'Confirmação do fornecedor'}
            lead={ask === 'send' ? 'Baixe o PDF e mande pelo canal combinado. A previsão de chegada passa a contar a partir de hoje.' : ask === 'confirm' ? 'Data em que o fornecedor se comprometeu a entregar.' : undefined}
            onClose={() => setAsk(null)}
          >
            {ask === 'send' ? (
              <>
                <div className="drawer-actions" style={{ marginBottom: 12 }}>
                  <a className="btn btn-ghost btn-sm" href={`/api/compras/pedidos/${o.id}/pdf`} target="_blank" rel="noreferrer">
                    <FileText size={14} /> Baixar PDF
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={mailto}>
                    Abrir e-mail pronto
                  </button>
                </div>
                <label className="label" htmlFor="po-via">
                  Enviado por
                </label>
                <select id="po-via" className="select input" value={via} onChange={(e) => setVia(e.target.value)}>
                  <option>e-mail</option>
                  <option>WhatsApp</option>
                  <option>portal do fornecedor</option>
                  <option>em mãos</option>
                </select>
              </>
            ) : ask === 'confirm' ? (
              <input type="date" className="input" aria-label="Data confirmada" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
            ) : (
              <textarea className="textarea" rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Motivo" aria-label="Motivo" autoFocus />
            )}
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setAsk(null)} disabled={Boolean(busy)}>
                Voltar
              </button>
              <button
                className={`btn ${ask === 'cancel' || ask === 'reject' ? 'btn-danger' : 'btn-primary'}`}
                disabled={Boolean(busy) || ((ask === 'cancel' || ask === 'reject') && !text.trim()) || (ask === 'confirm' && !date)}
                onClick={() =>
                  ask === 'send'
                    ? act({ action: 'send', via }, 'Pedido enviado ao fornecedor')
                    : ask === 'confirm'
                      ? act({ action: 'confirm', promised_date: date }, 'Entrega confirmada')
                      : ask === 'reject'
                        ? act({ action: 'reject', note: text }, o.approval ? 'Alteração recusada' : 'Devolvido para ajuste')
                        : act({ action: 'cancel', reason: text }, 'Pedido cancelado')
                }
              >
                {busy ? <span className="spinner" /> : null} {ask === 'send' ? 'Marcar como enviado' : ask === 'confirm' ? 'Salvar data' : 'Confirmar'}
              </button>
            </div>
          </Sheet>
        ) : null}
      </AnimatePresence>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
function EditOrderSheet({ o, onClose, onSave, busy, error }: { o: PurchaseOrder; onClose: () => void; onSave: (b: Record<string, unknown>) => void; busy: boolean; error: string }) {
  const [items, setItems] = useState(o.items.map((i) => ({ ...i, priceText: moneyIn(i.unit_price), qtyText: String(i.qty) })));
  const [extra, setExtra] = useState({ freight: moneyIn(o.freight || null), other: moneyIn(o.other_costs || null), discount: moneyIn(o.discount || null) });
  const [pay, setPay] = useState(o.payment);
  const [del, setDel] = useState(o.delivery);
  const [notes, setNotes] = useState(o.notes ?? '');
  const [reason, setReason] = useState('');
  const approved = Boolean(o.approval) && PO_OPEN.includes(o.status);
  const parsed: POItem[] = items.map((i) => ({ ...i, unit_price: parseMoney(i.priceText) ?? 0, qty: Number(i.qtyText) || 0 }));
  const total = poTotal({ items: parsed, freight: parseMoney(extra.freight) ?? 0, other_costs: parseMoney(extra.other) ?? 0, discount: parseMoney(extra.discount) ?? 0 });
  return (
    <Sheet title={`Editar ${poLabel(o.number)}`} lead={approved ? 'O pedido já foi aprovado: mudar item, quantidade, preço, custos ou pagamento manda de novo para aprovação. Prazo e observação não.' : undefined} onClose={onClose} wide locked>
      <div className="t-wrap">
        <table className="t-table pc-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th className="n">Qtd.</th>
              <th className="n">Preço unit.</th>
              <th className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={i.key}>
                <td>
                  <b>
                    {i.name}
                    {i.size ? ` · ${i.size}` : ''}
                  </b>
                  {i.received ? <small style={{ display: 'block' }}>{i.received} já recebidos</small> : null}
                </td>
                <td className="n">
                  <input className="input pc-num" inputMode="numeric" aria-label={`Quantidade de ${i.name}`} value={i.qtyText} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, qtyText: e.target.value.replace(/\D/g, '') } : x)))} />
                </td>
                <td className="n">
                  <input className="input pc-num" inputMode="decimal" aria-label={`Preço de ${i.name}`} value={i.priceText} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, priceText: e.target.value.replace(/[^\d,.]/g, '') } : x)))} />
                </td>
                <td className="n">{brl(parsed[k].qty * parsed[k].unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="eo-fr">
            Frete (R$)
          </label>
          <input id="eo-fr" className="input" inputMode="decimal" value={extra.freight} onChange={(e) => setExtra({ ...extra, freight: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="eo-ot">
            Outros custos (R$)
          </label>
          <input id="eo-ot" className="input" inputMode="decimal" value={extra.other} onChange={(e) => setExtra({ ...extra, other: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="eo-ds">
            Desconto (R$)
          </label>
          <input id="eo-ds" className="input" inputMode="decimal" value={extra.discount} onChange={(e) => setExtra({ ...extra, discount: e.target.value })} />
        </div>
        <div>
          <span className="label">Pagamento</span>
          <div className="o-sizes">
            <div>
              <select className="select input" aria-label="Forma de pagamento" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value as 'avista' | 'parcelado' })}>
                <option value="avista">À vista</option>
                <option value="parcelado">Parcelado</option>
              </select>
              {pay.mode === 'parcelado' ? <input className="input" inputMode="numeric" aria-label="Parcelas" value={pay.installments} onChange={(e) => setPay({ ...pay, installments: Number(e.target.value.replace(/\D/g, '')) || 1 })} /> : null}
              <input className="input" aria-label="Prazos" placeholder="30/60" value={pay.days ?? ''} onChange={(e) => setPay({ ...pay, days: e.target.value })} />
            </div>
          </div>
        </div>
        <div>
          <span className="label">Entrega</span>
          <div className="o-sizes">
            <div>
              <input className="input" inputMode="numeric" aria-label="Prazo em dias" placeholder="dias" value={del.days ?? ''} onChange={(e) => setDel({ ...del, days: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} />
              <select className="select input" aria-label="Tipo de dia" value={del.business ? 'u' : 'c'} onChange={(e) => setDel({ ...del, business: e.target.value === 'u' })}>
                <option value="u">úteis</option>
                <option value="c">corridos</option>
              </select>
              <input className="input" type="date" aria-label="Data combinada" value={del.date ?? ''} onChange={(e) => setDel({ ...del, date: e.target.value || null })} />
            </div>
          </div>
        </div>
      </div>
      <label className="label" htmlFor="eo-notes">
        Observações para o fornecedor
      </label>
      <textarea id="eo-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {approved ? (
        <>
          <label className="label" htmlFor="eo-reason">
            Motivo da alteração (fica no histórico)
          </label>
          <input id="eo-reason" className="input" maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      ) : null}
      <p className="help">
        Novo total: <b>{brl(total)}</b>
        {total !== o.total ? ` (antes ${brl(o.total)})` : ''}
      </p>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || (approved && !reason.trim())}
          onClick={() => onSave({ items: parsed, freight: parseMoney(extra.freight) ?? 0, other_costs: parseMoney(extra.other) ?? 0, discount: parseMoney(extra.discount) ?? 0, payment: pay, delivery: del, notes, reason })}
        >
          {busy ? <span className="spinner" /> : null} Salvar
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/** Pedido direto, sem cotação (contrato, fornecedor exclusivo): exige o motivo. */
function DirectOrderSheet({ draft, config, onClose, onDone }: { draft: DirectDraft; config: ComprasConfig | null; onClose: () => void; onDone: (o: PurchaseOrder) => void }) {
  const [catalog, setCatalog] = useState<(PickItem & { cost?: number | null })[]>([]);
  useEffect(() => {
    api<{ items: (PickItem & { cost?: number | null })[] }>('/api/compras/itens')
      .then((j) => setCatalog(j.items))
      .catch(() => undefined);
  }, []);
  const [sup, setSup] = useState<{ id: string; name: string } | null>(draft.supplier ?? null);
  const [supText, setSupText] = useState(draft.supplier?.name ?? '');
  const [lines, setLines] = useState(() => (draft.items?.length ? draft.items : [{ item_id: null, name: '', size: null, unit: 'Cada', qty: 1, unit_price: null }]).map((l, k) => ({ ...l, k, text: l.item_id ? `${l.name}${l.size ? ' ' + l.size : ''}` : l.name, priceText: moneyIn(l.unit_price ?? null), qtyText: String(l.qty) })));
  const [reason, setReason] = useState(draft.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: number, p: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...p } : l)));
  const items = lines.filter((l) => l.item_id || l.text.trim()).map((l) => ({ item_id: l.item_id, name: l.item_id ? l.name : l.text.trim(), size: l.size, unit: l.unit, qty: Number(l.qtyText) || 0, unit_price: parseMoney(l.priceText) ?? 0 }));
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await api<{ order: PurchaseOrder }>('/api/compras/pedidos', { method: 'POST', json: { supplier_id: sup?.id, reason, items, request_ids: draft.request_ids ?? [] } });
      onDone(j.order);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Pedido de compra direto" lead="Sem cotação: item de contrato, fornecedor exclusivo ou urgência justificada. O prazo vem do cadastro do fornecedor para cada item." onClose={onClose} wide locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="dp-sup">
            Fornecedor
          </label>
          <SupplierPicker
            id="dp-sup"
            value={supText}
            onChange={(v) => {
              setSupText(v);
              setSup(null);
            }}
            onPick={(s) => {
              setSup({ id: s.id, name: s.trade_name || s.name });
              setSupText(s.trade_name || s.name);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="dp-reason">
            Motivo da compra direta
          </label>
          <input id="dp-reason" className="input" maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: item do contrato" />
        </div>
      </div>
      <div className="p-lines">
        {lines.map((l, n) => (
          <div className="p-line" key={l.k}>
            <span className="p-line-n">{n + 1}</span>
            <ItemPicker
              label={`Item ${n + 1}`}
              value={{ item_id: l.item_id, text: l.text }}
              items={catalog}
              onPick={(it) => set(l.k, { item_id: it.id, name: it.name, size: it.size, unit: it.unit ?? 'Cada', text: `${it.name}${it.size ? ' ' + it.size : ''}`, priceText: l.priceText || moneyIn((it as { cost?: number | null }).cost ?? null) })}
              onText={(t) => set(l.k, { item_id: null, text: t })}
            />
            <input className="input p-line-qty" inputMode="numeric" aria-label={`Quantidade do item ${n + 1}`} value={l.qtyText} onChange={(e) => set(l.k, { qtyText: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
            <input className="input pc-num" inputMode="decimal" aria-label={`Preço do item ${n + 1}`} placeholder="R$ unit." value={l.priceText} onChange={(e) => set(l.k, { priceText: e.target.value.replace(/[^\d,.]/g, '') })} />
            {lines.length > 1 ? (
              <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.k !== l.k))} aria-label={`Remover item ${n + 1}`}>
                <X size={16} />
              </button>
            ) : (
              <span className="p-line-gap" />
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { k: Math.max(...ls.map((x) => x.k)) + 1, item_id: null, name: '', size: null, unit: 'Cada', qty: 1, unit_price: null, text: '', priceText: '', qtyText: '1' }])}>
        <Plus size={14} /> Adicionar item
      </button>
      <p className="help">
        Total: <b>{brl(poGoods(items))}</b> · entrega em {config?.delivery_location ?? '—'}
      </p>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !sup || !items.length || !reason.trim()}>
          {busy ? <span className="spinner" /> : null} Criar pedido (rascunho)
        </button>
      </div>
    </Sheet>
  );
}
