'use client';
import { AlertCircle, ArrowLeft, ClipboardCheck, FileSpreadsheet, Info, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { dateBR } from '../pedidos/ui';
import { INDICADORES, JANELA, STATUS_EXIG, STATUS_PECA, TIPO_EXIG, type ColabControle, type Contrato, type Exigencia, type Indicador, type Linha, type NumeroInd, type RegistroC, type TipoExig } from '@/lib/rh/controle';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';
import './controle.css';

interface Painel {
  hoje: string;
  resumo: NumeroInd[];
  contratos: Contrato[];
  estoque: { fisico: number; reservado: number; disponivel: number; noPosto: number; emUso: number };
  exigencias: Exigencia[];
  temExigencias: boolean;
  semPlanilha: boolean;
  colaboradores: number;
  funcoes: string[];
  clientes: string[];
  empresas: string[];
}

/**
 * Tela inicial do RH: os seis números (kit incompleto, peças pendentes, trocas vencidas,
 * reposições em 60 dias, ASOs e cursos). Cada número abre a relação filtrável e exportável;
 * o que está sem informação aparece separado.
 */
export function Controle({ canEdit, version }: { canEdit: boolean; version: number }) {
  const [data, setData] = useState<Painel | null>(null);
  const [failed, setFailed] = useState('');
  const [ind, setInd] = useState<Indicador | null>(null);
  const [exig, setExig] = useState(false);
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    try {
      setData(await api<Painel>('/api/rh/controle'));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version, n]);
  const r = useMemo(() => new Map((data?.resumo ?? []).map((x) => [x.id, x])), [data]);

  return (
    <div className="section-scroll" data-no-tilt>
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Controle</h1>
            <p>Fardamento por peça, ASO, cursos e documentos dos colaboradores ativos.</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setExig(true)} data-max="controle-exigencias" disabled={!data?.temExigencias}>
              <Settings2 size={18} /> ASO, cursos e documentos
            </button>
          </div>
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
          <div className="skeleton" style={{ height: 260, borderRadius: 16 }} />
        ) : ind ? (
          <Relacao ind={ind} painel={data} onBack={() => setInd(null)} />
        ) : (
          <>
            {!data.temExigencias ? (
              <div className="banner">
                <Info size={20} color="var(--amber)" />
                <span>O controle de ASO e cursos ainda não foi ativado no banco. Rode o arquivo supabase/controle_rh.sql no SQL Editor do Supabase. O fardamento já aparece abaixo.</span>
              </div>
            ) : null}
            <div className="ctl-grid">
              {INDICADORES.map((x) => {
                const v = r.get(x.id);
                return (
                  <button key={x.id} className={`ctl-card${v?.valor ? ' has' : ''}`} onClick={() => setInd(x.id)} data-max={`controle-${x.id}`}>
                    <small>{x.titulo}</small>
                    <b>{num(v?.valor ?? 0)}</b>
                    <span>{x.id === 'kit_incompleto' || x.id === 'aso' || x.id === 'cursos' ? x.sub : `${x.sub} · ${num(v?.pessoas ?? 0)} colaborador(es)`}</span>
                    {v?.semInfo ? (
                      <em className="ctl-sem">
                        {num(v.semInfo)} sem informação ({x.semInfo})
                      </em>
                    ) : (
                      <em className="ctl-sem ok">nada sem informação</em>
                    )}
                  </button>
                );
              })}
            </div>
            {data.semPlanilha ? (
              <p className="help" style={{ marginTop: 6 }}>
                As entregas vêm do sistema e da planilha de controle importada em Gestão › Fardamento (nenhuma importada ainda).
              </p>
            ) : null}
            <Contratos data={data} />
          </>
        )}
      </div>
      {exig && data ? <ExigenciasSheet exigs={data.exigencias} painel={data} canEdit={canEdit} onClose={() => setExig(false)} onChange={() => setN((x) => x + 1)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------ relação de um indicador */
function Relacao({ ind, painel, onBack }: { ind: Indicador; painel: Painel; onBack: () => void }) {
  const meta = INDICADORES.find((x) => x.id === ind)!;
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [failed, setFailed] = useState('');
  const [aba, setAba] = useState<'pend' | 'sem'>('pend');
  const [contrato, setContrato] = useState('');
  const [posto, setPosto] = useState('');
  const [funcao, setFuncao] = useState('');
  const [q, setQ] = useState('');
  const [limite, setLimite] = useState(300);
  useEffect(() => {
    setLinhas(null);
    api<{ linhas: Linha[] }>(`/api/rh/controle?ind=${ind}`)
      .then((j) => setLinhas(j.linhas))
      .catch((e) => setFailed((e as Error).message));
  }, [ind]);
  useEffect(() => setLimite(300), [aba, contrato, posto, funcao, q]);
  const filtra = useCallback(
    (ls: Linha[]) => {
      const t = fold(q.trim());
      return ls.filter((l) => (!contrato || l.contrato === contrato) && (!posto || (l.posto_name ?? '') === posto) && (!funcao || (l.role ?? '') === funcao) && (!t || fold(`${l.name} ${l.matricula ?? ''} ${l.item} ${l.contrato} ${l.posto_name ?? ''}`).includes(t)));
    },
    [contrato, posto, funcao, q],
  );
  const todas = linhas ?? [];
  const pend = useMemo(() => filtra(todas.filter((l) => !l.semInfo)), [todas, filtra]);
  const sem = useMemo(() => filtra(todas.filter((l) => l.semInfo)), [todas, filtra]);
  const shown = aba === 'pend' ? pend : sem;
  const opts = (f: (l: Linha) => string | null) => [...new Set(todas.map(f).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const exigencia = ind === 'aso' || ind === 'cursos';
  const href = `/api/rh/controle?ind=${ind}&format=xlsx&contrato=${encodeURIComponent(contrato)}&posto=${encodeURIComponent(posto)}&funcao=${encodeURIComponent(funcao)}&q=${encodeURIComponent(q)}`;
  return (
    <>
      <div className="ctl-rel-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={15} /> Voltar aos números
        </button>
        <h2>{meta.titulo}</h2>
        <a className="btn btn-ghost btn-sm" href={href} data-max="controle-exportar">
          <FileSpreadsheet size={15} /> Exportar Excel
        </a>
      </div>
      <div className="toolbar">
        <div className="filter-seg" role="tablist" aria-label="Situação">
          <button className={aba === 'pend' ? 'is-active' : ''} onClick={() => setAba('pend')}>
            Pendências <em>{num(pend.length)}</em>
          </button>
          <button className={aba === 'sem' ? 'is-active' : ''} onClick={() => setAba('sem')}>
            Sem informação <em>{num(sem.length)}</em>
          </button>
        </div>
        <div className="search">
          <Search size={17} />
          <input className="input" placeholder="Buscar colaborador, matrícula ou item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na relação" />
        </div>
      </div>
      <div className="ctl-filters">
        <select className="select input" value={contrato} onChange={(e) => setContrato(e.target.value)} aria-label="Contrato">
          <option value="">Todos os contratos</option>
          {opts((l) => l.contrato).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select className="select input" value={posto} onChange={(e) => setPosto(e.target.value)} aria-label="Posto">
          <option value="">Todos os postos</option>
          {opts((l) => l.posto_name).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select className="select input" value={funcao} onChange={(e) => setFuncao(e.target.value)} aria-label="Função">
          <option value="">Todas as funções</option>
          {opts((l) => l.role).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      {aba === 'sem' ? <p className="help">Registros sem informação ficam separados: ausência de data não significa que o item esteja regular ({meta.semInfo}).</p> : null}
      {failed ? (
        <div className="empty">
          <strong>Não foi possível carregar</strong>
          <span>{failed}</span>
        </div>
      ) : !linhas ? (
        <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
      ) : shown.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <ClipboardCheck size={24} />
          </span>
          <strong>{aba === 'pend' ? 'Nenhuma pendência' : 'Nada sem informação'}</strong>
          <span>{contrato || posto || funcao || q ? 'Tente outro filtro.' : aba === 'pend' ? 'Tudo em ordem neste indicador.' : 'Todos os dados necessários estão preenchidos.'}</span>
        </div>
      ) : (
        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Contrato / posto</th>
                <th>{exigencia ? 'Exigência' : ind === 'kit_incompleto' ? 'O que falta' : 'Peça'}</th>
                {ind === 'kit_incompleto' || ind === 'pendentes' ? null : <th>{exigencia ? 'Realizado' : 'Entregue'}</th>}
                {ind === 'kit_incompleto' || ind === 'pendentes' ? null : <th>{exigencia ? 'Vence' : 'Troca'}</th>}
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limite).map((l, i) => (
                <tr key={`${l.id}-${i}`}>
                  <td>
                    <b>{l.name}</b>
                    <small>{[l.matricula && `Mat. ${l.matricula}`, l.role].filter(Boolean).join(' · ') || '—'}</small>
                  </td>
                  <td>
                    {l.contrato}
                    <small>{l.posto_name ?? '—'}</small>
                  </td>
                  <td>
                    {l.item}
                    {l.size ? ` ${l.size}` : ''}
                    {l.qty > 1 && ind !== 'kit_incompleto' ? ` (${l.qty})` : ''}
                    {l.obs ? <small>{l.obs}</small> : null}
                  </td>
                  {ind === 'kit_incompleto' || ind === 'pendentes' ? null : <td>{dateBR(l.data)}</td>}
                  {ind === 'kit_incompleto' || ind === 'pendentes' ? null : <td>{dateBR(l.prazo)}</td>}
                  <td>
                    <span className={`pbadge ${l.semInfo ? 'gray' : l.dias !== null && l.dias < 0 ? 'red' : l.dias !== null ? 'amber' : 'red'}`}>{l.situacao}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limite ? (
            <button className="btn btn-ghost btn-sm list-more" onClick={() => setLimite((x) => x + 500)}>
              Mostrar mais ({num(shown.length - limite)} restantes)
            </button>
          ) : null}
        </div>
      )}
      <p className="help" style={{ marginTop: 8 }}>
        {num(painel.colaboradores)} colaboradores ativos. Peças: cada uma com a própria data de entrega e o prazo de troca do item no kit da função. Exigências: vale o registro mais recente.
      </p>
    </>
  );
}

/* ------------------------------------------------------------ estoque por contrato */
function Contratos({ data }: { data: Painel }) {
  const [q, setQ] = useState('');
  const [todos, setTodos] = useState(false);
  const lista = data.contratos.filter((c) => !q || fold(c.contrato).includes(fold(q)));
  const shown = todos ? lista : lista.slice(0, 15);
  const e = data.estoque;
  return (
    <div className="g-card" style={{ marginTop: 18 }}>
      <h3>Fardamento por contrato</h3>
      <p className="help" style={{ marginTop: -4 }}>
        Onde está cada peça: disponível no estoque central, reservada para um contrato (pedido em aberto), no posto ou já entregue ao colaborador. Peça entregue não conta como saldo.
      </p>
      <div className="stat-grid">
        <div className="stat">
          <small>Disponível no estoque central</small>
          <b>{num(e.disponivel)}</b>
        </div>
        <div className="stat">
          <small>Reservado para contratos</small>
          <b>{num(e.reservado)}</b>
        </div>
        <div className="stat">
          <small>Nos postos, sem colaborador</small>
          <b>{num(e.noPosto)}</b>
        </div>
        <div className="stat">
          <small>Entregue aos colaboradores (em uso)</small>
          <b>{num(e.emUso)}</b>
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <div className="search">
          <Search size={17} />
          <input className="input" placeholder="Buscar contrato" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Buscar contrato" />
        </div>
      </div>
      {lista.length === 0 ? (
        <div className="empty-line">Nenhum contrato.</div>
      ) : (
        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Contrato</th>
                <th className="n">Colab.</th>
                <th className="n">Em uso</th>
                <th className="n">Pendentes</th>
                <th className="n">Troca vencida</th>
                <th className="n">Reservado</th>
                <th className="n">No posto</th>
                <th className="n">Falta receber</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.contrato}>
                  <td>
                    {c.contrato}
                    {c.semKit ? <small>{num(c.semKit)} sem kit da função</small> : null}
                  </td>
                  <td className="n">{num(c.colaboradores)}</td>
                  <td className="n">{num(c.emUso)}</td>
                  <td className="n">{num(c.pendentes)}</td>
                  <td className="n">{num(c.vencidas)}</td>
                  <td className="n">{num(c.reservado)}</td>
                  <td className="n">{num(c.noPosto)}</td>
                  <td className={`n${c.falta ? ' t-short' : ''}`}>
                    <b>{num(c.falta)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > 15 && !todos ? (
            <button className="btn btn-ghost btn-sm list-more" onClick={() => setTodos(true)}>
              Mostrar todos ({num(lista.length)})
            </button>
          ) : null}
        </div>
      )}
      <p className="help">Falta receber = peças pendentes + trocas vencidas − o que já está reservado − o que já está no posto.</p>
    </div>
  );
}

/* ------------------------------------------------------------ exigências (ASO, cursos, documentos) */
function ExigenciasSheet({ exigs, painel, canEdit, onClose, onChange }: { exigs: Exigencia[]; painel: Painel; canEdit: boolean; onClose: () => void; onChange: () => void }) {
  const [edit, setEdit] = useState<Exigencia | 'nova' | null>(null);
  if (edit) return <ExigenciaForm e={edit === 'nova' ? null : edit} painel={painel} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange(); }} />;
  return (
    <Sheet title="ASO, cursos e documentos" lead="Cada exigência diz a quem se aplica, a validade e com quantos dias de antecedência alertar. Nova exigência não precisa de mudança no sistema." onClose={onClose} wide>
      {exigs.length === 0 ? <div className="empty-line">Nenhuma exigência cadastrada.</div> : null}
      {exigs.map((x) => (
        <div className="kv-row ctl-exig" key={x.id}>
          <span>
            <b>{x.name}</b> <span className="pbadge lilac">{TIPO_EXIG[x.kind]}</span> {!x.active ? <span className="pbadge gray">Desativada</span> : null}
            <small>
              Validade de {x.validity_months} {x.validity_months === 1 ? 'mês' : 'meses'} · alerta {x.alert_days} dias antes · {x.roles.length ? `funções: ${x.roles.join(', ')}` : 'todas as funções'}
              {x.clients.length ? ` · clientes: ${x.clients.join(', ')}` : ''}
              {x.companies.length ? ` · empresas: ${x.companies.join(', ')}` : ''}
            </small>
          </span>
          {canEdit ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit(x)}>
              Editar
            </button>
          ) : null}
        </div>
      ))}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Fechar
        </button>
        {canEdit ? (
          <button className="btn btn-primary" onClick={() => setEdit('nova')} data-max="exigencia-nova">
            <Plus size={16} /> Nova exigência
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

function Escolha({ label, todos, valores, setValores, opcoes }: { label: string; todos: string; valores: string[]; setValores: (v: string[]) => void; opcoes: string[] }) {
  const [txt, setTxt] = useState('');
  const add = (v: string) => {
    const t = v.trim();
    if (t && !valores.some((x) => fold(x) === fold(t))) setValores([...valores, t]);
    setTxt('');
  };
  const id = `esc-${fold(label).replace(/ /g, '-')}`;
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="ctl-chips">
        {valores.length === 0 ? <span className="ctl-chip all">{todos}</span> : null}
        {valores.map((v) => (
          <span className="ctl-chip" key={v}>
            {v}
            <button type="button" onClick={() => setValores(valores.filter((x) => x !== v))} aria-label={`Tirar ${v}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        className="input"
        list={`${id}-l`}
        value={txt}
        placeholder="Digite e tecle Enter para incluir"
        onChange={(e) => {
          const v = e.target.value;
          if (opcoes.includes(v)) add(v);
          else setTxt(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(txt);
          }
        }}
      />
      <datalist id={`${id}-l`}>
        {opcoes
          .filter((o) => !valores.includes(o))
          .map((o) => (
            <option key={o} value={o} />
          ))}
      </datalist>
    </div>
  );
}

function ExigenciaForm({ e, painel, onClose, onSaved }: { e: Exigencia | null; painel: Painel; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<TipoExig>(e?.kind ?? 'curso');
  const [name, setName] = useState(e?.name ?? '');
  const [validade, setValidade] = useState(String(e?.validity_months ?? 12));
  const [alerta, setAlerta] = useState(String(e?.alert_days ?? JANELA));
  const [roles, setRoles] = useState<string[]>(e?.roles ?? []);
  const [clients, setClients] = useState<string[]>(e?.clients ?? []);
  const [companies, setCompanies] = useState<string[]>(e?.companies ?? []);
  const [notes, setNotes] = useState(e?.notes ?? '');
  const [active, setActive] = useState(e?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(e ? `/api/rh/exigencias?id=${e.id}` : '/api/rh/exigencias', { method: e ? 'PATCH' : 'POST', json: { kind, name, validity_months: Number(validade), alert_days: Number(alerta), roles, clients, companies, notes, active } });
      toast({ kind: 'success', title: `${name} salvo` });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!e || !window.confirm(`Apagar "${e.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/rh/exigencias?id=${e.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={e ? e.name : 'Nova exigência'} lead="Ex.: ASO periódico (12 meses), Reciclagem de vigilante (24 meses, só a função Vigilante), NR-35, CNH." onClose={onClose} wide locked>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="ex-k">
            Tipo
          </label>
          <select id="ex-k" className="select input" value={kind} onChange={(ev) => setKind(ev.target.value as TipoExig)}>
            {(Object.keys(TIPO_EXIG) as TipoExig[]).map((k) => (
              <option key={k} value={k}>
                {TIPO_EXIG[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ex-n">
            Nome
          </label>
          <input id="ex-n" className="input" value={name} maxLength={120} onChange={(ev) => setName(ev.target.value)} placeholder="Ex.: Reciclagem de vigilante" />
        </div>
        <div>
          <label className="label" htmlFor="ex-v">
            Validade (meses)
          </label>
          <input id="ex-v" className="input" inputMode="numeric" value={validade} onChange={(ev) => setValidade(ev.target.value.replace(/\D/g, '').slice(0, 3))} />
        </div>
        <div>
          <label className="label" htmlFor="ex-a">
            Alertar com quantos dias de antecedência
          </label>
          <input id="ex-a" className="input" inputMode="numeric" value={alerta} onChange={(ev) => setAlerta(ev.target.value.replace(/\D/g, '').slice(0, 3))} />
        </div>
      </div>
      <h3 className="sec-title">A quem se aplica</h3>
      <Escolha label="Funções" todos="Todas as funções" valores={roles} setValores={setRoles} opcoes={painel.funcoes} />
      <Escolha label="Clientes (contratos)" todos="Todos os clientes" valores={clients} setValores={setClients} opcoes={painel.clientes} />
      <Escolha label="Empresas" todos="Todas as empresas" valores={companies} setValores={setCompanies} opcoes={painel.empresas} />
      <label className="label" htmlFor="ex-o">
        Observação <span className="opt-tag">(opcional)</span>
      </label>
      <input id="ex-o" className="input" value={notes} maxLength={300} onChange={(ev) => setNotes(ev.target.value)} placeholder="Ex.: periodicidade definida no PCMSO" />
      <label className="ctl-check">
        <input type="checkbox" checked={active} onChange={(ev) => setActive(ev.target.checked)} /> Ativa (desativada, sai dos alertas e mantém o histórico)
      </label>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        {e ? (
          <button className="btn btn-danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
            <Trash2 size={15} /> Apagar
          </button>
        ) : null}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? <span className="spinner" /> : null} Salvar
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ ficha do colaborador */
interface Ficha {
  colab: ColabControle;
  registros: (RegistroC & { requirement: string })[];
  aplicaveis: Exigencia[];
  temExigencias: boolean;
  hoje: string;
}
const TOM_PECA = { pendente: 'red', vencida: 'red', prevista: 'amber', em_dia: 'green', sem_data: 'gray' } as const;
const TOM_EXIG = { vencido: 'red', a_vencer: 'amber', em_dia: 'green', sem_registro: 'gray' } as const;

/** Na ficha do colaborador: cada peça do kit com entrega e troca, e ASO/cursos/documentos com o registro. */
export function FichaControle({ id, canEdit, version }: { id: string; canEdit: boolean; version: string | number | undefined }) {
  const toast = useToast();
  const [f, setF] = useState<Ficha | null>(null);
  const [reg, setReg] = useState<string | null>(null);
  const [hist, setHist] = useState(false);
  useEffect(() => {
    api<Ficha>(`/api/rh/colaboradores/${id}/controle`)
      .then(setF)
      .catch(() => setF(null));
  }, [id, version]);
  const apagar = async (rid: string) => {
    if (!window.confirm('Apagar este registro?')) return;
    try {
      setF(await api<Ficha>(`/api/rh/colaboradores/${id}/controle?registro=${rid}`, { method: 'DELETE' }));
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    }
  };
  if (!f) return <div className="skeleton" style={{ height: 80 }} />;
  const c = f.colab;
  return (
    <>
      {c.faltas.length ? (
        <div className="ctl-faltas">
          <b>Falta informar:</b> {c.faltas.join(' · ')}
        </div>
      ) : null}
      <div>
        <h3 className="sec-title">Fardamento por peça {c.kit ? <small>kit {c.kit}</small> : null}</h3>
        {!c.kit ? (
          <div className="empty-line">Sem kit cadastrado para a função: não dá para saber o que falta.</div>
        ) : (
          c.pecas.map((p, i) => (
            <div className="kv-row" key={i}>
              <span>
                {p.qty}× {p.item}
                {p.size ? ` ${p.size}` : ''}
                <small style={{ display: 'block', color: 'var(--muted)' }}>
                  {p.status === 'pendente' ? (p.semTamanho ? 'falta o tamanho no cadastro' : 'ainda não entregue') : `entregue em ${dateBR(p.entregue_em)}${p.origem === 'planilha' ? ' (planilha)' : ''} · troca a cada ${p.periodo} meses${p.troca_em ? `, em ${dateBR(p.troca_em)}` : ''}`}
                </small>
              </span>
              <span className={`pbadge ${TOM_PECA[p.status]}`}>{p.status === 'prevista' ? `Troca em ${p.dias} dias` : STATUS_PECA[p.status]}</span>
            </div>
          ))
        )}
      </div>
      <div>
        <h3 className="sec-title">ASO, cursos e documentos</h3>
        {!f.temExigencias ? (
          <div className="empty-line">Ainda não ativado no banco (supabase/controle_rh.sql).</div>
        ) : c.exigencias.length === 0 ? (
          <div className="empty-line">Nenhuma exigência se aplica a esta função.</div>
        ) : (
          c.exigencias.map((x) => (
            <div className="kv-row" key={x.id}>
              <span>
                {x.name}
                <small style={{ display: 'block', color: 'var(--muted)' }}>{x.feito_em ? `realizado em ${dateBR(x.feito_em)} · vence em ${dateBR(x.vence_em)}` : 'sem registro'}</small>
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className={`pbadge ${TOM_EXIG[x.status]}`}>{x.status === 'a_vencer' ? `Vence em ${x.dias} dias` : x.status === 'vencido' ? `Vencido há ${-(x.dias ?? 0)} dias` : STATUS_EXIG[x.status]}</span>
                {canEdit ? (
                  <button className="link-btn" onClick={() => setReg(x.id)} data-max="registro-novo">
                    registrar
                  </button>
                ) : null}
              </span>
            </div>
          ))
        )}
        {f.registros.length ? (
          <details className="dl-anteriores" open={hist} onToggle={(e) => setHist((e.target as HTMLDetailsElement).open)}>
            <summary>Histórico de registros ({f.registros.length})</summary>
            {f.registros.map((r) => (
              <div className="kv-row" key={r.id}>
                <span>
                  {r.requirement} · {dateBR(r.done_at)}
                  <small style={{ display: 'block', color: 'var(--muted)' }}>
                    {r.expires_at ? `validade informada: ${dateBR(r.expires_at)} · ` : ''}
                    {r.created_by ? `por ${r.created_by}` : ''}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </small>
                </span>
                {canEdit ? (
                  <button className="link-btn" onClick={() => apagar(r.id)}>
                    apagar
                  </button>
                ) : null}
              </div>
            ))}
          </details>
        ) : null}
      </div>
      {reg ? <RegistroSheet colabId={id} ex={f.aplicaveis.find((x) => x.id === reg) ?? null} hoje={f.hoje} onClose={() => setReg(null)} onSaved={(nf) => { setF(nf); setReg(null); }} /> : null}
    </>
  );
}

function RegistroSheet({ colabId, ex, hoje, onClose, onSaved }: { colabId: string; ex: Exigencia | null; hoje: string; onClose: () => void; onSaved: (f: Ficha) => void }) {
  const toast = useToast();
  const [done, setDone] = useState(hoje);
  const [exp, setExp] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ex) return null;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const f = await api<Ficha>(`/api/rh/colaboradores/${colabId}/controle`, { method: 'POST', json: { requirement_id: ex.id, done_at: done, expires_at: exp || null, notes } });
      toast({ kind: 'success', title: `${ex.name} registrado` });
      onSaved(f);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Sheet title={`Registrar ${ex.name}`} lead={`Validade padrão: ${ex.validity_months} meses a partir da realização.`} onClose={onClose} locked>
        <div className="sx-grid">
          <div>
            <label className="label" htmlFor="rg-d">
              Realizado em
            </label>
            <input id="rg-d" className="input" type="date" value={done} max={hoje} onChange={(e) => setDone(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rg-v">
              Vence em <span className="opt-tag">(se for diferente)</span>
            </label>
            <input id="rg-v" className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
          </div>
        </div>
        <label className="label" htmlFor="rg-o">
          Observação <span className="opt-tag">(opcional)</span>
        </label>
        <input id="rg-o" className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: clínica, nº do certificado" />
        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !done}>
            {busy ? <span className="spinner" /> : null} Registrar
          </button>
        </div>
      </Sheet>
    </div>
  );
}
