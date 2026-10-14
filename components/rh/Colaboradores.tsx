'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, FileText, FileUp, Pencil, Plus, Search, Shirt, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { ORIGIN_LABEL, orderLabel, type MaterialOrder } from '@/lib/pedidos/types';
import { ItemPicker, dateBR, type PickItem } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

export interface Collab {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  posto_id: string | null;
  posto_name: string | null;
  company: string | null;
  admitted_at: string | null;
  active: boolean;
  sizes: { camisa?: string; calca?: string; calcado?: string };
  phone: string | null;
  notes: string | null;
  updated_at?: string;
}
interface Kit {
  role: string;
  items: { name: string; size_from: 'camisa' | 'calca' | 'calcado' | null; qty: number; item_id?: string | null }[];
  period_months: number;
  updated_by: string | null;
}

/** Colaboradores (cadastro, tamanhos, histórico de entregas) e kits por função. */
export function Colaboradores({ canEdit, version }: { canEdit: boolean; version: number }) {
  const toast = useToast();
  const [view, setView] = useState<'pessoas' | 'kits'>('pessoas');
  const [list, setList] = useState<Collab[] | null>(null);
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ c: Collab | null } | null>(null);
  const [kitForm, setKitForm] = useState<{ k: Kit | null } | null>(null);
  const [importRows, setImportRows] = useState<{ rows: Record<string, unknown>[]; columns: string[]; warnings: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api<{ collaborators: Collab[] }>('/api/rh/colaboradores'), api<{ kits: Kit[] }>('/api/rh/kits')]);
      setList(a.collaborators);
      setKits(b.kits);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);

  const shown = useMemo(() => {
    const t = fold(query.trim());
    return (list ?? []).filter((c) => (showInactive ? !c.active : c.active) && (!t || fold(`${c.name} ${c.matricula ?? ''} ${c.role ?? ''} ${c.posto_name ?? ''} ${c.company ?? ''}`).includes(t)));
  }, [list, query, showInactive]);
  const noKit = useMemo(() => {
    const roles = new Set((kits ?? []).map((k) => fold(k.role)));
    return [...new Set((list ?? []).filter((c) => c.active && c.role && !roles.has(fold(c.role))).map((c) => c.role!))];
  }, [list, kits]);

  const upload = async (f: File) => {
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/rh/colaboradores/import', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não consegui ler a planilha.');
      setImportRows(j);
    } catch (e) {
      toast({ kind: 'error', title: 'Planilha não importada', text: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = openId ? (list ?? []).find((c) => c.id === openId) ?? null : null;
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Colaboradores</h1>
            <p>Cadastro com função, posto e tamanhos: é daqui que saem os kits de admissão e a troca anual, sem digitar de novo.</p>
          </div>
          <div className="head-actions">
            {view === 'pessoas' ? (
              <>
                <button className="btn btn-ghost edit-only" onClick={() => fileRef.current?.click()} disabled={!canEdit}>
                  <FileUp size={18} /> Importar planilha
                </button>
                <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Planilha de colaboradores" />
                <button className="btn btn-primary edit-only" onClick={() => setForm({ c: null })} disabled={!canEdit}>
                  <UserPlus size={18} /> Novo colaborador
                </button>
              </>
            ) : (
              <button className="btn btn-primary edit-only" onClick={() => setKitForm({ k: null })} disabled={!canEdit}>
                <Plus size={18} /> Novo kit
              </button>
            )}
          </div>
        </div>
        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Seção">
            <button className={view === 'pessoas' ? 'is-active' : ''} onClick={() => setView('pessoas')}>
              Pessoas <em>{num((list ?? []).filter((c) => c.active).length)}</em>
            </button>
            <button className={view === 'kits' ? 'is-active' : ''} onClick={() => setView('kits')}>
              Kits por função <em>{num(kits?.length ?? 0)}</em>
            </button>
          </div>
          {view === 'pessoas' ? (
            <>
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar por nome, matrícula, função ou posto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar colaboradores" />
              </div>
              <div className="filter-seg">
                <button className={!showInactive ? 'is-active' : ''} onClick={() => setShowInactive(false)}>
                  Ativos
                </button>
                <button className={showInactive ? 'is-active' : ''} onClick={() => setShowInactive(true)}>
                  Desligados
                </button>
              </div>
            </>
          ) : null}
        </div>

        {failed && !list ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar</strong>
            <span>{failed}</span>
          </div>
        ) : !list || !kits ? (
          <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
        ) : view === 'pessoas' ? (
          shown.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">
                <Users size={24} />
              </span>
              <strong>{list.length ? 'Ninguém encontrado' : 'Nenhum colaborador cadastrado'}</strong>
              <span>{list.length ? 'Tente outra busca.' : 'Importe a planilha do RH ou cadastre um por um. Admissões feitas em “Pedidos” já criam o cadastro sozinhas.'}</span>
            </div>
          ) : (
            <div className="t-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Função</th>
                    <th>Posto</th>
                    <th>Tamanhos</th>
                    <th>Admissão</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 400).map((c) => (
                    <tr key={c.id} className="click" onClick={() => setOpenId(c.id)}>
                      <td>
                        <b>{c.name}</b>
                        <small>{c.matricula ? `Matrícula ${c.matricula}` : 'Sem matrícula'}</small>
                      </td>
                      <td>{c.role ?? '—'}</td>
                      <td>{c.posto_name ?? '—'}</td>
                      <td>{[c.sizes?.camisa && `Camisa ${c.sizes.camisa}`, c.sizes?.calca && `Calça ${c.sizes.calca}`, c.sizes?.calcado && `Calçado ${c.sizes.calcado}`].filter(Boolean).join(' · ') || <span className="pbadge amber">Sem tamanhos</span>}</td>
                      <td>{dateBR(c.admitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            {noKit.length ? (
              <div className="banner">
                <Shirt size={20} color="var(--amber)" />
                <span>
                  Funções sem kit: {noKit.join(', ')}. Sem kit, a admissão e a troca anual dessas pessoas precisam de itens digitados.
                </span>
              </div>
            ) : null}
            {kits.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <Shirt size={24} />
                </span>
                <strong>Nenhum kit cadastrado</strong>
                <span>Diga o que cada função recebe (ex.: Vigilante: 2 camisas, 2 calças, 1 bota, 1 boné) e de quanto em quanto tempo troca.</span>
              </div>
            ) : (
              <div className="g-grid">
                {kits.map((k) => (
                  <div key={k.role} className="g-card">
                    <h3 style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      {k.role}
                      <span className="pbadge lilac">troca a cada {k.period_months} {k.period_months === 1 ? 'mês' : 'meses'}</span>
                    </h3>
                    {k.items.map((i, n) => (
                      <div key={n} className="g-row">
                        <div>
                          <span>{i.name}</span>
                          <b>
                            {i.qty}
                            {i.size_from ? <small style={{ color: 'var(--muted)', fontWeight: 500 }}> · tam. da {i.size_from === 'calcado' ? 'bota/sapato' : i.size_from}</small> : null}
                          </b>
                        </div>
                      </div>
                    ))}
                    <div className="drawer-actions edit-only" style={{ marginTop: 10 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setKitForm({ k })} disabled={!canEdit}>
                        <Pencil size={14} /> Editar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {open ? <CollabDrawer key={open.id} c={open} canEdit={canEdit} onClose={() => setOpenId(null)} onEdit={() => setForm({ c: open })} reload={load} modalOpen={Boolean(form)} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {form ? <CollabForm key="f" c={form.c} roles={(kits ?? []).map((k) => k.role)} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await load(); }} /> : null}
        {kitForm ? <KitForm key="k" k={kitForm.k} onClose={() => setKitForm(null)} onSaved={async () => { setKitForm(null); await load(); }} /> : null}
        {importRows ? (
          <Sheet key="imp" title="Importar colaboradores" lead={`${importRows.rows.length} pessoa(s) na planilha. Quem já existe (mesma matrícula) é atualizado; o resto é cadastrado.`} onClose={() => setImportRows(null)}>
            {importRows.columns.length ? <p className="help">Colunas reconhecidas: {importRows.columns.join(' · ')}</p> : null}
            {importRows.warnings.length ? <p className="help">{importRows.warnings.join(' ')}</p> : null}
            <div className="t-wrap" style={{ maxHeight: 260 }}>
              <table className="t-table">
                <tbody>
                  {importRows.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td>{String(r.name ?? '')}</td>
                      <td>{String(r.matricula ?? '')}</td>
                      <td>{String(r.role ?? '')}</td>
                      <td>{String(r.posto ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ImportConfirm rows={importRows.rows} onDone={async () => { setImportRows(null); await load(); }} onClose={() => setImportRows(null)} />
          </Sheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ImportConfirm({ rows, onDone, onClose }: { rows: Record<string, unknown>[]; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const j = await api<{ created: number; updated: number; errors: string[] }>('/api/rh/colaboradores', { method: 'POST', json: { rows } });
      toast({ kind: j.errors.length ? 'info' : 'success', title: `${j.created} cadastrado(s), ${j.updated} atualizado(s)`, text: j.errors.length ? `${j.errors.length} linha(s) com problema: ${j.errors.slice(0, 2).join('; ')}` : undefined }, 10000);
      onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Importação falhou', text: (e as Error).message });
      setBusy(false);
    }
  };
  return (
    <div className="modal-actions">
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
        Cancelar
      </button>
      <button className="btn btn-primary" onClick={go} disabled={busy}>
        {busy ? <span className="spinner" /> : <FileUp size={16} />} Importar {rows.length}
      </button>
    </div>
  );
}

function CollabForm({ c, roles, onClose, onSaved }: { c: Collab | null; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: c?.name ?? '',
    matricula: c?.matricula ?? '',
    role: c?.role ?? '',
    posto_name: c?.posto_name ?? '',
    company: c?.company ?? '',
    admitted_at: c?.admitted_at ?? '',
    phone: c?.phone ?? '',
    camisa: c?.sizes?.camisa ?? '',
    calca: c?.sizes?.calca ?? '',
    calcado: c?.sizes?.calcado ?? '',
    notes: c?.notes ?? '',
  });
  const [postos, setPostos] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ postos: { id: string; name: string }[] }>('/api/pedidos/catalogo').then((j) => setPostos(j.postos)).catch(() => undefined);
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Informe o nome.');
    setBusy(true);
    setError('');
    try {
      const body = { name: f.name, matricula: f.matricula, role: f.role, posto_name: f.posto_name, company: f.company, admitted_at: f.admitted_at, phone: f.phone, notes: f.notes, sizes: { camisa: f.camisa, calca: f.calca, calcado: f.calcado } };
      if (c) await api(`/api/rh/colaboradores/${c.id}`, { method: 'PATCH', json: body });
      else await api('/api/rh/colaboradores', { method: 'POST', json: body });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={c ? 'Editar colaborador' : 'Novo colaborador'} onClose={onClose} wide locked>
      <form onSubmit={save} noValidate>
        <datalist id="c-roles">
          {roles.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <datalist id="c-postos">
          {postos.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <div className="sx-grid">
          <div className="full">
            <label className="label" htmlFor="c-name">
              Nome completo
            </label>
            <input id="c-name" className="input" value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="c-mat">
              Matrícula
            </label>
            <input id="c-mat" className="input" value={f.matricula} maxLength={40} onChange={(e) => set('matricula', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="c-role">
              Função
            </label>
            <input id="c-role" className="input" list="c-roles" value={f.role} maxLength={80} onChange={(e) => set('role', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="c-posto">
              Posto
            </label>
            <input id="c-posto" className="input" list="c-postos" value={f.posto_name} maxLength={120} onChange={(e) => set('posto_name', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="c-comp">
              Empresa
            </label>
            <input id="c-comp" className="input" value={f.company} maxLength={80} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="c-adm">
              Admissão
            </label>
            <input id="c-adm" type="date" className="input" value={f.admitted_at ?? ''} onChange={(e) => set('admitted_at', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="c-tel">
              Telefone <span className="opt-tag">(opcional)</span>
            </label>
            <input id="c-tel" className="input" value={f.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="full o-sizes">
            <span className="label">Tamanhos</span>
            <div>
              <input className="input" aria-label="Camisa" placeholder="Camisa (P, M, G…)" value={f.camisa} maxLength={6} onChange={(e) => set('camisa', e.target.value.toUpperCase())} />
              <input className="input" aria-label="Calça" placeholder="Calça (38, 40…)" value={f.calca} maxLength={6} onChange={(e) => set('calca', e.target.value.toUpperCase())} />
              <input className="input" aria-label="Calçado" placeholder="Calçado (40, 42…)" value={f.calcado} maxLength={6} onChange={(e) => set('calcado', e.target.value)} />
            </div>
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
            {busy ? <span className="spinner" /> : null} Salvar
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function KitForm({ k, onClose, onSaved }: { k: Kit | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const seq = useRef(0);
  const [role, setRole] = useState(k?.role ?? '');
  const [months, setMonths] = useState(String(k?.period_months ?? 12));
  const [items, setItems] = useState<PickItem[]>([]);
  const [lines, setLines] = useState(() =>
    (k?.items.length ? k.items : [{ name: '', size_from: null, qty: 1, item_id: null }]).map((i) => ({ key: ++seq.current, name: i.name, size_from: i.size_from, qty: String(i.qty), item_id: i.item_id ?? null })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ items: PickItem[] }>('/api/pedidos/catalogo').then((j) => setItems(j.items)).catch(() => undefined);
  }, []);
  // nomes de produto sem tamanho (o tamanho vem do colaborador)
  const products = useMemo(() => {
    const seen = new Map<string, PickItem>();
    for (const i of items) if (!seen.has(fold(i.name))) seen.set(fold(i.name), { ...i, size: null });
    return [...seen.values()];
  }, [items]);
  const guess = (name: string): 'camisa' | 'calca' | 'calcado' | null => {
    const n = fold(name);
    if (/\b(bota|botas|sapato|coturno|tenis|calcado|botina)\b/.test(n)) return 'calcado';
    if (/\b(calca|calcas|bermuda)\b/.test(n)) return 'calca';
    if (/\b(camisa|camiseta|jaqueta|blusa|agasalho|casaco|japona|colete)\b/.test(n)) return 'camisa';
    return null;
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/rh/kits', { method: 'PUT', json: { role, old_role: k?.role, period_months: Number(months), items: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), size_from: l.size_from, qty: Number(l.qty) || 0, item_id: l.size_from ? null : l.item_id })) } });
      toast({ kind: 'success', title: `Kit ${role} salvo` });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!k) return;
    setBusy(true);
    try {
      await api(`/api/rh/kits?role=${encodeURIComponent(k.role)}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={k ? `Kit · ${k.role}` : 'Novo kit por função'} lead="O tamanho de roupa e calçado vem do cadastro de cada colaborador." onClose={onClose} wide locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="k-role">
            Função
          </label>
          <input id="k-role" className="input" value={role} maxLength={80} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: Vigilante" />
        </div>
        <div>
          <label className="label" htmlFor="k-m">
            Troca a cada (meses)
          </label>
          <input id="k-m" className="input" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </div>
      </div>
      <h3 className="sec-title">Itens do kit</h3>
      <div className="p-lines">
        {lines.map((l, n) => (
          <div className="p-line" key={l.key}>
            <span className="p-line-n">{n + 1}</span>
            <div className="p-line-item">
              <ItemPicker
                label={`Item ${n + 1} do kit`}
                value={{ item_id: null, text: l.name }}
                items={products}
                placeholder="Ex.: Camisa social manga curta"
                onPick={(it) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: it.name, item_id: it.id, size_from: guess(it.name) } : x)))}
                onText={(t) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, name: t, item_id: null, size_from: x.size_from ?? guess(t) } : x)))}
              />
            </div>
            <select className="select input p-line-size" style={{ width: 120 }} aria-label={`Tamanho do item ${n + 1}`} value={l.size_from ?? ''} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, size_from: (e.target.value || null) as typeof l.size_from } : x)))}>
              <option value="">Sem tamanho</option>
              <option value="camisa">Tam. camisa</option>
              <option value="calca">Tam. calça</option>
              <option value="calcado">Nº calçado</option>
            </select>
            <input className="input p-line-qty" aria-label={`Quantidade ${n + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value.replace(/\D/g, '').slice(0, 2) } : x)))} />
            {lines.length > 1 ? (
              <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remover item ${n + 1}`}>
                <X size={16} />
              </button>
            ) : (
              <span className="p-line-gap" />
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { key: ++seq.current, name: '', size_from: null, qty: '1', item_id: null }])} style={{ marginBottom: 12 }}>
        <Plus size={15} /> Adicionar item
      </button>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        {k ? (
          <button className="btn btn-danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
            <Trash2 size={15} /> Excluir kit
          </button>
        ) : null}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !role.trim()}>
          {busy ? <span className="spinner" /> : null} Salvar kit
        </button>
      </div>
    </Sheet>
  );
}

function CollabDrawer({ c, canEdit, onClose, onEdit, reload, modalOpen }: { c: Collab; canEdit: boolean; onClose: () => void; onEdit: () => void; reload: () => Promise<void>; modalOpen: boolean }) {
  const toast = useToast();
  const [detail, setDetail] = useState<{ deliveries: { id: string; group_id: string; item_name: string; size: string | null; qty: number; returned_qty: number; kind: string; delivered_at: string; order_number: number | null }[]; orders: MaterialOrder[] } | null>(null);
  useEffect(() => {
    api<typeof detail>(`/api/rh/colaboradores/${c.id}`).then(setDetail).catch(() => setDetail({ deliveries: [], orders: [] }));
  }, [c.id, c.updated_at]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen]);
  const toggle = async () => {
    try {
      await api(`/api/rh/colaboradores/${c.id}`, { method: 'PATCH', json: { active: !c.active } });
      toast({ kind: 'success', title: c.active ? 'Colaborador desligado' : 'Colaborador reativado' });
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="drawer o-drawer" role="dialog" aria-modal="true" aria-label={c.name} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2>{c.name}</h2>
            <p>
              {[c.matricula && `Matrícula ${c.matricula}`, c.role, c.posto_name, c.company].filter(Boolean).join(' · ')}
              {!c.active ? <span className="pbadge gray"> Desligado</span> : null}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Camisa</small>
              <b>{c.sizes?.camisa ?? '—'}</b>
            </div>
            <div>
              <small>Calça</small>
              <b>{c.sizes?.calca ?? '—'}</b>
            </div>
            <div>
              <small>Calçado</small>
              <b>{c.sizes?.calcado ?? '—'}</b>
            </div>
          </div>
          <div className="kv-row">
            <span>Admissão</span>
            <b>{dateBR(c.admitted_at)}</b>
          </div>
          {c.phone ? (
            <div className="kv-row">
              <span>Telefone</span>
              <b>{c.phone}</b>
            </div>
          ) : null}
          <div>
            <h3 className="sec-title">O que recebeu</h3>
            {!detail ? (
              <div className="skeleton" style={{ height: 60 }} />
            ) : detail.deliveries.length === 0 ? (
              <div className="empty-line">Nenhuma entrega registrada ainda.</div>
            ) : (
              detail.deliveries.map((d) => (
                <div className="kv-row" key={d.id}>
                  <span>
                    {d.qty} {d.item_name}
                    {d.size ? ` ${d.size}` : ''}
                    {d.kind === 'extra' ? ' · extraordinária' : ''}
                    {d.returned_qty ? ` · devolveu ${d.returned_qty}` : ''}
                    <small style={{ display: 'block', color: 'var(--muted)' }}>{formatDateTime(d.delivered_at)}</small>
                  </span>
                  <a className="link-btn" href={`/termo/${d.group_id}`} target="_blank" rel="noreferrer">
                    <FileText size={13} /> termo
                  </a>
                </div>
              ))
            )}
          </div>
          <div>
            <h3 className="sec-title">Pedidos</h3>
            {!detail ? null : detail.orders.length === 0 ? (
              <div className="empty-line">Nenhum pedido.</div>
            ) : (
              detail.orders.map((o) => (
                <div className="kv-row" key={o.id}>
                  <span>
                    {orderLabel(o.number)} · {ORIGIN_LABEL[o.origin]}
                  </span>
                  <b>{o.stage === 'concluido' ? 'Entregue' : o.stage === 'cancelado' ? 'Cancelado' : 'Em andamento'}</b>
                </div>
              ))
            )}
          </div>
          {canEdit ? (
            <div className="drawer-actions" style={{ marginTop: 'auto' }}>
              <button className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Pencil size={15} /> Editar dados e tamanhos
              </button>
              <button className="btn btn-ghost btn-sm" onClick={toggle}>
                {c.active ? 'Marcar como desligado' : 'Reativar'}
              </button>
            </div>
          ) : null}
        </div>
      </motion.aside>
    </motion.div>
  );
}
