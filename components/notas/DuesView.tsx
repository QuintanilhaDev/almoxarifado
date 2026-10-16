'use client';
import { CalendarClock, FileSpreadsheet, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fold } from '@/lib/almoxarifado/stockFormat';
import type { FiscalNote } from '@/lib/notas/server';
import { brl, dateBR, todayLocal } from '../pedidos/ui';
import { N_STATUS } from './NoteDrawer';

/**
 * Programação de vencimentos: consulta por período, fornecedor, nota e pedido, com totais
 * por mês e por fornecedor e exportação em planilha ou PDF. É previsão de desembolso.
 */
export function DuesView({ notes, onOpen }: { notes: FiscalNote[]; onOpen: (id: string) => void }) {
  const today = todayLocal();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState('');
  const [sup, setSup] = useState('');
  const rows = useMemo(
    () =>
      notes
        .filter((n) => n.status !== 'estornada' && (!sup.trim() || fold(n.supplier_name).includes(fold(sup.trim()))))
        .flatMap((n) => n.installments.map((p) => ({ note: n, ...p })))
        .filter((p) => (!from || (p.due && p.due >= from)) && (!to || (p.due && p.due <= to)))
        .sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999'))),
    [notes, from, to, sup],
  );
  const total = rows.reduce((t, r) => t + Number(r.value || 0), 0);
  const byMonth = new Map<string, number>();
  const bySup = new Map<string, number>();
  for (const r of rows) {
    const m = r.due ? `${r.due.slice(5, 7)}/${r.due.slice(0, 4)}` : 'sem data';
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(r.value || 0));
    bySup.set(r.note.supplier_name, (bySup.get(r.note.supplier_name) ?? 0) + Number(r.value || 0));
  }
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sup.trim() ? { supplier: sup.trim() } : {}) }).toString();
  return (
    <div>
      <div className="sx-grid pc-dues-filter">
        <div>
          <label className="label" htmlFor="du-from">
            De
          </label>
          <input id="du-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="du-to">
            Até
          </label>
          <input id="du-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="du-sup">
            Fornecedor
          </label>
          <input id="du-sup" className="input" value={sup} onChange={(e) => setSup(e.target.value)} placeholder="todos" />
        </div>
        <div style={{ alignSelf: 'end', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <a className="btn btn-ghost btn-sm" href={`/api/almoxarifado/notas/vencimentos?format=xlsx&${qs}`} data-max="vencimentos-planilha">
            <FileSpreadsheet size={14} /> Planilha
          </a>
          <a className="btn btn-ghost btn-sm" href={`/api/almoxarifado/notas/vencimentos?format=pdf&${qs}`} target="_blank" rel="noreferrer" data-max="vencimentos-pdf">
            <FileText size={14} /> PDF
          </a>
        </div>
      </div>
      <p className="help">Previsão de desembolso registrada nas notas: não indica que algo foi pago e não é o saldo bancário.</p>
      {!rows.length ? (
        <div className="empty">
          <span className="empty-icon">
            <CalendarClock size={24} />
          </span>
          <strong>Nenhuma parcela neste período</strong>
          <span>Mude as datas ou o fornecedor.</span>
        </div>
      ) : (
        <>
          <div className="pc-dues-sum">
            <div className="stat">
              <small>Total no período</small>
              <b>{brl(total)}</b>
            </div>
            <div className="stat">
              <small>Por mês</small>
              {[...byMonth].map(([m, v]) => (
                <div className="kv-row" key={m}>
                  <span>{m}</span>
                  <b>{brl(v)}</b>
                </div>
              ))}
            </div>
            <div className="stat">
              <small>Por fornecedor</small>
              {[...bySup]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([s, v]) => (
                  <div className="kv-row" key={s}>
                    <span>{s}</span>
                    <b>{brl(v)}</b>
                  </div>
                ))}
            </div>
          </div>
          <div className="t-wrap">
            <table className="t-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Nota</th>
                  <th>Fornecedor</th>
                  <th>Parcela</th>
                  <th className="n">Valor</th>
                  <th>Parcelas</th>
                  <th>Nota fiscal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={i} className="click" onClick={() => onOpen(p.note.id)}>
                    <td className={p.due && p.due < today ? 't-short' : ''}>{dateBR(p.due)}</td>
                    <td>NF {p.note.number}</td>
                    <td>{p.note.supplier_name}</td>
                    <td>
                      {p.n}
                      {p.method || p.ref ? <small style={{ display: 'block' }}>{[p.method, p.ref].filter(Boolean).join(' · ')}</small> : null}
                    </td>
                    <td className="n">{brl(Number(p.value))}</td>
                    <td>{p.note.installments_status === undefined ? '—' : p.note.installments_status === 'validada' ? 'validadas' : 'a conferir'}</td>
                    <td>
                      <span className={`pbadge ${N_STATUS[p.note.status].tone}`}>{N_STATUS[p.note.status].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
