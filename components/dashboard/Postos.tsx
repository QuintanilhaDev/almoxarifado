'use client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  Download,
  FileUp,
  MapPin,
  PackageMinus,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Posto, PostoStockLine, StockItem } from '@/lib/types';
import { downloadCsv, fold, itemLabel, num } from '@/lib/stockFormat';
import type { FormField } from '@/lib/types';
import { useToast } from '../Toasts';
import { api } from './api';
import { ImportDialog } from './ImportDialog';
import { ConfirmModal } from './Modal';
import { MovementFeed } from './Movements';
import { LoadError } from './LoadError';
import { PostoFormModal, QtyModal, SendModal } from './StockModals';
import './estoque.css';

const keyOf = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

export function Postos({
  postos,
  items,
  reload,
  version,
  failed,
}: {
  postos: Posto[] | null;
  items: StockItem[] | null;
  reload: () => Promise<void>;
  version: number;
  failed?: boolean;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ posto: Posto | null } | null>(null);
  const [send, setSend] = useState<{ posto?: Posto } | null>(null);
  const [importing, setImporting] = useState(false);
  const [del, setDel] = useState<Posto | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [formOptions, setFormOptions] = useState<string[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [syncAsk, setSyncAsk] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [qty, setQty] = useState<{ posto: Posto; line: PostoStockLine; kind: 'devolucao' | 'baixa_posto' } | null>(null);

  const list = postos ?? [];

  const loadForm = useCallback(() => {
    api<{ fields: FormField[] }>('/api/form')
      .then((j) => setFormOptions(j.fields.find((f) => f.system === 'posto')?.options ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadForm();
  }, [loadForm, version, postos?.length]);

  const shown = useMemo(() => {
    const t = fold(query.trim());
    return list
      .filter((p) => !t || fold([p.name, p.code, p.city, p.address, p.supervisor].filter(Boolean).join(' ')).includes(t))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true }));
  }, [list, query]);

  const totals = useMemo(() => list.reduce((a, p) => ({ units: a.units + p.units, items: a.items + p.items_count }), { units: 0, items: 0 }), [list]);

  // ---- ligação com o formulário ----
  const formDiff = useMemo(() => {
    if (!postos || formOptions === null) return null;
    const a = new Set(postos.map((p) => keyOf(p.name)));
    const b = new Set(formOptions.map(keyOf));
    const missingInForm = [...a].filter((k) => !b.has(k)).length;
    const extraInForm = [...b].filter((k) => !a.has(k)).length;
    return { missingInForm, extraInForm };
  }, [postos, formOptions]);

  const syncToForm = async () => {
    setSyncBusy(true);
    try {
      const j = await api<{ count: number }>('/api/admin/postos/sync-form', { method: 'POST', json: { mode: 'to-form' } });
      toast({ kind: 'success', title: 'Formulário atualizado', text: `O campo Posto agora tem ${j.count} opç${j.count === 1 ? 'ão' : 'ões'}` });
      setSyncAsk(false);
      loadForm();
    } catch (err) {
      toast({ kind: 'error', title: 'Não foi possível atualizar', text: (err as Error).message });
    } finally {
      setSyncBusy(false);
    }
  };
  const fromForm = async () => {
    setSyncBusy(true);
    try {
      const j = await api<{ added: number }>('/api/admin/postos/sync-form', { method: 'POST', json: { mode: 'from-form' } });
      toast({ kind: j.added ? 'success' : 'info', title: j.added ? `${j.added} posto${j.added > 1 ? 's' : ''} trazido${j.added > 1 ? 's' : ''} do formulário` : 'Nada novo para trazer' });
      reload();
    } catch (err) {
      toast({ kind: 'error', title: 'Não foi possível trazer', text: (err as Error).message });
    } finally {
      setSyncBusy(false);
    }
  };

  const removePosto = async () => {
    if (!del) return;
    setDelBusy(true);
    try {
      const j = await api<{ returned: number }>(`/api/admin/postos/${del.id}`, { method: 'DELETE' });
      toast({
        kind: 'success',
        title: 'Posto removido',
        text: j.returned ? `${num(j.returned)} unidade${j.returned === 1 ? '' : 's'} voltaram para o almoxarifado` : del.name,
      });
      setOpenId(null);
      setDel(null);
      reload();
    } catch (err) {
      toast({ kind: 'error', title: 'Não foi possível remover', text: (err as Error).message });
    } finally {
      setDelBusy(false);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      `postos-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Posto', 'Código', 'Cidade', 'Endereço', 'Responsável', 'Itens diferentes', 'Unidades'],
      [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })).map((p) => [p.name, p.code ?? '', p.city ?? '', p.address ?? '', p.supervisor ?? '', p.items_count, p.units]),
    );

  const openPosto = openId ? list.find((p) => p.id === openId) ?? null : null;
  useEffect(() => {
    if (openId && postos && !postos.some((p) => p.id === openId)) setOpenId(null);
  }, [postos, openId]);

  const showFormBanner = !dismissed && postos && formOptions !== null;
  const bannerFromForm = showFormBanner && list.length === 0 && formOptions!.length > 0;
  const bannerToForm = showFormBanner && list.length > 0 && formDiff && (formDiff.missingInForm > 0 || formDiff.extraInForm > 0);

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Postos</h1>
            <p>Os postos da empresa e o que cada um tem em estoque. Transfira itens, adicione ou remova postos e importe uma lista por planilha.</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              <FileUp size={18} /> Importar planilha
            </button>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!list.length}>
              <Download size={18} /> Exportar
            </button>
            <button className="btn btn-ghost" onClick={() => setSend({})} disabled={!items || !postos || !list.length}>
              <Send size={17} /> Transferir
            </button>
            <button className="btn btn-primary" onClick={() => setForm({ posto: null })}>
              <Plus size={18} /> Novo posto
            </button>
          </div>
        </div>

        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="stat">
            <small>Postos</small>
            <b>{postos ? num(list.length) : '…'}</b>
          </div>
          <div className="stat">
            <small>Unidades nos postos</small>
            <b>{postos ? num(totals.units) : '…'}</b>
          </div>
          <div className="stat">
            <small>Postos com estoque</small>
            <b>{postos ? num(list.filter((p) => p.units > 0).length) : '…'}</b>
          </div>
        </div>

        {bannerFromForm ? (
          <div className="banner">
            <Building2 size={20} color="var(--lilac)" />
            <span>O formulário de solicitações já lista {formOptions!.length} posto{formOptions!.length > 1 ? 's' : ''}. Quer trazê-los para cá?</span>
            <button className="btn btn-primary btn-sm" onClick={fromForm} disabled={syncBusy}>
              {syncBusy ? <span className="spinner" /> : null} Trazer do formulário
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>
              Agora não
            </button>
          </div>
        ) : null}
        {bannerToForm ? (
          <div className="banner">
            <Building2 size={20} color="var(--lilac)" />
            <span>
              A lista de postos do formulário de solicitações não é igual a esta
              {formDiff!.missingInForm ? ` (faltam ${formDiff!.missingInForm})` : ''}
              {formDiff!.extraInForm ? ` (${formDiff!.extraInForm} a mais)` : ''}. Quer atualizá-la?
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => setSyncAsk(true)}>
              Atualizar formulário
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>
              Agora não
            </button>
          </div>
        ) : null}

        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar posto, cidade ou responsável" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar postos" />
          </div>
        </div>

        {postos === null && failed ? (
          <LoadError what="os postos" />
        ) : postos === null ? (
          <div className="posto-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 130 }} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <Building2 size={24} />
            </span>
            <strong>{list.length === 0 ? 'Nenhum posto cadastrado' : 'Nada encontrado'}</strong>
            <span>{list.length === 0 ? 'Adicione um posto ou importe a lista por planilha.' : 'Tente outro termo.'}</span>
          </div>
        ) : (
          <div className="posto-grid">
            <AnimatePresence initial={false}>
              {shown.map((p) => (
                <motion.div
                  key={p.id}
                  layout="position"
                  className="posto-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir ${p.name}`}
                  onClick={() => setOpenId(p.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setOpenId(p.id);
                    }
                  }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="posto-top">
                    <h3>{p.name}</h3>
                    {p.code ? <span className="pill">{p.code}</span> : null}
                  </div>
                  <div className="sub">
                    {[p.city, p.supervisor].filter(Boolean).join(' · ') || 'Sem cidade ou responsável'}
                  </div>
                  <div className="foot">
                    <span className={`badge ${p.units ? 'green' : 'gray'}`}>
                      {p.units ? `${num(p.units)} unid. · ${num(p.items_count)} ite${p.items_count === 1 ? 'm' : 'ns'}` : 'Sem estoque'}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSend({ posto: p });
                      }}
                      disabled={!items}
                    >
                      <Send size={14} /> Enviar itens
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        {postos && shown.length ? (
          <p className="help" style={{ marginTop: 12 }}>
            {num(shown.length)} {shown.length === 1 ? 'posto' : 'postos'}
            {shown.length !== list.length ? ` de ${num(list.length)}` : ''}.
          </p>
        ) : null}
      </div>

      <AnimatePresence>
        {openPosto ? (
          <PostoDrawer
            key="drawer"
            posto={openPosto}
            version={version}
            modalOpen={Boolean(form || send || importing || del || qty || syncAsk)}
            onClose={() => setOpenId(null)}
            onSend={() => setSend({ posto: openPosto })}
            onEdit={() => setForm({ posto: openPosto })}
            onDelete={() => setDel(openPosto)}
            onLine={(line, kind) => setQty({ posto: openPosto, line, kind })}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {form ? <PostoFormModal key="form" posto={form.posto} onClose={() => setForm(null)} onSaved={reload} /> : null}
        {send && items && postos ? (
          <SendModal key="send" items={items} postos={postos} posto={send.posto} onClose={() => setSend(null)} onSaved={reload} />
        ) : null}
        {importing ? <ImportDialog key="imp" kind="postos" onClose={() => setImporting(false)} onDone={reload} /> : null}
        {qty ? (
          <QtyModal
            key="qty"
            item={{ id: qty.line.item_id, name: qty.line.name, size: qty.line.size, quantity: items?.find((i) => i.id === qty.line.item_id)?.quantity ?? 0 }}
            kind={qty.kind}
            posto={{ id: qty.posto.id, name: qty.posto.name }}
            atPosto={qty.line.quantity}
            onClose={() => setQty(null)}
            onSaved={reload}
          />
        ) : null}
      </AnimatePresence>

      <ConfirmModal
        open={Boolean(del)}
        title="Remover este posto?"
        text={
          del
            ? `"${del.name}" será removido da lista.${del.units > 0 ? ` As ${num(del.units)} unidade${del.units === 1 ? '' : 's'} que estão nele voltam para o estoque do almoxarifado.` : ''} Os pedidos antigos não mudam. Não dá para desfazer.`
            : ''
        }
        confirmLabel="Remover posto"
        danger
        busy={delBusy}
        onConfirm={removePosto}
        onClose={() => !delBusy && setDel(null)}
      />
      <ConfirmModal
        open={syncAsk}
        title="Atualizar o formulário?"
        text={`O campo "Posto" do formulário vai listar exatamente os ${list.length} posto${list.length === 1 ? '' : 's'} cadastrados aqui. Quem abrir o formulário vê a lista nova na hora.`}
        confirmLabel="Atualizar formulário"
        busy={syncBusy}
        onConfirm={syncToForm}
        onClose={() => !syncBusy && setSyncAsk(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* gaveta do posto                                                     */
/* ------------------------------------------------------------------ */
function PostoDrawer({
  posto,
  version,
  modalOpen,
  onClose,
  onSend,
  onEdit,
  onDelete,
  onLine,
}: {
  posto: Posto;
  version: number;
  modalOpen: boolean;
  onClose: () => void;
  onSend: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLine: (line: PostoStockLine, kind: 'devolucao' | 'baixa_posto') => void;
}) {
  const [lines, setLines] = useState<PostoStockLine[] | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await api<{ lines: PostoStockLine[] }>(`/api/admin/postos/${posto.id}`);
      setLines(j.lines);
    } catch {
      /* mantém */
    }
  }, [posto.id]);
  useEffect(() => {
    load();
  }, [load, version, posto.units, posto.items_count]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, modalOpen]);

  const filtered = useMemo(() => {
    const t = fold(q.trim());
    return (lines ?? []).filter((l) => !t || fold(itemLabel(l)).includes(t));
  }, [lines, q]);

  const exportLines = () =>
    downloadCsv(
      `estoque-${fold(posto.name).replace(/[^a-z0-9]+/g, '-')}.csv`,
      ['Item', 'Tamanho', 'Unidade', 'Quantidade'],
      (lines ?? []).map((l) => [l.name, l.size ?? '', l.unit, l.quantity]),
    );

  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={posto.name}
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-top">
          <div style={{ minWidth: 0 }}>
            <h2>{posto.name}</h2>
            <p>{[posto.code ? `Código ${posto.code}` : null, posto.city].filter(Boolean).join(' · ') || 'Posto'}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="mini-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div>
              <small>Unidades no posto</small>
              <b>{num(posto.units)}</b>
            </div>
            <div>
              <small>Itens diferentes</small>
              <b>{num(posto.items_count)}</b>
            </div>
          </div>

          <div className="drawer-actions">
            <button className="btn btn-primary btn-sm" onClick={onSend}>
              <Send size={15} /> Enviar itens
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportLines} disabled={!lines?.length}>
              <Download size={15} /> Exportar estoque
            </button>
          </div>

          {posto.address || posto.supervisor || posto.notes ? (
            <div>
              <h3 className="sec-title">Dados</h3>
              {posto.supervisor ? (
                <div className="kv-row">
                  <span>
                    <UserRound size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                    Responsável
                  </span>
                  <b>{posto.supervisor}</b>
                </div>
              ) : null}
              {posto.address ? (
                <div className="kv-row">
                  <span>
                    <MapPin size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                    Endereço
                  </span>
                  <b style={{ textAlign: 'right' }}>{posto.address}</b>
                </div>
              ) : null}
              {posto.notes ? (
                <div className="kv-row">
                  <span>Observações</span>
                  <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{posto.notes}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <h3 className="sec-title">Estoque do posto</h3>
            {lines && lines.length > 6 ? (
              <div className="search" style={{ marginBottom: 8 }}>
                <Search size={17} />
                <input className="input" placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no estoque do posto" />
              </div>
            ) : null}
            {lines === null ? (
              <div className="skeleton" style={{ height: 60 }} />
            ) : filtered.length === 0 ? (
              <div className="empty-line">{lines.length ? 'Nada encontrado.' : 'Este posto ainda não recebeu itens.'}</div>
            ) : (
              filtered.map((l) => (
                <div className="kv-row" key={l.item_id}>
                  <span>
                    {l.name}
                    <small>{[l.size ? `Tam. ${l.size}` : null, l.unit].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="kv-actions">
                    <b>{num(l.quantity)}</b>
                    <button className="icon-btn" title="Devolver ao almoxarifado" aria-label={`Devolver ${itemLabel(l)} ao almoxarifado`} onClick={() => onLine(l, 'devolucao')}>
                      <Undo2 size={16} />
                    </button>
                    <button className="icon-btn" title="Dar baixa (consumido no posto)" aria-label={`Dar baixa em ${itemLabel(l)}`} onClick={() => onLine(l, 'baixa_posto')}>
                      <PackageMinus size={16} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          <div>
            <h3 className="sec-title">Movimentações</h3>
            <MovementFeed postoId={posto.id} version={version} />
          </div>

          <div className="drawer-actions" style={{ marginTop: 'auto' }}>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>
              <Pencil size={15} /> Editar posto
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              <Trash2 size={15} /> Remover posto
            </button>
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}

