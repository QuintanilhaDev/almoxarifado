'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, FileText, Mail, Plus, Scale, Search, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime, timeAgo } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import {
  PROPOSAL_STATUS,
  brl,
  effectiveUnit,
  paymentText,
  proposalDate,
  proposalExpired,
  proposalTotal,
  quoteLabel,
  recommend,
  type ComprasConfig,
  type Proposal,
  type ProposalLine,
  type PurchaseOrder,
  type Quote,
} from '@/lib/compras/pc';
import { leadText, todayBahia, addDays } from '@/lib/compras/prazo';
import { purchaseLabel, type PurchaseRequest } from '@/lib/compras/types';
import { HOMOLOGATION } from '@/lib/compras/fornecedores';
import { SupplierPicker } from './SupplierPicker';
import { Attachments, Drawer, DrawerTop, QuoteBadge, moneyIn, parseMoney } from './pcui';
import { dateBR } from '../pedidos/ui';

type Filter = 'abertas' | 'decididas' | 'todas';

export function Cotacoes({
  quotes,
  requests,
  config,
  canEdit,
  reload,
  openId,
  setOpenId,
  onOrders,
}: {
  quotes: Quote[] | null;
  requests: PurchaseRequest[] | null;
  config: ComprasConfig | null;
  canEdit: boolean;
  reload: () => Promise<void> | void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOrders: (o: PurchaseOrder[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('abertas');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => quotes ?? [], [quotes]);
  const today = todayBahia();
  const shown = list.filter((q) => {
    if (filter === 'abertas' && q.status !== 'aberta') return false;
    if (filter === 'decididas' && q.status !== 'decidida') return false;
    const t = fold(query.trim());
    return !t || fold(`${q.number} ${q.items.map((i) => i.name).join(' ')} ${q.proposals.map((p) => p.supplier_name).join(' ')}`).includes(t);
  });
  const open = openId ? list.find((q) => q.id === openId) ?? null : null;
  const counts = { abertas: list.filter((q) => q.status === 'aberta').length, decididas: list.filter((q) => q.status === 'decidida').length, todas: list.length };
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Cotações</h1>
            <p>Propostas dos fornecedores e o mapa comparativo de cada item.</p>
          </div>
          <div className="head-actions">
            <button data-max="cotacao-nova" className="btn btn-primary edit-only" onClick={() => setCreating(true)} disabled={!canEdit}>
              <Plus size={18} /> Nova cotação
            </button>
          </div>
        </div>
        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Filtrar cotações">
            {(
              [
                ['abertas', 'Abertas'],
                ['decididas', 'Decididas'],
                ['todas', 'Todas'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>
                {label} <em>{num(counts[id])}</em>
              </button>
            ))}
          </div>
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por número, item ou fornecedor" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar cotações" />
          </div>
        </div>
        {!quotes ? (
          <div className="p-list">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 70, borderRadius: 16 }} />
            ))}
          </div>
        ) : !shown.length ? (
          <div className="empty">
            <span className="empty-icon">
              <Scale size={24} />
            </span>
            <strong>{list.length ? 'Nada neste filtro' : 'Nenhuma cotação ainda'}</strong>
            <span>{list.length ? 'Tente outro filtro.' : 'Abra uma cotação a partir das solicitações de compra.'}</span>
          </div>
        ) : (
          <div className="p-list">
            {shown.map((q) => {
              const got = q.proposals.filter((p) => p.status === 'recebida').length;
              const expired = q.proposals.filter((p) => proposalExpired(p, today)).length;
              return (
                <button key={q.id} className="p-row" onClick={() => setOpenId(q.id)} aria-label={`Abrir ${quoteLabel(q.number)}`}>
                  <span className="p-num">{quoteLabel(q.number)}</span>
                  <span className="p-main">
                    <b>{q.items.map((i) => `${i.name}${i.size ? ' ' + i.size : ''} (${i.qty})`).slice(0, 2).join(', ') + (q.items.length > 2 ? ` e mais ${q.items.length - 2}` : '')}</b>
                    <small>
                      {got} de {q.proposals.length} proposta{q.proposals.length === 1 ? '' : 's'} · {timeAgo(q.created_at)}
                      {q.reply_by && q.status === 'aberta' ? ` · resposta até ${dateBR(q.reply_by)}` : ''}
                    </small>
                  </span>
                  <span className="p-tags">
                    {expired && q.status === 'aberta' ? <span className="pbadge red">{expired} vencida{expired > 1 ? 's' : ''}</span> : null}
                    <QuoteBadge status={q.status} />
                  </span>
                  <ChevronRight size={18} className="row-chevron" />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <AnimatePresence>{open ? <QuoteDrawer key={open.id} q={open} config={config} canEdit={canEdit} reload={reload} onClose={() => setOpenId(null)} onOrders={onOrders} /> : null}</AnimatePresence>
      <AnimatePresence>
        {creating ? (
          <NewQuoteSheet
            key="nq"
            requests={requests ?? []}
            onClose={() => setCreating(false)}
            onDone={async (q) => {
              setCreating(false);
              await reload();
              setOpenId(q.id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** escolhe as solicitações (as mais antigas primeiro) e abre a cotação de uma vez */
export function NewQuoteSheet({ requests, preselect, onClose, onDone }: { requests: PurchaseRequest[]; preselect?: string[]; onClose: () => void; onDone: (q: Quote) => void }) {
  const pending = requests.filter((r) => r.status === 'nova' || r.status === 'em_cotacao');
  const [sel, setSel] = useState<string[]>(preselect ?? pending.filter((r) => r.status === 'nova').map((r) => r.id));
  const [replyBy, setReplyBy] = useState(addDays(todayBahia(), 3, true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await api<{ quote: Quote }>('/api/compras/cotacoes', { method: 'POST', json: { request_ids: sel, reply_by: replyBy } });
      onDone(j.quote);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Nova cotação" lead="Itens iguais de solicitações diferentes viram uma linha só. Os fornecedores que já vendem cada item entram sozinhos." onClose={onClose} wide locked>
      {!pending.length ? (
        <p className="help">Nenhuma solicitação esperando cotação.</p>
      ) : (
        <div className="pc-pick">
          {pending.map((r) => (
            <label key={r.id} className="pc-pick-row">
              <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
              <span>
                <b>
                  {purchaseLabel(r.number)} · {r.items.map((i) => `${i.name}${i.size ? ' ' + i.size : ''} (${i.quantity})`).join(', ')}
                </b>
                <small>
                  {r.requested_by} · {timeAgo(r.created_at)}
                  {r.priority === 'urgente' ? ' · URGENTE' : ''}
                  {r.status === 'em_cotacao' ? ' · já em cotação' : ''}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="sx-grid" style={{ marginTop: 12 }}>
        <div>
          <label className="label" htmlFor="nq-reply">
            Pedir resposta até
          </label>
          <input id="nq-reply" type="date" className="input" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
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
        <button className="btn btn-primary" onClick={go} disabled={busy || !sel.length}>
          {busy ? <span className="spinner" /> : <Scale size={17} />} Abrir cotação ({sel.length})
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* gaveta da cotação: fornecedores, mapa e decisão                     */
/* ------------------------------------------------------------------ */
function QuoteDrawer({ q, config, canEdit, reload, onClose, onOrders }: { q: Quote; config: ComprasConfig | null; canEdit: boolean; reload: () => Promise<void> | void; onClose: () => void; onOrders: (o: PurchaseOrder[]) => void }) {
  const toast = useToast();
  const today = todayBahia();
  const rec = useMemo(() => recommend(q, today), [q, today]);
  const [pick, setPick] = useState<Record<string, string>>(() => (q.decision ? q.decision.lines : Object.fromEntries(Object.entries(rec).filter(([, v]) => v).map(([k, v]) => [k, v!.proposal_id]))));
  const [justification, setJustification] = useState('');
  const [needJust, setNeedJust] = useState<string[]>([]);
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cancelAsk, setCancelAsk] = useState(false);
  const [reason, setReason] = useState('');
  const open = q.status === 'aberta' && canEdit;
  const received = q.proposals.filter((p) => p.status === 'recebida');

  // chegou proposta nova: a recomendação entra nos itens ainda sem escolha
  useEffect(() => {
    if (q.decision) return;
    setPick((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(rec)) if (v && !next[k]) next[k] = v.proposal_id;
      return next;
    });
  }, [rec, q.decision]);

  const differs = q.items.filter((it) => pick[it.key] && rec[it.key] && rec[it.key]!.proposal_id !== pick[it.key]);
  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError('');
    try {
      const j = await api<{ quote: Quote; orders: PurchaseOrder[]; labels: string[] }>(`/api/compras/cotacoes/${q.id}`, { method: 'PATCH', json: body });
      await reload();
      return j;
    } catch (e) {
      const err = e as ApiError;
      if (err.data?.needs === 'justification') setNeedJust((err.data.reasons as string[]) ?? []);
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const ask = async (p: Proposal) => {
    try {
      const j = await api<{ to: string | null; subject: string; body: string }>(`/api/compras/cotacoes/${q.id}/rfq?proposal=${p.id}&format=email`);
      window.open(`mailto:${encodeURIComponent(j.to ?? '')}?subject=${encodeURIComponent(j.subject)}&body=${encodeURIComponent(j.body)}`, '_self');
      if (!p.sent_at) await patch({ action: 'proposal', proposal: { ...p, sent_at: today, sent_via: 'e-mail' } }, 'sent');
      toast({ kind: 'info', title: `Pedido de orçamento para ${p.supplier_name}`, text: j.to ? 'O e-mail abriu pronto no seu programa de e-mail.' : 'O fornecedor não tem e-mail cadastrado: baixe o PDF e envie por onde preferir.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Não deu para montar o e-mail', text: (e as Error).message });
    }
  };

  return (
    <Drawer label={quoteLabel(q.number)} onClose={onClose} wide blockEsc={Boolean(editing || adding || cancelAsk)}>
      <DrawerTop
        title={
          <>
            {quoteLabel(q.number)} <QuoteBadge status={q.status} />
          </>
        }
        sub={`${q.items.length} ${q.items.length === 1 ? 'item' : 'itens'} · aberta por ${q.created_by ?? '—'} em ${formatDateTime(q.created_at)}${q.reply_by ? ` · resposta até ${dateBR(q.reply_by)}` : ''}`}
        onClose={onClose}
      />
      <div className="drawer-body">
        <div>
          <h3 className="sec-title">Fornecedores</h3>
          <div className="pc-sups">
            {q.proposals.map((p) => {
              const exp = proposalExpired(p, today);
              return (
                <div key={p.id} className={`pc-sup${p.status === 'recebida' ? ' is-in' : ''}`}>
                  <div>
                    <b>{p.supplier_name}</b>
                    <small>
                      {exp ? <span className="pbadge red">Vencida em {dateBR(p.valid_until)}</span> : <span className={`pbadge ${p.status === 'recebida' ? 'green' : p.status === 'recusada' ? 'gray' : 'amber'}`}>{PROPOSAL_STATUS[p.status]}</span>}
                      {p.homologation !== 'homologado' ? <span className={`pbadge ${HOMOLOGATION[p.homologation].tone}`}>{HOMOLOGATION[p.homologation].label}</span> : null}
                      {p.sent_at && p.status === 'aguardando' ? ` pedido em ${dateBR(p.sent_at)}` : ''}
                      {p.status === 'recebida' ? ` ${brl(proposalTotal(p, q.items))} · ${paymentText(p.payment)} · ${p.delivery.date ? `entrega ${dateBR(p.delivery.date)}` : leadText(p.delivery.days, p.delivery.business)}` : ''}
                    </small>
                    {p.note && p.status === 'aguardando' ? <small className="help">{p.note}</small> : null}
                  </div>
                  <div className="pc-sup-act">
                    {open && p.status !== 'recebida' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => ask(p)} title="Abre o e-mail pronto">
                        <Mail size={14} /> Pedir orçamento
                      </button>
                    ) : null}
                    <a className="btn btn-ghost btn-sm" href={`/api/compras/cotacoes/${q.id}/rfq?proposal=${p.id}`} target="_blank" rel="noreferrer">
                      <FileText size={14} /> PDF
                    </a>
                    {open ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setEditing(p)}>
                        {p.status === 'recebida' ? 'Editar proposta' : 'Registrar resposta'}
                      </button>
                    ) : p.status === 'recebida' ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>
                        Ver proposta
                      </button>
                    ) : null}
                    {open && p.status === 'aguardando' ? (
                      <button className="icon-btn" aria-label={`Tirar ${p.supplier_name}`} onClick={() => patch({ action: 'remove', proposal_id: p.id }, 'rm')}>
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {open ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} style={{ marginTop: 8 }}>
              <Plus size={14} /> Adicionar fornecedor
            </button>
          ) : null}
        </div>

        <div>
          <h3 className="sec-title">Mapa comparativo</h3>
          {!received.length ? (
            <p className="help">Quando chegarem as propostas, o mapa compara o custo de cada item (preço + parte do frete e descontos), o prazo e o pagamento. A melhor opção já vem marcada.</p>
          ) : (
            <div className="t-wrap pc-map">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    {received.map((p) => (
                      <th key={p.id} className="n">
                        {p.supplier_name}
                        {proposalExpired(p, today) ? <small className="t-short"> vencida</small> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it) => (
                    <tr key={it.key}>
                      <td>
                        <b>
                          {it.name}
                          {it.size ? ` · ${it.size}` : ''}
                        </b>
                        <small className="help" style={{ display: 'block' }}>
                          {num(it.qty)} {it.unit}
                        </small>
                      </td>
                      {received.map((p) => {
                        const l = p.lines.find((x) => x.key === it.key);
                        const eff = effectiveUnit(p, q.items, it.key);
                        const best = rec[it.key]?.proposal_id === p.id;
                        const chosen = pick[it.key] === p.id;
                        if (!l || eff === null) return <td key={p.id} className="n pc-none">não cotou</td>;
                        return (
                          <td key={p.id} className={`n pc-cell${chosen ? ' is-chosen' : ''}${best ? ' is-best' : ''}`}>
                            <label>
                              {q.status === 'aberta' ? <input type="radio" name={`pick-${it.key}`} checked={chosen} disabled={!open} onChange={() => setPick((s) => ({ ...s, [it.key]: p.id }))} aria-label={`${it.name}: ${p.supplier_name}`} /> : null}
                              <b>{brl(l.unit_price)}</b>
                              {best ? <Star size={13} className="pc-star" aria-label="menor custo" /> : null}
                            </label>
                            <small>
                              custo efetivo {brl(eff)}
                              {l.first_price ? ` · pediu ${brl(l.first_price)}` : ''}
                            </small>
                            {l.brand || l.model ? <small>{[l.brand, l.model].filter(Boolean).join(' · ')}</small> : null}
                            {l.adherence !== 'total' ? <small className="t-short">{l.adherence === 'nao' ? 'não atende' : 'atende em parte'}</small> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="pc-foot">
                    <td>Frete − desconto</td>
                    {received.map((p) => (
                      <td key={p.id} className="n">
                        {brl((p.freight || 0) + (p.other_costs || 0) - (p.discount || 0))}
                      </td>
                    ))}
                  </tr>
                  <tr className="pc-foot">
                    <td>Total da proposta</td>
                    {received.map((p) => (
                      <td key={p.id} className="n">
                        <b>{brl(proposalTotal(p, q.items))}</b>
                      </td>
                    ))}
                  </tr>
                  <tr className="pc-foot">
                    <td>Entrega</td>
                    {received.map((p) => (
                      <td key={p.id} className="n">
                        {proposalDate(p) ? dateBR(proposalDate(p)) : '—'}
                        <small style={{ display: 'block' }}>
                          {p.delivery.mode === 'producao' ? 'sob produção' : 'pronta entrega'} · {leadText(p.delivery.days, p.delivery.business)}
                        </small>
                      </td>
                    ))}
                  </tr>
                  <tr className="pc-foot">
                    <td>Pagamento · validade</td>
                    {received.map((p) => (
                      <td key={p.id} className="n">
                        {paymentText(p.payment)}
                        <small style={{ display: 'block' }} className={proposalExpired(p, today) ? 't-short' : ''}>
                          até {dateBR(p.valid_until)}
                        </small>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {q.decision ? (
          <div className="p-answer">
            <b>Decidido</b> por {q.decision.by} em {formatDateTime(q.decision.at)}
            {q.decision.justification ? <p className="p-text">“{q.decision.justification}”</p> : null}
          </div>
        ) : null}

        {open && received.length ? (
          <div className="pc-decide">
            {differs.length || needJust.length ? (
              <div>
                <label className="label" htmlFor="q-just">
                  <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} color="var(--amber)" /> Justificativa{' '}
                  <small className="help">({differs.length ? `${differs.map((d) => d.name).join(', ')}: não é o de menor custo` : needJust.join('; ')})</small>
                </label>
                <textarea id="q-just" className="textarea" rows={2} maxLength={600} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Ex.: prazo menor, marca com CA válido, fornecedor homologado, um fornecedor só reduz o frete." />
              </div>
            ) : (
              <p className="help">
                <CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} color="var(--mint)" /> A escolha marcada é a de menor custo de cada item. É só gerar o pedido.
              </p>
            )}
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <div className="drawer-actions">
              <button
                className="btn btn-primary"
                disabled={Boolean(busy) || !Object.keys(pick).length}
                onClick={async () => {
                  const j = await patch({ action: 'decide', lines: pick, justification }, 'decide');
                  if (j) {
                    toast({ kind: 'success', title: j.labels.length === 1 ? `${j.labels[0]} gerado (rascunho)` : `${j.labels.join(', ')} gerados`, text: 'Confira e mande para aprovação.' }, 9000);
                    onOrders(j.orders);
                  }
                }}
              >
                {busy === 'decide' ? <span className="spinner" /> : <CheckCircle2 size={16} />} Decidir e gerar pedido de compra
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setCancelAsk(true)} disabled={Boolean(busy)}>
                Cancelar cotação
              </button>
            </div>
          </div>
        ) : open ? (
          <div className="drawer-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setCancelAsk(true)} disabled={Boolean(busy)}>
              Cancelar cotação
            </button>
          </div>
        ) : null}
        {error && !(open && received.length) ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}

        <div>
          <h3 className="sec-title">Histórico</h3>
          <ol className="p-history o-history">
            {[...q.history].reverse().map((h, i) => (
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
        {editing ? (
          <ProposalSheet
            key="ps"
            q={q}
            p={editing}
            config={config}
            readOnly={!open}
            onClose={() => setEditing(null)}
            onSave={async (prop) => {
              const j = await patch({ action: 'proposal', proposal: prop }, 'prop');
              if (j) setEditing(null);
              return Boolean(j);
            }}
          />
        ) : null}
        {adding ? (
          <Sheet key="add" title="Adicionar fornecedor à cotação" onClose={() => setAdding(false)}>
            <AddSupplier
              taken={q.proposals.map((p) => p.supplier_id)}
              onPick={async (id) => {
                const j = await patch({ action: 'proposal', proposal: { supplier_id: id, status: 'aguardando', sent_at: null } }, 'add');
                if (j) setAdding(false);
              }}
            />
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
          </Sheet>
        ) : null}
        {cancelAsk ? (
          <Sheet key="cx" title={`Cancelar a ${quoteLabel(q.number)}?`} lead="As solicitações voltam para a fila de Compras." onClose={() => setCancelAsk(false)} locked={Boolean(reason)}>
            <textarea className="textarea" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo do cancelamento" autoFocus />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCancelAsk(false)}>
                Voltar
              </button>
              <button
                className="btn btn-danger"
                disabled={!reason.trim() || Boolean(busy)}
                onClick={async () => {
                  if (await patch({ action: 'cancel', reason }, 'cancel')) setCancelAsk(false);
                }}
              >
                Cancelar cotação
              </button>
            </div>
          </Sheet>
        ) : null}
      </AnimatePresence>
    </Drawer>
  );
}

function AddSupplier({ taken, onPick }: { taken: string[]; onPick: (id: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div>
      <label className="label" htmlFor="q-add">
        Fornecedor do cadastro
      </label>
      <SupplierPicker id="q-add" value={text} onChange={setText} onPick={(s) => (taken.includes(s.id) ? setText(`${s.name} (já está na cotação)`) : onPick(s.id))} autoFocus />
      <small className="help">Fornecedor novo? Cadastre na aba Fornecedores. Ele pode cotar, mas só é contratado depois de homologado.</small>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* proposta de um fornecedor                                           */
/* ------------------------------------------------------------------ */
function ProposalSheet({ q, p, config, readOnly, onClose, onSave }: { q: Quote; p: Proposal; config: ComprasConfig | null; readOnly: boolean; onClose: () => void; onSave: (p: Record<string, unknown>) => Promise<boolean> }) {
  const today = todayBahia();
  const [status, setStatus] = useState<Proposal['status']>(p.status === 'aguardando' ? 'recebida' : p.status);
  const [valid, setValid] = useState(p.valid_until ?? addDays(today, config?.quote_valid_days ?? 7, false));
  const [pay, setPay] = useState(p.payment);
  const [del, setDel] = useState(p.delivery);
  const [money3, setMoney3] = useState({ freight: moneyIn(p.freight || null), other: moneyIn(p.other_costs || null), discount: moneyIn(p.discount || null) });
  const [lines, setLines] = useState<(ProposalLine & { priceText: string; firstText: string })[]>(() =>
    q.items.map((it) => {
      const l = p.lines.find((x) => x.key === it.key) ?? { key: it.key, unit_price: null, first_price: null, qty: null, brand: null, model: null, ext_code: null, warranty: null, adherence: 'total' as const, available: true, note: null };
      return { ...l, priceText: moneyIn(l.unit_price), firstText: moneyIn(l.first_price) };
    }),
  );
  const [atts, setAtts] = useState(p.attachments);
  const [note, setNote] = useState(p.status === 'aguardando' && p.note?.startsWith('Sugerido') ? '' : p.note ?? '');
  const [busy, setBusy] = useState(false);
  const set = (key: string, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const save = async () => {
    setBusy(true);
    const ok = await onSave({
      id: p.id,
      status,
      valid_until: valid,
      returned_at: status === 'aguardando' ? null : p.returned_at ?? today,
      sent_at: p.sent_at ?? today,
      payment: pay,
      delivery: del,
      freight: parseMoney(money3.freight) ?? 0,
      other_costs: parseMoney(money3.other) ?? 0,
      discount: parseMoney(money3.discount) ?? 0,
      lines: lines.map((l) => ({ ...l, unit_price: parseMoney(l.priceText), first_price: parseMoney(l.firstText) })),
      attachments: atts,
      note,
    });
    if (!ok) setBusy(false);
  };
  return (
    <Sheet title={`Proposta · ${p.supplier_name}`} lead={readOnly ? undefined : 'Preencha o que o fornecedor respondeu. Se ele baixou o preço na negociação, guarde o primeiro preço também: vira a economia negociada.'} onClose={onClose} wide locked={!readOnly}>
      <fieldset disabled={readOnly} className="pc-fs">
        <div className="sx-grid">
          <div>
            <span className="label">Resposta</span>
            <div className="filter-seg" role="group" aria-label="Resposta do fornecedor">
              {(['recebida', 'recusada', 'aguardando'] as const).map((s) => (
                <button type="button" key={s} className={status === s ? 'is-active' : ''} onClick={() => setStatus(s)} aria-pressed={status === s}>
                  {PROPOSAL_STATUS[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pp-valid">
              Válida até
            </label>
            <input id="pp-valid" type="date" className="input" value={valid} onChange={(e) => setValid(e.target.value)} />
          </div>
        </div>
        {status === 'recebida' ? (
          <>
            <div className="t-wrap" style={{ marginTop: 10 }}>
              <table className="t-table pc-lines">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="n">Preço unit.</th>
                    <th className="n">1º preço</th>
                    <th>Marca / modelo</th>
                    <th>Cód. fornecedor</th>
                    <th>Atende?</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it) => {
                    const l = lines.find((x) => x.key === it.key)!;
                    return (
                      <tr key={it.key} className={!l.available ? 'skip' : ''}>
                        <td>
                          <b>
                            {it.name}
                            {it.size ? ` · ${it.size}` : ''}
                          </b>
                          <small style={{ display: 'block' }}>
                            {num(it.qty)} {it.unit} ·{' '}
                            <label>
                              <input type="checkbox" checked={!l.available} onChange={(e) => set(it.key, { available: !e.target.checked })} /> não tem
                            </label>
                          </small>
                        </td>
                        <td className="n">
                          <input className="input pc-num" inputMode="decimal" aria-label={`Preço de ${it.name}`} value={l.priceText} onChange={(e) => set(it.key, { priceText: e.target.value.replace(/[^\d,.]/g, '') })} disabled={!l.available} />
                        </td>
                        <td className="n">
                          <input className="input pc-num" inputMode="decimal" aria-label={`Primeiro preço de ${it.name}`} value={l.firstText} onChange={(e) => set(it.key, { firstText: e.target.value.replace(/[^\d,.]/g, '') })} disabled={!l.available} placeholder="opcional" />
                        </td>
                        <td>
                          <input className="input" aria-label={`Marca de ${it.name}`} value={[l.brand, l.model].filter(Boolean).join(' / ')} onChange={(e) => {
                            const [b, ...m] = e.target.value.split('/');
                            set(it.key, { brand: b.trim() || null, model: m.join('/').trim() || null });
                          }} placeholder="Marca / modelo" />
                        </td>
                        <td>
                          <input className="input" aria-label={`Código do fornecedor para ${it.name}`} value={l.ext_code ?? ''} onChange={(e) => set(it.key, { ext_code: e.target.value || null })} />
                        </td>
                        <td>
                          <select className="select input" aria-label={`${it.name} atende?`} value={l.adherence} onChange={(e) => set(it.key, { adherence: e.target.value as ProposalLine['adherence'] })}>
                            <option value="total">Sim</option>
                            <option value="parcial">Em parte</option>
                            <option value="nao">Não</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sx-grid">
              <div>
                <label className="label" htmlFor="pp-fr">
                  Frete (R$)
                </label>
                <input id="pp-fr" className="input" inputMode="decimal" value={money3.freight} onChange={(e) => setMoney3({ ...money3, freight: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="pp-ot">
                  Outros custos (R$)
                </label>
                <input id="pp-ot" className="input" inputMode="decimal" value={money3.other} onChange={(e) => setMoney3({ ...money3, other: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="pp-ds">
                  Desconto (R$)
                </label>
                <input id="pp-ds" className="input" inputMode="decimal" value={money3.discount} onChange={(e) => setMoney3({ ...money3, discount: e.target.value })} />
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
                    <input className="input" aria-label="Prazos do pagamento" placeholder="ex.: 30/60/90" value={pay.days ?? ''} onChange={(e) => setPay({ ...pay, days: e.target.value })} />
                  </div>
                </div>
              </div>
              <div>
                <span className="label">Entrega</span>
                <div className="o-sizes">
                  <div>
                    <input className="input" inputMode="numeric" aria-label="Prazo em dias" placeholder="dias" value={del.days ?? ''} onChange={(e) => setDel({ ...del, days: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} />
                    <select className="select input" aria-label="Tipo de dia" value={del.business ? 'u' : 'c'} onChange={(e) => setDel({ ...del, business: e.target.value === 'u' })}>
                      <option value="u">dias úteis</option>
                      <option value="c">dias corridos</option>
                    </select>
                    <select className="select input" aria-label="Pronta entrega ou produção" value={del.mode} onChange={(e) => setDel({ ...del, mode: e.target.value as 'pronta' | 'producao' })}>
                      <option value="pronta">pronta entrega</option>
                      <option value="producao">sob produção</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
        <label className="label" htmlFor="pp-note">
          Observação <span className="opt-tag">(opcional)</span>
        </label>
        <textarea id="pp-note" className="textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <Attachments list={atts} scope="cotacao" canEdit={!readOnly} onChange={setAtts} label="Proposta e documentos" />
      </fieldset>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          {readOnly ? 'Fechar' : 'Cancelar'}
        </button>
        {!readOnly ? (
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : null} Salvar proposta
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
