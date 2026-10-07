'use client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Posto, StockItem, StockMovement } from '@/lib/types';
import { compareItems, downloadCsv, fold, isLow, itemLabel, money, num, refLabel } from '@/lib/stockFormat';
import { useToast } from '../Toasts';
import { api } from './api';
import { ImportDialog } from './ImportDialog';
import { ConfirmModal } from './Modal';
import { MovementFeed, MovementRow } from './Movements';
import { LoadError } from './LoadError';
import { ItemFormModal, QtyModal, SendModal, type QtyKind } from './StockModals';
import './estoque.css';

type Filter = 'todos' | 'baixo' | 'zerado' | 'postos';
type SortKey = 'nome' | 'menor' | 'maior' | 'valor' | 'recente';
const PAGE = 150;

export function Estoque({
  items,
  postos,
  reload,
  version,
  failed,
}: {
  items: StockItem[] | null;
  postos: Posto[] | null;
  reload: () => Promise<void>;
  version: number;
  failed?: boolean;
}) {
  const [view, setView] = useState<'itens' | 'historico'>('itens');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [sort, setSort] = useState<SortKey>('nome');
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: StockItem | null } | null>(null);
  const [qty, setQty] = useState<{ itemId: string; kind: QtyKind } | null>(null);
  const [send, setSend] = useState<{ itemId?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [del, setDel] = useState<StockItem | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const toast = useToast();

  const list = items ?? [];
  const stats = useMemo(() => {
    let almox = 0;
    let atPostos = 0;
    let value = 0;
    let low = 0;
    let zero = 0;
    let inPostos = 0;
    for (const i of list) {
      almox += i.quantity;
      atPostos += i.at_postos;
      if (i.cost !== null) value += i.quantity * i.cost;
      if (isLow(i)) low++;
      if (i.quantity === 0) zero++;
      if (i.at_postos > 0) inPostos++;
    }
    return { almox, atPostos, value, low, zero, inPostos };
  }, [list]);

  const shown = useMemo(() => {
    const t = fold(query.trim());
    const out = list.filter((i) => {
      if (filter === 'baixo' && !isLow(i)) return false;
      if (filter === 'zerado' && i.quantity !== 0) return false;
      if (filter === 'postos' && i.at_postos <= 0) return false;
      if (!t) return true;
      return fold(`${i.name} ${i.size ?? ''} ${i.unit} ${refLabel(i.ref)}`).includes(t);
    });
    const cmp: Record<SortKey, (a: StockItem, b: StockItem) => number> = {
      nome: compareItems,
      menor: (a, b) => a.quantity - b.quantity || compareItems(a, b),
      maior: (a, b) => b.quantity - a.quantity || compareItems(a, b),
      valor: (a, b) => b.quantity * (b.cost ?? 0) - a.quantity * (a.cost ?? 0) || compareItems(a, b),
      recente: (a, b) => b.created_at.localeCompare(a.created_at) || compareItems(a, b),
    };
    return out.sort(cmp[sort]);
  }, [list, query, filter, sort]);

  useEffect(() => setLimit(PAGE), [query, filter, sort]);

  const exportCsv = () => {
    const rows = [...list].sort(compareItems).map((i) => [
      refLabel(i.ref),
      i.name,
      i.size ?? '',
      i.unit,
      i.quantity,
      i.at_postos,
      i.quantity + i.at_postos,
      i.min_quantity,
      i.cost === null ? '' : String(i.cost).replace('.', ','),
      i.cost === null ? '' : String(Math.round(i.quantity * i.cost * 100) / 100).replace('.', ','),
    ]);
    downloadCsv(`estoque-${new Date().toISOString().slice(0, 10)}.csv`, ['Ref', 'Item', 'Tamanho', 'Unidade', 'Almoxarifado', 'Nos postos', 'Total', 'Mínimo', 'Custo unitário', 'Valor em estoque'], rows);
  };

  const openItem = openId ? list.find((i) => i.id === openId) ?? null : null;
  const qtyItem = qty ? list.find((i) => i.id === qty.itemId) ?? null : null;

  // se o item aberto for excluído por outra pessoa, fecha a gaveta
  useEffect(() => {
    if (openId && items && !items.some((i) => i.id === openId)) setOpenId(null);
  }, [items, openId]);

  const FILTERS: { id: Filter; label: string; n: number }[] = [
    { id: 'todos', label: 'Todos', n: list.length },
    { id: 'baixo', label: 'Estoque baixo', n: stats.low },
    { id: 'zerado', label: 'Sem saldo', n: stats.zero },
    { id: 'postos', label: 'Nos postos', n: stats.inPostos },
  ];

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Estoque</h1>
            <p>Tudo o que está no almoxarifado e o que já foi enviado aos postos, em um só lugar.</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              <FileUp size={18} /> Importar planilha
            </button>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!list.length}>
              <Download size={18} /> Exportar
            </button>
            <button className="btn btn-ghost" onClick={() => setSend({})} disabled={!items || !postos}>
              <Send size={17} /> Transferir
            </button>
            <button className="btn btn-primary" onClick={() => setForm({ item: null })}>
              <Plus size={18} /> Novo item
            </button>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <small>Itens cadastrados</small>
            <b>{items ? num(list.length) : '…'}</b>
          </div>
          <div className="stat">
            <small>Unidades no almoxarifado</small>
            <b>{items ? num(stats.almox) : '…'}</b>
          </div>
          <div className="stat">
            <small>Unidades nos postos</small>
            <b>{items ? num(stats.atPostos) : '…'}</b>
          </div>
          <div className="stat">
            <small>Valor no almoxarifado</small>
            <b>{items ? money(stats.value) : '…'}</b>
          </div>
        </div>

        {stats.low > 0 && filter !== 'baixo' ? (
          <div className="banner">
            <AlertTriangle size={20} color="var(--amber)" />
            <span>
              {stats.low} {stats.low === 1 ? 'item chegou' : 'itens chegaram'} ao estoque mínimo ou abaixo.
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setView('itens'); setFilter('baixo'); }}>
              Ver itens
            </button>
          </div>
        ) : null}

        <div className="toolbar">
          <div className="filter-seg" role="tablist" aria-label="Seção">
            <button className={view === 'itens' ? 'is-active' : ''} onClick={() => setView('itens')}>
              Itens
            </button>
            <button className={view === 'historico' ? 'is-active' : ''} onClick={() => setView('historico')}>
              Histórico
            </button>
          </div>
          {view === 'itens' ? (
            <>
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar por nome, tamanho ou ref." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar itens" />
              </div>
              <div className="select-wrap">
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar por">
                  <option value="nome">Nome (A–Z)</option>
                  <option value="menor">Menor saldo primeiro</option>
                  <option value="maior">Maior saldo primeiro</option>
                  <option value="valor">Maior valor em estoque</option>
                  <option value="recente">Cadastrados recentemente</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </>
          ) : null}
        </div>

        {view === 'itens' ? (
          <>
            <div className="filter-seg" style={{ marginBottom: 14 }}>
              {FILTERS.map((f) => (
                <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
                  {f.label} <em>{num(f.n)}</em>
                </button>
              ))}
            </div>

            {items === null && failed ? (
              <LoadError what="o estoque" />
            ) : items === null ? (
              <div className="stock-table">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 58, borderRadius: 0 }} />
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">
                <span className="empty-icon">
                  <PackageSearch size={24} />
                </span>
                <strong>{list.length === 0 ? 'O estoque está vazio' : 'Nada encontrado'}</strong>
                <span>
                  {list.length === 0
                    ? 'Cadastre o primeiro item ou importe a planilha do estoque.'
                    : 'Tente outro termo ou mude o filtro.'}
                </span>
              </div>
            ) : (
              <div className="stock-table">
                <div className="stock-row head" aria-hidden>
                  <span>Item</span>
                  <span className="num">Almoxarifado</span>
                  <span className="num">Nos postos</span>
                  <span className="num">Mínimo</span>
                  <span className="num">Custo</span>
                  <span />
                </div>
                {shown.slice(0, limit).map((i) => (
                  <button key={i.id} className="stock-row" onClick={() => setOpenId(i.id)} aria-label={`Abrir ${itemLabel(i)}`}>
                    <span className="stock-name">
                      <b title={i.name}>{i.name}</b>
                      <small>
                        {[i.size ? `Tam. ${i.size}` : null, i.unit, `Ref. ${refLabel(i.ref)}`].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    <span className={`num c-almox qty${i.quantity === 0 ? ' zero' : isLow(i) ? ' low' : ''}`}>
                      {isLow(i) ? <AlertTriangle size={14} aria-label="Estoque baixo" /> : null}
                      {num(i.quantity)}
                    </span>
                    <span className="num mut c-hide">{num(i.at_postos)}</span>
                    <span className="num mut c-hide">{i.min_quantity ? num(i.min_quantity) : '—'}</span>
                    <span className="num mut c-hide">{money(i.cost)}</span>
                    <span className="c-meta">
                      <span>Postos: {num(i.at_postos)}</span>
                      {i.min_quantity ? <span>Mín.: {num(i.min_quantity)}</span> : null}
                      <span>{money(i.cost)}</span>
                    </span>
                    <ChevronRight size={18} className="row-chevron" />
                  </button>
                ))}
                {shown.length > limit ? (
                  <div className="more-row">
                    <button className="btn btn-ghost btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                      Mostrar mais ({num(shown.length - limit)})
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            {items && shown.length ? (
              <p className="help" style={{ marginTop: 12 }}>
                {num(shown.length)} {shown.length === 1 ? 'item' : 'itens'}
                {shown.length !== list.length ? ` de ${num(list.length)}` : ''}. Toque em um item para movimentar, editar ou ver onde ele está.
              </p>
            ) : null}
          </>
        ) : (
          <div className="panel">
            <MovementFeed version={version} />
          </div>
        )}
      </div>

      <AnimatePresence>
        {openItem ? (
          <ItemDrawer
            key="drawer"
            item={openItem}
            version={version}
            onClose={() => setOpenId(null)}
            onQty={(kind) => setQty({ itemId: openItem.id, kind })}
            onSend={() => setSend({ itemId: openItem.id })}
            onEdit={() => setForm({ item: openItem })}
            onDelete={() => setDel(openItem)}
            modalOpen={Boolean(form || qty || send || importing || del)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {form ? <ItemFormModal key="form" item={form.item} onClose={() => setForm(null)} onSaved={reload} /> : null}
        {qty && qtyItem ? (
          <QtyModal key="qty" item={qtyItem} kind={qty.kind} onClose={() => setQty(null)} onSaved={reload} />
        ) : null}
        {send && items && postos ? (
          <SendModal key="send" items={items} postos={postos} initialItemId={send.itemId} onClose={() => setSend(null)} onSaved={reload} />
        ) : null}
        {importing ? <ImportDialog key="imp" kind="itens" onClose={() => setImporting(false)} onDone={reload} /> : null}
      </AnimatePresence>

      <ConfirmModal
        open={Boolean(del)}
        title="Excluir este item?"
        text={
          del
            ? `"${itemLabel(del)}" sai do estoque${del.quantity + del.at_postos > 0 ? ` (${num(del.quantity + del.at_postos)} unidade${del.quantity + del.at_postos === 1 ? '' : 's'} no total, contando os postos)` : ''}. O histórico fica guardado. Não dá para desfazer.`
            : ''
        }
        confirmLabel="Excluir"
        danger
        busy={delBusy}
        onConfirm={async () => {
          if (!del) return;
          setDelBusy(true);
          try {
            await api(`/api/admin/stock/${del.id}`, { method: 'DELETE' });
            toast({ kind: 'success', title: 'Item excluído', text: itemLabel(del) });
            setOpenId(null);
            setDel(null);
            reload();
          } catch (err) {
            toast({ kind: 'error', title: 'Não foi possível excluir', text: (err as Error).message });
          } finally {
            setDelBusy(false);
          }
        }}
        onClose={() => !delBusy && setDel(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* gaveta de detalhes do item                                          */
/* ------------------------------------------------------------------ */
function ItemDrawer({
  item,
  version,
  onClose,
  onQty,
  onSend,
  onEdit,
  onDelete,
  modalOpen,
}: {
  item: StockItem;
  version: number;
  onClose: () => void;
  onQty: (k: QtyKind) => void;
  onSend: () => void;
  onEdit: () => void;
  onDelete: () => void;
  modalOpen: boolean;
}) {
  const [detail, setDetail] = useState<{ at_postos: { posto_id: string; posto_name: string; quantity: number }[]; movements: StockMovement[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api(`/api/admin/stock/${item.id}`));
    } catch {
      /* mantém o que já está na tela */
    }
  }, [item.id]);
  useEffect(() => {
    load();
  }, [load, version, item.quantity, item.at_postos]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen]);

  const low = isLow(item);
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={itemLabel(item)}
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2>{item.name}</h2>
            <p>
              {[item.size ? `Tam. ${item.size}` : null, item.unit, `Ref. ${refLabel(item.ref)}`].filter(Boolean).join(' · ')}
              {low ? (
                <>
                  {' '}
                  <span className="badge">
                    <AlertTriangle size={12} /> Estoque baixo
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats">
            <div>
              <small>Almoxarifado</small>
              <b style={{ color: low ? 'var(--amber)' : undefined }}>{num(item.quantity)}</b>
            </div>
            <div>
              <small>Nos postos</small>
              <b>{num(item.at_postos)}</b>
            </div>
            <div>
              <small>Total</small>
              <b>{num(item.quantity + item.at_postos)}</b>
            </div>
          </div>

          <div className="drawer-actions">
            <button className="btn btn-primary btn-sm" onClick={onSend} disabled={item.quantity < 1}>
              <Send size={15} /> Enviar a posto
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onQty('entrada')}>
              <ArrowDownToLine size={15} /> Entrada
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onQty('saida')} disabled={item.quantity < 1}>
              <ArrowUpFromLine size={15} /> Saída
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onQty('ajuste')}>
              <SlidersHorizontal size={15} /> Ajustar saldo
            </button>
          </div>

          <div>
            <h3 className="sec-title">Dados</h3>
            <div className="kv-row">
              <span>Estoque mínimo</span>
              <b>{item.min_quantity ? num(item.min_quantity) : 'Não definido'}</b>
            </div>
            <div className="kv-row">
              <span>Custo unitário</span>
              <b>{money(item.cost)}</b>
            </div>
            <div className="kv-row">
              <span>Valor no almoxarifado</span>
              <b>{item.cost === null ? '—' : money(item.quantity * item.cost)}</b>
            </div>
          </div>

          <div>
            <h3 className="sec-title">Nos postos</h3>
            {detail === null ? (
              <div className="skeleton" style={{ height: 44 }} />
            ) : detail.at_postos.length === 0 ? (
              <div className="empty-line">Nenhum posto tem este item no momento.</div>
            ) : (
              detail.at_postos.map((p) => (
                <div className="kv-row" key={p.posto_id}>
                  <span>{p.posto_name}</span>
                  <b>{num(p.quantity)}</b>
                </div>
              ))
            )}
          </div>

          <div>
            <h3 className="sec-title">Últimas movimentações</h3>
            {detail === null ? (
              <div className="skeleton" style={{ height: 80 }} />
            ) : detail.movements.length === 0 ? (
              <div className="empty-line">Sem movimentações registradas.</div>
            ) : (
              detail.movements.slice(0, 15).map((m) => <MovementRow key={m.id} m={m} showItem={false} />)
            )}
          </div>

          <div className="drawer-actions" style={{ marginTop: 'auto' }}>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>
              <Pencil size={15} /> Editar dados
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              <Trash2 size={15} /> Excluir item
            </button>
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}
