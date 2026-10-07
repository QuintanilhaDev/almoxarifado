'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ChevronDown, PackagePlus, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Posto, StockItem } from '@/lib/types';
import { fold, itemLabel, num } from '@/lib/stockFormat';
import { useToast } from '../Toasts';
import { api } from './api';

export function Sheet({
  title,
  lead,
  onClose,
  children,
  wide,
  locked,
}: {
  title: string;
  lead?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** impede fechar clicando fora (formulários com texto digitado) */
  locked?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => (locked ? undefined : onClose())}
    >
      <motion.div
        className={`modal sx${wide ? ' xl' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {lead ? <p className="lead">{lead}</p> : <div style={{ height: 14 }} />}
        {children}
      </motion.div>
    </motion.div>
  );
}

function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="sx-error" role="alert">
      <AlertCircle size={16} /> {text}
    </div>
  );
}

const UNITS = ['Cada', 'Par', 'Caixa', 'Kit', 'Pacote', 'Metro', 'Litro', 'Rolo'];

/* ------------------------------------------------------------------ */
/* novo item / editar item                                             */
/* ------------------------------------------------------------------ */
export function ItemFormModal({
  item,
  onClose,
  onSaved,
}: {
  item: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: item?.name ?? '',
    size: item?.size ?? '',
    unit: item?.unit ?? 'Cada',
    quantity: '0',
    min_quantity: String(item?.min_quantity ?? 0),
    cost: item?.cost != null ? String(item.cost).replace('.', ',') : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setError('Dê um nome ao item.');
    setBusy(true);
    try {
      const payload = { name: f.name, size: f.size, unit: f.unit, min_quantity: f.min_quantity, cost: f.cost };
      if (item) await api(`/api/admin/stock/${item.id}`, { method: 'PATCH', json: payload });
      else await api('/api/admin/stock', { method: 'POST', json: { ...payload, quantity: f.quantity } });
      toast({ kind: 'success', title: item ? 'Item atualizado' : 'Item cadastrado', text: f.name.trim() });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={item ? 'Editar item' : 'Novo item'}
      lead={item ? 'Para mudar o saldo, use Entrada, Saída ou Ajustar saldo no detalhe do item.' : undefined}
      onClose={onClose}
      locked
    >
      <form onSubmit={submit} noValidate>
        <div className="sx-grid">
          <div className="full">
            <label className="label" htmlFor="it-name">
              Descrição do produto <span className="req">*</span>
            </label>
            <input id="it-name" className="input" value={f.name} onChange={set('name')} maxLength={160} autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="it-size">
              Tamanho <span className="opt-tag">(opcional)</span>
            </label>
            <input id="it-size" className="input" value={f.size} onChange={set('size')} maxLength={40} placeholder="Ex.: M, 42, Único" />
          </div>
          <div>
            <label className="label" htmlFor="it-unit">
              Unidade
            </label>
            <input id="it-unit" className="input" list="units" value={f.unit} onChange={set('unit')} maxLength={20} />
            <datalist id="units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          {!item ? (
            <div>
              <label className="label" htmlFor="it-qty">
                Saldo inicial
              </label>
              <input id="it-qty" className="input" inputMode="numeric" value={f.quantity} onChange={set('quantity')} />
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="it-min">
              Estoque mínimo
            </label>
            <input id="it-min" className="input" inputMode="numeric" value={f.min_quantity} onChange={set('min_quantity')} />
          </div>
          <div>
            <label className="label" htmlFor="it-cost">
              Custo unitário (R$) <span className="opt-tag">(opcional)</span>
            </label>
            <input id="it-cost" className="input" inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="0,00" />
          </div>
        </div>
        <ErrorLine text={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <PackagePlus size={18} />} {item ? 'Salvar' : 'Cadastrar item'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* entrada / saída / ajuste (almoxarifado) e devolução / baixa (posto) */
/* ------------------------------------------------------------------ */
export type QtyKind = 'entrada' | 'saida' | 'ajuste' | 'devolucao' | 'baixa_posto';

const KIND_TITLE: Record<QtyKind, string> = {
  entrada: 'Registrar entrada',
  saida: 'Registrar saída',
  ajuste: 'Ajustar saldo',
  devolucao: 'Devolver ao almoxarifado',
  baixa_posto: 'Dar baixa no posto',
};

export function QtyModal({
  item,
  kind: initial,
  posto,
  atPosto,
  onClose,
  onSaved,
}: {
  item: { id: string; name: string; size: string | null; quantity?: number };
  kind: QtyKind;
  posto?: { id: string; name: string };
  /** quanto o posto tem deste item (devolução/baixa) */
  atPosto?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<QtyKind>(initial);
  const isPosto = kind === 'devolucao' || kind === 'baixa_posto';
  const balance = item.quantity ?? 0;
  const [qty, setQty] = useState(initial === 'ajuste' ? String(balance) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const n = qty.trim() === '' ? null : Number(qty);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && (kind === 'ajuste' || n >= 1);
  const after =
    !valid || n === null
      ? null
      : kind === 'entrada'
        ? balance + n
        : kind === 'saida'
          ? balance - n
          : kind === 'ajuste'
            ? n
            : kind === 'devolucao'
              ? balance + n
              : balance;

  const switchKind = (k: QtyKind) => {
    setKind(k);
    setError('');
    setQty(k === 'ajuste' ? String(balance) : '');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || n === null) return setError(kind === 'ajuste' ? 'Informe o novo saldo (zero ou mais).' : 'Informe uma quantidade inteira maior que zero.');
    if ((kind === 'saida') && n > balance) return setError(`Saldo insuficiente: há apenas ${num(balance)} no almoxarifado.`);
    if (isPosto && atPosto !== undefined && n > atPosto) return setError(`O posto tem apenas ${num(atPosto)} deste item.`);
    setBusy(true);
    try {
      await api('/api/admin/stock/move', {
        method: 'POST',
        json: { item_id: item.id, kind, quantity: n, posto_id: posto?.id, note },
      });
      toast({ kind: 'success', title: KIND_TITLE[kind], text: itemLabel(item) });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={KIND_TITLE[kind]} lead={itemLabel(item) + (posto ? ` · ${posto.name}` : '')} onClose={onClose} locked>
      <form onSubmit={submit} noValidate>
        {!isPosto ? (
          <div className="kind-seg" role="tablist">
            {(['entrada', 'saida', 'ajuste'] as const).map((k) => (
              <button type="button" key={k} className={kind === k ? 'is-active' : ''} onClick={() => switchKind(k)}>
                {k === 'entrada' ? 'Entrada' : k === 'saida' ? 'Saída' : 'Ajuste'}
              </button>
            ))}
          </div>
        ) : null}
        <div className="sx-grid" style={{ marginBottom: 12 }}>
          <div className="full">
            <label className="label" htmlFor="q-qty">
              {kind === 'ajuste' ? 'Novo saldo do almoxarifado' : 'Quantidade'}
            </label>
            <input
              id="q-qty"
              className="input"
              inputMode="numeric"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setError('');
              }}
              autoFocus
              placeholder={kind === 'ajuste' ? String(balance) : '1'}
            />
          </div>
          <div className="full">
            <label className="label" htmlFor="q-note">
              Observação <span className="opt-tag">(opcional)</span>
            </label>
            <input
              id="q-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder={
                kind === 'entrada' ? 'Ex.: nota fiscal 1234' : kind === 'ajuste' ? 'Ex.: contagem do inventário' : kind === 'saida' ? 'Ex.: entregue ao colaborador' : ''
              }
            />
          </div>
        </div>
        <div className="qty-preview">
          No almoxarifado: <b>{num(balance)}</b>
          {after !== null && after !== balance ? (
            <>
              {' '}
              → <b>{num(after)}</b>
            </>
          ) : null}
          {isPosto && atPosto !== undefined ? (
            <>
              {' · '}No posto: <b>{num(atPosto)}</b>
              {valid && n !== null ? (
                <>
                  {' '}
                  → <b>{num(Math.max(0, atPosto - n))}</b>
                </>
              ) : null}
            </>
          ) : null}
          {after !== null && after < 0 ? <b style={{ color: 'var(--danger)' }}> (saldo insuficiente)</b> : null}
        </div>
        <ErrorLine text={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : null} Confirmar
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* enviar itens a um posto (vários de uma vez)                         */
/* ------------------------------------------------------------------ */
interface Line {
  item_id: string;
  qty: string;
}

export function SendModal({
  postos,
  items,
  posto,
  initialItemId,
  onClose,
  onSaved,
}: {
  postos: Posto[];
  items: StockItem[];
  /** posto fixo (quando aberto de dentro de um posto) */
  posto?: Posto;
  initialItemId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [postoId, setPostoId] = useState(posto?.id ?? '');
  const [lines, setLines] = useState<Line[]>(initialItemId ? [{ item_id: initialItemId, qty: '1' }] : []);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const taken = useMemo(() => new Set(lines.map((l) => l.item_id)), [lines]);
  const options = useMemo(() => {
    const t = fold(q.trim());
    return items
      .filter((i) => i.quantity > 0 && !taken.has(i.id) && (!t || fold(itemLabel(i)).includes(t)))
      .slice(0, 40);
  }, [items, taken, q]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const add = (id: string) => {
    setLines((l) => [...l, { item_id: id, qty: '1' }]);
    setQ('');
    setOpenList(false);
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postoId) return setError('Escolha o posto de destino.');
    if (!lines.length) return setError('Adicione pelo menos um item.');
    const payload: { item_id: string; quantity: number }[] = [];
    for (const l of lines) {
      const it = byId.get(l.item_id);
      const n = Number(l.qty);
      if (!it) return setError('Um dos itens não existe mais. Remova-o da lista.');
      if (!Number.isInteger(n) || n < 1) return setError(`Informe a quantidade de "${itemLabel(it)}".`);
      if (n > it.quantity) return setError(`"${itemLabel(it)}": há apenas ${num(it.quantity)} no almoxarifado.`);
      payload.push({ item_id: l.item_id, quantity: n });
    }
    setBusy(true);
    try {
      const j = await api<{ items: number; units: number }>('/api/admin/stock/transfer', {
        method: 'POST',
        json: { posto_id: postoId, lines: payload, note },
      });
      const dest = postos.find((p) => p.id === postoId)?.name ?? 'o posto';
      toast({ kind: 'success', title: `Enviado para ${dest}`, text: `${num(j.units)} unidade${j.units === 1 ? '' : 's'} em ${num(j.items)} ite${j.items === 1 ? 'm' : 'ns'}` });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const total = lines.reduce((a, l) => a + (Number.isInteger(Number(l.qty)) ? Number(l.qty) : 0), 0);

  return (
    <Sheet
      title="Transferir para posto"
      lead="Tira do almoxarifado e coloca no estoque do posto. Se algum item não tiver saldo, nada é enviado."
      onClose={onClose}
      locked
    >
      <form onSubmit={submit} noValidate>
        <label className="label" htmlFor="s-posto">
          Posto de destino
        </label>
        <div className="select-wrap" style={{ marginBottom: 16 }}>
          <select
            id="s-posto"
            className="select"
            value={postoId}
            onChange={(e) => {
              setPostoId(e.target.value);
              setError('');
            }}
            disabled={Boolean(posto)}
            data-empty={postoId ? undefined : ''}
          >
            <option value="">{postos.length ? 'Escolha o posto' : 'Nenhum posto cadastrado'}</option>
            {postos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={18} />
        </div>

        <label className="label" htmlFor="s-search">
          Itens
        </label>
        <div className="picker" ref={pickerRef}>
          <div className="search" style={{ margin: 0 }}>
            <Search size={17} />
            <input
              id="s-search"
              className="input"
              placeholder="Buscar item para adicionar"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpenList(true);
              }}
              onFocus={() => setOpenList(true)}
              autoComplete="off"
            />
          </div>
          {openList ? (
            <div className="picker-list">
              {options.length ? (
                options.map((i) => (
                  <button type="button" key={i.id} onClick={() => add(i.id)}>
                    <span>{itemLabel(i)}</span>
                    <small>{num(i.quantity)} disp.</small>
                  </button>
                ))
              ) : (
                <div className="picker-empty">{q ? 'Nenhum item com saldo encontrado.' : 'Todos os itens com saldo já foram adicionados.'}</div>
              )}
            </div>
          ) : null}
        </div>

        <div className="line-list">
          <AnimatePresence initial={false}>
            {lines.map((l) => {
              const it = byId.get(l.item_id);
              return (
                <motion.div
                  key={l.item_id}
                  className="line-row"
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
                >
                  <div style={{ minWidth: 0 }}>
                    <b>{it ? itemLabel(it) : 'Item removido'}</b>
                    <small>{it ? `${num(it.quantity)} disponíve${it.quantity === 1 ? 'l' : 'is'}` : ''}</small>
                  </div>
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Quantidade de ${it ? itemLabel(it) : 'item'}`}
                    value={l.qty}
                    onChange={(e) => {
                      setLines((ls) => ls.map((x) => (x.item_id === l.item_id ? { ...x, qty: e.target.value } : x)));
                      setError('');
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remover da lista"
                    onClick={() => setLines((ls) => ls.filter((x) => x.item_id !== l.item_id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!lines.length ? <div className="empty-line">Nenhum item na lista ainda.</div> : null}
        </div>

        <label className="label" htmlFor="s-note">
          Observação <span className="opt-tag">(opcional)</span>
        </label>
        <input id="s-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} style={{ marginBottom: 16 }} placeholder="Ex.: reposição de fardamento" />
        <ErrorLine text={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !lines.length}>
            {busy ? <span className="spinner" /> : <Send size={17} />} Transferir{total ? ` ${num(total)}` : ''}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* novo posto / editar posto                                           */
/* ------------------------------------------------------------------ */
export function PostoFormModal({
  posto,
  onClose,
  onSaved,
}: {
  posto: Posto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [many, setMany] = useState(false);
  const [f, setF] = useState({
    name: posto?.name ?? '',
    code: posto?.code ?? '',
    city: posto?.city ?? '',
    address: posto?.address ?? '',
    supervisor: posto?.supervisor ?? '',
    notes: posto?.notes ?? '',
  });
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (many) {
        if (!names.trim()) {
          setBusy(false);
          return setError('Digite pelo menos um nome.');
        }
        const j = await api<{ added: number; duplicates: number }>('/api/admin/postos', { method: 'POST', json: { names } });
        toast({
          kind: j.added ? 'success' : 'info',
          title: j.added ? `${j.added} posto${j.added > 1 ? 's' : ''} adicionado${j.added > 1 ? 's' : ''}` : 'Nenhum posto novo',
          text: j.duplicates ? `${j.duplicates} já existia${j.duplicates > 1 ? 'm' : ''}` : undefined,
        });
      } else {
        if (!f.name.trim()) {
          setBusy(false);
          return setError('Dê um nome ao posto.');
        }
        if (posto) await api(`/api/admin/postos/${posto.id}`, { method: 'PATCH', json: f });
        else await api('/api/admin/postos', { method: 'POST', json: f });
        toast({ kind: 'success', title: posto ? 'Posto atualizado' : 'Posto adicionado', text: f.name.trim() });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet title={posto ? 'Editar posto' : many ? 'Adicionar vários postos' : 'Novo posto'} onClose={onClose} locked>
      <form onSubmit={submit} noValidate>
        {!posto ? (
          <div className="kind-seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button type="button" className={!many ? 'is-active' : ''} onClick={() => setMany(false)}>
              Um posto
            </button>
            <button type="button" className={many ? 'is-active' : ''} onClick={() => setMany(true)}>
              Vários de uma vez
            </button>
          </div>
        ) : null}
        {many ? (
          <div style={{ marginBottom: 18 }}>
            <label className="label" htmlFor="p-names">
              Nomes dos postos
            </label>
            <span className="help">Um por linha. Os que já existem são ignorados.</span>
            <textarea id="p-names" className="textarea" value={names} onChange={(e) => { setNames(e.target.value); setError(''); }} placeholder={'Posto Centro\nPosto Norte\nPosto Sul'} autoFocus />
          </div>
        ) : (
          <div className="sx-grid">
            <div className="full">
              <label className="label" htmlFor="p-name">
                Nome do posto <span className="req">*</span>
              </label>
              <input id="p-name" className="input" value={f.name} onChange={set('name')} maxLength={120} autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="p-code">
                Código <span className="opt-tag">(opcional)</span>
              </label>
              <input id="p-code" className="input" value={f.code} onChange={set('code')} maxLength={40} />
            </div>
            <div>
              <label className="label" htmlFor="p-city">
                Cidade <span className="opt-tag">(opcional)</span>
              </label>
              <input id="p-city" className="input" value={f.city} onChange={set('city')} maxLength={80} />
            </div>
            <div className="full">
              <label className="label" htmlFor="p-addr">
                Endereço <span className="opt-tag">(opcional)</span>
              </label>
              <input id="p-addr" className="input" value={f.address} onChange={set('address')} maxLength={200} />
            </div>
            <div className="full">
              <label className="label" htmlFor="p-sup">
                Supervisor <span className="opt-tag">(opcional)</span>
              </label>
              <input id="p-sup" className="input" value={f.supervisor} onChange={set('supervisor')} maxLength={120} />
            </div>
            <div className="full">
              <label className="label" htmlFor="p-notes">
                Observações <span className="opt-tag">(opcional)</span>
              </label>
              <textarea id="p-notes" className="textarea" value={f.notes} onChange={set('notes')} maxLength={400} />
            </div>
          </div>
        )}
        <ErrorLine text={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Plus size={18} />} {posto ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function IconClose({ onClick, label = 'Fechar' }: { onClick: () => void; label?: string }) {
  return (
    <button className="icon-btn" onClick={onClick} aria-label={label}>
      <X size={19} />
    </button>
  );
}
