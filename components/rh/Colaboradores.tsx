'use client';
import { deg } from '@/lib/fx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, FileText, FileUp, Pencil, Plus, RotateCcw, Search, Shirt, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime } from '@/lib/format';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { ORIGIN_LABEL, orderLabel, type MaterialOrder } from '@/lib/pedidos/types';
import { ItemPicker, dateBR, type PickItem } from '../pedidos/ui';
import { DesligarSheet, DevolucaoFicha, DevolucoesView } from './Desligamento';
import { arquivada, clienteDe, type Devolucao } from '@/lib/rh/devolucao';
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
  /** cliente (tomador do serviço) e desligamento: só depois do supabase/desligamento.sql */
  client?: string | null;
  dismissed_at?: string | null;
  dismissal_reason?: string | null;
  dismissal_notes?: string | null;
  dismissed_by?: string | null;
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
  const [view, setView] = useState<'pessoas' | 'devolucoes' | 'kits'>('pessoas');
  const [list, setList] = useState<Collab[] | null>(null);
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  // a lista toda vem do servidor; a tabela desenha aos poucos (milhares de linhas travariam a tela)
  const [limite, setLimite] = useState(300);
  useEffect(() => setLimite(300), [query, showInactive]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ c: Collab | null } | null>(null);
  const [kitForm, setKitForm] = useState<{ k: Kit | null } | null>(null);
  const [importRows, setImportRows] = useState<ImportData | null>(null);
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
    return (list ?? []).filter((c) => (showInactive ? !c.active : c.active) && (!t || fold(`${c.name} ${c.matricula ?? ''} ${c.role ?? ''} ${c.posto_name ?? ''} ${c.company ?? ''} ${c.client ?? ''}`).includes(t)));
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

  const open = openId ? ((list ?? []).find((c) => c.id === openId) ?? null) : null;
  return (
    <div className="section-scroll" data-no-tilt>
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Colaboradores</h1>
            <p>Cadastro, tamanhos e kits por função.</p>
          </div>
          <div className="head-actions">
            {view === 'devolucoes' ? null : view === 'pessoas' ? (
              <>
                <button data-max="colab-importar" data-max-file="#colab-file" className="btn btn-ghost edit-only" onClick={() => fileRef.current?.click()} disabled={!canEdit}>
                  <FileUp size={18} /> Importar planilha
                </button>
                <input ref={fileRef} id="colab-file" type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Planilha de colaboradores" />
                <button data-max="colab-novo" className="btn btn-primary edit-only" onClick={() => setForm({ c: null })} disabled={!canEdit}>
                  <UserPlus size={18} /> Novo colaborador
                </button>
              </>
            ) : (
              <button data-max="kit-novo" className="btn btn-primary edit-only" onClick={() => setKitForm({ k: null })} disabled={!canEdit}>
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
            <button data-max="colab-devolucoes" className={view === 'devolucoes' ? 'is-active' : ''} onClick={() => setView('devolucoes')}>
              Devoluções
            </button>
            <button data-max="colab-kits" className={view === 'kits' ? 'is-active' : ''} onClick={() => setView('kits')}>
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
        ) : view === 'devolucoes' ? (
          <DevolucoesView version={version + (list?.length ?? 0)} onOpen={setOpenId} />
        ) : !list || !kits ? (
          <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
        ) : view === 'pessoas' ? (
          shown.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">
                <Users size={24} />
              </span>
              <strong>{list.length ? 'Ninguém encontrado' : 'Nenhum colaborador cadastrado'}</strong>
              <span>{list.length ? 'Tente outra busca.' : 'Importe a planilha do RH ou cadastre um por um. Admissões feitas em Pedidos também entram aqui.'}</span>
            </div>
          ) : (
            <>
            <div className="t-wrap">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Função</th>
                    <th>Posto</th>
                    <th>Tamanhos</th>
                    <th>{showInactive ? 'Desligado em' : 'Admissão'}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, limite).map((c) => (
                    <tr key={c.id} className="click" onClick={() => setOpenId(c.id)}>
                      <td>
                        <b>{c.name}</b>
                        <small>{c.matricula ? `Matrícula ${c.matricula}` : 'Sem matrícula'}</small>
                      </td>
                      <td>{c.role ?? '—'}</td>
                      <td>
                        {c.posto_name ?? (clienteDe(c) || '—')}
                        {c.posto_name && c.client && c.client !== c.posto_name ? <small>{c.client}</small> : null}
                      </td>
                      <td>
                        {[c.sizes?.camisa && `Camisa ${c.sizes.camisa}`, c.sizes?.calca && `Calça ${c.sizes.calca}`, c.sizes?.calcado && `Calçado ${c.sizes.calcado}`].filter(Boolean).join(' · ') || (
                          <span className="pbadge amber">Sem tamanhos</span>
                        )}
                      </td>
                      <td>{showInactive ? dateBR(c.dismissed_at ?? null) : dateBR(c.admitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              {shown.length > limite ? (
                <div className="list-more">
                  <span>
                    Mostrando {num(limite)} de {num(shown.length)}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setLimite((x) => x + 500)}>
                    Mostrar mais
                  </button>
                  <button className="link-btn" onClick={() => setLimite(shown.length)}>
                    mostrar todos
                  </button>
                </div>
              ) : null}
            </>
          )
        ) : (
          <>
            {noKit.length ? (
              <div className="banner">
                <Shirt size={20} color="var(--amber)" />
                <span>Funções sem kit: {noKit.join(', ')}. Sem kit, a admissão e a troca anual dessas pessoas precisam de itens digitados.</span>
              </div>
            ) : null}
            {kits.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <Shirt size={24} />
                </span>
                <strong>Nenhum kit cadastrado</strong>
                <span>Cadastre o que cada função recebe e o prazo de troca.</span>
              </div>
            ) : (
              <div className="g-grid">
                {kits.map((k) => (
                  <div key={k.role} className="g-card">
                    <h3 style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      {k.role}
                      <span className="pbadge lilac">
                        troca a cada {k.period_months} {k.period_months === 1 ? 'mês' : 'meses'}
                      </span>
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
        {form ? (
          <CollabForm
            key="f"
            c={form.c}
            roles={(kits ?? []).map((k) => k.role)}
            onClose={() => setForm(null)}
            onSaved={async () => {
              setForm(null);
              await load();
            }}
          />
        ) : null}
        {kitForm ? (
          <KitForm
            key="k"
            k={kitForm.k}
            onClose={() => setKitForm(null)}
            onSaved={async () => {
              setKitForm(null);
              await load();
            }}
          />
        ) : null}
        {importRows ? (
          <ImportSheet
            key="imp"
            data={importRows}
            onClose={() => setImportRows(null)}
            onDone={async () => {
              setImportRows(null);
              await load();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface ImportData {
  rows: Record<string, unknown>[];
  columns: string[];
  warnings: string[];
  abas?: { nome: string; linhas: number; ignorada: string | null; oculta: boolean }[];
  juntados?: number;
  resumo?: { novos: number; atualizar: number; desligados: number; semMatricula: number; semFuncao: number; clientes: { nome: string; n: number }[]; funcoes: { nome: string; n: number }[] };
  empresa?: string;
}
type StatusImp = 'novo' | 'atualizar' | 'desligado';
const IMP_LABEL: Record<StatusImp, string> = { novo: 'Novo', atualizar: 'Atualiza', desligado: 'Desligado' };

/**
 * Conferência da importação: TODAS as abas são lidas e a mesma pessoa em várias abas vira uma só.
 * Mostra de onde veio cada um, quem é novo, quem será atualizado e o que falta na planilha.
 */
function ImportSheet({ data, onDone, onClose }: { data: ImportData; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [empresa, setEmpresa] = useState(data.empresa ?? '');
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState<StatusImp | ''>('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => data.rows.map(({ _abas, _status, ...r }): Record<string, unknown> => ({ ...r, company: r.company || empresa || null })), [data.rows, empresa]);
  const vis = useMemo(() => {
    const t = fold(q.trim());
    return data.rows.filter((r) => (!filtro || r._status === filtro) && (!t || fold(`${r.name} ${r.matricula ?? ''} ${r.role ?? ''} ${r.client ?? ''}`).includes(t)));
  }, [data.rows, filtro, q]);
  const res = data.resumo;
  const abas = data.abas ?? [];
  const go = async () => {
    setBusy(true);
    try {
      const j = await api<{ created: number; updated: number; unchanged?: number; errors: string[] }>('/api/rh/colaboradores', { method: 'POST', json: { rows } });
      toast(
        {
          kind: j.errors.length ? 'info' : 'success',
          title: `${num(j.created)} cadastrado(s), ${num(j.updated)} atualizado(s)${j.unchanged ? `, ${num(j.unchanged)} sem mudança` : ''}`,
          text: j.errors.length ? `${j.errors.length} com problema: ${j.errors.slice(0, 2).join('; ')}` : undefined,
        },
        10000,
      );
      onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Importação falhou', text: (e as Error).message });
      setBusy(false);
    }
  };
  return (
    <Sheet title="Importar colaboradores" lead={`${num(rows.length)} pessoa(s) encontradas em ${abas.filter((a) => !a.ignorada && a.linhas).length || 1} aba(s). Confira antes de importar.`} onClose={onClose} wide>
      {abas.length > 1 ? (
        <div className="imp-abas">
          <span className="label">Abas da planilha</span>
          <div className="imp-aba-list">
            {abas.map((a) => (
              <span key={a.nome} className={`imp-aba${a.ignorada ? ' is-off' : ''}`} title={a.ignorada ?? undefined}>
                <b>{a.nome}</b>
                <em>{a.ignorada ? `ignorada: ${a.ignorada}` : `${num(a.linhas)} pessoa(s)${a.oculta ? ' · oculta' : ''}`}</em>
              </span>
            ))}
          </div>
          {data.juntados ? <p className="help">{num(data.juntados)} pessoa(s) aparecem em mais de uma aba e entram uma vez só (pela matrícula), com os dados completados pelas outras abas.</p> : null}
        </div>
      ) : null}
      {res ? (
        <div className="imp-resumo">
          {(['novo', 'atualizar', 'desligado'] as StatusImp[]).map((k) => {
            const n = k === 'novo' ? res.novos : k === 'atualizar' ? res.atualizar : res.desligados;
            if (!n && k === 'desligado') return null;
            return (
              <button key={k} type="button" className={`imp-card${filtro === k ? ' is-on' : ''}`} onClick={() => setFiltro(filtro === k ? '' : k)}>
                <small>{k === 'novo' ? 'Novos cadastros' : k === 'atualizar' ? 'Já cadastrados (atualiza)' : 'Desligados (continuam desligados)'}</small>
                <b>{num(n)}</b>
              </button>
            );
          })}
          <div className="imp-card is-static">
            <small>Atenção</small>
            <b className="imp-warn">{num(res.semMatricula + res.semFuncao)}</b>
            <em>
              {res.semMatricula} sem matrícula · {res.semFuncao} sem função
            </em>
          </div>
        </div>
      ) : null}
      {res?.clientes.length ? (
        <p className="help">
          Clientes com mais gente: {res.clientes.slice(0, 5).map((c) => `${c.nome} (${c.n})`).join(' · ')}
        </p>
      ) : null}
      <label className="imp-emp">
        <span className="label">Empresa (para quem não tem na planilha)</span>
        <input className="input" value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Ex.: Max Serviços" aria-label="Empresa" />
      </label>
      {data.columns.length ? <p className="help">Colunas reconhecidas: {data.columns.join(' · ')}</p> : null}
      {data.warnings.length ? <p className="help">{data.warnings.join(' ')}</p> : null}
      <div className="search" style={{ marginBottom: 8 }}>
        <Search size={16} />
        <input className="input" placeholder="Buscar na planilha" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na planilha" />
      </div>
      <div className="t-wrap" style={{ maxHeight: 300 }}>
        <table className="t-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Função</th>
              <th>Cliente</th>
              <th>Aba</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vis.slice(0, 200).map((r, i) => (
              <tr key={i}>
                <td>
                  <b>{String(r.name ?? '')}</b>
                  <small>{r.matricula ? `Matrícula ${r.matricula}` : 'Sem matrícula'}</small>
                </td>
                <td>{String(r.role ?? '—')}</td>
                <td>{String(r.client ?? r.posto ?? '—')}</td>
                <td>
                  <small>{String(r._abas ?? '')}</small>
                </td>
                <td>{r._status ? <span className={`pbadge ${r._status === 'novo' ? 'lilac' : r._status === 'desligado' ? 'gray' : 'green'}`}>{IMP_LABEL[r._status as StatusImp]}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {vis.length > 200 ? <p className="help">Mostrando 200 de {num(vis.length)}. Use a busca para achar alguém.</p> : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !rows.length}>
          {busy ? <span className="spinner" /> : <FileUp size={16} />} Importar {num(rows.length)}
        </button>
      </div>
    </Sheet>
  );
}

function CollabForm({ c, roles, onClose, onSaved }: { c: Collab | null; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: c?.name ?? '',
    matricula: c?.matricula ?? '',
    role: c?.role ?? '',
    posto_name: c?.posto_name ?? '',
    company: c?.company ?? '',
    client: c?.client ?? '',
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
    api<{ postos: { id: string; name: string }[] }>('/api/pedidos/catalogo')
      .then((j) => setPostos(j.postos))
      .catch(() => undefined);
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Informe o nome.');
    setBusy(true);
    setError('');
    try {
      const body = {
        name: f.name,
        matricula: f.matricula,
        role: f.role,
        posto_name: f.posto_name,
        company: f.company,
        client: f.client,
        admitted_at: f.admitted_at,
        phone: f.phone,
        notes: f.notes,
        sizes: { camisa: f.camisa, calca: f.calca, calcado: f.calcado },
      };
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
            <label className="label" htmlFor="c-cli">
              Cliente
            </label>
            <input id="c-cli" className="input" value={f.client} maxLength={120} onChange={(e) => set('client', e.target.value)} placeholder="Tomador do serviço" />
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
    api<{ items: PickItem[] }>('/api/pedidos/catalogo')
      .then((j) => setItems(j.items))
      .catch(() => undefined);
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
      await api('/api/rh/kits', {
        method: 'PUT',
        json: {
          role,
          old_role: k?.role,
          period_months: Number(months),
          items: lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), size_from: l.size_from, qty: Number(l.qty) || 0, item_id: l.size_from ? null : l.item_id })),
        },
      });
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
            <select
              className="select input p-line-size"
              style={{ width: 120 }}
              aria-label={`Tamanho do item ${n + 1}`}
              value={l.size_from ?? ''}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, size_from: (e.target.value || null) as typeof l.size_from } : x)))}
            >
              <option value="">Sem tamanho</option>
              <option value="camisa">Tam. camisa</option>
              <option value="calca">Tam. calça</option>
              <option value="calcado">Nº calçado</option>
            </select>
            <input
              className="input p-line-qty"
              aria-label={`Quantidade ${n + 1}`}
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value.replace(/\D/g, '').slice(0, 2) } : x)))}
            />
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
  const [detail, setDetail] = useState<{
    deliveries: { id: string; group_id: string; item_name: string; size: string | null; qty: number; returned_qty: number; kind: string; delivered_at: string; order_number: number | null }[];
    orders: MaterialOrder[];
    returns?: Devolucao[];
    desligamento?: boolean;
  } | null>(null);
  const [desligar, setDesligar] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    api<typeof detail>(`/api/rh/colaboradores/${c.id}`)
      .then(setDetail)
      .catch(() => setDetail({ deliveries: [], orders: [] }));
  }, [c.id, c.updated_at, n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && !desligar && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen, desligar]);
  const toggle = async () => {
    if (!c.active && !window.confirm(`Reativar ${c.name}? Ele volta para os alertas e pedidos. As devoluções registradas continuam no histórico.`)) return;
    try {
      await api(`/api/rh/colaboradores/${c.id}`, { method: 'PATCH', json: { active: !c.active } });
      toast({ kind: 'success', title: c.active ? 'Colaborador desligado' : 'Colaborador reativado' });
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  // com o desligamento ativado no banco, sair passa pela conferência da devolução
  const comConferencia = detail?.desligamento === true;
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer o-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={c.name}
        initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }}
        animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }}
        exit={{ x: 60, opacity: 0, rotateY: deg(-18) }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2>{c.name}</h2>
            <p>
              {[c.matricula && `Matrícula ${c.matricula}`, c.role, c.client, c.posto_name, c.company].filter(Boolean).join(' · ')}
              {!c.active ? <span className="pbadge gray"> Desligado</span> : null}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          {!c.active && detail?.desligamento ? <DevolucaoFicha c={c} itens={(detail.returns ?? []).filter((x) => !arquivada(x))} canEdit={canEdit} onChange={() => setN((x) => x + 1)} /> : null}
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
          {(detail?.returns ?? []).some(arquivada) ? (
            <details className="dl-anteriores">
              <summary>Devoluções de um desligamento anterior ({(detail?.returns ?? []).filter(arquivada).length})</summary>
              {(detail?.returns ?? []).filter(arquivada).map((r) => (
                <div className="kv-row" key={r.id}>
                  <span>
                    {r.qty_delivered ? `${r.qty_delivered}× ` : ''}
                    {r.item_name}
                    {r.size ? ` ${r.size}` : ''}
                  </span>
                  <b>{r.status === 'devolvido' ? 'Devolvido' : r.status === 'nao_devolvido' ? 'Não devolvido' : 'Pendente'}</b>
                </div>
              ))}
            </details>
          ) : null}
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
              {c.active && comConferencia ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setDesligar(true)} data-max="colab-desligar">
                  <UserMinus size={15} /> Registrar desligamento
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={toggle} disabled={!detail}>
                  {c.active ? (
                    'Marcar como desligado'
                  ) : (
                    <>
                      <RotateCcw size={14} /> Reativar
                    </>
                  )}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </motion.aside>
      {/* a conferência abre por cima da ficha; o clique nela não pode fechar a ficha */}
      <div onClick={(e) => e.stopPropagation()}>
        <AnimatePresence>
          {desligar ? (
            <DesligarSheet
              key="desl"
              c={c}
              onClose={() => setDesligar(false)}
              onDone={async () => {
                setDesligar(false);
                await reload();
                setN((x) => x + 1);
              }}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
