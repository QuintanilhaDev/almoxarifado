'use client';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, FileDown, FileSpreadsheet, History, PackageCheck, Plus, Save, Search, Trash2, UserMinus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import { MOTIVOS, ORIGEM, STATUS_DEV, STATUS_LIST, clienteDe, type Desligado, type Devolucao, type ItemEntregue, type StatusDevolucao } from '@/lib/rh/devolucao';
import './desligamento.css';

const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const BADGE: Record<StatusDevolucao, string> = { pendente: 'amber', devolvido: 'green', nao_devolvido: 'red' };
type Escolha = StatusDevolucao | 'fora';

interface Linha {
  key: string;
  source: ItemEntregue['source'];
  item_name: string;
  size: string;
  qty_delivered: number;
  last: string | null;
  datas: string[];
  status: Escolha;
  qty_returned: string;
  returned_at: string;
  notes: string;
}

/* ======================================================================
 * Registrar o desligamento: data, motivo e a conferência de cada item
 * ====================================================================== */
export function DesligarSheet({ c, onClose, onDone }: { c: { id: string; name: string; admitted_at: string | null }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [hoje, setHoje] = useState(new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10));
  const [date, setDate] = useState(hoje);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ itens: ItemEntregue[]; hoje: string }>(`/api/rh/colaboradores/${c.id}/desligamento`)
      .then((j) => {
        setHoje(j.hoje);
        setDate(j.hoje);
        setLinhas(
          j.itens.map((i) => ({
            key: i.key,
            source: i.source,
            item_name: i.item_name,
            size: i.size ?? '',
            qty_delivered: i.qty,
            last: i.last,
            datas: i.datas,
            status: 'pendente',
            qty_returned: '',
            returned_at: '',
            notes: '',
          })),
        );
      })
      .catch((e) => {
        setErro((e as Error).message);
        setLinhas([]);
      });
  }, [c.id]);
  const set = (key: string, p: Partial<Linha>) => setLinhas((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, ...p } : l)));
  const marcarTodos = (s: Escolha) => setLinhas((ls) => (ls ?? []).map((l) => ({ ...l, status: s, qty_returned: s === 'devolvido' ? String(l.qty_delivered || 1) : l.qty_returned })));
  const novo = () =>
    setLinhas((ls) => [...(ls ?? []), { key: `m${Date.now()}`, source: 'manual', item_name: '', size: '', qty_delivered: 1, last: null, datas: [], status: 'pendente', qty_returned: '', returned_at: '', notes: '' }]);
  const conta = useMemo(() => {
    const ls = (linhas ?? []).filter((l) => l.status !== 'fora');
    return { total: ls.length, dev: ls.filter((l) => l.status === 'devolvido').length, pend: ls.filter((l) => l.status === 'pendente').length, nao: ls.filter((l) => l.status === 'nao_devolvido').length };
  }, [linhas]);
  const grupos = useMemo(() => {
    const g = new Map<string, Linha[]>();
    for (const l of linhas ?? []) g.set(l.source, [...(g.get(l.source) ?? []), l]);
    return [...g];
  }, [linhas]);

  const salvar = async () => {
    setErro('');
    if (!date) return setErro('Informe a data do desligamento.');
    const itens = (linhas ?? []).filter((l) => l.status !== 'fora');
    const semNome = itens.find((l) => !l.item_name.trim());
    if (semNome) return setErro('Dê um nome ao item incluído ou remova a linha.');
    setBusy(true);
    try {
      const j = await api<{ pedidosAbertos?: number[] }>(`/api/rh/colaboradores/${c.id}/desligamento`, {
        method: 'POST',
        json: {
          date,
          reason,
          notes,
          items: itens.map((l) => ({
            source: l.source,
            item_name: l.item_name.trim(),
            size: l.size.trim() || null,
            qty_delivered: l.qty_delivered,
            last_delivered_at: l.last,
            status: l.status,
            qty_returned: l.qty_returned ? Number(l.qty_returned) : l.status === 'devolvido' ? l.qty_delivered || 1 : 0,
            returned_at: l.returned_at || (l.status === 'devolvido' ? date : null),
            notes: l.notes.trim() || null,
          })),
        },
      });
      toast({ kind: 'success', title: 'Desligamento registrado', text: conta.pend ? `${conta.pend} item(ns) pendente(s) ficam em Devoluções para acompanhar.` : 'Conferência completa.' }, 8000);
      // pedidos de material ainda abertos para a pessoa: precisam ser cancelados ou concluídos em Pedidos
      if (j.pedidosAbertos?.length)
        toast({ kind: 'info', title: `${j.pedidosAbertos.length} pedido(s) de material em aberto`, text: `Pedido(s) ${j.pedidosAbertos.map((x) => `#${x}`).join(', ')} desta pessoa continuam abertos. Cancele em Pedidos para liberar a reserva do estoque.` }, 15000);
      onDone();
    } catch (e) {
      setErro((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Desligamento · ${c.name}`}
      lead="Confira o que foi entregue e registre a devolução de cada item. O cadastro fica inativo (sai dos alertas), mas o histórico continua disponível."
      onClose={onClose}
      wide
      locked
    >
      <div className="dl-head">
        <label>
          <span className="label">Data do desligamento</span>
          <input className="input" type="date" value={date} max={hoje} min={c.admitted_at ?? undefined} onChange={(e) => setDate(e.target.value)} aria-label="Data do desligamento" />
        </label>
        <label>
          <span className="label">Motivo</span>
          <div className="select-wrap">
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do desligamento">
              <option value="">Não informar</option>
              {MOTIVOS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </label>
        <label className="dl-wide">
          <span className="label">Observações</span>
          <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" aria-label="Observações do desligamento" />
        </label>
      </div>

      <div className="dl-bar">
        <h3>
          <PackageCheck size={16} /> Conferência da devolução
        </h3>
        {linhas?.length ? (
          <span className="dl-all">
            Marcar todos como:
            <button type="button" onClick={() => marcarTodos('devolvido')}>
              devolvido
            </button>
            <button type="button" onClick={() => marcarTodos('pendente')}>
              pendente
            </button>
            <button type="button" onClick={() => marcarTodos('nao_devolvido')}>
              não devolvido
            </button>
          </span>
        ) : null}
      </div>
      {!linhas ? (
        <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
      ) : (
        <>
          {!linhas.length ? <p className="help">Nenhuma entrega registrada para esta pessoa (nem no sistema nem na planilha de controle da Gestão). Inclua abaixo o que ela precisa devolver.</p> : null}
          {grupos.map(([src, ls]) => (
            <div key={src} className="dl-grupo">
              <small className="dl-src">{ORIGEM[src as ItemEntregue['source']]}</small>
              {ls.map((l) => (
                <LinhaItem key={l.key} l={l} set={(p) => set(l.key, p)} remover={l.source === 'manual' ? () => setLinhas((x) => (x ?? []).filter((y) => y.key !== l.key)) : undefined} padrao={date} />
              ))}
            </div>
          ))}
          <button type="button" className="link-btn" onClick={novo} style={{ marginTop: 6 }}>
            <Plus size={14} /> Incluir item (crachá, rádio, colete…)
          </button>
        </>
      )}
      {linhas?.length ? (
        <p className="help dl-resumo">
          {conta.total} item(ns) na conferência: <b className="t-green">{conta.dev} devolvido(s)</b> · <b className="t-amber">{conta.pend} pendente(s)</b> · <b className="t-red">{conta.nao} não devolvido(s)</b>. A
          devolução só fica registrada: o estoque não muda (avaliação e higienização são feitas depois, no controle de estoque).
        </p>
      ) : null}
      {erro ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {erro}
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={salvar} disabled={busy || !linhas} data-max="desligar-confirmar">
          {busy ? <span className="spinner" /> : <UserMinus size={16} />} Registrar desligamento
        </button>
      </div>
    </Sheet>
  );
}

function LinhaItem({ l, set, remover, padrao }: { l: Linha; set: (p: Partial<Linha>) => void; remover?: () => void; padrao: string }) {
  const fora = l.status === 'fora';
  return (
    <div className={`dl-item${fora ? ' is-fora' : ''} st-${l.status}`}>
      <div className="dl-item-nome">
        {l.source === 'manual' ? (
          <span className="dl-manual">
            <input className="input" value={l.item_name} placeholder="Item" onChange={(e) => set({ item_name: e.target.value })} aria-label="Nome do item" />
            <input className="input dl-tam" value={l.size} placeholder="Tam." onChange={(e) => set({ size: e.target.value })} aria-label="Tamanho" />
            <input
              className="input dl-qtd"
              inputMode="numeric"
              value={String(l.qty_delivered)}
              onChange={(e) => set({ qty_delivered: Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0) })}
              aria-label="Quantidade entregue"
            />
          </span>
        ) : (
          <>
            <b>
              {l.qty_delivered}× {l.item_name}
              {l.size ? <em> {l.size}</em> : null}
            </b>
            <small>{l.datas.length > 1 ? `${l.datas.length} entregas · última em ${dataBR(l.last)}` : l.last ? `entregue em ${dataBR(l.last)}` : ''}</small>
          </>
        )}
      </div>
      <div className="dl-st" role="radiogroup" aria-label={`Situação de ${l.item_name || 'item'}`}>
        {(['devolvido', 'pendente', 'nao_devolvido', 'fora'] as Escolha[]).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={l.status === s}
            className={l.status === s ? `is-on s-${s}` : ''}
            onClick={() => set({ status: s, qty_returned: s === 'devolvido' && !l.qty_returned ? String(l.qty_delivered || 1) : l.qty_returned })}
            title={s === 'fora' ? 'Não entra na conferência (ex.: item de consumo, já descartado)' : undefined}
          >
            {s === 'fora' ? 'Não se aplica' : STATUS_DEV[s]}
          </button>
        ))}
      </div>
      {!fora ? (
        <div className="dl-extra">
          {l.status !== 'nao_devolvido' ? (
            <>
              <label>
                <span>Qtd devolvida</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={l.qty_returned}
                  placeholder="0"
                  onChange={(e) => set({ qty_returned: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                  aria-label="Quantidade devolvida"
                />
              </label>
              <label>
                <span>Data</span>
                <input className="input" type="date" value={l.returned_at || (l.status === 'devolvido' ? padrao : '')} onChange={(e) => set({ returned_at: e.target.value })} aria-label="Data da devolução" />
              </label>
            </>
          ) : null}
          <label className="dl-obs">
            <span>Observação</span>
            <input
              className="input"
              value={l.notes}
              maxLength={300}
              placeholder={l.status === 'nao_devolvido' ? 'Ex.: extraviado, descontado na rescisão' : 'Opcional'}
              onChange={(e) => set({ notes: e.target.value })}
              aria-label="Observação do item"
            />
          </label>
          {remover ? (
            <button type="button" className="icon-btn" onClick={remover} aria-label="Remover item">
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ======================================================================
 * Na ficha de quem já saiu: dados do desligamento e a devolução, editável
 * ====================================================================== */
export function DevolucaoFicha({
  c,
  itens,
  canEdit,
  onChange,
}: {
  c: { id: string; dismissed_at?: string | null; dismissal_reason?: string | null; dismissal_notes?: string | null; dismissed_by?: string | null };
  itens: Devolucao[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const [novo, setNovo] = useState(false);
  const pend = itens.filter((i) => i.status === 'pendente').length;
  return (
    <div className="dl-ficha">
      <h3 className="sec-title">Desligamento</h3>
      <div className="kv-row">
        <span>Data</span>
        <b>{dataBR(c.dismissed_at)}</b>
      </div>
      {c.dismissal_reason ? (
        <div className="kv-row">
          <span>Motivo</span>
          <b>{c.dismissal_reason}</b>
        </div>
      ) : null}
      {c.dismissal_notes ? (
        <div className="kv-row">
          <span>Observações</span>
          <b style={{ whiteSpace: 'normal', textAlign: 'right' }}>{c.dismissal_notes}</b>
        </div>
      ) : null}
      {c.dismissed_by ? (
        <div className="kv-row">
          <span>Registrado por</span>
          <b>{c.dismissed_by}</b>
        </div>
      ) : null}
      <h3 className="sec-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Devolução
        {itens.length ? <span className={`pbadge ${pend ? 'amber' : 'green'}`}>{pend ? `${pend} pendente(s)` : 'concluída'}</span> : null}
      </h3>
      {!itens.length ? <div className="empty-line">Nenhum item na conferência.</div> : null}
      {itens.map((i) => (
        <ItemFicha key={i.id} i={i} canEdit={canEdit} onSaved={onChange} />
      ))}
      {canEdit ? (
        novo ? (
          <NovoItem collaboratorId={c.id} onClose={() => setNovo(false)} onSaved={() => (setNovo(false), onChange())} />
        ) : (
          <button type="button" className="link-btn" onClick={() => setNovo(true)}>
            <Plus size={14} /> Incluir item na conferência
          </button>
        )
      ) : null}
    </div>
  );
}

function ItemFicha({ i, canEdit, onSaved }: { i: Devolucao; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [ed, setEd] = useState(false);
  const [f, setF] = useState({ status: i.status, qty_returned: String(i.qty_returned || ''), returned_at: i.returned_at ?? '', notes: i.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try {
      await api(`/api/rh/devolucoes/${i.id}`, { method: 'PATCH', json: { status: f.status, qty_returned: f.qty_returned ? Number(f.qty_returned) : 0, returned_at: f.returned_at || null, notes: f.notes } });
      toast({ kind: 'success', title: 'Devolução atualizada', text: `${i.item_name}: ${STATUS_DEV[f.status].toLowerCase()}` });
      setEd(false);
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível salvar', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`dl-fitem st-${i.status}`}>
      <div className="dl-fitem-top">
        <span>
          <b>
            {i.qty_delivered ? `${i.qty_delivered}× ` : ''}
            {i.item_name}
            {i.size ? <em> {i.size}</em> : null}
          </b>
          <small>
            {i.status === 'devolvido'
              ? `devolveu ${i.qty_returned} em ${dataBR(i.returned_at)}`
              : i.qty_returned
                ? `devolveu ${i.qty_returned} de ${i.qty_delivered}`
                : i.last_delivered_at
                  ? `entregue em ${dataBR(i.last_delivered_at)}`
                  : ORIGEM[i.source]}
            {i.notes ? ` · ${i.notes}` : ''}
          </small>
        </span>
        <span className="dl-fitem-act">
          <span className={`pbadge ${BADGE[i.status]}`}>{STATUS_DEV[i.status]}</span>
          {i.history?.length ? (
            <button type="button" className="icon-btn" onClick={() => setHist((h) => !h)} aria-label="Histórico do item">
              <History size={14} />
            </button>
          ) : null}
          {canEdit && !ed ? (
            <button type="button" className="link-btn" onClick={() => setEd(true)}>
              atualizar
            </button>
          ) : null}
        </span>
      </div>
      {hist ? (
        <ul className="dl-hist">
          {i.history.map((h, k) => (
            <li key={k}>
              {new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {h.by}: {h.what}
            </li>
          ))}
        </ul>
      ) : null}
      {ed ? (
        <div className="dl-fedit">
          <div className="dl-st">
            {STATUS_LIST.map((s) => (
              <button
                key={s}
                type="button"
                className={f.status === s ? `is-on s-${s}` : ''}
                onClick={() => setF((x) => ({ ...x, status: s, qty_returned: s === 'devolvido' && !x.qty_returned ? String(i.qty_delivered || 1) : x.qty_returned, returned_at: s === 'devolvido' && !x.returned_at ? new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10) : x.returned_at }))}
              >
                {STATUS_DEV[s]}
              </button>
            ))}
          </div>
          <div className="dl-extra">
            <label>
              <span>Qtd devolvida</span>
              <input
                className="input"
                inputMode="numeric"
                value={f.qty_returned}
                onChange={(e) => setF((x) => ({ ...x, qty_returned: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                aria-label="Quantidade devolvida"
              />
            </label>
            <label>
              <span>Data</span>
              <input className="input" type="date" value={f.returned_at} onChange={(e) => setF((x) => ({ ...x, returned_at: e.target.value }))} aria-label="Data da devolução" />
            </label>
            <label className="dl-obs">
              <span>Observação</span>
              <input className="input" value={f.notes} maxLength={300} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} aria-label="Observação" />
            </label>
          </div>
          <div className="drawer-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setEd(false)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-primary btn-sm" onClick={salvar} disabled={busy}>
              {busy ? <span className="spinner" /> : <Save size={14} />} Salvar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NovoItem({ collaboratorId, onClose, onSaved }: { collaboratorId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ item_name: '', size: '', qty_delivered: '1', status: 'pendente' as StatusDevolucao, notes: '' });
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!f.item_name.trim()) return toast({ kind: 'error', title: 'Informe o item' });
    setBusy(true);
    try {
      await api('/api/rh/devolucoes', {
        method: 'POST',
        json: { collaborator_id: collaboratorId, item_name: f.item_name, size: f.size || null, qty_delivered: Number(f.qty_delivered) || 0, status: f.status, notes: f.notes },
      });
      onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível incluir', text: (e as Error).message });
      setBusy(false);
    }
  };
  return (
    <div className="dl-fedit">
      <div className="dl-extra">
        <label className="dl-obs">
          <span>Item</span>
          <input className="input" value={f.item_name} onChange={(e) => setF((x) => ({ ...x, item_name: e.target.value }))} placeholder="Ex.: crachá, rádio" aria-label="Item" autoFocus />
        </label>
        <label>
          <span>Tam.</span>
          <input className="input" value={f.size} onChange={(e) => setF((x) => ({ ...x, size: e.target.value }))} aria-label="Tamanho" />
        </label>
        <label>
          <span>Qtd</span>
          <input className="input" inputMode="numeric" value={f.qty_delivered} onChange={(e) => setF((x) => ({ ...x, qty_delivered: e.target.value.replace(/\D/g, '').slice(0, 3) }))} aria-label="Quantidade" />
        </label>
      </div>
      <div className="dl-st">
        {STATUS_LIST.map((s) => (
          <button key={s} type="button" className={f.status === s ? `is-on s-${s}` : ''} onClick={() => setF((x) => ({ ...x, status: s }))}>
            {STATUS_DEV[s]}
          </button>
        ))}
      </div>
      <div className="drawer-actions">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button className="btn btn-primary btn-sm" onClick={salvar} disabled={busy}>
          {busy ? <span className="spinner" /> : <Plus size={14} />} Incluir
        </button>
      </div>
    </div>
  );
}

/* ======================================================================
 * Aba "Devoluções": desligados com itens pendentes, filtros e relatório
 * ====================================================================== */
export function DevolucoesView({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const [lista, setLista] = useState<Desligado[] | null>(null);
  const [erro, setErro] = useState<{ msg: string; setup: boolean } | null>(null);
  const [situacao, setSituacao] = useState<'pendentes' | 'todos'>('pendentes');
  const [cliente, setCliente] = useState('');
  const [posto, setPosto] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('/api/rh/devolucoes', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error ?? 'Não consegui carregar as devoluções.'), { setup: Boolean(j.setup) });
        setLista(j.desligados);
        setErro(null);
      })
      .catch((e) => setErro({ msg: (e as Error).message, setup: Boolean((e as { setup?: boolean }).setup) }));
  }, [version]);

  const clientes = useMemo(() => [...new Set((lista ?? []).map((d) => clienteDe(d)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [lista]);
  const postos = useMemo(
    () =>
      [
        ...new Set(
          (lista ?? [])
            .filter((d) => !cliente || clienteDe(d) === cliente)
            .map((d) => d.posto_name ?? '')
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [lista, cliente],
  );
  const vis = useMemo(() => {
    const t = fold(q.trim());
    return (lista ?? []).filter(
      (d) =>
        (situacao === 'todos' || d.pendentes > 0) &&
        (!cliente || clienteDe(d) === cliente) &&
        (!posto || d.posto_name === posto) &&
        (!t || fold(`${d.name} ${d.matricula ?? ''} ${d.itens.map((i) => i.item_name).join(' ')}`).includes(t)),
    );
  }, [lista, situacao, cliente, posto, q]);
  const totalPend = (lista ?? []).filter((d) => d.pendentes > 0).length;
  const qs = new URLSearchParams({ situacao, ...(cliente ? { cliente } : {}), ...(posto ? { posto } : {}) }).toString();

  if (erro)
    return (
      <div className="empty">
        <span className="empty-icon">
          <AlertCircle size={24} />
        </span>
        <strong>{erro.setup ? 'Falta ativar o desligamento no banco' : 'Não foi possível carregar'}</strong>
        <span>{erro.msg}</span>
      </div>
    );
  if (!lista) return <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />;
  return (
    <div className="dl-view">
      <div className="toolbar dl-filtros">
        <div className="filter-seg" role="tablist" aria-label="Situação">
          <button className={situacao === 'pendentes' ? 'is-active' : ''} onClick={() => setSituacao('pendentes')}>
            Com pendência <em>{num(totalPend)}</em>
          </button>
          <button className={situacao === 'todos' ? 'is-active' : ''} onClick={() => setSituacao('todos')}>
            Todos os desligados <em>{num(lista.length)}</em>
          </button>
        </div>
        <div className="select-wrap">
          <select className="select" value={cliente} onChange={(e) => (setCliente(e.target.value), setPosto(''))} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {clientes.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
        <div className="select-wrap">
          <select className="select" value={posto} onChange={(e) => setPosto(e.target.value)} aria-label="Posto">
            <option value="">Todos os postos</option>
            {postos.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder="Buscar nome, matrícula ou item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar desligados" />
        </div>
        <span className="dl-rel">
          <a className="btn btn-ghost btn-sm" href={`/api/rh/devolucoes/relatorio?format=pdf&${qs}`} data-max="devolucoes-pdf">
            <FileDown size={15} /> Relatório PDF
          </a>
          <a className="btn btn-ghost btn-sm" href={`/api/rh/devolucoes/relatorio?format=xlsx&${qs}`} data-max="devolucoes-xlsx">
            <FileSpreadsheet size={15} /> Excel
          </a>
        </span>
      </div>
      {!vis.length ? (
        <div className="empty">
          <span className="empty-icon">{situacao === 'pendentes' && !cliente && !posto && !q ? <CheckCircle2 size={24} /> : <Search size={24} />}</span>
          <strong>{situacao === 'pendentes' && !cliente && !posto && !q ? 'Nenhuma devolução pendente' : 'Ninguém com esses filtros'}</strong>
          <span>{lista.length ? 'Os desligamentos registrados aparecem aqui, com o que falta devolver.' : 'Registre o desligamento na ficha do colaborador (aba Pessoas).'}</span>
        </div>
      ) : (
        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Cliente · posto</th>
                <th>Desligado em</th>
                <th>Pendente</th>
              </tr>
            </thead>
            <tbody>
              {vis.slice(0, 500).map((d) => {
                const pend = d.itens.filter((i) => i.status === 'pendente');
                return (
                  <tr key={d.id} className="click" onClick={() => onOpen(d.id)}>
                    <td>
                      <b>{d.name}</b>
                      <small>{[d.matricula ? `Matrícula ${d.matricula}` : null, d.role].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>
                      <b>{clienteDe(d) || '—'}</b>
                      <small>{d.posto_name && d.posto_name !== clienteDe(d) ? d.posto_name : ''}</small>
                    </td>
                    <td>
                      {dataBR(d.dismissed_at)}
                      <small>{d.dismissed_at ? `há ${Math.max(0, Math.round((Date.now() - Date.parse(d.dismissed_at)) / 86_400_000))} dias` : ''}</small>
                    </td>
                    <td>
                      {pend.length ? (
                        <>
                          <span className="pbadge amber">
                            <AlertTriangle size={12} /> {pend.length} item(ns)
                          </span>
                          <small>
                            {pend
                              .map((i) => `${i.item_name}${i.size ? ` ${i.size}` : ''}`)
                              .slice(0, 4)
                              .join(', ')}
                            {pend.length > 4 ? '…' : ''}
                          </small>
                        </>
                      ) : d.itens.length ? (
                        <span className="pbadge green">Concluída</span>
                      ) : (
                        <span className="pbadge gray">Sem itens</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="help" style={{ marginTop: 10 }}>
        Desligados não aparecem nos alertas de troca de fardamento nem nos pedidos, mas a ficha continua com todo o histórico.
      </p>
    </div>
  );
}
