'use client';
import { Building2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fold } from '@/lib/almoxarifado/stockFormat';
import { formatDoc, type Supplier } from '@/lib/compras/fornecedores';
import './compras.css';

/** cadastro de fornecedores (um pedido por página aberta; recarrega depois de 1 minuto) */
let cache: { at: number; list: Promise<Supplier[]> } | null = null;
function loadSuppliers(): Promise<Supplier[]> {
  if (!cache || Date.now() - cache.at > 60_000) {
    cache = {
      at: Date.now(),
      list: fetch('/api/compras/fornecedores', { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { suppliers: [] }))
        .then((j: { suppliers?: Supplier[] }) => (j.suppliers ?? []).filter((s) => s.active !== false))
        .catch(() => []),
    };
  }
  return cache.list;
}

/**
 * Caixa de texto do fornecedor com sugestões do cadastro de Compras.
 * Digitando, aparecem os fornecedores parecidos (nome, nome fantasia, o que fornece ou CNPJ);
 * ao escolher, o CNPJ vem junto. Quem não está na lista pode ser digitado normalmente.
 */
export function SupplierPicker({
  id,
  value,
  onChange,
  onPick,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (s: Supplier) => void;
  autoFocus?: boolean;
}) {
  const [list, setList] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    let alive = true;
    loadSuppliers().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const t = fold(value.trim());
    const d = value.replace(/\D/g, '');
    const scored = list
      .map((s) => {
        const name = fold(`${s.trade_name ?? ''} ${s.name}`);
        let score = 0;
        if (!t) score = 1 + Math.min(1, (s.notes_count ?? 0) / 20); // sem nada digitado: os que mais vendem primeiro
        else if (name.startsWith(t) || fold(s.name).startsWith(t)) score = 4;
        else if (name.includes(t)) score = 3;
        else if (t.split(' ').every((w) => name.includes(w))) score = 2.5;
        else if (d.length >= 3 && (s.cnpj ?? '').includes(d)) score = 2.4;
        else if (fold(s.category ?? '').includes(t)) score = 1.5;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.s.notes_count ?? 0) - (a.s.notes_count ?? 0) || a.s.name.localeCompare(b.s.name));
    return scored.slice(0, 6).map((x) => x.s);
  }, [list, value]);

  // fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const choose = (s: Supplier) => {
    setPicked(s.id);
    onPick(s);
    setOpen(false);
  };
  const exact = shown.some((s) => fold(s.name) === fold(value.trim()) || fold(s.trade_name ?? '') === fold(value.trim()));
  const visible = open && list.length > 0 && (shown.length > 0 || value.trim().length > 1);

  return (
    <div className="sp-wrap" ref={wrap}>
      <input
        id={id}
        className="input"
        value={value}
        maxLength={160}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={list.length ? 'Digite para buscar no cadastro de fornecedores' : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setPicked(null);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === 'Escape') {
            // fecha só a lista (o formulário continua aberto)
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setOpen(false);
            return;
          }
          if (!shown.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + shown.length) % shown.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(shown[active]);
          }
        }}
      />
      {visible ? (
        <div className="sp-list" id={listId} role="listbox">
          {shown.map((s, i) => (
            <button
              type="button"
              key={s.id}
              role="option"
              aria-selected={i === active}
              className={`sp-opt${i === active ? ' is-active' : ''}${picked === s.id ? ' is-picked' : ''}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              <span className="sp-ico">
                <Building2 size={15} />
              </span>
              <span className="sp-txt">
                <b>{s.trade_name || s.name}</b>
                <small>{[s.trade_name ? s.name : null, s.cnpj ? formatDoc(s.cnpj) : 'Sem CNPJ', s.category].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          ))}
          {!exact && value.trim().length > 1 ? (
            <div className="sp-hint">{shown.length ? 'Não é nenhum desses? ' : 'Não está no cadastro de Compras. '}Pode digitar: o fornecedor entra no cadastro quando a nota for lançada.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
