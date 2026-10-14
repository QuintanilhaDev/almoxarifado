'use client';
import { AlertCircle, PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { num } from '@/lib/almoxarifado/stockFormat';
import type { PurchaseRequest } from '@/lib/compras/types';

interface Row {
  item_id: string;
  code: string | null;
  name: string;
  size: string | null;
  unit: string;
  quantity: number;
  reserved: number;
  available: number;
  min: number;
  daily: number;
  lead_days: number;
  point: number;
  in_transit: number;
  demand: number;
  suggest: number;
  cover_days: number | null;
  urgent: boolean;
}
interface Result {
  days: number;
  defaultLead: number;
  rows: Row[];
}

/** quantos itens estão no ponto de reposição (recalcula quando as compras mudam) */
export function useReplenishCount(enabled: boolean, requests: PurchaseRequest[] | null) {
  const [n, setN] = useState(0);
  const stamp = (requests ?? []).map((r) => r.updated_at).join('|');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api<Result>('/api/almoxarifado/reposicao')
      .then((j) => alive && setN(j.rows.length))
      .catch(() => alive && setN(0));
    return () => {
      alive = false;
    };
  }, [enabled, stamp]);
  return n;
}

/**
 * Reposição sugerida (Projeto 3, seção 7): ponto = consumo médio diário × prazo + segurança.
 * Já desconta o que está para chegar (compras abertas). A pessoa confere e confirma a solicitação.
 */
export function ReplenishSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<Result | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Result>('/api/almoxarifado/reposicao')
      .then((j) => {
        setData(j);
        setQty(Object.fromEntries(j.rows.map((r) => [r.item_id, String(r.suggest)])));
        setOn(Object.fromEntries(j.rows.map((r) => [r.item_id, true])));
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  const chosen = (data?.rows ?? []).filter((r) => on[r.item_id] && Number(qty[r.item_id]) > 0);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await api<{ request: PurchaseRequest }>('/api/compras/requests', {
        method: 'POST',
        json: {
          items: chosen.map((r) => ({ item_id: r.item_id, quantity: Number(qty[r.item_id]), note: `Reposição: ponto ${r.point}, disponível ${r.available}${r.in_transit ? `, ${r.in_transit} a caminho` : ''}` })),
          priority: chosen.some((r) => r.urgent) ? 'urgente' : 'normal',
          reason: 'Reposição de estoque',
        },
      });
      toast({ kind: 'success', title: `Solicitação de compra ${j.request.number} enviada`, text: `${chosen.length} item(ns) · o setor de Compras foi avisado` });
      onSaved(j.request.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Reposição sugerida" lead={data ? `Com base no consumo dos últimos ${data.days} dias e no prazo de reposição de cada item.` : 'Calculando…'} onClose={onClose} wide locked>
      {!data && !error ? <div className="skeleton" style={{ height: 160 }} /> : null}
      {data && data.rows.length === 0 ? <p className="help">Nenhum item precisa de reposição agora.</p> : null}
      {data && data.rows.length ? (
        <div className="t-wrap" style={{ maxHeight: '52vh', overflow: 'auto' }}>
          <table className="t-table">
            <thead>
              <tr>
                <th />
                <th>Item</th>
                <th className="n">Disponível</th>
                <th className="n">Consumo/dia</th>
                <th className="n">Cobre</th>
                <th className="n">A caminho</th>
                <th className="n">Ponto</th>
                <th className="n">Pedir</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.item_id}>
                  <td>
                    <input type="checkbox" aria-label={`Incluir ${r.name}`} checked={Boolean(on[r.item_id])} onChange={(e) => setOn((x) => ({ ...x, [r.item_id]: e.target.checked }))} />
                  </td>
                  <td>
                    <b>
                      {r.name}
                      {r.size ? ` ${r.size}` : ''}
                    </b>
                    <small>
                      {[r.code, r.urgent ? 'urgente' : null, r.demand ? `${r.demand} pedido(s) sem saldo` : null].filter(Boolean).join(' · ')}
                    </small>
                  </td>
                  <td className={`n${r.urgent ? ' t-short' : ''}`}>{num(r.available)}</td>
                  <td className="n">{r.daily ? r.daily.toLocaleString('pt-BR') : '—'}</td>
                  <td className="n">{r.cover_days === null ? '—' : `${r.cover_days} d`}</td>
                  <td className="n">{r.in_transit ? num(r.in_transit) : '—'}</td>
                  <td className="n">{num(r.point)}</td>
                  <td className="n" style={{ width: 96 }}>
                    <input className="input" inputMode="numeric" aria-label={`Quantidade de ${r.name}`} value={qty[r.item_id] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [r.item_id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Fechar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !chosen.length}>
          {busy ? <span className="spinner" /> : <PackagePlus size={17} />} Pedir compra de {chosen.length} item(ns)
        </button>
      </div>
    </Sheet>
  );
}
