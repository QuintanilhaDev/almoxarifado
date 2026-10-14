'use client';
import { AlertCircle, ClipboardCheck, PackageX, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from './StockModals';
import { CATEGORIES, suggestClass, type CatalogGroup } from '@/lib/catalog';
import { fold, itemLabel, num } from '@/lib/almoxarifado/stockFormat';
import type { StockItem } from '@/lib/almoxarifado/types';

/* ---------- grupos do catálogo (carrega uma vez) ---------- */
let cache: { groups: CatalogGroup[]; ready: boolean } | null = null;
let inflight: Promise<{ groups: CatalogGroup[]; ready: boolean }> | null = null;
export function useCatalog() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) return;
    inflight ??= api<{ groups: CatalogGroup[]; ready: boolean }>('/api/almoxarifado/catalog')
      .then((j) => (cache = { groups: j.groups, ready: j.ready }))
      .catch(() => ({ groups: [], ready: false }));
    inflight.then((d) => setData(d));
  }, []);
  const reload = async () => {
    cache = null;
    inflight = null;
    const j = await api<{ groups: CatalogGroup[]; ready: boolean }>('/api/almoxarifado/catalog');
    cache = { groups: j.groups, ready: j.ready };
    setData(cache);
  };
  return { groups: data?.groups ?? [], ready: data?.ready ?? false, loaded: Boolean(data), reload };
}
export const groupName = (groups: CatalogGroup[], cat: string | null, grp: string | null) => groups.find((g) => g.cat === cat && g.grp === grp)?.name ?? null;

