'use client';
import { SupplierPicker } from '../compras/SupplierPicker';
import { formatDoc } from '@/lib/compras/fornecedores';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, ChevronRight, FileCode2, FilePlus2, PackageCheck, PackageOpen, Plus, Receipt, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import type { FiscalNote, NoteLine } from '@/lib/notas/server';
import { ItemPicker, brl, dateBR, todayLocal, type PickItem } from '../pedidos/ui';
import { N_STATUS, NoteDrawer, noteTotal } from './NoteDrawer';
import { ReceiveSheet, InstallmentsEditor } from './ReceiveSheet';
import { DuesView } from './DuesView';
import { Equivalencias } from './Equivalencias';
import { installmentsGap } from '@/lib/notas/conferencia';
import { parseMoney } from '../compras/pcui';
import { poLabel, type PurchaseOrder } from '@/lib/compras/pc';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

const total = noteTotal;
type Waiting = { id: string; label: string; who: string | null; lines: { name: string; size: string | null; missing: number }[] };

/**
 * Entradas por nota fiscal (Projeto 3, seção 3).
 *  - Almoxarifado: importa o XML (ou digita), confere o recebimento (tudo ou parte) e estorna.
 *  - Financeiro: consulta notas, parcelas e vencimentos (só leitura; o recebimento não aprova pagamento).
 */
