'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, PackageOpen, Scale, Settings2, ShieldAlert, Timer, TrendingDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { num } from '@/lib/almoxarifado/stockFormat';
import { brl, parseBRL, poLabel, quoteLabel, type ComprasConfig } from '@/lib/compras/pc';
import { DIV_LABEL, type Divergence } from '@/lib/notas/conferencia';
import { purchaseLabel } from '@/lib/compras/types';
import { useRealtime } from '@/lib/realtime';
import { dateBR } from '../pedidos/ui';
import type { DirectDraft } from './PedidosCompra';

export interface Painel {
  counts: Record<string, number>;
  queue: { id: string; number: number; status: string; priority: string; items: number; by: string; at: string; needed_by: string | null }[];
  quotes: { id: string; number: number; items: number; received: number; total: number; reply_by: string | null }[];
  expired: { quote_id: string; quote: number; supplier: string; valid_until: string | null }[];
  divergent: { id: string; number: string; supplier: string; order: number | null; divergences: Divergence[] }[];
  awaiting: { id: string; number: number; supplier: string; total: number; by: string | null }[];
  late: { id: string; number: number; supplier: string; due: string | null; days: number; left: number }[];
  arriving: { id: string; number: number; supplier: string; due: string | null; left: number; status: string }[];
  suppliers: { id: string; name: string; orders: number; delivered: number; on_time_pct: number | null; avg_delay: number | null; late_open: number; divergences: number; spent: number }[];
  gestao: {
    by_month: { month: string; total: number }[];
    by_supplier: { name: string; total: number }[];
    by_category: { name: string; total: number }[];
    bought: number;
    savings: { negotiated: number; vs_average: number; criterion: string };
    critical: { item_id: string; name: string; available: number; min: number; on_order: number; next: string | null; late: boolean }[];
  };
}

export function usePainel(enabled = true) {
  const [data, setData] = useState<Painel | null>(null);
  const [failed, setFailed] = useState('');
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await api<Painel>('/api/compras/painel'));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((ev) => (ev === 'purchase:update' || ev === 'purchase:new' || ev === 'note:update' || ev === 'stock:update') && void load(), () => void load(), 60_000);
  return { data, failed, reload: load };
}

