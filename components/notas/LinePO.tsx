'use client';
import { Link2 } from 'lucide-react';
import { poLabel, poLeft, type PurchaseOrder } from '@/lib/compras/pc';
import type { NoteLine } from '@/lib/notas/server';

/**
 * Pedido de compra de uma linha da nota: mostra a ligação (e o porquê) e deixa trocar —
 * automático, outra linha de pedido do mesmo fornecedor ou "fora de pedido".
 * `parts`: a linha (ou as partes dela, quando dividida entre pedidos).
 */
export function LinePO({
  parts,
  orders,
  itemId,
  value,
  onChange,
  disabled,
  label,
}: {
  parts: NoteLine[];
  orders: PurchaseOrder[];
  itemId: string | null;
  /** undefined = automático; null = fora de pedido; objeto = escolhido */
  value: { po_id: string; po_key: string } | null | undefined;
  onChange?: (v: { po_id: string; po_key: string } | null | undefined) => void;
  disabled?: boolean;
  label: string;
}) {
  const linked = parts.filter((p) => p.po_id);
  const name = (p: NoteLine) => {
    const o = orders.find((x) => x.id === p.po_id);
    const it = o?.items.find((x) => x.key === p.po_key);
    return o ? `${poLabel(o.number)}${it ? ' · ' + it.name + (it.size ? ' ' + it.size : '') : ''}` : 'pedido';
  };
  const opts = orders.flatMap((o) => o.items.filter((it) => !itemId || !it.item_id || it.item_id === itemId).map((it) => ({ v: `${o.id}|${it.key}`, t: `${poLabel(o.number)} · ${it.name}${it.size ? ' ' + it.size : ''} (${poLeft(it)} a receber)` })));
  const cur = value === undefined ? 'auto' : value === null ? 'none' : `${value.po_id}|${value.po_key}`;
  return (
    <div className="n-po-line">
      {linked.length ? (
        linked.map((p, k) => (
          <small key={k} className="n-po-tag" title={p.po_why ?? undefined}>
            <Link2 size={12} /> {name(p)}
            {linked.length > 1 || (p.parts ?? 1) > 1 ? ` · ${p.qty}` : ''}
            {p.po_why ? <span className="n-po-why">{p.po_why.split(': ').slice(1).join(': ')}</span> : null}
          </small>
        ))
      ) : (
        <small className="n-po-tag is-none">{parts[0]?.po_lock ? 'Fora de pedido (escolhido)' : itemId ? 'Não está em nenhum pedido em aberto' : 'Pedido: depois de escolher o item'}</small>
      )}
      {onChange && orders.length ? (
        <select
          className="select input n-po-select"
          aria-label={`Pedido de compra de ${label}`}
          value={cur}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'auto') onChange(undefined);
            else if (v === 'none') onChange(null);
            else {
              const [po_id, po_key] = v.split('|');
              onChange({ po_id, po_key });
            }
          }}
        >
          <option value="auto">Pedido: automático</option>
          {opts.map((o) => (
            <option key={o.v} value={o.v}>
              {o.t}
            </option>
          ))}
          <option value="none">Fora de pedido</option>
        </select>
      ) : null}
    </div>
  );
}