export function NotasPanel({
  mode,
  canEdit,
  items,
  onOrders,
  canTreat = false,
  canAuthorize = false,
  receive,
  onReceiveUsed,
  onOrder,
  focus,
  onFocusUsed,
}: {
  mode: 'almox' | 'financeiro';
  canEdit: boolean;
  items?: PickItem[] | null;
  onOrders?: (orderId?: string) => void;
  /** Compras/gestão: trata divergência; aprovação: autoriza exceção */
  canTreat?: boolean;
  canAuthorize?: boolean;
  /** abrir já o recebimento deste pedido de compra */
  receive?: PurchaseOrder | null;
  onReceiveUsed?: () => void;
  /** abrir o pedido de compra ligado */
  onOrder?: (poId: string) => void;
  /** abrir já esta nota */
  focus?: string | null;
  onFocusUsed?: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState<FiscalNote[] | null>(null);
  const [failed, setFailed] = useState('');
  const [view, setView] = useState<'notas' | 'vencimentos' | 'equivalencias'>(mode === 'financeiro' ? 'vencimentos' : 'notas');
  const [filter, setFilter] = useState<'todas' | 'conferir' | 'divergencia' | 'lancadas' | 'estornadas'>('todas');
  const [receiving, setReceiving] = useState<{ po: PurchaseOrder | null } | null>(null);
  useEffect(() => {
    if (focus) {
      setView('notas');
      setOpenId(focus);
      onFocusUsed?.();
    }
  }, [focus, onFocusUsed]);
  useEffect(() => {
    if (receive && canEdit) {
      setReceiving({ po: receive });
      onReceiveUsed?.();
    }
  }, [receive, canEdit, onReceiveUsed]);
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
  // sem o tempo real (rede bloqueada), confere de minuto em minuto
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => clearInterval(t);
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
      if (filter === 'conferir' && !['aberta', 'conferencia', 'divergencia', 'parcial'].includes(n.status)) return false;
      if (filter === 'divergencia' && !(n.divergences ?? []).some((d) => d.status !== 'resolvida')) return false;
      if (filter === 'lancadas' && n.status !== 'lancada') return false;
      if (filter === 'estornadas' && n.status !== 'estornada') return false;
      if (!t) return true;
      return fold(`${n.number} ${n.supplier_name} ${n.cnpj ?? ''} ${n.access_key ?? ''} ${n.items.map((l) => l.description).join(' ')}`).includes(t);
    });
  }, [list, filter, query]);

  const today = todayLocal();
  const soon = new Date(Date.now() - 3 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
  const dues = useMemo(() => {
    const rows = list.filter((n) => n.status !== 'estornada').flatMap((n) => n.installments.map((p) => ({ note: n, ...p })));
    const sum = (f: (d: string) => boolean) => rows.filter((r) => r.due && f(r.due)).reduce((t, r) => t + Number(r.value || 0), 0);
    return { rows, overdue: sum((d) => d < today), soon: sum((d) => d >= today && d <= soon), later: sum((d) => d > soon) };
  }, [list, today, soon]);

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
  // abriu uma nota: busca a versão mais nova (mesmo sem o tempo real)
  useEffect(() => {
    if (openId) void load();
  }, [openId, load]);
  const counts = {
    todas: list.length,
    conferir: list.filter((n) => ['aberta', 'conferencia', 'divergencia', 'parcial'].includes(n.status)).length,
    divergencia: list.filter((n) => (n.divergences ?? []).some((d) => d.status !== 'resolvida')).length,
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
              <button data-max="nota-digitar" className="btn btn-ghost edit-only" onClick={() => setManual(true)} disabled={!canEdit || !items}>
                <FilePlus2 size={18} /> Digitar nota
              </button>
              <button data-max="nota-importar" data-max-file="#nota-file" className="btn btn-ghost edit-only" onClick={() => fileRef.current?.click()} disabled={!canEdit || parsing}>
                {parsing ? <span className="spinner" /> : <FileCode2 size={18} />} Importar XML
              </button>
              <button data-max="receber-pedido" className="btn btn-primary edit-only" onClick={() => setReceiving({ po: null })} disabled={!canEdit}>
                <PackageOpen size={18} /> Receber pelo pedido
              </button>
              <input ref={fileRef} id="nota-file" type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} aria-label="Arquivo XML da nota" />
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
            {mode === 'almox' ? (
              <button className={view === 'equivalencias' ? 'is-active' : ''} onClick={() => setView('equivalencias')}>
                Equivalências
              </button>
            ) : null}
          </div>
          {view === 'notas' ? (
            <div className="search">
              <Search size={17} />
              <input className="input" placeholder="Buscar por número, fornecedor, CNPJ ou item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar notas" />
            </div>
          ) : null}
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
                  ['conferir', 'A conferir'],
                  ['divergencia', 'Com divergência'],
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
                          {n.purchase_order_id ? ' · pelo pedido de compra' : ''}
                          {next && n.status !== 'estornada' ? ` · próxima parcela ${dateBR(next.due)}` : ''}
                        </small>
                      </span>
                      <span className="p-tags">
                        {(n.divergences ?? []).some((d) => d.status !== 'resolvida') && n.status !== 'divergencia' ? <span className="pbadge red">Divergência</span> : null}
                        {n.installments_status === 'incompleta' && n.status !== 'estornada' ? <span className="pbadge amber">Parcelas a conferir</span> : null}
                        <span className={`pbadge ${N_STATUS[n.status].tone}`}>{N_STATUS[n.status].label}</span>
                      </span>
                      <ChevronRight size={18} className="row-chevron" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : view === 'vencimentos' ? (
          <DuesView notes={list} onOpen={(id) => setOpenId(id)} />
        ) : (
          <Equivalencias items={items ?? []} canEdit={canEdit} />
        )}
      </div>

      <AnimatePresence>
        {open ? (
          <NoteDrawer key={open.id} note={open} canEdit={mode === 'almox' && canEdit} canTreat={canTreat} canAuthorize={canAuthorize} items={items ?? []} onClose={() => setOpenId(null)} reload={load} onOrders={onOrders} onOrder={onOrder} modalOpen={Boolean(review || manual || receiving)} />
        ) : null}
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
        {receiving ? (
          <ReceiveSheet
            key="recv"
            initial={receiving.po}
            onClose={() => setReceiving(null)}
            onDone={async (note) => {
              setReceiving(null);
              await load();
              setOpenId(note.id);
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
  orders?: { id: string; number: number; status: string; supplier: string; match: number; left: number; due: string | null }[];
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
  const bestPO = parsed?.orders?.find((o) => o.match >= 0.5) ?? (parsed?.orders?.length === 1 ? parsed.orders[0] : undefined);
  const [poId, setPoId] = useState<string>(bestPO?.id ?? '');
  const [instOk, setInstOk] = useState(false);
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
            purchase_request_id: poId ? null : purchase || null,
            purchase_order_id: poId || null,
            xml: parsed.xml,
          }
        : {
            supplier_name: head.supplier.trim(),
            cnpj: head.cnpj,
            number: head.number.trim(),
            series: head.series.trim() || null,
            issue_date: head.issue || null,
            items: filled.map((l) => ({ code: l.code, description: l.description.trim() || l.text, qty: Number(l.qty) || 0, total: parseMoney(l.total) ?? 0, item_id: l.item_id, unit: 'UN' })),
            installments: inst.filter((p) => p.value > 0),
            validate_installments: instOk && installmentsGap(inst.filter((p) => p.value > 0), manualTotal) === 0,
          };
      const j = await api<{ note: FiscalNote }>('/api/almoxarifado/notas', { method: 'POST', json: body });
      if (post) {
        const toPost = filled.map((l, i) => ({ i, qty: Number(l.receive) || 0, item_id: l.item_id })).filter((x) => x.qty > 0);
        if (toPost.length) {
          let r: { note: FiscalNote; purchase: { number: number } | null; waiting: Waiting[] };
          try {
            r = await api<{ note: FiscalNote; purchase: { number: number } | null; waiting: Waiting[] }>(`/api/almoxarifado/notas/${j.note.id}/post`, { method: 'POST', json: { lines: toPost } });
          } catch (e) {
            // registrada, mas a entrada espera (parcelas a conferir ou divergência com o pedido)
            if (e instanceof ApiError && e.status === 409 && Array.isArray(e.data?.blockers)) {
              toast({ kind: 'info', title: `NF ${j.note.number} registrada, sem entrada ainda`, text: `Falta: ${(e.data.blockers as string[]).join('; ')}.` }, 12000);
              onDone(j.note.id);
              return;
            }
            throw e;
          }
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
  const manualTotal = Math.round(lines.reduce((t, l) => t + (parseMoney(String(l.total)) ?? 0), 0) * 100) / 100;
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
            <SupplierPicker
              id="n-sup"
              value={head.supplier}
              onChange={(v) => setHead((h) => ({ ...h, supplier: v }))}
              onPick={(sup) => setHead((h) => ({ ...h, supplier: sup.name, cnpj: sup.cnpj ? formatDoc(sup.cnpj) : h.cnpj }))}
            />
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

      {parsed && parsed.orders?.length ? (
        <div style={{ margin: '4px 0 12px' }}>
          <label className="label" htmlFor="n-po">
            Pedido de compra que esta nota atende
          </label>
          <select id="n-po" className="select input" value={poId} onChange={(e) => setPoId(e.target.value)}>
            <option value="">Nenhum (nota sem pedido)</option>
            {parsed.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {poLabel(o.number)} · {o.supplier} · {o.left} a receber{o.due ? ` até ${dateBR(o.due)}` : ''} · {Math.round(o.match * 100)}% dos itens
              </option>
            ))}
          </select>
          <small className="help">Ligada ao pedido, a nota é comparada com ele (itens, preços, frete e pagamento) e o "a receber" baixa sozinho.</small>
        </div>
      ) : null}
      {parsed && parsed.purchases.length && !poId ? (
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
          <InstallmentsEditor list={inst.map((p) => ({ ...p, obs: null, method: null, ref: null }))} total={manualTotal} onChange={(l) => { setInst(l.map((p) => ({ n: p.n, due: p.due, value: p.value }))); setInstOk(false); }} />
          <label className="pc-check">
            <input type="checkbox" checked={instOk} onChange={(e) => setInstOk(e.target.checked)} disabled={!inst.length || installmentsGap(inst, manualTotal) !== 0} /> Conferi as parcelas (soma igual ao total da nota)
          </label>
        </>
      ) : parsed.nfe.installments.length ? (
        <p className="help">
          Parcelas do XML: {parsed.nfe.installments.map((p) => `${p.n} · ${dateBR(p.due)} · ${brl(p.value)}`).join(' | ')}
          {installmentsGap(parsed.nfe.installments, Number(parsed.nfe.totals.total)) === 0 ? ' — conferem com o total.' : ' — a soma não bate com o total: confira depois de registrar.'}
        </p>
      ) : (
        <p className="help">O XML não traz parcelas: registre e informe as parcelas na nota antes da entrada.</p>
      )}
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