/** Categoria + grupo (dois selects). */
export function ClassPicker({ cat, grp, groups, onChange, idPrefix }: { cat: string; grp: string; groups: CatalogGroup[]; onChange: (cat: string, grp: string) => void; idPrefix: string }) {
  const inCat = groups.filter((g) => g.cat === cat);
  return (
    <div className="o-sizes">
      <div style={{ gridTemplateColumns: '1fr 1fr' }}>
        <select
          id={`${idPrefix}-cat`}
          className="select input"
          aria-label="Categoria"
          value={cat}
          onChange={(e) => {
            const c = e.target.value;
            onChange(c, groups.find((g) => g.cat === c)?.grp ?? '01');
          }}
        >
          {CATEGORIES.map((c) => (
            <option key={c.cat} value={c.cat}>
              {c.cat} · {c.name}
            </option>
          ))}
        </select>
        <select id={`${idPrefix}-grp`} className="select input" aria-label="Grupo" value={grp} onChange={(e) => onChange(cat, e.target.value)}>
          {inCat.map((g) => (
            <option key={g.grp} value={g.grp}>
              {g.grp} · {g.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Classificação automática: sugere categoria/grupo de todos os itens sem código; a pessoa confere e confirma. */
export function ClassifySheet({ items, onClose, onDone }: { items: StockItem[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { groups } = useCatalog();
  const todo = useMemo(() => items.filter((i) => !i.code), [items]);
  const [rows, setRows] = useState(() => todo.map((i) => ({ item: i, on: true, ...suggestClass(i.name) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unsure = rows.filter((r) => !r.sure).length;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const j = await api<{ done: number; errors: string[] }>('/api/almoxarifado/catalog/classify', { method: 'POST', json: { items: rows.filter((r) => r.on).map((r) => ({ id: r.item.id, cat: r.cat, grp: r.grp })) } });
      toast({ kind: j.errors.length ? 'info' : 'success', title: `${j.done} item(ns) com código`, text: j.errors.length ? j.errors.slice(0, 2).join('; ') : undefined }, 9000);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Classificar itens e gerar códigos" lead="Confira a categoria e o grupo de cada item. Os marcados em amarelo precisam de revisão." onClose={onClose} wide locked>
      {rows.length === 0 ? (
        <p className="help">Todos os itens já têm código.</p>
      ) : (
        <>
          {unsure ? (
            <p className="o-plan-warn" style={{ marginTop: 0 }}>
              <AlertCircle size={14} /> {unsure} item(ns) ficaram em Outros. Escolha a categoria certa.
            </p>
          ) : null}
          <div className="t-wrap" style={{ maxHeight: '52vh', overflow: 'auto' }}>
            <table className="t-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label="Marcar todos" checked={rows.every((r) => r.on)} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, on: e.target.checked })))} />
                  </th>
                  <th>Item</th>
                  <th>Categoria e grupo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={r.item.id} style={!r.sure ? { background: 'rgba(242,200,121,0.06)' } : undefined}>
                    <td>
                      <input type="checkbox" aria-label={`Classificar ${itemLabel(r.item)}`} checked={r.on} onChange={(e) => setRows((rs) => rs.map((x, k) => (k === n ? { ...x, on: e.target.checked } : x)))} />
                    </td>
                    <td>
                      <b>{itemLabel(r.item)}</b>
                      {!r.sure ? <small style={{ color: 'var(--amber)' }}>revisar</small> : null}
                    </td>
                    <td style={{ minWidth: 300 }}>
                      <ClassPicker idPrefix={`cl-${n}`} cat={r.cat} grp={r.grp} groups={groups} onChange={(cat, grp) => setRows((rs) => rs.map((x, k) => (k === n ? { ...x, cat, grp, sure: true } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !rows.some((r) => r.on)}>
          {busy ? <span className="spinner" /> : <Wand2 size={17} />} Gerar {num(rows.filter((r) => r.on).length)} código(s)
        </button>
      </div>
    </Sheet>
  );
}

/** Inventário: conta o que há na prateleira e o sistema ajusta só as diferenças. */
export function InventorySheet({ items, onClose, onDone }: { items: StockItem[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = useMemo(() => {
    const t = fold(query.trim());
    return items.filter((i) => i.active !== false && (!t || fold(`${i.name} ${i.size ?? ''} ${i.code ?? ''} ${i.location ?? ''}`).includes(t)));
  }, [items, query]);
  const diffs = items.filter((i) => counted[i.id] !== undefined && counted[i.id] !== '' && Number(counted[i.id]) !== i.quantity);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const lines = items.filter((i) => counted[i.id] !== undefined && counted[i.id] !== '').map((i) => ({ item_id: i.id, counted: Number(counted[i.id]) }));
      const j = await api<{ adjusted: number }>('/api/almoxarifado/stock/inventario', { method: 'POST', json: { lines, note: note || 'Inventário' } });
      toast({ kind: 'success', title: 'Inventário registrado', text: j.adjusted ? `${j.adjusted} item(ns) ajustado(s)` : 'Nenhuma diferença encontrada.' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Inventário" lead="Informe a quantidade contada de cada item." onClose={onClose} wide locked>
      <input className="input" placeholder="Filtrar por nome, código ou localização" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filtrar itens" style={{ marginBottom: 10 }} />
      <div className="t-wrap" style={{ maxHeight: '48vh', overflow: 'auto' }}>
        <table className="t-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="n">No sistema</th>
              <th className="n">Reservado</th>
              <th className="n">Contado</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((i) => {
              const c = counted[i.id];
              const diff = c !== undefined && c !== '' ? Number(c) - i.quantity : 0;
              return (
                <tr key={i.id}>
                  <td>
                    <b>{itemLabel(i)}</b>
                    <small>{[i.code, i.location].filter(Boolean).join(' · ')}</small>
                  </td>
                  <td className="n">{num(i.quantity)}</td>
                  <td className="n">{i.reserved ? num(i.reserved) : '—'}</td>
                  <td className="n" style={{ width: 120 }}>
                    <input className="input" inputMode="numeric" aria-label={`Contado de ${itemLabel(i)}`} value={c ?? ''} placeholder={String(i.quantity)} onChange={(e) => setCounted((x) => ({ ...x, [i.id]: e.target.value.replace(/\D/g, '').slice(0, 7) }))} />
                    {diff ? <small style={{ color: diff < 0 ? 'var(--danger)' : 'var(--mint)' }}>{diff > 0 ? `+${diff}` : diff}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="label" htmlFor="inv-note" style={{ marginTop: 10 }}>
        Observação <span className="opt-tag">(opcional)</span>
      </label>
      <input id="inv-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: inventário mensal de outubro" />
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={go} disabled={busy || !Object.values(counted).some((v) => v !== '')}>
          {busy ? <span className="spinner" /> : <ClipboardCheck size={17} />} Registrar ({diffs.length} diferença{diffs.length === 1 ? '' : 's'})
        </button>
      </div>
    </Sheet>
  );
}

/** Baixa por perda/avaria ou devolução ao fornecedor (sempre com motivo). */
export function WriteoffSheet({ item, onClose, onDone }: { item: StockItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'perda' | 'devolucao_fornecedor'>('perda');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const free = item.quantity - item.reserved;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/almoxarifado/stock/${item.id}/baixa`, { method: 'POST', json: { qty: Number(qty), kind, reason } });
      toast({ kind: 'success', title: kind === 'perda' ? 'Baixa registrada' : 'Devolução ao fornecedor registrada', text: itemLabel(item) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Baixa · ${itemLabel(item)}`} lead={`Disponível ${num(free)}${item.reserved ? ` (${num(item.reserved)} reservado para pedidos)` : ''}.`} onClose={onClose} locked={Boolean(reason)}>
      <div className="filter-seg" role="group" style={{ marginBottom: 12 }}>
        <button className={kind === 'perda' ? 'is-active' : ''} onClick={() => setKind('perda')} aria-pressed={kind === 'perda'}>
          Perda ou avaria
        </button>
        <button className={kind === 'devolucao_fornecedor' ? 'is-active' : ''} onClick={() => setKind('devolucao_fornecedor')} aria-pressed={kind === 'devolucao_fornecedor'}>
          Devolução ao fornecedor
        </button>
      </div>
      <div className="sx-grid">
        <div>
          <label className="label" htmlFor="wo-q">
            Quantidade
          </label>
          <input id="wo-q" className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
        <div className="full">
          <label className="label" htmlFor="wo-r">
            Motivo
          </label>
          <input id="wo-r" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'perda' ? 'Ex.: molhou no depósito; furto' : 'Ex.: lote com defeito, NF 4321'} />
        </div>
      </div>
      {error ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-danger" onClick={go} disabled={busy || !Number(qty) || !reason.trim()}>
          {busy ? <span className="spinner" /> : <PackageX size={16} />} Dar baixa
        </button>
      </div>
    </Sheet>
  );
}

/** Campos do catálogo no cadastro do item (código, marca, CA, localização, reposição). */
export interface CatalogDraft {
  cat: string;
  grp: string;
  brand: string;
  ca_number: string;
  location: string;
  max_quantity: string;
  lead_days: string;
  safety_qty: string;
}
export const draftOf = (i: StockItem | null, name = ''): CatalogDraft => {
  const s = suggestClass(i?.name ?? name);
  return {
    cat: i?.cat_code ?? s.cat,
    grp: i?.grp_code ?? s.grp,
    brand: i?.brand ?? '',
    ca_number: i?.ca_number ?? '',
    location: i?.location ?? '',
    max_quantity: i?.max_quantity != null ? String(i.max_quantity) : '',
    lead_days: i?.lead_days != null ? String(i.lead_days) : '',
    safety_qty: i?.safety_qty != null ? String(i.safety_qty) : '',
  };
};
export function CatalogSection({ item, d, setD, groups, suggestedFor }: { item: StockItem | null; d: CatalogDraft; setD: (d: CatalogDraft) => void; groups: CatalogGroup[]; suggestedFor: string }) {
  const s = suggestClass(suggestedFor);
  const field = (k: keyof CatalogDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <>
      <div className="full">
        <span className="label">
          Código do catálogo{' '}
          {item?.code ? null : (
            <button type="button" className="link-btn" onClick={() => setD({ ...d, cat: s.cat, grp: s.grp })}>
              <Sparkles size={12} /> sugerir
            </button>
          )}
        </span>
        {item?.code ? (
          <p className="help" style={{ margin: 0 }}>
            <b style={{ color: 'var(--white)', fontFamily: 'ui-monospace, monospace' }}>{item.code}</b> · {groupName(groups, item.cat_code, item.grp_code) ?? ''} 
          </p>
        ) : (
          <>
            <ClassPicker idPrefix="it-cl" cat={d.cat} grp={d.grp} groups={groups} onChange={(cat, grp) => setD({ ...d, cat, grp })} />
            <small className="help">O código é gerado ao salvar.</small>
          </>
        )}
      </div>
      <div>
        <label className="label" htmlFor="it-brand">
          Marca/modelo <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-brand" className="input" value={d.brand} maxLength={80} onChange={field('brand')} />
      </div>
      <div>
        <label className="label" htmlFor="it-ca">
          CA (EPI) <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-ca" className="input" value={d.ca_number} maxLength={20} onChange={field('ca_number')} />
      </div>
      <div>
        <label className="label" htmlFor="it-loc">
          Localização <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-loc" className="input" value={d.location} maxLength={60} onChange={field('location')} placeholder="Ex.: Prateleira B2" />
      </div>
      <div>
        <label className="label" htmlFor="it-max">
          Estoque máximo <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-max" className="input" inputMode="numeric" value={d.max_quantity} onChange={field('max_quantity')} />
      </div>
      <div>
        <label className="label" htmlFor="it-lead">
          Prazo de reposição (dias) <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-lead" className="input" inputMode="numeric" value={d.lead_days} onChange={field('lead_days')} placeholder="padrão: 15" />
      </div>
      <div>
        <label className="label" htmlFor="it-safe">
          Estoque de segurança <span className="opt-tag">(opcional)</span>
        </label>
        <input id="it-safe" className="input" inputMode="numeric" value={d.safety_qty} onChange={field('safety_qty')} placeholder="padrão: o mínimo" />
      </div>
    </>
  );
}
