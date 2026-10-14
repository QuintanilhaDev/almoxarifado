'use client';
import { AlertCircle, CalendarClock, RefreshCcw, Search, Settings2, Shirt } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { dateBR, todayLocal } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

interface Row {
  collaborator: { id: string; name: string; matricula: string | null; role: string | null; posto_name: string | null; company: string | null; sizes: Record<string, string> };
  period_months: number;
  base: string | null;
  base_kind: 'troca' | 'admissao' | 'sem_registro';
  due: string | null;
  status: 'vencida' | 'proxima' | 'em_dia' | 'sem_data';
  days: number | null;
  open_order: number | null;
}
interface Demand {
  item_id: string | null;
  name: string;
  size: string | null;
  qty: number;
  available: number | null;
  people: number;
}
interface Data {
  rows: Row[];
  noKit: string[];
  demand: Demand[];
  config: { tradeAlertDays: number; extraResetsCycle: boolean };
}
const ST: Record<Row['status'], { label: string; tone: string }> = {
  vencida: { label: 'Vencida', tone: 'red' },
  proxima: { label: 'Vence logo', tone: 'amber' },
  em_dia: { label: 'Em dia', tone: 'green' },
  sem_data: { label: 'Sem data-base', tone: 'gray' },
};

/**
 * Troca anual (Projeto 3, seção 5): a lista se monta sozinha a partir da última entrega
 * (ou da admissão) e do prazo de cada função. O RH marca quem vai trocar e confirma;
 * a Operação valida e o Almoxarifado entrega.
 */
