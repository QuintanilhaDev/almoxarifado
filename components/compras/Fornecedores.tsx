'use client';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Building2, FileUp, Mail, MessageCircle, Pencil, Phone, Plus, Power, Receipt, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { ImportDialog } from '../almoxarifado/ImportDialog';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { formatDoc, type Supplier } from '@/lib/compras/fornecedores';
import { useMaxBus } from '@/lib/max/bus';
import { brl, dateBR } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import './compras.css';
import '../pedidos/pedidos.css';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const STATUS_NOTE: Record<string, string> = { aberta: 'Conferindo', parcial: 'Parcial', lancada: 'Lançada', estornada: 'Estornada' };
const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length >= 10 ? `https://wa.me/${d.length <= 11 ? '55' + d : d}` : null;
};

/**
 * Fornecedores (setor Compras): cadastro manual ou por planilha, com a leitura inteligente
 * de planilhas usada em toda a plataforma. Os fornecedores que chegam pelas notas fiscais
 * também aparecem aqui, já com o histórico de notas.
 */
export function Fornecedores({ canEdit, onList }: { canEdit: boolean; onList?: (list: Supplier[] | null) => void }) {
  const toast = useToast();
  const [list, setList] = useState<Supplier[] | null>(null);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [inactive, setInactive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ s: Supplier | null; prefill?: Record<string, string> } | null>(null);
  const [importing, setImporting] = useState(false);
  const onListRef = useRef(onList);
  onListRef.current = onList;

  const load = useCallback(async () => {
    try {
      const j = await api<{ suppliers: Supplier[] }>('/api/compras/fornecedores');
      setList(j.suppliers);
      onListRef.current?.(j.suppliers);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // pedidos da Max
  useMaxBus('fornecedores:open', (p) => setOpenId(p.id));
  useMaxBus('fornecedores:new', (p) => canEdit && setForm({ s: null, prefill: p.prefill }));
  useMaxBus('fornecedores:import', () => canEdit && setImporting(true));
  useMaxBus('fornecedores:search', (p) => {
    setInactive(false);
    setQuery(p.q);
  });

  const counts = useMemo(() => ({ on: (list ?? []).filter((s) => s.active).length, off: (list ?? []).filter((s) => !s.active).length }), [list]);
  const shown = useMemo(() => {
    const t = fold(query.trim());
    const d = query.replace(/\D/g, '');
    return (list ?? []).filter(
      (s) =>
        (inactive ? !s.active : s.active) &&
        (!t || fold(`${s.name} ${s.trade_name ?? ''} ${s.category ?? ''} ${s.contact ?? ''} ${s.city ?? ''} ${s.email ?? ''}`).includes(t) || (d.length >= 3 && (s.cnpj ?? '').includes(d))),
    );
  }, [list, query, inactive]);
  const open = openId ? (list ?? []).find((s) => s.id === openId) ?? null : null;

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Fornecedores</h1>
            <p>Quem vende para a empresa: contato, o que fornece e o histórico de notas.</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost edit-only" onClick={() => setImporting(true)} disabled={!canEdit} data-max="fornecedor-importar">
              <FileUp size={18} /> Importar planilha
            </button>
            <button className="btn btn-primary edit-only" onClick={() => setForm({ s: null })} disabled={!canEdit} data-max="fornecedor-novo">
              <Plus size={18} /> Novo fornecedor
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por nome, CNPJ, o que fornece, contato ou cidade" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar fornecedores" />
          </div>
          <div className="filter-seg" role="tablist" aria-label="Situação">
            <button className={!inactive ? 'is-active' : ''} onClick={() => setInactive(false)}>
              Ativos <em>{num(counts.on)}</em>
            </button>
            <button className={inactive ? 'is-active' : ''} onClick={() => setInactive(true)}>
              Inativos <em>{num(counts.off)}</em>
            </button>
          </div>
        </div>

        {failed && !list ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar</strong>
            <span>{failed}</span>
          </div>
        ) : !list ? (
          <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <Building2 size={24} />
            </span>
            <strong>{query ? 'Nenhum fornecedor encontrado' : inactive ? 'Nenhum fornecedor inativo' : 'Nenhum fornecedor cadastrado'}</strong>
            <span>{query ? 'Tente outra busca.' : inactive ? 'Fornecedores desativados aparecem aqui.' : 'Importe a planilha de fornecedores ou cadastre um por um. Quem vende pelas notas fiscais também entra aqui sozinho.'}</span>
          </div>
        ) : (
          <div className="t-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>O que fornece</th>
                  <th>Contato</th>
                  <th>Cidade</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((s) => (
                  <tr key={s.id} className="click" onClick={() => setOpenId(s.id)} data-max-fornecedor={s.id}>
                    <td>
                      <b>{s.trade_name || s.name}</b>
                      <small>{[s.trade_name ? s.name : null, s.cnpj ? formatDoc(s.cnpj) : 'Sem CNPJ'].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>{s.category ?? <span className="muted-t">—</span>}</td>
                    <td>
                      {s.contact ?? (s.phone || s.email ? '' : '—')}
                      {s.phone || s.email ? <small>{s.phone ?? s.email}</small> : null}
                    </td>
                    <td>{s.city ? `${s.city}${s.uf ? '/' + s.uf : ''}` : s.uf ?? '—'}</td>
                    <td>
                      {s.notes_count ? (
                        <>
                          {num(s.notes_count)} {s.notes_count === 1 ? 'nota' : 'notas'}
                          <small>última em {dateBR(s.last_note ?? null)}</small>
                        </>
                      ) : (
                        <span className="muted-t">Nenhuma</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {open ? (
          <SupplierDrawer
            key={open.id}
            s={open}
            canEdit={canEdit}
            modalOpen={Boolean(form)}
            onClose={() => setOpenId(null)}
            onEdit={() => setForm({ s: open })}
            onToggle={async () => {
              try {
                await api(`/api/compras/fornecedores/${open.id}`, { method: 'PATCH', json: { active: !open.active } });
                toast({ kind: 'success', title: open.active ? 'Fornecedor desativado' : 'Fornecedor reativado', text: open.trade_name || open.name });
                await load();
              } catch (e) {
                toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
              }
            }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {form ? (
          <SupplierForm
            key="f"
            s={form.s}
            prefill={form.prefill}
            onClose={() => setForm(null)}
            onSaved={async (saved) => {
              setForm(null);
              toast({ kind: 'success', title: form.s ? 'Fornecedor atualizado' : 'Fornecedor cadastrado', text: saved.trade_name || saved.name });
              await load();
              if (!form.s) setOpenId(saved.id);
            }}
          />
        ) : null}
        {importing ? <ImportDialog key="imp" kind="fornecedores" onClose={() => setImporting(false)} onDone={load} /> : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SupplierDrawer({ s, canEdit, modalOpen, onClose, onEdit, onToggle }: { s: Supplier; canEdit: boolean; modalOpen: boolean; onClose: () => void; onEdit: () => void; onToggle: () => void }) {
  const [notes, setNotes] = useState<{ id: string; number: string; series: string | null; issue_date: string | null; status: string; totals: { total?: number } | null }[] | null>(null);
  useEffect(() => {
    api<{ notes: NonNullable<typeof notes> }>(`/api/compras/fornecedores/${s.id}`)
      .then((j) => setNotes(j.notes))
      .catch(() => setNotes([]));
  }, [s.id, s.updated_at]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen]);
  const wa = s.phone ? waLink(s.phone) : null;
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer o-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={s.trade_name || s.name}
        initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }}
        animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }}
        exit={{ x: 60, opacity: 0, rotateY: deg(-18) }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2>{s.trade_name || s.name}</h2>
            <p>
              {[s.trade_name ? s.name : null, s.cnpj ? formatDoc(s.cnpj) : null].filter(Boolean).join(' · ') || 'Sem CNPJ cadastrado'}
              {!s.active ? <span className="pbadge gray"> Inativo</span> : null}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Notas</small>
              <b>{num(s.notes_count ?? 0)}</b>
            </div>
            <div>
              <small>Comprado</small>
              <b>{brl(s.total ?? 0)}</b>
            </div>
            <div>
              <small>Última nota</small>
              <b>{s.last_note ? dateBR(s.last_note) : '—'}</b>
            </div>
          </div>

          {s.category ? (
            <div className="kv-row">
              <span>O que fornece</span>
              <b>{s.category}</b>
            </div>
          ) : null}
          {s.contact ? (
            <div className="kv-row">
              <span>Contato</span>
              <b>{s.contact}</b>
            </div>
          ) : null}
          {s.phone ? (
            <div className="kv-row">
              <span>Telefone</span>
              <b>{s.phone}</b>
            </div>
          ) : null}
          {s.email ? (
            <div className="kv-row">
              <span>E-mail</span>
              <b>{s.email}</b>
            </div>
          ) : null}
          {s.city || s.address ? (
            <div className="kv-row">
              <span>Endereço</span>
              <b>{[s.address, s.city ? `${s.city}${s.uf ? '/' + s.uf : ''}` : s.uf].filter(Boolean).join(' · ')}</b>
            </div>
          ) : null}
          {s.notes ? <p className="help" style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</p> : null}

          {s.phone || s.email ? (
            <div className="drawer-actions" style={{ flexWrap: 'wrap' }}>
              {s.phone ? (
                <a className="btn btn-ghost btn-sm" href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}>
                  <Phone size={14} /> Ligar
                </a>
              ) : null}
              {wa ? (
                <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              ) : null}
              {s.email ? (
                <a className="btn btn-ghost btn-sm" href={`mailto:${s.email}`}>
                  <Mail size={14} /> E-mail
                </a>
              ) : null}
            </div>
          ) : null}

          <h3 className="sec-title" style={{ justifyContent: "flex-start", marginTop: 6 }}>
            <Receipt size={15} /> Notas fiscais
          </h3>
          {!notes ? (
            <div className="skeleton" style={{ height: 60, borderRadius: 12 }} />
          ) : notes.length === 0 ? (
            <p className="help">Nenhuma nota deste fornecedor ainda. Quando o Almoxarifado lançar uma, ela aparece aqui.</p>
          ) : (
            <div className="t-wrap">
              <table className="t-table">
                <tbody>
                  {notes.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <b>NF {n.number}</b>
                        {n.series ? <small>série {n.series}</small> : null}
                      </td>
                      <td>{dateBR(n.issue_date)}</td>
                      <td>{STATUS_NOTE[n.status] ?? n.status}</td>
                      <td style={{ textAlign: 'right' }}>{brl(Number(n.totals?.total ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {s.created_by ? <p className="help">Cadastrado por {s.created_by}.</p> : <p className="help">Cadastrado automaticamente pela primeira nota fiscal.</p>}

          <div className="drawer-actions edit-only">
            <button className="btn btn-ghost btn-sm" onClick={onEdit} disabled={!canEdit}>
              <Pencil size={14} /> Editar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onToggle} disabled={!canEdit}>
              <Power size={14} /> {s.active ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

function SupplierForm({ s, prefill, onClose, onSaved }: { s: Supplier | null; prefill?: Record<string, string>; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const [f, setF] = useState({
    name: s?.name ?? prefill?.name ?? '',
    trade_name: s?.trade_name ?? prefill?.trade_name ?? '',
    cnpj: s?.cnpj ? formatDoc(s.cnpj) : prefill?.cnpj ?? '',
    category: s?.category ?? prefill?.category ?? '',
    contact: s?.contact ?? prefill?.contact ?? '',
    phone: s?.phone ?? prefill?.phone ?? '',
    email: s?.email ?? prefill?.email ?? '',
    city: s?.city ?? prefill?.city ?? '',
    uf: s?.uf ?? prefill?.uf ?? '',
    address: s?.address ?? '',
    notes: s?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Informe o nome (razão social) do fornecedor.');
    setBusy(true);
    setError('');
    try {
      const j = s
        ? await api<{ supplier: Supplier }>(`/api/compras/fornecedores/${s.id}`, { method: 'PATCH', json: f })
        : await api<{ supplier: Supplier }>('/api/compras/fornecedores', { method: 'POST', json: f });
      onSaved(j.supplier);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, opts: { full?: boolean; max?: number; type?: string; mode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; ph?: string; auto?: boolean } = {}) => (
    <div className={opts.full ? 'full' : undefined}>
      <label className="label" htmlFor={`sf-${k}`}>
        {label}
      </label>
      <input id={`sf-${k}`} className="input" type={opts.type ?? 'text'} inputMode={opts.mode} value={f[k]} maxLength={opts.max ?? 120} placeholder={opts.ph} onChange={(e) => set(k, e.target.value)} autoFocus={opts.auto} />
    </div>
  );
  return (
    <Sheet title={s ? 'Editar fornecedor' : 'Novo fornecedor'} lead={s ? undefined : 'Só a razão social é obrigatória. O CNPJ liga o fornecedor às notas fiscais dele.'} onClose={onClose} wide locked>
      <form onSubmit={save} noValidate>
        <div className="sx-grid">
          {field('name', 'Razão social', { full: true, max: 160, auto: true })}
          {field('trade_name', 'Nome fantasia')}
          {field('cnpj', 'CNPJ ou CPF', { mode: 'numeric', max: 20, ph: '00.000.000/0000-00' })}
          {field('category', 'O que fornece', { full: true, max: 160, ph: 'Ex.: fardamento, botas, EPI' })}
          {field('contact', 'Contato', { ph: 'Nome de quem atende' })}
          {field('phone', 'Telefone', { type: 'tel', mode: 'tel', max: 60 })}
          {field('email', 'E-mail', { type: 'email', mode: 'email', max: 160, full: true })}
          {field('city', 'Cidade', { max: 80 })}
          <div>
            <label className="label" htmlFor="sf-uf">
              UF
            </label>
            <select id="sf-uf" className="input" value={f.uf} onChange={(e) => set('uf', e.target.value)}>
              <option value="">—</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          {field('address', 'Endereço', { full: true, max: 200 })}
          <div className="full">
            <label className="label" htmlFor="sf-notes">
              Observações
            </label>
            <textarea id="sf-notes" className="input" rows={3} value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} placeholder="Prazo de entrega, condições de pagamento, pedido mínimo…" />
          </div>
        </div>
        {error ? (
          <div className="sx-error" role="alert" style={{ marginTop: 14 }}>
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : null} {s ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

