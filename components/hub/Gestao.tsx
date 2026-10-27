'use client';
import { AnimatePresence, motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { num } from '@/lib/almoxarifado/stockFormat';
import type { Indicators } from '@/lib/gestao';
import type { Painel } from '../compras/PainelCompras';
import { brl, dateBR } from '../pedidos/ui';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import '../pedidos/pedidos.css';

const Fardamento = dynamic(() => import('./Fardamento').then((m) => m.Fardamento), {
  loading: () => <div className="skeleton" style={{ height: 240, borderRadius: 16 }} />,
});
const VISTA_KEY = 'maxhub-gestao-vista';
type Vista = 'sistema' | 'fardamento';

const P_STATUS: Record<string, string> = { nova: 'Novas', em_cotacao: 'Em cotação', comprada: 'Compradas', entregue: 'Entregues', recusada: 'Recusadas', cancelada: 'Canceladas' };

/** Painel da Gestão (Projeto 3, seções 10 e 14): números do estoque, dos pedidos, das compras e das notas, sem planilha manual. */
export function Gestao({ version }: { version: number }) {
  // duas visões: os números do próprio sistema e o controle de fardamento (planilha do RH/DP)
  const [vista, setVistaState] = useState<Vista>('sistema');
  useEffect(() => {
    try {
      if (window.location.hash.includes('fardamento') || localStorage.getItem(VISTA_KEY) === 'fardamento') setVistaState('fardamento');
    } catch {
      /* padrão */
    }
  }, []);
  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      localStorage.setItem(VISTA_KEY, v);
    } catch {
      /* ignore */
    }
  };
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
            <p>{vista === 'fardamento' ? 'Controle de fardamento: o que foi entregue, para quem, onde e em que tamanhos.' : 'Resumo do estoque, dos pedidos, das compras e das notas.'}</p>
          </div>
          {vista === 'sistema' ? (
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
              <a className="btn btn-ghost" href={`/api/gestao/export?days=${days}`} data-max="gestao-xlsx">
                <Download size={18} /> Excel
              </a>
              <a className="btn btn-ghost" href={`/api/gestao/pdf?days=${days}`} data-max="gestao-pdf">
                <FileText size={18} /> PDF
              </a>
            </div>
          ) : null}
        </div>
        <div className="seg g-vista" role="tablist" aria-label="Visão da Gestão">
          {(
            [
              ['sistema', 'Estoque e pedidos'],
              ['fardamento', 'Fardamento'],
            ] as [Vista, string][]
          ).map(([v, t]) => (
            <button key={v} role="tab" aria-selected={vista === v} className={`seg-btn${vista === v ? ' is-active' : ''}`} onClick={() => setVista(v)} data-max={`gestao-${v}`}>
              {vista === v ? <motion.span layoutId="gestao-vista-bg" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} /> : null}
              <span>{t}</span>
            </button>
          ))}
        </div>
        {vista === 'fardamento' ? (
          <Fardamento />
        ) : failed && !data ? (
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
              <StockCycler physical={data.stock.physical} reserved={data.stock.reserved} available={data.stock.available} />
              <div className="stat">
                <small>Pedidos em aberto</small>
                <b>{num(data.orders.open)}</b>
              </div>
              <div className="stat">
                <small>Tempo médio de atendimento</small>
                <b>{data.orders.avgDays === null ? '—' : data.orders.avgDays < 1 ? 'menos de 1 dia' : `${data.orders.avgDays.toLocaleString('pt-BR')} dias`}</b>
              </div>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <small>Itens no mínimo ou abaixo</small>
                <b
                  style={{
                    color: data.stock.below ? 'var(--amber)' : undefined,
                  }}
                >
                  {num(data.stock.below)}
                </b>
              </div>
              <div className="stat">
                <small>Pedidos atrasados</small>
                <b
                  style={{
                    color: data.orders.late ? 'var(--danger)' : undefined,
                  }}
                >
                  {num(data.orders.late)}
                </b>
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
                <b
                  style={{
                    color: data.notes.overdue ? 'var(--danger)' : undefined,
                  }}
                >
                  {brl(data.notes.overdueValue)}
                </b>
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
                {data.orders.byOrigin.length ? <h3 style={{ marginTop: 14 }}>Por origem</h3> : null}
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
                {data.stock.noCost ? (
                  <p className="help">
                    {num(data.stock.noCost)} {data.stock.noCost === 1 ? 'item sem custo cadastrado fica' : 'itens sem custo cadastrado ficam'} fora do valor.
                  </p>
                ) : null}
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
                {data.below.length === 0 ? <p className="help">Nenhum item abaixo do mínimo.</p> : null}
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
                {data.replenish ? (
                  <p className="help">
                    {num(data.replenish)} {data.replenish === 1 ? 'item' : 'itens'} com reposição sugerida na aba Compras do Almoxarifado.
                  </p>
                ) : null}
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
                          {num(i.quantity)} un.
                          {i.value ? ` · ${brl(i.value)}` : ''}
                        </b>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <ComprasGestao version={version} />
            <p className="help" style={{ marginTop: 12 }}>
              Atualizado {new Date(data.at).toLocaleString('pt-BR')}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Saldo físico, reservado e disponível: um de cada vez, alternando pelas setas. */
const STOCK_VIEWS = [
  { key: 'physical', label: 'Saldo físico', hint: 'unidades na prateleira' },
  { key: 'reserved', label: 'Reservado', hint: 'separado para pedidos' },
  { key: 'available', label: 'Disponível', hint: 'livre para usar' },
] as const;
function StockCycler(v: { physical: number; reserved: number; available: number }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const go = (d: number) => {
    setDir(d);
    setI((x) => (x + d + STOCK_VIEWS.length) % STOCK_VIEWS.length);
  };
  const cur = STOCK_VIEWS[i];
  return (
    <div className="stat g-cycler">
      <div className="g-cycler-head">
        <small>{cur.label}</small>
        <span className="g-cycler-nav">
          <button type="button" className="icon-btn" aria-label="Anterior" onClick={() => go(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Próximo" onClick={() => go(1)}>
            <ChevronRight size={16} />
          </button>
        </span>
      </div>
      <div className="g-cycler-body">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.b
            key={cur.key}
            custom={dir}
            initial={{ opacity: 0, rotateY: dir * 70, x: dir * 24 }}
            animate={{ opacity: 1, rotateY: 0, x: 0 }}
            exit={{ opacity: 0, rotateY: dir * -70, x: dir * -24 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 600 }}
          >
            {num(v[cur.key])}
          </motion.b>
        </AnimatePresence>
      </div>
      <div className="g-cycler-foot">
        <span>{cur.hint}</span>
        <span className="g-dots">
          {STOCK_VIEWS.map((x, k) => (
            <button
              key={x.key}
              type="button"
              aria-label={x.label}
              className={k === i ? 'is-on' : ''}
              onClick={() => {
                setDir(k > i ? 1 : -1);
                setI(k);
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

/** Compras na Gestão: valor comprado (mês, fornecedor, categoria), economia e itens críticos. */
function ComprasGestao({ version }: { version: number }) {
  const [d, setD] = useState<Painel | null>(null);
  useEffect(() => {
    api<Painel>('/api/compras/painel')
      .then(setD)
      .catch(() => setD(null));
  }, [version]);
  if (!d) return null;
  const g = d.gestao;
  const maxM = Math.max(1, ...g.by_month.map((m) => m.total));
  const maxS = Math.max(1, ...g.by_supplier.map((m) => m.total));
  const maxC = Math.max(1, ...g.by_category.map((m) => m.total));
  const month = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
  return (
    <>
      <h2 className="g-sub">Compras</h2>
      <div className="g-grid">
        <div className="g-card">
          <h3>Comprado e economia (12 meses)</h3>
          <div className="g-row">
            <div>
              <span>Total comprado (pedidos aprovados)</span>
              <b>{brl(g.bought)}</b>
            </div>
          </div>
          <div className="g-row">
            <div>
              <span>Economia negociada</span>
              <b>{brl(g.savings.negotiated)}</b>
            </div>
          </div>
          <div className="g-row">
            <div>
              <span>Economia sobre a média das propostas</span>
              <b>{brl(g.savings.vs_average)}</b>
            </div>
          </div>
          <p className="help">{g.savings.criterion}</p>
          <div className="g-row">
            <div>
              <span>Pedidos a receber · atrasados</span>
              <b>
                {num(d.counts.po_open ?? 0)} · {num(d.counts.po_late ?? 0)}
              </b>
            </div>
          </div>
        </div>
        <div className="g-card">
          <h3>Comprado por mês</h3>
          {g.by_month.length ? (
            g.by_month.map((m) => (
              <div className="g-row" key={m.month}>
                <div>
                  <span>{month(m.month)}</span>
                  <b>{brl(m.total)}</b>
                </div>
                <div className="g-bar">
                  <i style={{ width: `${(m.total / maxM) * 100}%` }} />
                </div>
              </div>
            ))
          ) : (
            <p className="help">Sem pedidos aprovados ainda.</p>
          )}
        </div>
        <div className="g-card">
          <h3>Comprado por fornecedor</h3>
          {g.by_supplier.map((m) => (
            <div className="g-row" key={m.name}>
              <div>
                <span>{m.name}</span>
                <b>{brl(m.total)}</b>
              </div>
              <div className="g-bar">
                <i style={{ width: `${(m.total / maxS) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="g-card">
          <h3>Comprado por categoria</h3>
          {g.by_category.map((m) => (
            <div className="g-row" key={m.name}>
              <div>
                <span>{m.name}</span>
                <b>{brl(m.total)}</b>
              </div>
              <div className="g-bar">
                <i style={{ width: `${(m.total / maxC) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        {g.critical.length ? (
          <div className="g-card">
            <h3>Itens críticos</h3>
            {g.critical.slice(0, 10).map((i) => (
              <div className="g-row" key={i.item_id}>
                <div>
                  <span>{i.name}</span>
                  <b>
                    {num(i.available)} / mín. {num(i.min)}
                    {i.on_order ? ` · ${num(i.on_order)} a receber${i.late ? ' (atrasado)' : ''}` : ' · sem compra'}
                  </b>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