/** Painel de Compras: o que precisa de alguém agora, o que chega, fornecedores e regras. */
export function PainelCompras({
  canEdit,
  canApprove,
  config,
  reloadAll,
  go,
}: {
  canEdit: boolean;
  canApprove: boolean;
  config: { config: ComprasConfig; canEdit: boolean } | null;
  reloadAll: () => void;
  go: { quote: (id: string) => void; order: (id: string) => void; request: (id: string) => void; newQuote: (ids: string[]) => void; direct: (d: DirectDraft) => void };
}) {
  const { data, failed, reload } = usePainel();
  const [treat, setTreat] = useState<{ noteId: string; number: string; d: Divergence } | null>(null);
  const [rules, setRules] = useState(false);
  const c = data?.counts ?? {};
  const todo = data
    ? [
        ...(canApprove ? data.awaiting.map((o) => ({ k: 'a' + o.id, icon: <CheckCircle2 size={16} />, text: `Aprovar ${poLabel(o.number)} · ${o.supplier} · ${brl(o.total)}`, act: () => go.order(o.id) })) : []),
        ...(canEdit || canApprove
          ? data.divergent.flatMap((n) =>
              n.divergences
                .filter((d) => d.blocking)
                .map((d) => ({ k: 'd' + n.id + d.id, icon: <ShieldAlert size={16} />, text: `NF ${n.number} (${n.supplier}): ${d.text}`, act: () => setTreat({ noteId: n.id, number: n.number, d }), tone: 'red' })),
            )
          : []),
        ...data.expired.map((e) => ({ k: 'e' + e.quote_id + e.supplier, icon: <Timer size={16} />, text: `Proposta de ${e.supplier} venceu (${quoteLabel(e.quote)}): peça para revalidar`, act: () => go.quote(e.quote_id) })),
        ...data.late.map((o) => ({ k: 'l' + o.id, icon: <AlertTriangle size={16} />, text: `${poLabel(o.number)} · ${o.supplier}: ${o.days} dia${o.days === 1 ? ' útil' : 's úteis'} de atraso (${num(o.left)} a receber)`, act: () => go.order(o.id), tone: 'red' })),
      ]
    : [];
  const newReqs = data?.queue.filter((r) => r.status === 'nova') ?? [];
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Painel de Compras</h1>
            <p>O que precisa de você, o que está chegando e como andam os fornecedores.</p>
          </div>
          {config?.canEdit ? (
            <div className="head-actions">
              <button className="btn btn-ghost" onClick={() => setRules(true)}>
                <Settings2 size={18} /> Regras e alçada
              </button>
            </div>
          ) : null}
        </div>
        {failed && !data ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar o painel</strong>
            <span>{failed}</span>
          </div>
        ) : null}
        <div className="stat-grid pc-stats">
          {[
            ['Solicitações novas', c.requests_new, ClipboardList],
            ['Cotações abertas', c.quotes_open, Scale],
            ['Para aprovar', c.po_awaiting, CheckCircle2],
            ['Pedidos a receber', c.po_open, PackageOpen],
            ['Atrasados', c.po_late, AlertTriangle],
            ['Notas com divergência', c.notes_divergent, ShieldAlert],
          ].map(([label, v, Icon]) => {
            const I = Icon as typeof Scale;
            return (
              <div className="stat" key={label as string}>
                <small>
                  <I size={13} style={{ verticalAlign: '-2px' }} /> {label as string}
                </small>
                <b style={{ color: (label === 'Atrasados' || label === 'Notas com divergência') && Number(v) ? 'var(--danger)' : undefined }}>{data ? num(Number(v ?? 0)) : '…'}</b>
              </div>
            );
          })}
        </div>

        <div className="pc-grid">
          <section className="pc-card">
            <h3 className="sec-title">Precisa de você</h3>
            {!data ? (
              <div className="skeleton" style={{ height: 80, borderRadius: 12 }} />
            ) : !todo.length && !newReqs.length ? (
              <p className="help">
                <CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} color="var(--mint)" /> Nada pendente agora.
              </p>
            ) : (
              <ul className="pc-todo">
                {newReqs.length ? (
                  <li>
                    <ClipboardList size={16} />
                    <span>
                      {newReqs.length === 1 ? '1 solicitação nova' : `${newReqs.length} solicitações novas`} do Almoxarifado ({newReqs.map((r) => purchaseLabel(r.number)).join(', ')})
                    </span>
                    {canEdit ? (
                      <button className="btn btn-primary btn-sm" onClick={() => go.newQuote(newReqs.map((r) => r.id))}>
                        Cotar {newReqs.length > 1 ? 'todas' : ''}
                      </button>
                    ) : null}
                  </li>
                ) : null}
                {todo.map((t) => (
                  <li key={t.k} className={(t as { tone?: string }).tone === 'red' ? 'is-red' : ''}>
                    {t.icon}
                    <span>{t.text}</span>
                    <button className="btn btn-ghost btn-sm" onClick={t.act}>
                      Abrir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pc-card">
            <h3 className="sec-title">
              <CalendarClock size={15} style={{ verticalAlign: '-2px' }} /> Chegando nos próximos 14 dias
            </h3>
            {!data?.arriving.length ? (
              <p className="help">Nenhuma entrega prevista.</p>
            ) : (
              <ul className="pc-todo">
                {data.arriving.map((o) => (
                  <li key={o.id}>
                    <PackageOpen size={16} />
                    <span>
                      {dateBR(o.due)} · {poLabel(o.number)} · {o.supplier} ({num(o.left)} un.)
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => go.order(o.id)}>
                      Abrir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pc-card">
            <h3 className="sec-title">Itens críticos</h3>
            <p className="help">Abaixo do mínimo sem compra em andamento (ou com a compra atrasada).</p>
            {!data?.gestao.critical.length ? (
              <p className="help">Nenhum item crítico.</p>
            ) : (
              <ul className="pc-todo">
                {data.gestao.critical.slice(0, 10).map((i) => (
                  <li key={i.item_id} className={i.late ? 'is-red' : ''}>
                    <AlertTriangle size={16} />
                    <span>
                      {i.name}: disponível {num(i.available)}, mínimo {num(i.min)}
                      {i.on_order ? ` · ${num(i.on_order)} a receber${i.late ? ' (atrasado)' : ''}` : ''}
                    </span>
                    {canEdit ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => go.direct({ items: [{ item_id: i.item_id, name: i.name.split(' · ')[0], size: i.name.split(' · ')[1] ?? null, unit: 'Cada', qty: Math.max(1, i.min * 2 - i.available - i.on_order) }] })}>
                        Comprar
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pc-card pc-span">
            <h3 className="sec-title">Desempenho dos fornecedores</h3>
            {!data?.suppliers.length ? (
              <p className="help">Aparece depois dos primeiros pedidos de compra.</p>
            ) : (
              <div className="t-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Fornecedor</th>
                      <th className="n">Pedidos</th>
                      <th className="n">No prazo</th>
                      <th className="n">Atraso médio</th>
                      <th className="n">Atrasados agora</th>
                      <th className="n">Divergências</th>
                      <th className="n">Comprado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suppliers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td className="n">{num(s.orders)}</td>
                        <td className="n">{s.on_time_pct === null ? '—' : `${s.on_time_pct}%`}</td>
                        <td className="n">{s.avg_delay === null ? '—' : `${String(s.avg_delay).replace('.', ',')} d. úteis`}</td>
                        <td className={`n${s.late_open ? ' t-short' : ''}`}>{num(s.late_open)}</td>
                        <td className="n">{num(s.divergences)}</td>
                        <td className="n">{brl(s.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="pc-card">
            <h3 className="sec-title">
              <TrendingDown size={15} style={{ verticalAlign: '-2px' }} /> Economia (12 meses)
            </h3>
            <div className="kv-row">
              <span>Negociada</span>
              <b>{brl(data?.gestao.savings.negotiated ?? 0)}</b>
            </div>
            <div className="kv-row">
              <span>Sobre a média das propostas</span>
              <b>{brl(data?.gestao.savings.vs_average ?? 0)}</b>
            </div>
            <div className="kv-row">
              <span>Total comprado</span>
              <b>{brl(data?.gestao.bought ?? 0)}</b>
            </div>
            <small className="help">{data?.gestao.savings.criterion}</small>
          </section>
        </div>
      </div>
      <AnimatePresence>
        {treat ? (
          <DivergenceSheet
            key="tr"
            noteId={treat.noteId}
            number={treat.number}
            d={treat.d}
            canAuthorize={canApprove}
            onClose={() => setTreat(null)}
            onDone={() => {
              setTreat(null);
              void reload();
              reloadAll();
            }}
          />
        ) : null}
        {rules && config ? (
          <RulesSheet
            key="rules"
            config={config.config}
            onClose={() => setRules(false)}
            onDone={() => {
              setRules(false);
              reloadAll();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Compras/gestão trata uma divergência da nota (autorizar exige a permissão de aprovação). */
export function DivergenceSheet({ noteId, number, d, canAuthorize, onClose, onDone }: { noteId: string; number: string; d: Divergence; canAuthorize: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [decision, setDecision] = useState<'tratada' | 'autorizada'>(d.kind === 'preco' && canAuthorize ? 'autorizada' : 'tratada');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/almoxarifado/notas/${noteId}/divergencia`, { method: 'POST', json: { divergence_id: d.id, resolution: text, decision } });
      toast({ kind: 'success', title: `Divergência da NF ${number} ${decision === 'autorizada' ? 'autorizada' : 'tratada'}`, text: 'O Almoxarifado já pode seguir com a entrada.' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={`${DIV_LABEL[d.kind]} · NF ${number}`} lead={d.text} onClose={onClose} locked={Boolean(text)}>
      {d.blocking ? (
        <div className="filter-seg" role="group" aria-label="Decisão" style={{ marginBottom: 10 }}>
          <button type="button" className={decision === 'autorizada' ? 'is-active' : ''} onClick={() => setDecision('autorizada')} disabled={!canAuthorize} title={canAuthorize ? '' : 'Precisa da permissão "Aprovação de compras"'}>
            Autorizar exceção
          </button>
          <button type="button" className={decision === 'tratada' ? 'is-active' : ''} onClick={() => setDecision('tratada')}>
            Resolvido de outro jeito
          </button>
        </div>
      ) : null}
      <label className="label" htmlFor="dv-text">
        Justificativa / tratamento
      </label>
      <textarea id="dv-text" className="textarea" rows={3} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder={decision === 'autorizada' ? 'Ex.: reajuste de R$ 2 aceito pela gestão.' : 'Ex.: fornecedor vai emitir carta de correção / nota complementar / abatimento no boleto.'} autoFocus />
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Voltar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || text.trim().length < 5}>
          {busy ? <span className="spinner" /> : null} Registrar
        </button>
      </div>
    </Sheet>
  );
}

function RulesSheet({ config, onClose, onDone }: { config: ComprasConfig; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [c, setC] = useState({ ...config, approval_min_text: String(config.approval_min).replace('.', ',') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const minVal = (() => {
    if (!c.approval_min_text.trim()) return 0;
    const n = parseBRL(c.approval_min_text);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  })();
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (minVal === null) throw new Error('Valor da alçada inválido. Ex.: 2.000,50');
      const j = await api<{ note: string }>('/api/compras/config', { method: 'PUT', json: { ...c, approval_min: minVal } });
      toast({ kind: 'success', title: 'Regras salvas', text: j.note });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Regras de Compras" lead="Valem para todos os pedidos de compra novos." onClose={onClose} wide locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="rc-min">
            Alçada: aprova sozinho abaixo de (R$)
          </label>
          <input id="rc-min" className="input" inputMode="decimal" value={c.approval_min_text} onChange={(e) => setC({ ...c, approval_min_text: e.target.value.replace(/[^\d,.]/g, '') })} />
          <small className="help">
            {minVal === null ? 'Valor inválido. ' : `Vale ${brl(minVal)}. `}0 = todo pedido passa por aprovação (master geral ou quem tem "Aprovação de compras").
          </small>
        </div>
        <div>
          <label className="label" htmlFor="rc-days">
            Validade pedida nas propostas (dias)
          </label>
          <input id="rc-days" className="input" inputMode="numeric" value={c.quote_valid_days} onChange={(e) => setC({ ...c, quote_valid_days: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </div>
        <div className="full">
          <label className="label" htmlFor="rc-loc">
            Local de entrega padrão
          </label>
          <input id="rc-loc" className="input" maxLength={160} value={c.delivery_location} onChange={(e) => setC({ ...c, delivery_location: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="rc-name">
            Empresa (nos documentos)
          </label>
          <input id="rc-name" className="input" maxLength={120} value={c.company.name} onChange={(e) => setC({ ...c, company: { ...c.company, name: e.target.value } })} />
        </div>
        <div>
          <label className="label" htmlFor="rc-cnpj">
            CNPJ
          </label>
          <input id="rc-cnpj" className="input" maxLength={20} value={c.company.cnpj} onChange={(e) => setC({ ...c, company: { ...c.company, cnpj: e.target.value } })} />
        </div>
        <div>
          <label className="label" htmlFor="rc-phone">
            Telefone
          </label>
          <input id="rc-phone" className="input" maxLength={40} value={c.company.phone} onChange={(e) => setC({ ...c, company: { ...c.company, phone: e.target.value } })} />
        </div>
        <div>
          <label className="label" htmlFor="rc-mail">
            E-mail de Compras
          </label>
          <input id="rc-mail" className="input" maxLength={120} value={c.company.email} onChange={(e) => setC({ ...c, company: { ...c.company, email: e.target.value } })} />
        </div>
        <div className="full">
          <label className="label" htmlFor="rc-addr">
            Endereço
          </label>
          <input id="rc-addr" className="input" maxLength={200} value={c.company.address} onChange={(e) => setC({ ...c, company: { ...c.company, address: e.target.value } })} />
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
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Salvar regras
        </button>
      </div>
    </Sheet>
  );
}
