'use client';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CalendarClock, ChevronRight, Download, FileCode2, FilePlus2, PackageCheck, Plus, Receipt, RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import type { FiscalNote, NoteLine } from '@/lib/notas/server';
import { ItemPicker, brl, dateBR, todayLocal, type PickItem } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

const N_STATUS: Record<FiscalNote['status'], { label: string; tone: string }> = {
  aberta: { label: 'Aguardando conferência', tone: 'lilac' },
  parcial: { label: 'Recebida em parte', tone: 'amber' },
  lancada: { label: 'Lançada', tone: 'green' },
  estornada: { label: 'Estornada', tone: 'gray' },
};
const total = (n: FiscalNote) => Number(n.totals?.total ?? n.items.reduce((t, l) => t + (Number(l.total) || 0), 0));
type Waiting = { id: string; label: string; who: string | null; lines: { name: string; size: string | null; missing: number }[] };

/**
 * Entradas por nota fiscal (Projeto 3, seção 3).
 *  - Almoxarifado: importa o XML (ou digita), confere o recebimento (tudo ou parte) e estorna.
 *  - Financeiro: consulta notas, parcelas e vencimentos (só leitura; o recebimento não aprova pagamento).
 */
export function NotasPanel({ mode, canEdit, items, onOrders }: { mode: 'almox' | 'financeiro'; canEdit: boolean; items?: PickItem[] | null; onOrders?: (orderId?: string) => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState<FiscalNote[] | null>(null);
  const [failed, setFailed] = useState('');
  const [view, setView] = useState<'notas' | 'vencimentos'>(mode === 'financeiro' ? 'vencimentos' : 'notas');
  const [filter, setFilter] = useState<'todas' | 'conferir' | 'lancadas' | 'estornadas'>('todas');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<ParseResult | null>(null);
  const [manual, setManual] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<{ notes: FiscalNote[] }>('/api/almoxarifado/notas');
      setNotes(j.notes);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const on = () => load();
    window.addEventListener('maxhub:notes', on);
    return () => window.removeEventListener('maxhub:notes', on);
  }, [load]);

  const list = useMemo(() => notes ?? [], [notes]);
  const shown = useMemo(() => {
    const t = fold(query.trim());
    return list.filter((n) => {
      if (filter === 'conferir' && !(n.status === 'aberta' || n.status === 'parcial')) return false;
      if (filter === 'lancadas' && n.status !== 'lancada') return false;
      if (filter === 'estornadas' && n.status !== 'estornada') return false;
      if (!t) return true;
      return fold(`${n.number} ${n.supplier_name} ${n.cnpj ?? ''} ${n.access_key ?? ''} ${n.items.map((l) => l.description).join(' ')}`).includes(t);
    });
  }, [list, filter, query]);

  const today = todayLocal();
  const soon = new Date(Date.now() - 3 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
  const dues = useMemo(() => {
    const rows = list
      .filter((n) => n.status !== 'estornada')
      .flatMap((n) => n.installments.map((p) => ({ note: n, ...p })))
      .filter((p) => fold(`${p.note.number} ${p.note.supplier_name}`).includes(fold(query.trim())))
      .sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')));
    const sum = (f: (d: string) => boolean) => rows.filter((r) => r.due && f(r.due)).reduce((t, r) => t + Number(r.value || 0), 0);
    return { rows, overdue: sum((d) => d < today), soon: sum((d) => d >= today && d <= soon), later: sum((d) => d > soon) };
  }, [list, query, today, soon]);

  const pickFile = async (f: File) => {
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/almoxarifado/notas/parse', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não consegui ler o XML.');
      setReview(j as ParseResult);
    } catch (e) {
      toast({ kind: 'error', title: 'XML não importado', text: (e as Error).message });
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = openId ? list.find((n) => n.id === openId) ?? null : null;
  const counts = {
    todas: list.length,
    conferir: list.filter((n) => n.status === 'aberta' || n.status === 'parcial').length,
    lancadas: list.filter((n) => n.status === 'lancada').length,
    estornadas: list.filter((n) => n.status === 'estornada').length,
  };

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>{mode === 'financeiro' ? 'Notas e vencimentos' : 'Entradas por nota fiscal'}</h1>
            <p>
              {mode === 'financeiro'
                ? 'Notas de compra, parcelas e vencimentos.'
                : 'Notas de compra recebidas pelo almoxarifado.'}
            </p>
          </div>
          {mode === 'almox' ? (
            <div className="head-actions">
              <button className="btn btn-ghost edit-only" onClick={() => setManual(true)} disabled={!canEdit || !items}>
                <FilePlus2 size={18} /> Digitar nota
              </button>
              <button className="btn btn-primary edit-only" onClick={() => fileRef.current?.click()} disabled={!canEdit || parsing}>
                {parsing ? <span className="spinner" /> : <FileCode2 size={18} />} Importar XML
              </button>
              <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} aria-label="Arquivo XML da nota" />
            </div>
          ) : null}
        </div>

        <div className="stat-grid">
          <div className="stat">
            <small>Em conferência</small>
            <b>{notes ? num(counts.conferir) : '…'}</b>
          </div>
          <div className="stat">
            <small>Vencido</small>
            <b style={{ color: dues.overdue ? 'var(--danger)' : undefined }}>{notes ? brl(dues.overdue) : '…'}</b>
          </div>
          <div className="stat">
            <small>A vencer em 30 dias</small>
            <b>{notes ? brl(dues.soon) : '…'}</b>
          </div>
          <div className="stat">
            <small>Depois de 30 dias</small>
            <b>{notes ? brl(dues.later) : '…'}</b>
          </div>
        </div>

        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Seção">
            <button className={view === 'notas' ? 'is-active' : ''} onClick={() => setView('notas')}>
              Notas
            </button>
            <button className={view === 'vencimentos' ? 'is-active' : ''} onClick={() => setView('vencimentos')}>
              Vencimentos
            </button>
          </div>
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por número, fornecedor, CNPJ ou item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar notas" />
          </div>
        </div>

        {failed && !notes ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar as notas</strong>
            <span>{failed}</span>
          </div>
        ) : !notes ? (
          <div className="p-list">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 70, borderRadius: 16 }} />
            ))}
          </div>
        ) : view === 'notas' ? (
          <>
            <div className="filter-seg o-segs">
              {(
                [
                  ['todas', 'Todas'],
                  ['conferir', 'Em conferência'],
                  ['lancadas', 'Lançadas'],
                  ['estornadas', 'Estornadas'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>
                  {label} <em>{num(counts[id])}</em>
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <Receipt size={24} />
                </span>
                <strong>{list.length ? 'Nada neste filtro' : 'Nenhuma nota ainda'}</strong>
                <span>{list.length ? 'Tente outro filtro ou outra busca.' : mode === 'almox' ? 'Use “Importar XML” quando chegar uma compra.' : 'Quando o Almoxarifado lançar uma nota, ela aparece aqui.'}</span>
              </div>
            ) : (
              <div className="p-list">
                {shown.map((n) => {
                  const next = n.installments.filter((p) => p.due && p.due >= today).sort((a, b) => a.due!.localeCompare(b.due!))[0];
                  return (
                    <button key={n.id} className="p-row" onClick={() => setOpenId(n.id)} aria-label={`Abrir nota ${n.number}`} data-max-nota={n.number}>
                      <span className="p-num">NF {n.number}</span>
                      <span className="p-main">
                        <b>{n.supplier_name}</b>
                        <small>
                          {brl(total(n))} · {n.items.length} {n.items.length === 1 ? 'item' : 'itens'} · emitida {dateBR(n.issue_date)}
                          {next && n.status !== 'estornada' ? ` · próxima parcela ${dateBR(next.due)}` : ''}
                        </small>
                      </span>
                      <span className="p-tags">
                        <span className={`pbadge ${N_STATUS[n.status].tone}`}>{N_STATUS[n.status].label}</span>
                      </span>
                      <ChevronRight size={18} className="row-chevron" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : dues.rows.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <CalendarClock size={24} />
            </span>
            <strong>Nenhuma parcela</strong>
            <span>As parcelas aparecem aqui quando a nota tem duplicatas (vêm do XML).</span>
          </div>
        ) : (
          <div className="t-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Nota</th>
                  <th>Fornecedor</th>
                  <th>Parcela</th>
                  <th className="n">Valor</th>
                  <th>Recebimento</th>
                </tr>
              </thead>
              <tbody>
                {dues.rows.map((p, i) => (
                  <tr key={i} className="click" onClick={() => setOpenId(p.note.id)}>
                    <td className={p.due && p.due < today ? 't-short' : ''}>{dateBR(p.due)}</td>
                    <td>NF {p.note.number}</td>
                    <td>{p.note.supplier_name}</td>
                    <td>{p.n}</td>
                    <td className="n">{brl(Number(p.value))}</td>
                    <td>
                      <span className={`pbadge ${N_STATUS[p.note.status].tone}`}>{N_STATUS[p.note.status].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {open ? <NoteDrawer key={open.id} note={open} canEdit={mode === 'almox' && canEdit} items={items ?? []} onClose={() => setOpenId(null)} reload={load} onOrders={onOrders} modalOpen={Boolean(review || manual)} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {review ? (
          <ReviewSheet
            key="rev"
            parsed={review}
            items={items ?? []}
            onClose={() => setReview(null)}
            onDone={async (id) => {
              setReview(null);
              await load();
              setOpenId(id);
            }}
          />
        ) : null}
        {manual ? (
          <ReviewSheet
            key="man"
            parsed={null}
            items={items ?? []}
            onClose={() => setManual(false)}
            onDone={async (id) => {
              setManual(false);
              await load();
              setOpenId(id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
interface ParsedLine extends NoteLine {
  options?: { id: string; label: string; score: number }[];
}
interface ParseResult {
  nfe: {
    access_key: string | null;
    number: string;
    series: string | null;
    issue_date: string | null;
    supplier: { name: string; cnpj: string | null };
    company: { name: string | null; cnpj: string | null };
    items: ParsedLine[];
    totals: Record<string, number>;
    installments: { n: string; due: string | null; value: number }[];
    payment: string | null;
  };
  duplicate: { id: string; number: string; status: string } | null;
  purchases: { id: string; number: number; status: string; supplier: string | null; match: number }[];
  xml: string;
}
interface RLine {
  key: number;
  code: string;
  description: string;
  unit: string;
  qty: string;
  total: string;
  unit_cost: number | null;
  raw?: ParsedLine;
  item_id: string | null;
  text: string;
  via: 'fornecedor' | 'nome' | null;
  receive: string;
}

/** Conferência antes de gravar: a nota do XML (ou digitada) com os itens já ligados ao estoque. */
function ReviewSheet({ parsed, items, onClose, onDone }: { parsed: ParseResult | null; items: PickItem[]; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const seq = useRef(0);
  const label = (id: string | null) => {
    const it = id ? items.find((i) => i.id === id) : null;
    return it ? `${it.name}${it.size ? ' ' + it.size : ''}` : '';
  };
  const [lines, setLines] = useState<RLine[]>(() =>
    parsed
      ? parsed.nfe.items.map((l) => ({ key: ++seq.current, code: l.code, description: l.description, unit: l.unit, qty: String(l.qty), total: String(l.total), unit_cost: l.unit_cost, raw: l, item_id: l.item_id, text: label(l.item_id), via: l.via ?? null, receive: String(l.qty) }))
      : [{ key: ++seq.current, code: '', description: '', unit: 'UN', qty: '1', total: '', unit_cost: null, item_id: null, text: '', via: null, receive: '1' }],
  );
  const [head, setHead] = useState({ supplier: parsed?.nfe.supplier.name ?? '', cnpj: parsed?.nfe.supplier.cnpj ?? '', number: parsed?.nfe.number ?? '', series: parsed?.nfe.series ?? '', issue: parsed?.nfe.issue_date ?? todayLocal() });
  const [inst, setInst] = useState(parsed?.nfe.installments ?? []);
  const best = parsed?.purchases.find((p) => p.match >= 0.5);
  const [purchase, setPurchase] = useState<string>(best?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: number, p: Partial<RLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
    setError('');
  };

  const save = async (post: boolean) => {
    setError('');
    if (!parsed && (!head.supplier.trim() || !head.number.trim())) return setError('Informe o fornecedor e o número da nota.');
    const filled = lines.filter((l) => parsed || l.item_id || l.description.trim());
    if (!filled.length) return setError('A nota precisa ter itens.');
    if (post) {
      const missing = filled.filter((l) => Number(l.receive) > 0 && !l.item_id);
      if (missing.length) return setError(`Ligue ao estoque antes de dar entrada: ${missing.map((l) => l.description || 'item sem nome').join(', ')}. (Ou deixe 0 em “Recebido agora” para conferir depois.)`);
    }
    setBusy(true);
    try {
      const body = parsed
        ? {
            ...parsed.nfe,
            supplier_name: parsed.nfe.supplier.name,
            cnpj: parsed.nfe.supplier.cnpj,
            company: parsed.nfe.company.name,
            company_cnpj: parsed.nfe.company.cnpj,
            items: filled.map((l) => ({ ...l.raw, item_id: l.item_id })),
            purchase_request_id: purchase || null,
            xml: parsed.xml,
          }
        : {
            supplier_name: head.supplier.trim(),
            cnpj: head.cnpj,
            number: head.number.trim(),
            series: head.series.trim() || null,
            issue_date: head.issue || null,
            items: filled.map((l) => ({ code: l.code, description: l.description.trim() || l.text, qty: Number(l.qty) || 0, total: l.total.replace(',', '.'), item_id: l.item_id, unit: 'UN' })),
            installments: inst.filter((p) => p.value > 0),
          };
      const j = await api<{ note: FiscalNote }>('/api/almoxarifado/notas', { method: 'POST', json: body });
      if (post) {
        const toPost = filled.map((l, i) => ({ i, qty: Number(l.receive) || 0, item_id: l.item_id })).filter((x) => x.qty > 0);
        if (toPost.length) {
          const r = await api<{ note: FiscalNote; purchase: { number: number } | null; waiting: Waiting[] }>(`/api/almoxarifado/notas/${j.note.id}/post`, { method: 'POST', json: { lines: toPost } });
          toast({ kind: 'success', title: r.note.status === 'lancada' ? `NF ${j.note.number} lançada no estoque` : `NF ${j.note.number}: entrada parcial lançada`, text: [r.purchase ? `Compra nº ${r.purchase.number} marcada como entregue` : '', r.waiting.length ? `${r.waiting.length} pedido(s) esperavam estes itens` : ''].filter(Boolean).join(' · ') || undefined }, 10000);
          if (r.waiting.length) sessionStorage.setItem(`waiting:${j.note.id}`, JSON.stringify(r.waiting));
        }
      } else toast({ kind: 'success', title: `NF ${j.note.number} registrada` });
      onDone(j.note.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const unlinked = lines.filter((l) => !l.item_id).length;
  return (
    <Sheet title={parsed ? `Nota ${parsed.nfe.number}${parsed.nfe.series ? '/' + parsed.nfe.series : ''} · conferência` : 'Digitar nota fiscal'} lead={parsed ? 'Confira os itens e as quantidades recebidas.' : undefined} onClose={onClose} wide locked>
      {parsed?.duplicate ? (
        <div className="sx-error" role="alert">
          <AlertTriangle size={16} /> Esta nota já foi registrada (NF {parsed.duplicate.number}, {N_STATUS[parsed.duplicate.status as FiscalNote['status']]?.label ?? parsed.duplicate.status}). Não dá para lançar de novo.
        </div>
      ) : null}
      {parsed ? (
        <div className="n-review-head">
          <div>
            <small>Fornecedor</small>
            <b>{parsed.nfe.supplier.name}</b>
          </div>
          <div>
            <small>CNPJ</small>
            <b>{parsed.nfe.supplier.cnpj ?? '—'}</b>
          </div>
          <div>
            <small>Emissão</small>
            <b>{dateBR(parsed.nfe.issue_date)}</b>
          </div>
          <div>
            <small>Total</small>
            <b>{brl(parsed.nfe.totals.total)}</b>
          </div>
          <div>
            <small>Desconto · frete</small>
            <b>
              {brl(parsed.nfe.totals.discount)} · {brl(parsed.nfe.totals.freight)}
            </b>
          </div>
          <div>
            <small>Pagamento</small>
            <b>
              {parsed.nfe.payment ?? '—'}
              {parsed.nfe.installments.length ? ` · ${parsed.nfe.installments.length}x` : ''}
            </b>
          </div>
        </div>
      ) : (
        <div className="sx-grid">
          <div>
            <label className="label" htmlFor="n-sup">
              Fornecedor
            </label>
            <input id="n-sup" className="input" value={head.supplier} maxLength={160} onChange={(e) => setHead({ ...head, supplier: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="n-cnpj">
              CNPJ <span className="opt-tag">(opcional)</span>
            </label>
            <input id="n-cnpj" className="input" inputMode="numeric" value={head.cnpj} maxLength={20} onChange={(e) => setHead({ ...head, cnpj: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="n-num">
              Número da nota
            </label>
            <input id="n-num" className="input" inputMode="numeric" value={head.number} maxLength={20} onChange={(e) => setHead({ ...head, number: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="n-ser">
              Série <span className="opt-tag">(opcional)</span>
            </label>
            <input id="n-ser" className="input" value={head.series} maxLength={5} onChange={(e) => setHead({ ...head, series: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="n-iss">
              Emissão
            </label>
            <input id="n-iss" type="date" className="input" value={head.issue} onChange={(e) => setHead({ ...head, issue: e.target.value })} />
          </div>
        </div>
      )}

      {parsed && parsed.purchases.length ? (
        <div style={{ margin: '4px 0 12px' }}>
          <label className="label" htmlFor="n-pr">
            Solicitação de compra que esta nota atende
          </label>
          <select id="n-pr" className="select input" value={purchase} onChange={(e) => setPurchase(e.target.value)}>
            <option value="">Nenhuma</option>
            {parsed.purchases.map((p) => (
              <option key={p.id} value={p.id}>
                Compra nº {p.number} · {p.status}
                {p.supplier ? ` · ${p.supplier}` : ''} · {Math.round(p.match * 100)}% dos itens
              </option>
            ))}
          </select>
          <small className="help">A compra é marcada como entregue quando a nota for lançada.</small>
        </div>
      ) : null}

      <h3 className="sec-title">
        Itens {unlinked ? <span className="pbadge amber">{unlinked} sem item do estoque</span> : <span className="pbadge green">todos ligados</span>}
      </h3>
      <div className="n-lines">
        {lines.map((l, n) => (
          <div key={l.key} className="n-line">
            <div>
              {parsed ? (
                <>
                  <b>{l.description}</b>
                  <small>
                    {l.code ? `cód. ${l.code} · ` : ''}
                    {num(Number(l.qty))} {l.unit} · custo {brl(l.unit_cost)}/un
                  </small>
                </>
              ) : (
                <div className="o-sizes">
                  <div>
                    <input className="input" aria-label={`Descrição ${n + 1}`} placeholder="Descrição na nota" value={l.description} maxLength={200} onChange={(e) => set(l.key, { description: e.target.value })} />
                    <input className="input" aria-label={`Quantidade ${n + 1}`} inputMode="numeric" placeholder="Qtd." value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/\D/g, '').slice(0, 6), receive: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                    <input className="input" aria-label={`Valor total ${n + 1}`} inputMode="decimal" placeholder="Valor total R$" value={l.total} onChange={(e) => set(l.key, { total: e.target.value.replace(/[^\d,.]/g, '').slice(0, 12) })} />
                  </div>
                </div>
              )}
            </div>
            <div>
              {l.item_id ? (
                <>
                  <b style={{ fontSize: 14 }}>{label(l.item_id)}</b>
                  <small className={l.via === 'fornecedor' ? 'n-via' : ''}>
                    {l.via === 'fornecedor' ? 'mesmo item da última nota' : l.via === 'nome' ? 'confira' : 'escolhido'}{' '}
                    · <button type="button" className="link-btn" onClick={() => set(l.key, { item_id: null, text: '', via: null })}>trocar</button>
                  </small>
                </>
              ) : (
                <>
                  <ItemPicker label={`Item do estoque para a linha ${n + 1}`} value={{ item_id: null, text: l.text }} items={items} onPick={(it) => set(l.key, { item_id: it.id, text: `${it.name}${it.size ? ' ' + it.size : ''}`, via: null })} onText={(t) => set(l.key, { text: t })} />
                  {l.raw?.options?.length ? (
                    <small>
                      Parecidos:{' '}
                      {l.raw.options.slice(0, 3).map((o, k) => (
                        <button key={o.id} type="button" className="link-btn" onClick={() => set(l.key, { item_id: o.id, via: null })}>
                          {k ? ', ' : ''}
                          {o.label}
                        </button>
                      ))}
                    </small>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <input className="input" inputMode="numeric" aria-label={`Recebido agora, linha ${n + 1}`} value={l.receive} onChange={(e) => set(l.key, { receive: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              <small>recebido</small>
            </div>
          </div>
        ))}
      </div>
      {!parsed ? (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { key: ++seq.current, code: '', description: '', unit: 'UN', qty: '1', total: '', unit_cost: null, item_id: null, text: '', via: null, receive: '1' }])} style={{ marginBottom: 12 }}>
            <Plus size={15} /> Adicionar item
          </button>
          <h3 className="sec-title">Parcelas</h3>
          {inst.map((p, i) => (
            <div key={i} className="o-sizes" style={{ marginBottom: 6 }}>
              <div>
                <input className="input" aria-label={`Parcela ${i + 1}`} value={p.n} onChange={(e) => setInst(inst.map((x, k) => (k === i ? { ...x, n: e.target.value.slice(0, 6) } : x)))} />
                <input className="input" type="date" aria-label={`Vencimento ${i + 1}`} value={p.due ?? ''} onChange={(e) => setInst(inst.map((x, k) => (k === i ? { ...x, due: e.target.value } : x)))} />
                <input className="input" inputMode="decimal" aria-label={`Valor ${i + 1}`} value={p.value || ''} onChange={(e) => setInst(inst.map((x, k) => (k === i ? { ...x, value: Number(e.target.value.replace(',', '.')) || 0 } : x)))} placeholder="Valor" />
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInst([...inst, { n: String(inst.length + 1).padStart(3, '0'), due: null, value: 0 }])} style={{ marginBottom: 12 }}>
            <Plus size={15} /> Adicionar parcela
          </button>
        </>
      ) : parsed.nfe.installments.length ? (
        <p className="help">Parcelas: {parsed.nfe.installments.map((p) => `${p.n} · ${dateBR(p.due)} · ${brl(p.value)}`).join(' | ')}</p>
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
        <button className="btn btn-ghost" onClick={() => save(false)} disabled={busy || Boolean(parsed?.duplicate)}>
          Só registrar
        </button>
        <button className="btn btn-primary" onClick={() => save(true)} disabled={busy || Boolean(parsed?.duplicate)}>
          {busy ? <span className="spinner" /> : <PackageCheck size={17} />} Registrar e dar entrada
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
function NoteDrawer({ note: n, canEdit, items, onClose, reload, onOrders, modalOpen }: { note: FiscalNote; canEdit: boolean; items: PickItem[]; onClose: () => void; reload: () => Promise<void>; onOrders?: (orderId?: string) => void; modalOpen: boolean }) {
  const toast = useToast();
  const [recv, setRecv] = useState<Record<number, string>>(() => Object.fromEntries(n.items.map((l, i) => [i, String(Math.max(0, l.qty - l.received))])));
  const [links, setLinks] = useState<Record<number, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reverse, setReverse] = useState(false);
  const [reason, setReason] = useState('');
  const [waiting, setWaiting] = useState<Waiting[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`waiting:${n.id}`) || '[]');
    } catch {
      return [];
    }
  });
  const openNote = n.status === 'aberta' || n.status === 'parcial';
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && !reverse && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen, reverse]);
  const label = (id: string | null) => {
    const it = id ? items.find((i) => i.id === id) : null;
    return it ? `${it.name}${it.size ? ' ' + it.size : ''}` : null;
  };

  const post = async () => {
    setBusy('post');
    setError('');
    try {
      const lines = n.items.map((l, i) => ({ i, qty: Number(recv[i]) || 0, item_id: links[i] ?? l.item_id })).filter((x) => x.qty > 0);
      if (!lines.length) throw new ApiError('Informe o que chegou.', 400, {});
      const r = await api<{ note: FiscalNote; purchase: { number: number } | null; waiting: Waiting[] }>(`/api/almoxarifado/notas/${n.id}/post`, { method: 'POST', json: { lines } });
      toast({ kind: 'success', title: r.note.status === 'lancada' ? 'Nota lançada no estoque' : 'Entrada parcial lançada', text: r.purchase ? `Compra nº ${r.purchase.number} marcada como entregue` : undefined });
      setWaiting(r.waiting);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const doReverse = async () => {
    setBusy('reverse');
    setError('');
    try {
      await api(`/api/almoxarifado/notas/${n.id}/reverse`, { method: 'POST', json: { reason } });
      toast({ kind: 'success', title: `NF ${n.number} estornada` });
      setReverse(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setReverse(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="drawer o-drawer" role="dialog" aria-modal="true" aria-label={`Nota ${n.number}`} initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }} animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }} exit={{ x: 60, opacity: 0, rotateY: deg(-18) }} transition={{ type: 'spring', stiffness: 360, damping: 34 }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2 className="p-title">
              NF {n.number}
              {n.series ? `/${n.series}` : ''} <span className={`pbadge ${N_STATUS[n.status].tone}`}>{N_STATUS[n.status].label}</span>
            </h2>
            <p>
              {n.supplier_name}
              {n.cnpj ? ` · CNPJ ${n.cnpj}` : ''}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Total</small>
              <b className="p-date">{brl(total(n))}</b>
            </div>
            <div>
              <small>Emissão</small>
              <b className="p-date">{dateBR(n.issue_date)}</b>
            </div>
            <div>
              <small>Recebida</small>
              <b className="p-date">{dateBR(n.received_date)}</b>
            </div>
          </div>

          {waiting.length ? (
            <div className="o-plan">
              <div className="o-plan-head">
                <PackageCheck size={16} /> <b>Pedidos que esperavam estes itens</b>
              </div>
              {waiting.map((w) => (
                <p key={w.id}>
                  <span>{w.label}{w.who ? ` · ${w.who}` : ''}:</span> {w.lines.map((l) => `${l.missing} ${l.name}${l.size ? ' ' + l.size : ''}`).join(', ')}
                </p>
              ))}
              {onOrders ? (
                <div className="drawer-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => onOrders(waiting[0].id)}>
                    Ir para os pedidos e reservar
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="sx-error" role="alert">
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Itens{openNote && canEdit ? ' · conferência' : ''}</h3>
            <div className="o-items">
              {n.items.map((l, i) => {
                const left = l.qty - l.received;
                const linked = links[i] !== undefined ? links[i] : l.item_id;
                return (
                  <div key={i} className={`o-item${!linked ? ' is-check' : ''}`}>
                    <div className="o-item-top">
                      <b>{l.description}</b>
                      <span className={`pbadge ${left <= 0 ? 'green' : l.received ? 'amber' : 'lilac'}`}>{left <= 0 ? 'Recebido' : l.received ? `Faltam ${left}` : 'A receber'}</span>
                    </div>
                    <div className="o-nums">
                      <span>
                        Na nota <b>{num(l.qty)}</b>
                      </span>
                      <span>
                        Recebido <b>{num(l.received)}</b>
                      </span>
                      <span>
                        Custo <b>{brl(l.unit_cost)}</b>
                      </span>
                      {l.discount ? (
                        <span>
                          Desconto <b>{brl(l.discount)}</b>
                        </span>
                      ) : null}
                    </div>
                    <small className="o-note">{linked ? `Estoque: ${label(linked) ?? 'item ligado'}` : 'Ainda sem item do estoque'}</small>
                    {openNote && canEdit && left > 0 ? (
                      <div className="o-qty-row" style={{ background: 'transparent', padding: 0 }}>
                        {!l.received ? (
                          <ItemPicker label={`Item do estoque, linha ${i + 1}`} value={{ item_id: null, text: '' }} items={items} placeholder={linked ? 'Trocar o item do estoque…' : 'Escolha o item do estoque'} onPick={(it) => setLinks((x) => ({ ...x, [i]: it.id }))} onText={() => undefined} />
                        ) : (
                          <span />
                        )}
                        <input className="input" inputMode="numeric" aria-label={`Chegou agora, ${l.description}`} value={recv[i] ?? ''} onChange={(e) => setRecv((r) => ({ ...r, [i]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          {openNote && canEdit ? (
            <div className="drawer-actions">
              <button className="btn btn-primary btn-sm" onClick={post} disabled={Boolean(busy)}>
                {busy === 'post' ? <span className="spinner" /> : <PackageCheck size={15} />} Dar entrada no que chegou
              </button>
            </div>
          ) : null}

          {n.installments.length ? (
            <div>
              <h3 className="sec-title">Parcelas</h3>
              {n.installments.map((p, i) => (
                <div className="kv-row" key={i}>
                  <span>
                    {p.n} · vence {dateBR(p.due)}
                  </span>
                  <b>{brl(Number(p.value))}</b>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Dados</h3>
            {[
              ['Chave de acesso', n.access_key],
              ['Empresa compradora', n.company],
              ['Pagamento', n.payment],
              ['Desconto', n.totals?.discount ? brl(n.totals.discount) : null],
              ['Frete', n.totals?.freight ? brl(n.totals.freight) : null],
              ['Registrada por', n.created_by],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div className="kv-row" key={k as string}>
                  <span>{k}</span>
                  <b className="o-kv">{v}</b>
                </div>
              ))}
            {n.access_key ? (
              <a className="btn btn-ghost btn-sm" href={`/api/almoxarifado/notas/${n.id}?xml=1`} style={{ marginTop: 8 }} data-max="nota-xml">
                <Download size={14} /> Baixar XML
              </a>
            ) : null}
          </div>

          <div>
            <h3 className="sec-title">Histórico</h3>
            <ol className="p-history o-history">
              {[...n.history].reverse().map((h, i) => (
                <li key={i}>
                  <span>
                    <em>{h.what}</em>
                    {h.by} · {formatDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {canEdit && (n.status === 'parcial' || n.status === 'lancada') ? (
            <div className="drawer-actions" style={{ marginTop: 'auto' }}>
              <button className="btn btn-danger btn-sm" onClick={() => setReverse(true)} disabled={Boolean(busy)}>
                <RotateCcw size={15} /> Estornar nota
              </button>
            </div>
          ) : null}
        </div>
      </motion.aside>
      <AnimatePresence>
        {reverse ? (
          <Sheet key="rev" title={`Estornar a NF ${n.number}?`} lead="As quantidades desta nota saem do estoque." onClose={() => setReverse(false)} locked={Boolean(reason)}>
            <label className="label" htmlFor="n-rev">
              Motivo
            </label>
            <textarea id="n-rev" className="textarea" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setReverse(false)} disabled={Boolean(busy)}>
                Voltar
              </button>
              <button className="btn btn-danger" onClick={doReverse} disabled={Boolean(busy) || !reason.trim()}>
                {busy ? <span className="spinner" /> : <RotateCcw size={16} />} Estornar
              </button>
            </div>
          </Sheet>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
