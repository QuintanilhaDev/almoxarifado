'use client';
import { AlertCircle, ChevronDown, Download, Printer, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { num } from '@/lib/almoxarifado/stockFormat';
import type { Indicators } from '@/lib/gestao';
import { brl, dateBR } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

const P_STATUS: Record<string, string> = { nova: 'Novas', em_cotacao: 'Em cotação', comprada: 'Compradas', entregue: 'Entregues', recusada: 'Recusadas', cancelada: 'Canceladas' };

/** Painel da Gestão (Projeto 3, seções 10 e 14): números do estoque, dos pedidos, das compras e das notas, sem planilha manual. */
export function Gestao({ version }: { version: number }) {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Indicators | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api<Indicators>(`/api/gestao?days=${days}`));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [days]);
  useEffect(() => {
    load();
  }, [load, version]);

  const maxCat = Math.max(1, ...(data?.byCategory ?? []).map((c) => c.value));
  const maxCons = Math.max(1, ...(data?.consumption ?? []).map((c) => c.units));
  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Gestão</h1>
            <p>Estoque, pedidos de material, compras e notas em números, calculados na hora a partir do que cada setor registra.</p>
          </div>
          <div className="head-actions">
            <div className="select-wrap">
              <select className="select" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período">
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="365">Últimos 12 meses</option>
              </select>
              <ChevronDown size={16} />
            </div>
            <button className="btn btn-ghost" onClick={load} disabled={busy} aria-label="Atualizar">
              {busy ? <span className="spinner" /> : <RefreshCcw size={17} />}
            </button>
            <a className="btn btn-ghost" href={`/api/gestao/export?days=${days}`}>
              <Download size={18} /> Excel
            </a>
            <button className="btn btn-ghost" onClick={() => window.print()}>
              <Printer size={18} /> PDF
            </button>
          </div>
        </div>
        {failed && !data ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertCircle size={24} />
            </span>
            <strong>Não foi possível carregar os indicadores</strong>
            <span>{failed}</span>
          </div>
        ) : !data ? (
          <div className="skeleton" style={{ height: 240, borderRadius: 16 }} />
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat">
                <small>Valor em estoque</small>
                <b>{brl(data.stock.value)}</b>
              </div>
              <div className="stat">
                <small>Físico · reservado · disponível</small>
                <b style={{ fontSize: 20 }}>
                  {num(data.stock.physical)} · {num(data.stock.reserved)} · {num(data.stock.available)}
                </b>
              </div>
              <div className="stat">
                <small>Pedidos em aberto</small>
                <b>{num(data.orders.open)}</b>
              </div>
              <div className="stat">
                <small>Tempo médio de atendimento</small>
                <b>{data.orders.avgDays === null ? '—' : `${data.orders.avgDays.toLocaleString('pt-BR')} dias`}</b>
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <small>Itens no mínimo ou abaixo</small>
                <b style={{ color: data.stock.below ? 'var(--amber)' : undefined }}>{num(data.stock.below)}</b>
              </div>
              <div className="stat">
                <small>Pedidos atrasados</small>
                <b style={{ color: data.orders.late ? 'var(--danger)' : undefined }}>{num(data.orders.late)}</b>
              </div>
              <div className="stat">
                <small>Compras em aberto (atrasadas)</small>
                <b>
                  {num(data.purchases.open)}
                  {data.purchases.late ? <span style={{ color: 'var(--danger)' }}> ({num(data.purchases.late)})</span> : null}
                </b>
              </div>
              <div className="stat">
                <small>Parcelas vencidas</small>
                <b style={{ color: data.notes.overdue ? 'var(--danger)' : undefined }}>{brl(data.notes.overdueValue)}</b>
              </div>
            </div>

            <div className="g-grid">
              <div className="g-card">
                <h3>Pedidos de material</h3>
                {[
                  ['Em aberto', data.orders.open],
                  ['Parcialmente atendidos', data.orders.partial],
                  ['Aguardando compra', data.orders.waitingPurchase],
                  ['Atrasados', data.orders.late],
                  [`Concluídos (${data.days} dias)`, data.orders.done],
                  [`Cancelados (${data.days} dias)`, data.orders.cancelled],
                ].map(([k, v]) => (
                  <div className="g-row" key={k as string}>
                    <div>
                      <span>{k}</span>
                      <b>{num(v as number)}</b>
                    </div>
                  </div>
                ))}
                <h3 style={{ marginTop: 14 }}>Por origem</h3>
                {data.orders.byOrigin.map((o) => (
                  <div className="g-row" key={o.origin}>
                    <div>
                      <span>{o.label}</span>
                      <b>
                        {num(o.open)} abertos · {num(o.done)} entregues
                      </b>
                    </div>
                  </div>
                ))}
              </div>

              <div className="g-card">
                <h3>Valor do estoque por categoria</h3>
                {data.byCategory.map((c) => (
                  <div className="g-row" key={c.cat}>
                    <div>
                      <span>
                        {c.cat !== '—' ? `${c.cat} · ` : ''}
                        {c.name}
                      </span>
                      <b>{brl(c.value)}</b>
                    </div>
                    <div className="g-bar">
                      <i style={{ width: `${(c.value / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {data.stock.noCost ? <p className="help">{num(data.stock.noCost)} item(ns) sem custo cadastrado ficam fora do valor.</p> : null}
              </div>

              <div className="g-card">
                <h3>Mais consumidos ({data.days} dias)</h3>
                {data.consumption.length === 0 ? <p className="help">Sem saídas no período.</p> : null}
                {data.consumption.slice(0, 10).map((c) => (
                  <div className="g-row" key={c.item_id}>
                    <div>
                      <span>
                        {c.name}
                        {c.size ? ` ${c.size}` : ''}
                      </span>
                      <b>
                        {num(c.units)}
                        {c.turnover !== null ? <small style={{ color: 'var(--muted)', fontWeight: 500 }}> · giro {c.turnover.toLocaleString('pt-BR')}</small> : null}
                      </b>
                    </div>
                    <div className="g-bar">
                      <i style={{ width: `${(c.units / maxCons) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="g-card">
                <h3>Entregas por empresa ({data.days} dias)</h3>
                {data.byCompany.length === 0 ? <p className="help">Sem entregas com termo no período.</p> : null}
                {data.byCompany.map((c) => (
                  <div className="g-row" key={c.company}>
                    <div>
                      <span>{c.company}</span>
                      <b>
                        {num(c.units)} un. · {brl(c.value)}
                      </b>
                    </div>
                  </div>
                ))}
              </div>

              <div className="g-card">
                <h3>Abaixo do mínimo</h3>
                {data.below.length === 0 ? <p className="help">Nenhum item no mínimo. 👍</p> : null}
                {data.below.slice(0, 12).map((b) => (
                  <div className="g-row" key={b.id}>
                    <div>
                      <span>
                        {b.name}
                        {b.size ? ` ${b.size}` : ''}
                      </span>
                      <b style={{ color: 'var(--amber)' }}>
                        {num(b.quantity - b.reserved)} / mín. {num(b.min)}
                      </b>
                    </div>
                  </div>
                ))}
                {data.replenish ? <p className="help">{num(data.replenish)} item(ns) com reposição sugerida na aba Compras do Almoxarifado.</p> : null}
              </div>

              <div className="g-card">
                <h3>Compras e notas</h3>
                {Object.entries(data.purchases.byStatus).map(([k, v]) => (
                  <div className="g-row" key={k}>
                    <div>
                      <span>Solicitações {P_STATUS[k]?.toLowerCase() ?? k}</span>
                      <b>{num(v)}</b>
                    </div>
                  </div>
                ))}
                <div className="g-row">
                  <div>
                    <span>Notas em conferência</span>
                    <b>{num(data.notes.open)}</b>
                  </div>
                </div>
                <div className="g-row">
                  <div>
                    <span>A vencer em 30 dias</span>
                    <b>
                      {num(data.notes.dueSoon)} · {brl(data.notes.dueSoonValue)}
                    </b>
                  </div>
                </div>
              </div>

              {data.orders.lateList.length ? (
                <div className="g-card">
                  <h3>Pedidos atrasados</h3>
                  {data.orders.lateList.map((o) => (
                    <div className="g-row" key={o.id}>
                      <div>
                        <span>
                          {o.number} · {o.who}
                        </span>
                        <b style={{ color: 'var(--danger)' }}>{dateBR(o.due)}</b>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {data.idle.length ? (
                <div className="g-card">
                  <h3>Sem movimentação ({Math.max(data.days, 30)} dias)</h3>
                  {data.idle.slice(0, 10).map((i, n) => (
                    <div className="g-row" key={n}>
                      <div>
                        <span>
                          {i.name}
                          {i.size ? ` ${i.size}` : ''}
                        </span>
                        <b>
                          {num(i.quantity)} un.{i.value ? ` · ${brl(i.value)}` : ''}
                        </b>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="help" style={{ marginTop: 12 }}>Atualizado {new Date(data.at).toLocaleString('pt-BR')}.</p>
          </>
        )}
      </div>
    </div>
  );
}