export function TrocaAnual({ canEdit, isMaster, version, onOpened }: { canEdit: boolean; isMaster: boolean; version: number; onOpened?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [filter, setFilter] = useState<'atencao' | 'vencida' | 'proxima' | 'todos'>('atencao');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [needed, setNeeded] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>('/api/rh/trocas'));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const count = useMemo(() => ({ vencida: rows.filter((r) => r.status === 'vencida').length, proxima: rows.filter((r) => r.status === 'proxima').length, todos: rows.length }), [rows]);
  const shown = useMemo(() => {
    const t = fold(query.trim());
    return rows.filter((r) => {
      if (filter === 'atencao' && r.status !== 'vencida' && r.status !== 'proxima') return false;
      if (filter === 'vencida' && r.status !== 'vencida') return false;
      if (filter === 'proxima' && r.status !== 'proxima') return false;
      return !t || fold(`${r.collaborator.name} ${r.collaborator.matricula ?? ''} ${r.collaborator.role ?? ''} ${r.collaborator.posto_name ?? ''}`).includes(t);
    });
  }, [rows, filter, query]);
  const selectable = shown.filter((r) => !r.open_order);
  const allOn = selectable.length > 0 && selectable.every((r) => sel.has(r.collaborator.id));

  const create = async () => {
    setBusy(true);
    try {
      const j = await api<{ created: { number: number; name: string }[]; skipped: string[] }>('/api/rh/trocas', { method: 'POST', json: { collaborator_ids: [...sel], needed_by: needed || null } });
      toast({ kind: j.created.length ? 'success' : 'info', title: j.created.length ? `${j.created.length} troca(s) aberta(s)` : 'Nenhuma troca aberta', text: [j.created.length ? 'Foram para a Operação validar.' : '', j.skipped.length ? `Ficaram de fora: ${j.skipped.slice(0, 3).join('; ')}` : ''].filter(Boolean).join(' ') }, 10000);
      setSel(new Set());
      setConfirm(false);
      await load();
      onOpened?.();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível abrir as trocas', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const short = (data?.demand ?? []).filter((d) => d.available !== null && d.available < d.qty);
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Troca anual</h1>
            <p>Colaboradores com troca vencida ou perto de vencer.</p>
          </div>
          <div className="head-actions">
            {isMaster ? (
              <button className="btn btn-ghost" onClick={() => setCfg(true)} disabled={!data}>
                <Settings2 size={18} /> Regras
              </button>
            ) : null}
            <button className="btn btn-primary edit-only" disabled={!canEdit || !sel.size} onClick={() => setConfirm(true)}>
              <RefreshCcw size={18} /> Abrir troca{sel.size ? ` (${sel.size})` : ''}
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
          <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <small>Vencidas</small>
                <b style={{ color: count.vencida ? 'var(--danger)' : undefined }}>{num(count.vencida)}</b>
              </div>
              <div className="stat">
                <small>Vencem em {data.config.tradeAlertDays} dias</small>
                <b style={{ color: count.proxima ? 'var(--amber)' : undefined }}>{num(count.proxima)}</b>
              </div>
              <div className="stat">
                <small>Colaboradores com kit</small>
                <b>{num(count.todos)}</b>
              </div>
              <div className="stat">
                <small>Itens a preparar</small>
                <b>{num(data.demand.reduce((t, d) => t + d.qty, 0))}</b>
              </div>
            </div>
            {data.noKit.length ? (
              <div className="banner">
                <Shirt size={20} color="var(--amber)" />
                <span>Funções sem kit (ficam fora da troca): {data.noKit.join(', ')}. Cadastre em Colaboradores › Kits por função.</span>
              </div>
            ) : null}

            <div className="toolbar">
              <div className="filter-seg">
                {(
                  [
                    ['atencao', 'Precisam trocar', count.vencida + count.proxima],
                    ['vencida', 'Vencidas', count.vencida],
                    ['proxima', 'Vencem logo', count.proxima],
                    ['todos', 'Todos', count.todos],
                  ] as const
                ).map(([id, label, n]) => (
                  <button key={id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>
                    {label} <em>{num(n)}</em>
                  </button>
                ))}
              </div>
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar colaborador, função ou posto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar" />
              </div>
            </div>

            {shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <CalendarClock size={24} />
                </span>
                <strong>{rows.length ? 'Ninguém neste filtro' : 'Nenhum colaborador com kit'}</strong>
                <span>{rows.length ? 'Tudo em dia por aqui.' : 'Cadastre os kits por função e os colaboradores (com a data de admissão).'}</span>
              </div>
            ) : (
              <div className="t-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>
                        <input type="checkbox" aria-label="Marcar todos" checked={allOn} disabled={!canEdit || !selectable.length} onChange={() => setSel(allOn ? new Set() : new Set(selectable.map((r) => r.collaborator.id)))} />
                      </th>
                      <th>Colaborador</th>
                      <th>Função</th>
                      <th>Última troca</th>
                      <th>Vence</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.collaborator.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Marcar ${r.collaborator.name}`}
                            disabled={!canEdit || Boolean(r.open_order)}
                            checked={sel.has(r.collaborator.id)}
                            onChange={() =>
                              setSel((s) => {
                                const n = new Set(s);
                                if (n.has(r.collaborator.id)) n.delete(r.collaborator.id);
                                else n.add(r.collaborator.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td>
                          <b>{r.collaborator.name}</b>
                          <small>{[r.collaborator.matricula, r.collaborator.posto_name].filter(Boolean).join(' · ') || '—'}</small>
                        </td>
                        <td>
                          {r.collaborator.role}
                          <small>a cada {r.period_months} meses</small>
                        </td>
                        <td>
                          {dateBR(r.base)}
                          <small>{r.base_kind === 'troca' ? 'última entrega' : r.base_kind === 'admissao' ? 'admissão' : 'sem registro'}</small>
                        </td>
                        <td>
                          {dateBR(r.due)}
                          {r.days !== null ? <small>{r.days < 0 ? `há ${-r.days} dias` : r.days === 0 ? 'hoje' : `em ${r.days} dias`}</small> : null}
                        </td>
                        <td>{r.open_order ? <span className="pbadge blue">Troca #{String(r.open_order).padStart(4, '0')} aberta</span> : <span className={`pbadge ${ST[r.status].tone}`}>{ST[r.status].label}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.demand.length ? (
              <div className="g-card" style={{ marginTop: 14 }}>
                <h3>Demanda consolidada (vencidas e que vencem logo, sem troca aberta)</h3>
                <p className="help" style={{ marginTop: -4 }}>
                  Peças necessárias para as trocas pendentes{short.length ? ` — falta saldo de ${short.length} item(ns)` : ''}.
                </p>
                <div className="t-wrap">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="n">Pessoas</th>
                        <th className="n">Precisa</th>
                        <th className="n">Disponível</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.demand.map((d, i) => (
                        <tr key={i}>
                          <td>
                            {d.name}
                            {d.size ? ` ${d.size}` : ''}
                            {!d.item_id ? <small>não está no estoque com esse tamanho</small> : null}
                          </td>
                          <td className="n">{num(d.people)}</td>
                          <td className="n">{num(d.qty)}</td>
                          <td className={`n${d.available !== null && d.available < d.qty ? ' t-short' : ''}`}>{d.available === null ? '—' : num(d.available)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {confirm ? (
        <Sheet title={`Abrir a troca de ${sel.size} colaborador(es)?`} lead="Os pedidos seguem para a validação da Operação." onClose={() => setConfirm(false)}>
          <label className="label" htmlFor="t-need">
            Entregar até <span className="opt-tag">(opcional)</span>
          </label>
          <input id="t-need" type="date" className="input" min={todayLocal()} value={needed} onChange={(e) => setNeeded(e.target.value)} />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={busy}>
              Voltar
            </button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>
              {busy ? <span className="spinner" /> : <RefreshCcw size={16} />} Abrir {sel.size} troca(s)
            </button>
          </div>
        </Sheet>
      ) : null}
      {cfg && data ? <RulesSheet cfg={data.config} onClose={() => setCfg(false)} onSaved={async () => { setCfg(false); await load(); }} /> : null}
    </div>
  );
}

function RulesSheet({ cfg, onClose, onSaved }: { cfg: Data['config']; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState(String(cfg.tradeAlertDays));
  const [reset, setReset] = useState(cfg.extraResetsCycle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/pedidos/config', { method: 'PUT', json: { tradeAlertDays: Number(days), extraResetsCycle: reset } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Regras da troca" onClose={onClose}>
      <label className="label" htmlFor="r-days">
        Avisar com quantos dias de antecedência
      </label>
      <input id="r-days" className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
      <span className="label" style={{ marginTop: 14 }}>
        Troca extraordinária reinicia a contagem?
      </span>
      <div className="filter-seg" role="group">
        <button className={!reset ? 'is-active' : ''} onClick={() => setReset(false)} aria-pressed={!reset}>
          Não (padrão)
        </button>
        <button className={reset ? 'is-active' : ''} onClick={() => setReset(true)} aria-pressed={reset}>
          Sim
        </button>
      </div>
      <p className="help">Por padrão, a troca extraordinária não altera a data da próxima troca.</p>
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
          {busy ? <span className="spinner" /> : null} Salvar
        </button>
      </div>
    </Sheet>
  );
}

