'use client';
import { AlertCircle, PackageCheck, RotateCcw, Search, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from './StockModals';
import { fold, itemLabel, num } from '@/lib/almoxarifado/stockFormat';
import type { StockItem } from '@/lib/almoxarifado/types';
import { dateBR } from '../pedidos/ui';
import { formatDateTime } from '@/lib/format';
import '../pedidos/pedidos.css';
import '../compras/compras.css';

type StatusLote = 'aguardando' | 'higienizacao' | 'reaproveitado' | 'descartado';
const STATUS: Record<StatusLote, { label: string; tone: string }> = {
  aguardando: { label: 'Aguardando avaliação', tone: 'amber' },
  higienizacao: { label: 'Em higienização', tone: 'blue' },
  reaproveitado: { label: 'Reaproveitado', tone: 'green' },
  descartado: { label: 'Descartado', tone: 'gray' },
};
interface Lote {
  id: string;
  collaborator_name: string | null;
  item_name: string;
  size: string | null;
  qty: number;
  received_at: string;
  status: StatusLote;
  stock_item_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  notes: string | null;
  history: { at: string; by: string; what: string }[];
}

/**
 * Estoque de devolução Fard/EPI (transitório): o que os colaboradores devolveram fica aqui
 * até a avaliação. Reaproveitar = higienizar e dar entrada no estoque; o que não serve é descartado.
 */
export function EstoqueDevolucao({ items, canEdit, version }: { items: StockItem[]; canEdit: boolean; version: number }) {
  const toast = useToast();
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [failed, setFailed] = useState('');
  const [filtro, setFiltro] = useState<'abertos' | StatusLote | 'todos'>('abertos');
  const [q, setQ] = useState('');
  const [acao, setAcao] = useState<{ lote: Lote; tipo: 'reaproveitar' | 'descartar' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLotes((await api<{ lotes: Lote[] }>('/api/almoxarifado/devolucoes')).lotes);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, version]);
  const tot = useMemo(() => {
    const t = { aguardando: 0, higienizacao: 0, reaproveitado: 0, descartado: 0 } as Record<StatusLote, number>;
    for (const l of lotes ?? []) t[l.status] += l.qty;
    return t;
  }, [lotes]);
  const shown = useMemo(() => {
    const t = fold(q.trim());
    return (lotes ?? []).filter((l) => (filtro === 'todos' ? true : filtro === 'abertos' ? l.status === 'aguardando' || l.status === 'higienizacao' : l.status === filtro) && (!t || fold(`${l.item_name} ${l.size ?? ''} ${l.collaborator_name ?? ''}`).includes(t)));
  }, [lotes, filtro, q]);
  const simples = async (l: Lote, a: 'higienizacao' | 'voltar') => {
    setBusy(l.id);
    try {
      await api(`/api/almoxarifado/devolucoes?id=${l.id}`, { method: 'PATCH', json: { acao: a } });
      await load();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Devoluções Fard/EPI</h1>
            <p>Estoque transitório do que os colaboradores devolveram. Avalie cada peça: higienizar e dar entrada no estoque, ou descartar.</p>
          </div>
        </div>
        {failed && !lotes ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar</strong>
            <span>{failed}</span>
          </div>
        ) : !lotes ? (
          <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <small>Aguardando avaliação</small>
                <b>{num(tot.aguardando)}</b>
              </div>
              <div className="stat">
                <small>Em higienização</small>
                <b>{num(tot.higienizacao)}</b>
              </div>
              <div className="stat">
                <small>Reaproveitadas (entraram no estoque)</small>
                <b>{num(tot.reaproveitado)}</b>
              </div>
              <div className="stat">
                <small>Descartadas</small>
                <b>{num(tot.descartado)}</b>
              </div>
            </div>
            <div className="toolbar">
              <div className="filter-seg" role="tablist" aria-label="Situação">
                {(['abertos', 'aguardando', 'higienizacao', 'reaproveitado', 'descartado', 'todos'] as const).map((f) => (
                  <button key={f} className={filtro === f ? 'is-active' : ''} onClick={() => setFiltro(f)}>
                    {f === 'abertos' ? 'Para avaliar' : f === 'todos' ? 'Todos' : STATUS[f].label}
                  </button>
                ))}
              </div>
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar peça ou colaborador" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no estoque de devolução" />
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <RotateCcw size={24} />
                </span>
                <strong>{filtro === 'abertos' ? 'Nada para avaliar' : 'Nada aqui'}</strong>
                <span>As peças entram aqui quando o RH registra a devolução de um colaborador desligado.</span>
              </div>
            ) : (
              <div className="t-wrap">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Peça</th>
                      <th className="n">Qtd.</th>
                      <th>Devolvida por</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <b>
                            {l.item_name}
                            {l.size ? ` ${l.size}` : ''}
                          </b>
                          {l.notes ? <small>{l.notes}</small> : null}
                        </td>
                        <td className="n">{num(l.qty)}</td>
                        <td>
                          {l.collaborator_name ?? '—'}
                          <small>em {dateBR(l.received_at)}</small>
                        </td>
                        <td>
                          <span className={`pbadge ${STATUS[l.status].tone}`}>{STATUS[l.status].label}</span>
                          {l.decided_by ? <small>{`${l.decided_by}${l.decided_at ? ` · ${formatDateTime(l.decided_at)}` : ''}`}</small> : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {canEdit && (l.status === 'aguardando' || l.status === 'higienizacao') ? (
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              {l.status === 'aguardando' ? (
                                <button className="btn btn-ghost btn-sm" disabled={busy === l.id} onClick={() => simples(l, 'higienizacao')} data-max="devol-higienizar">
                                  <Sparkles size={14} /> Higienizar
                                </button>
                              ) : (
                                <button className="btn btn-ghost btn-sm" disabled={busy === l.id} onClick={() => simples(l, 'voltar')}>
                                  <RotateCcw size={14} /> Voltar
                                </button>
                              )}
                              <button className="btn btn-ghost btn-sm" onClick={() => setAcao({ lote: l, tipo: 'reaproveitar' })} data-max="devol-reaproveitar">
                                <PackageCheck size={14} /> Dar entrada
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setAcao({ lote: l, tipo: 'descartar' })} data-max="devol-descartar">
                                <Trash2 size={14} /> Descartar
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {acao ? (
        <AvaliarSheet
          lote={acao.lote}
          tipo={acao.tipo}
          items={items}
          onClose={() => setAcao(null)}
          onDone={async () => {
            setAcao(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function AvaliarSheet({ lote, tipo, items, onClose, onDone }: { lote: Lote; tipo: 'reaproveitar' | 'descartar'; items: StockItem[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState(String(lote.qty));
  const [notes, setNotes] = useState('');
  const [q, setQ] = useState(lote.item_name.split(/\s+/)[0] ?? '');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const opcoes = useMemo(() => {
    const t = fold(q.trim());
    const ls = items.filter((i) => i.active !== false && (!t || fold(itemLabel(i)).includes(t)));
    // o mesmo tamanho primeiro
    return ls.sort((a, b) => Number((b.size ?? '') === (lote.size ?? '')) - Number((a.size ?? '') === (lote.size ?? '')) || itemLabel(a).localeCompare(itemLabel(b), 'pt-BR')).slice(0, 60);
  }, [items, q, lote.size]);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/almoxarifado/devolucoes?id=${lote.id}`, { method: 'PATCH', json: { acao: tipo, qty: Number(qty), notes, stock_item_id: itemId || undefined } });
      toast({ kind: 'success', title: tipo === 'reaproveitar' ? 'Entrada registrada no estoque' : 'Descarte registrado' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={tipo === 'reaproveitar' ? 'Reaproveitar (entrada no estoque)' : 'Descartar'}
      lead={`${lote.qty} × ${lote.item_name}${lote.size ? ' ' + lote.size : ''}, devolvida por ${lote.collaborator_name ?? 'colaborador'}. ${tipo === 'reaproveitar' ? 'Depois da higienização, as peças entram no estoque com uma movimentação de entrada.' : 'As peças saem do estoque de devolução sem entrar no estoque.'}`}
      onClose={onClose}
      wide={tipo === 'reaproveitar'}
      locked
    >
      <label className="label" htmlFor="av-q">
        Quantidade {Number(qty) < lote.qty ? <span className="opt-tag">(o resto continua para avaliar)</span> : null}
      </label>
      <input id="av-q" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 5))} style={{ maxWidth: 140 }} />
      {tipo === 'reaproveitar' ? (
        <>
          <label className="label" htmlFor="av-b" style={{ marginTop: 10 }}>
            Item do estoque que recebe as peças
          </label>
          <input id="av-b" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item" />
          <div className="av-list" role="listbox" aria-label="Itens do estoque" style={{ maxHeight: 260, overflow: 'auto', marginTop: 6, border: '1px solid var(--line)', borderRadius: 12 }}>
            {opcoes.length === 0 ? <div className="empty-line">Nenhum item com esse nome.</div> : null}
            {opcoes.map((i) => (
              <label key={i.id} className="kv-row" style={{ cursor: 'pointer', padding: '8px 12px' }}>
                <span>
                  <input type="radio" name="av-item" checked={itemId === i.id} onChange={() => setItemId(i.id)} style={{ marginRight: 8 }} />
                  {itemLabel(i)}
                </span>
                <small style={{ color: 'var(--muted)' }}>saldo {num(i.quantity)}</small>
              </label>
            ))}
          </div>
        </>
      ) : null}
      <label className="label" htmlFor="av-n" style={{ marginTop: 10 }}>
        {tipo === 'descartar' ? 'Motivo do descarte' : 'Observação'} {tipo === 'reaproveitar' ? <span className="opt-tag">(opcional)</span> : null}
      </label>
      <input id="av-n" className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder={tipo === 'descartar' ? 'Ex.: rasgada, manchada, sem condição de uso' : 'Ex.: higienizada pela lavanderia X'} />
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className={`btn ${tipo === 'descartar' ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy || !Number(qty) || (tipo === 'reaproveitar' && !itemId) || (tipo === 'descartar' && !notes.trim())}>
          {busy ? <span className="spinner" /> : null} {tipo === 'reaproveitar' ? 'Dar entrada' : 'Descartar'}
        </button>
      </div>
    </Sheet>
  );
}
