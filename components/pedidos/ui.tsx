'use client';
import { useMemo, useState } from 'react';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from '@/lib/pedidos/types';

/** item do catálogo como as telas de pedido usam (o estoque completo só o Almoxarifado vê) */
export interface PickItem {
  id: string;
  code?: string | null;
  name: string;
  size: string | null;
  unit?: string;
  available: number;
}

export const dateBR = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
export const todayLocal = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
export const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`pbadge ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** baixa um arquivo que veio de um POST (planilha) */
export async function downloadPost(url: string, body: unknown, fallbackName: string) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || 'Não foi possível gerar a planilha.');
  }
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Busca de item do estoque (digita e escolhe). Sem escolha, fica o texto livre. */
export function ItemPicker({
  value,
  items,
  onPick,
  onText,
  placeholder = 'Busque o item (nome, tamanho ou código)',
  label,
  taken = [],
}: {
  value: { item_id: string | null; text: string };
  items: PickItem[];
  onPick: (i: PickItem) => void;
  onText: (t: string) => void;
  placeholder?: string;
  label: string;
  taken?: string[];
}) {
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const hits = useMemo(() => {
    const t = fold(value.text.trim());
    if (!t || value.item_id) return [];
    const words = t.split(/\s+/);
    return items.filter((i) => !taken.includes(i.id) && words.every((w) => fold(`${i.name} ${i.size ?? ''} ${i.code ?? ''}`).includes(w))).slice(0, 8);
  }, [value.text, value.item_id, items, taken]);
  const pick = (i: PickItem) => {
    onPick(i);
    setFocus(false);
  };
  return (
    <div className="p-line-item">
      <input
        className="input"
        aria-label={label}
        placeholder={placeholder}
        value={value.text}
        maxLength={160}
        onChange={(e) => {
          onText(e.target.value);
          setHi(0);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(hits.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(hits[hi] ?? hits[0]);
          }
        }}
      />
      {focus && hits.length ? (
        <div className="p-suggest" role="listbox">
          {hits.map((i, k) => (
            <button type="button" role="option" aria-selected={k === hi} key={i.id} className={k === hi ? 'is-hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              <b>
                {i.name}
                {i.size ? ` ${i.size}` : ''}
              </b>
              <small>
                {i.code ? `${i.code} · ` : ''}disponível {num(i.available)}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
