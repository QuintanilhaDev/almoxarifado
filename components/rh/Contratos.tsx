'use client';
import { AlertCircle, Building2, FileUp, FileText, Info, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { ImportDialog } from '../almoxarifado/ImportDialog';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import type { Posto } from '@/lib/almoxarifado/types';
import type { Contrato } from '@/lib/rh/contratos';
import { dateBR } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';
import './controle.css';

type ContratoC = Contrato & { colaboradores: number; postos: number };
interface Painel {
  contratos: ContratoC[];
  postos: Posto[];
  semContrato: number;
  clientesSemContrato: { client: string; colaboradores: number }[];
  canEdit: boolean;
}
const EMPRESAS = ['MAX SERVIÇOS', 'MAX FORTE', 'MAX CONFIÁVEL'];
const docFmt = (d: string | null) => {
  const x = (d ?? '').replace(/\D/g, '');
  return x.length === 14 ? x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : x.length === 11 ? x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d ?? '';
};

/** RH › Contratos: cadastro dos contratos (clientes) e dos postos de cada um. */
export function Contratos({ version }: { version: number }) {
  const [data, setData] = useState<Painel | null>(null);
  const [failed, setFailed] = useState('');
  const [aba, setAba] = useState<'contratos' | 'postos' | 'sem'>('contratos');
  const [q, setQ] = useState('');
  const [editC, setEditC] = useState<ContratoC | 'novo' | null>(null);
  const [editP, setEditP] = useState<Posto | 'novo' | null>(null);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const load = useCallback(async () => {
    try {
      setData(await api<Painel>('/api/rh/contratos'));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);
  const nomeContrato = useMemo(() => new Map((data?.contratos ?? []).map((c) => [c.id, c.name])), [data]);
  const t = fold(q.trim());
  const contratos = (data?.contratos ?? []).filter((c) => !t || fold(`${c.name} ${c.aliases.join(' ')} ${c.cnpj ?? ''}`).includes(t));
  const postos = (data?.postos ?? []).filter((p) => !t || fold(`${p.name} ${p.code ?? ''} ${p.city ?? ''} ${nomeContrato.get(p.contract_id ?? '') ?? ''}`).includes(t));
  const sem = (data?.clientesSemContrato ?? []).filter((c) => !t || fold(c.client).includes(t));
  const criarDoCliente = async (client: string) => {
    try {
      const r = await api<Painel & { id: string }>('/api/rh/contratos', { method: 'POST', json: { name: client } });
      setData((d) => ({ ...r, canEdit: d?.canEdit ?? false }));
      toast({ kind: 'success', title: `Contrato ${client} criado` });
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  const canEdit = data?.canEdit ?? false;
  return (
    <div className="section-scroll" data-no-tilt>
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Contratos</h1>
            <p>Os contratos (clientes) e os postos de cada um. O colaborador entra no contrato pelo campo cliente do cadastro.</p>
          </div>
          {canEdit ? (
            <div className="head-actions">
              {aba === 'postos' ? (
                <>
                  <button className="btn btn-ghost" onClick={() => setImporting(true)}>
                    <FileUp size={18} /> Importar postos
                  </button>
                  <button className="btn btn-primary" onClick={() => setEditP('novo')} data-max="posto-novo-rh">
                    <Plus size={18} /> Novo posto
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => setEditC('novo')} data-max="contrato-novo">
                  <Plus size={18} /> Novo contrato
                </button>
              )}
            </div>
          ) : null}
        </div>
        {failed && !data ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar</strong>
            <span>{failed}</span>
          </div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 240, borderRadius: 16 }} />
        ) : (
          <>
            <div className="toolbar">
              <div className="filter-seg" role="tablist" aria-label="Ver">
                <button className={aba === 'contratos' ? 'is-active' : ''} onClick={() => setAba('contratos')}>
                  Contratos <em>{num(data.contratos.length)}</em>
                </button>
                <button className={aba === 'postos' ? 'is-active' : ''} onClick={() => setAba('postos')}>
                  Postos <em>{num(data.postos.length)}</em>
                </button>
                <button className={aba === 'sem' ? 'is-active' : ''} onClick={() => setAba('sem')}>
                  Clientes sem contrato <em>{num(data.clientesSemContrato.length)}</em>
                </button>
              </div>
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder={aba === 'postos' ? 'Buscar posto ou contrato' : 'Buscar contrato, CNPJ ou cliente'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
              </div>
            </div>
            {aba === 'contratos' ? (
              contratos.length === 0 ? (
                <div className="empty-line">Nenhum contrato{t ? ' com essa busca' : ''}.</div>
              ) : (
                <div className="t-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Contrato</th>
                        <th>Empresa</th>
                        <th>Vigência</th>
                        <th className="n">Colab.</th>
                        <th className="n">Postos</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {contratos.map((c) => (
                        <tr key={c.id} onClick={() => setEditC(c)} style={{ cursor: 'pointer' }}>
                          <td>
                            <b>{c.name}</b>
                            <small>{[c.cnpj ? docFmt(c.cnpj) : '', c.aliases.length ? `também: ${c.aliases.join(', ')}` : ''].filter(Boolean).join(' · ') || '—'}</small>
                          </td>
                          <td>{c.company ?? '—'}</td>
                          <td>{c.start_date || c.end_date ? `${dateBR(c.start_date)} a ${c.end_date ? dateBR(c.end_date) : 'atual'}` : '—'}</td>
                          <td className="n">{num(c.colaboradores)}</td>
                          <td className="n">{num(c.postos)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {!c.active ? <span className="pbadge gray">Encerrado</span> : null} {c.portaria_social ? <span className="pbadge lilac">Portaria social</span> : null} {c.block_import ? <span className="pbadge red">Não importar</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : aba === 'postos' ? (
              postos.length === 0 ? (
                <div className="empty-line">Nenhum posto{t ? ' com essa busca' : ''}.</div>
              ) : (
                <div className="t-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Posto</th>
                        <th>Contrato</th>
                        <th>Cidade</th>
                        <th>Supervisor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {postos.map((p) => (
                        <tr key={p.id} onClick={() => canEdit && setEditP(p)} style={{ cursor: canEdit ? 'pointer' : undefined }}>
                          <td>
                            <b>{p.name}</b>
                            <small>{p.code ? `código ${p.code}` : '—'}</small>
                          </td>
                          <td>{p.contract_id ? nomeContrato.get(p.contract_id) : <span className="pbadge amber">Sem contrato</span>}</td>
                          <td>{p.city ?? '—'}</td>
                          <td>{p.supervisor ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <>
                <p className="help">Clientes que aparecem no cadastro de colaboradores e ainda não têm contrato ({num(data.semContrato)} colaboradores ativos ao todo, contando quem está sem cliente).</p>
                {sem.length === 0 ? (
                  <div className="empty-line">Todos os clientes já têm contrato.</div>
                ) : (
                  sem.map((c) => (
                    <div className="kv-row" key={c.client}>
                      <span>
                        {c.client}
                        <small style={{ display: 'block', color: 'var(--muted)' }}>{num(c.colaboradores)} colaborador(es)</small>
                      </span>
                      {canEdit ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => criarDoCliente(c.client)}>
                          <Plus size={14} /> Criar contrato
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}
      </div>
      {editC && data ? <ContratoSheet c={editC === 'novo' ? null : editC} painel={data} canEdit={canEdit} onClose={() => setEditC(null)} onSaved={(p) => { setData((d) => ({ ...p, canEdit: d?.canEdit ?? false })); setEditC(null); }} /> : null}
      {editP && data ? <PostoSheet p={editP === 'novo' ? null : editP} contratos={data.contratos} onClose={() => setEditP(null)} onSaved={async () => { setEditP(null); await load(); }} /> : null}
      {importing ? <ImportDialog kind="postos" onClose={() => setImporting(false)} onDone={load} /> : null}
    </div>
  );
}

function ContratoSheet({ c, painel, canEdit, onClose, onSaved }: { c: ContratoC | null; painel: Painel; canEdit: boolean; onClose: () => void; onSaved: (p: Painel) => void }) {
  const toast = useToast();
  const [name, setName] = useState(c?.name ?? '');
  const [aliases, setAliases] = useState<string[]>(c?.aliases ?? []);
  const [alias, setAlias] = useState('');
  const [cnpj, setCnpj] = useState(c?.cnpj ? docFmt(c.cnpj) : '');
  const [company, setCompany] = useState(c?.company ?? '');
  const [start, setStart] = useState(c?.start_date ?? '');
  const [end, setEnd] = useState(c?.end_date ?? '');
  const [active, setActive] = useState(c?.active ?? true);
  const [social, setSocial] = useState(c?.portaria_social ?? false);
  const [block, setBlock] = useState(c?.block_import ?? false);
  const [notes, setNotes] = useState(c?.notes ?? '');
  const [novoPosto, setNovoPosto] = useState('');
  const [ligar, setLigar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [postos, setPostos] = useState(painel.postos);
  const meus = c ? postos.filter((p) => p.contract_id === c.id) : [];
  const livres = postos.filter((p) => !p.contract_id);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { name, aliases: alias.trim() ? [...aliases, alias.trim()] : aliases, cnpj, company, start_date: start || null, end_date: end || null, active, portaria_social: social, block_import: block, notes };
      const r = await api<Painel>(c ? `/api/rh/contratos?id=${c.id}` : '/api/rh/contratos', { method: c ? 'PATCH' : 'POST', json: body });
      toast({ kind: 'success', title: `${name} salvo` });
      onSaved(r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!c || !window.confirm(`Apagar o contrato ${c.name}? Os postos continuam, só sem contrato.`)) return;
    setBusy(true);
    try {
      onSaved(await api<Painel>(`/api/rh/contratos?id=${c.id}`, { method: 'DELETE' }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const vincular = async (postoId: string, contractId: string | null) => {
    try {
      await api(`/api/almoxarifado/postos/${postoId}`, { method: 'PATCH', json: { contract_id: contractId } });
      setPostos((ps) => ps.map((p) => (p.id === postoId ? { ...p, contract_id: contractId } : p)));
      setLigar('');
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  const criarPosto = async () => {
    if (!c || !novoPosto.trim()) return;
    try {
      const r = await api<{ id: string }>('/api/almoxarifado/postos', { method: 'POST', json: { name: novoPosto.trim(), contract_id: c.id } });
      setPostos((ps) => [...ps, { id: r.id, name: novoPosto.trim(), contract_id: c.id, code: null, city: null, address: null, supervisor: null, notes: null, created_by: null, created_at: new Date().toISOString(), items_count: 0, units: 0 }]);
      setNovoPosto('');
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  return (
    <Sheet title={c ? c.name : 'Novo contrato'} lead={c ? `${num(c.colaboradores)} colaborador(es) ativo(s) · ${num(meus.length)} posto(s)` : 'O nome deve ser igual ao do campo cliente no cadastro de colaboradores (ou inclua os outros nomes abaixo).'} onClose={onClose} wide locked>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <label className="label" htmlFor="ct-n">
          Nome do contrato (cliente)
        </label>
        <input id="ct-n" className="input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        <label className="label" htmlFor="ct-a" style={{ marginTop: 10 }}>
          Outros nomes do mesmo cliente na planilha <span className="opt-tag">(opcional)</span>
        </label>
        <div className="ctl-chips">
          {aliases.map((a) => (
            <span className="ctl-chip" key={a}>
              {a}
              <button type="button" onClick={() => setAliases(aliases.filter((x) => x !== a))} aria-label={`Tirar ${a}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <input
          id="ct-a"
          className="input"
          value={alias}
          placeholder="Digite e tecle Enter"
          onChange={(e) => setAlias(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && alias.trim()) {
              e.preventDefault();
              setAliases([...new Set([...aliases, alias.trim()])]);
              setAlias('');
            }
          }}
        />
        <div className="sx-grid" style={{ marginTop: 10 }}>
          <div>
            <label className="label" htmlFor="ct-c">
              CNPJ <span className="opt-tag">(opcional)</span>
            </label>
            <input id="ct-c" className="input" value={cnpj} inputMode="numeric" onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="label" htmlFor="ct-e">
              Empresa
            </label>
            <input id="ct-e" className="input" list="ct-e-l" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="MAX SERVIÇOS ou MAX FORTE" />
            <datalist id="ct-e-l">
              {EMPRESAS.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="ct-i">
              Início da vigência <span className="opt-tag">(opcional)</span>
            </label>
            <input id="ct-i" className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ct-f">
              Fim da vigência <span className="opt-tag">(opcional)</span>
            </label>
            <input id="ct-f" className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <label className="ctl-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Contrato ativo
        </label>
        <label className="ctl-check">
          <input type="checkbox" checked={social} onChange={(e) => setSocial(e.target.checked)} /> Portaria social: o Agente de Portaria deste contrato recebe o kit social
        </label>
        <label className="ctl-check">
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Não importar: a planilha de colaboradores ignora quem é deste contrato
        </label>
        <label className="label" htmlFor="ct-o" style={{ marginTop: 8 }}>
          Observação <span className="opt-tag">(opcional)</span>
        </label>
        <input id="ct-o" className="input" value={notes} maxLength={400} onChange={(e) => setNotes(e.target.value)} />
      </fieldset>
      {c ? (
        <>
          <h3 className="sec-title" style={{ marginTop: 16 }}>
            Postos do contrato
          </h3>
          {meus.length === 0 ? <div className="empty-line">Nenhum posto ligado a este contrato.</div> : null}
          {meus.map((p) => (
            <div className="kv-row" key={p.id}>
              <span>
                <Building2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                {p.name}
              </span>
              {canEdit ? (
                <button className="link-btn" onClick={() => vincular(p.id, null)}>
                  tirar do contrato
                </button>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <div className="sx-grid" style={{ marginTop: 8 }}>
              <div>
                <label className="label" htmlFor="ct-l">
                  Ligar posto já cadastrado
                </label>
                <select id="ct-l" className="select input" value={ligar} onChange={(e) => e.target.value && vincular(e.target.value, c.id)}>
                  <option value="">{livres.length ? 'Escolha um posto sem contrato' : 'Nenhum posto sem contrato'}</option>
                  {livres.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ct-np">
                  Ou cadastrar um posto novo
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="ct-np" className="input" value={novoPosto} onChange={(e) => setNovoPosto(e.target.value)} placeholder="Nome do posto" />
                  <button className="btn btn-ghost" onClick={criarPosto} disabled={!novoPosto.trim()}>
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        {c && canEdit ? (
          <button className="btn btn-danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
            <Trash2 size={15} /> Apagar
          </button>
        ) : null}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          {canEdit ? 'Cancelar' : 'Fechar'}
        </button>
        {canEdit ? (
          <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? <span className="spinner" /> : <FileText size={15} />} Salvar
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

function PostoSheet({ p, contratos, onClose, onSaved }: { p: Posto | null; contratos: ContratoC[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', code: p?.code ?? '', city: p?.city ?? '', address: p?.address ?? '', supervisor: p?.supervisor ?? '', notes: p?.notes ?? '', contract_id: p?.contract_id ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(p ? `/api/almoxarifado/postos/${p.id}` : '/api/almoxarifado/postos', { method: p ? 'PATCH' : 'POST', json: { ...f, contract_id: f.contract_id || null } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!p) return;
    if (!window.confirm(`Remover o posto ${p.name}?${p.units ? ` O que está nele (${p.units} unidades) volta para o almoxarifado.` : ''}`)) return;
    setBusy(true);
    try {
      await api(`/api/almoxarifado/postos/${p.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={p ? p.name : 'Novo posto'} onClose={onClose} wide locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="ps-n">
            Nome do posto
          </label>
          <input id="ps-n" className="input" value={f.name} maxLength={120} onChange={set('name')} />
        </div>
        <div>
          <label className="label" htmlFor="ps-ct">
            Contrato
          </label>
          <select id="ps-ct" className="select input" value={f.contract_id} onChange={set('contract_id')}>
            <option value="">Sem contrato</option>
            {contratos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ps-c">
            Código <span className="opt-tag">(opcional)</span>
          </label>
          <input id="ps-c" className="input" value={f.code} maxLength={40} onChange={set('code')} />
        </div>
        <div>
          <label className="label" htmlFor="ps-ci">
            Cidade <span className="opt-tag">(opcional)</span>
          </label>
          <input id="ps-ci" className="input" value={f.city} maxLength={80} onChange={set('city')} />
        </div>
        <div>
          <label className="label" htmlFor="ps-e">
            Endereço <span className="opt-tag">(opcional)</span>
          </label>
          <input id="ps-e" className="input" value={f.address} maxLength={200} onChange={set('address')} />
        </div>
        <div>
          <label className="label" htmlFor="ps-s">
            Supervisor <span className="opt-tag">(opcional)</span>
          </label>
          <input id="ps-s" className="input" value={f.supervisor} maxLength={120} onChange={set('supervisor')} />
        </div>
      </div>
      <label className="label" htmlFor="ps-o">
        Observação <span className="opt-tag">(opcional)</span>
      </label>
      <input id="ps-o" className="input" value={f.notes} maxLength={400} onChange={set('notes')} />
      {p ? (
        <p className="help" style={{ marginTop: 8 }}>
          <Info size={13} style={{ verticalAlign: -2 }} /> O estoque do posto e as movimentações continuam no Almoxarifado › Postos.
        </p>
      ) : null}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        {p ? (
          <button className="btn btn-danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
            <Trash2 size={15} /> Remover posto
          </button>
        ) : null}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>
          {busy ? <span className="spinner" /> : null} Salvar
        </button>
      </div>
    </Sheet>
  );
}
