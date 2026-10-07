'use client';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  PackageMinus,
  PackagePlus,
  Send,
  SlidersHorizontal,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { num } from '@/lib/stockFormat';
import { MOVEMENT_LABEL, type MovementKind, type StockMovement } from '@/lib/types';
import { api } from './api';

const ICON: Record<MovementKind, { Icon: LucideIcon; tone: '' | 'in' | 'out' }> = {
  entrada: { Icon: ArrowDownToLine, tone: 'in' },
  saida: { Icon: ArrowUpFromLine, tone: 'out' },
  ajuste: { Icon: SlidersHorizontal, tone: '' },
  transferencia: { Icon: Send, tone: '' },
  devolucao: { Icon: Undo2, tone: 'in' },
  baixa_posto: { Icon: PackageMinus, tone: 'out' },
  criacao: { Icon: PackagePlus, tone: 'in' },
  exclusao: { Icon: Trash2, tone: 'out' },
};

function amount(m: StockMovement) {
  switch (m.kind) {
    case 'entrada':
    case 'devolucao':
    case 'criacao':
      return `+${num(m.quantity)}`;
    case 'saida':
    case 'baixa_posto':
    case 'exclusao':
      return `−${num(m.quantity)}`;
    case 'transferencia':
      return `→ ${num(m.quantity)}`;
    case 'ajuste':
      return m.before_qty !== null && m.after_qty !== null ? `${num(m.before_qty)} → ${num(m.after_qty)}` : num(m.quantity);
  }
}

export function MovementRow({ m, showItem = true }: { m: StockMovement; showItem?: boolean }) {
  const { Icon, tone } = ICON[m.kind] ?? ICON.ajuste;
  const where = m.posto_name ? ` · ${m.posto_name}` : '';
  return (
    <div className="move-row">
      <span className={`move-ic ${tone}`}>
        <Icon size={17} />
      </span>
      <div style={{ minWidth: 0 }}>
        <b>{showItem ? m.item_name : MOVEMENT_LABEL[m.kind] + where}</b>
        <small>
          {showItem ? MOVEMENT_LABEL[m.kind] + where : ''}
          {m.note ? `${showItem ? ' · ' : ''}${m.note}` : ''}
        </small>
        <small>
          {m.by_name ? `${m.by_name} · ` : ''}
          {formatDateTime(m.created_at)}
        </small>
      </div>
      <div className="move-qty">
        {amount(m)}
        {m.after_qty !== null && m.kind !== 'ajuste' && m.kind !== 'exclusao' ? <small>saldo {num(m.after_qty)}</small> : null}
      </div>
    </div>
  );
}

/** Histórico geral (ou de um posto), com "carregar mais". Recarrega quando `version` muda. */
export function MovementFeed({ postoId, version }: { postoId?: string; version: number }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchPage = useCallback(
    async (offset: number) => {
      const qs = new URLSearchParams({ offset: String(offset), limit: '40' });
      if (postoId) qs.set('posto_id', postoId);
      return api<{ movements: StockMovement[]; more: boolean }>(`/api/admin/stock/movements?${qs}`);
    },
    [postoId],
  );

  useEffect(() => {
    let alive = true;
    fetchPage(0)
      .then((j) => {
        if (!alive) return;
        setRows(j.movements);
        setMore(j.more);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [fetchPage, version]);

  const loadMore = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const j = await fetchPage(rows.length);
      setRows((r) => [...(r ?? []), ...j.movements]);
      setMore(j.more);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (failed && !rows) return <div className="empty-line">Não foi possível carregar o histórico agora.</div>;
  if (!rows) return <div className="skeleton" style={{ height: 120 }} />;
  if (!rows.length) return <div className="empty-line">Nenhuma movimentação registrada ainda.</div>;
  return (
    <div>
      {rows.map((m) => (
        <MovementRow key={m.id} m={m} showItem />
      ))}
      {more ? (
        <div className="more-row">
          <button className="btn btn-ghost btn-sm" onClick={loadMore} disabled={busy}>
            {busy ? <span className="spinner" /> : null} Carregar mais
          </button>
        </div>
      ) : null}
    </div>
  );
}
