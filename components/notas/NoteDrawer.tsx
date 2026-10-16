'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Download, PackageCheck, RotateCcw, ShieldAlert, ShoppingBag } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { formatDateTime } from '@/lib/format';
import { num } from '@/lib/almoxarifado/stockFormat';
import type { FiscalNote } from '@/lib/notas/server';
import { DIV_LABEL, installmentsGap, openBlocking, type Divergence, type Installment } from '@/lib/notas/conferencia';
import { poLabel, type PurchaseOrder } from '@/lib/compras/pc';
import { LinePO } from './LinePO';
import { ItemPicker, brl, dateBR, type PickItem } from '../pedidos/ui';
import { Attachments, Drawer, DrawerTop } from '../compras/pcui';
import { DivergenceSheet } from '../compras/PainelCompras';
import { InstallmentsEditor } from './ReceiveSheet';

type Waiting = { id: string; label: string; who: string | null; lines: { name: string; size: string | null; missing: number }[] };
export const N_STATUS: Record<FiscalNote['status'], { label: string; tone: string }> = {
  aberta: { label: 'NF recebida', tone: 'lilac' },
  conferencia: { label: 'Em conferência', tone: 'blue' },
  divergencia: { label: 'Com divergência', tone: 'red' },
  parcial: { label: 'Recebimento parcial', tone: 'amber' },
  lancada: { label: 'Entrada confirmada', tone: 'green' },
  estornada: { label: 'Estornada', tone: 'gray' },
};
export const noteTotal = (n: FiscalNote) => Number(n.totals?.total ?? n.items.reduce((t, l) => t + (Number(l.total) || 0), 0));

/**
 * Nota fiscal: conferência física por linha (chegou / aceito / recusado), divergências com
 * o pedido, parcelas com a soma conferida e a entrada do que foi aceito.
 */
export function NoteDrawer({
  note: n,
  canEdit,
  canTreat,
  canAuthorize,
  items,
  onClose,
  reload,
  onOrders,
  onOrder,
  modalOpen,
}: {
  note: FiscalNote;
  canEdit: boolean;
  canTreat: boolean;
  canAuthorize: boolean;
  items: PickItem[];
  onClose: () => void;
  reload: () => Promise<void>;
  onOrders?: (orderId?: string) => void;
  onOrder?: (poId: string) => void;
  modalOpen: boolean;
}) {
  const toast = useToast();
  const pc = n.installments_status !== undefined;
  const open = n.status !== 'lancada' && n.status !== 'estornada';
  const edit = canEdit && open;
  const factorOf = (i: number) => n.items[i].factor || 1;
  const [conf, setConf] = useState(() =>
    n.items.map((l, i) => {
      const inv = l.qty * factorOf(i);
      const d = l.delivered ?? inv;
      return { delivered: String(d), refused: String(l.refused ?? 0), note: l.inspection_note ?? '', touched: l.inspected_at && !l.inspection_auto ? true : false };
    }),
  );
  const [links, setLinks] = useState<Record<number, { item_id: string; factor: number }>>({});
  // pedido de cada linha: a nota pode atender vários pedidos do mesmo fornecedor
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [poLinks, setPoLinks] = useState<Record<number, { po_id: string; po_key: string } | null>>({});
  useEffect(() => {
    if (!pc) return;
    api<{ orders?: PurchaseOrder[] }>(`/api/almoxarifado/notas/${n.id}?orders=1`)
      .then((j) => setOrders(j.orders ?? []))
      .catch(() => undefined);
  }, [n.id, n.updated_at, pc]);
  const noteOrders = (n.purchase_order_ids?.length ? n.purchase_order_ids : n.purchase_order_id ? [n.purchase_order_id] : []).map((id) => ({ id, number: orders.find((o) => o.id === id)?.number }));
  const savePo = async (i: number, v: { po_id: string; po_key: string } | null | undefined) => {
    setPoLinks((x) => {
      const y = { ...x };
      if (v === undefined) delete y[i];
      else y[i] = v;
      return y;
    });
    try {
      await api(`/api/almoxarifado/notas/${n.id}`, { method: 'PATCH', json: { po_links: [v === undefined ? { i, auto: true } : { i, po_id: v?.po_id ?? null, po_key: v?.po_key ?? null }] } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const [inst, setInst] = useState<Installment[]>(n.installments);
  const [instDirty, setInstDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reverse, setReverse] = useState(false);
  const [reason, setReason] = useState('');
  const [treat, setTreat] = useState<Divergence | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`waiting:${n.id}`) || '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!instDirty) setInst(n.installments);
  }, [n.installments, instDirty]);
  const label = (id: string | null) => {
    const it = id ? items.find((i) => i.id === id) : null;
    return it ? `${it.name}${it.size ? ' ' + it.size : ''}` : null;
  };
  const total = noteTotal(n);
  const gap = installmentsGap(inst, total);
  const blockers = openBlocking(n.divergences);
  const openDivs = (n.divergences ?? []).filter((d) => d.status !== 'resolvida');
  const instOk = !pc || n.installments_status === 'validada';
  const pendingUnits = useMemo(() => n.items.reduce((t, l, i) => t + Math.max(0, l.qty * factorOf(i) - l.received - (l.refused ?? 0)), 0), [n.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async <T,>(url: string, body: unknown, key: string): Promise<T | null> => {
    setBusy(key);
    setError('');
    try {
      return await api<T>(url, { method: 'POST', json: body });
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** salva a conferência das linhas que mudaram e dá entrada no aceito que falta */
  const confirm = async (enter: boolean) => {
    if (Object.keys(links).length) {
      try {
        await api(`/api/almoxarifado/notas/${n.id}`, { method: 'PATCH', json: { links: Object.entries(links).map(([i, v]) => ({ i: Number(i), item_id: v.item_id, factor: v.factor })) } });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    let cur = n;
    if (pc) {
      const send = n.items.map((l, i) => {
        const d = Number(conf[i].delivered);
        const r = Number(conf[i].refused) || 0;
        return { i, delivered: d, accepted: d - r, refused: r, note: conf[i].note || null };
      });
      // só grava se algo mudou (ou se ainda não houve conferência registrada nesta tela)
      const changed = send.some((x, i) => {
        const l = n.items[i];
        return !l.inspected_at || l.inspection_auto || x.delivered !== l.delivered || x.refused !== (l.refused ?? 0) || (x.note ?? '') !== (l.inspection_note ?? '');
      });
      if (changed) {
        const c = await call<{ note: FiscalNote; blockers: string[] }>(`/api/almoxarifado/notas/${n.id}/conferencia`, { lines: send }, 'conf');
        if (!c) return;
        cur = c.note;
        if (!enter) {
          toast({ kind: 'success', title: 'Conferência salva', text: c.blockers.length ? 'Ainda falta: ' + c.blockers.join('; ') : 'Pronta para dar entrada.' });
          await reload();
          return;
        }
      }
    }
    if (!enter) return;
    const lines = cur.items
      .map((l, i) => ({ i, qty: pc ? (l.accepted ?? 0) - l.received : Math.max(0, Number(conf[i].delivered) - l.received), item_id: links[i]?.item_id ?? l.item_id }))
      .filter((x) => x.qty > 0);
    if (!lines.length) {
      setError('Nada novo para entrar: o aceito já está no estoque.');
      await reload();
      return;
    }
    const r = await call<{ note: FiscalNote; purchase: { number: number } | null; order: { number: number; status: string } | null; waiting: Waiting[] }>(`/api/almoxarifado/notas/${n.id}/post`, { lines }, 'post');
    if (r) {
      toast({ kind: 'success', title: r.note.status === 'lancada' ? 'Entrada confirmada' : 'Entrada parcial confirmada', text: r.order ? `${poLabel(r.order.number)} ${r.order.status === 'concluido' ? 'concluído' : 'com entrega parcial'}` : r.purchase ? `Compra nº ${r.purchase.number} marcada como entregue` : undefined });
      setWaiting(r.waiting);
    }
    await reload();
  };
  const saveInst = async (validate: boolean) => {
    const r = await call<{ note: FiscalNote }>(`/api/almoxarifado/notas/${n.id}/parcelas`, { installments: inst, validate }, 'inst');
    if (r) {
      setInstDirty(false);
      toast({ kind: 'success', title: validate ? 'Parcelas validadas' : 'Parcelas salvas' });
      await reload();
    }
  };

  return (
    <Drawer label={`Nota ${n.number}`} onClose={onClose} wide blockEsc={modalOpen || reverse || Boolean(treat)}>
      <DrawerTop
        title={
          <>
            NF {n.number}
            {n.series ? `/${n.series}` : ''} <span className={`pbadge ${N_STATUS[n.status].tone}`}>{N_STATUS[n.status].label}</span>
            {openDivs.length && n.status !== 'divergencia' ? <span className="pbadge red">{openDivs.length} divergência{openDivs.length > 1 ? 's' : ''}</span> : null}
          </>
        }
        sub={`${n.supplier_name}${n.cnpj ? ` · CNPJ ${n.cnpj}` : ''}`}
        onClose={onClose}
      />
      <div className="drawer-body">
        <div className="mini-stats">
          <div>
            <small>Total</small>
            <b className="p-date">{brl(total)}</b>
          </div>
          <div>
            <small>Emissão</small>
            <b className="p-date">{dateBR(n.issue_date)}</b>
          </div>
          <div>
            <small>{pendingUnits ? 'Falta receber' : 'Recebida'}</small>
            <b className="p-date">{pendingUnits ? num(pendingUnits) : dateBR(n.received_date)}</b>
          </div>
        </div>
        {noteOrders.length && onOrder ? (
          <div className="drawer-actions" style={{ flexWrap: 'wrap' }}>
            {noteOrders.map((o) => (
              <button key={o.id} className="btn btn-ghost btn-sm" onClick={() => onOrder(o.id)}>
                <ShoppingBag size={14} /> {noteOrders.length > 1 ? `Ver o ${o.number ? poLabel(o.number) : 'pedido'}` : 'Ver o pedido de compra'}
              </button>
            ))}
          </div>
        ) : null}
        {noteOrders.length > 1 ? <p className="help">Esta nota atende {noteOrders.length} pedidos de compra: cada linha baixa o seu (veja em cada item).</p> : null}

        {waiting.length ? (
          <div className="o-plan">
            <div className="o-plan-head">
              <PackageCheck size={16} /> <b>Pedidos que esperavam estes itens</b>
            </div>
            {waiting.map((w) => (
              <p key={w.id}>
                <span>
                  {w.label}
                  {w.who ? ` · ${w.who}` : ''}:
                </span>{' '}
                {w.lines.map((l) => `${l.missing} ${l.name}${l.size ? ' ' + l.size : ''}`).join(', ')}
              </p>
            ))}
            {onOrders ? (
              <div className="drawer-actions">
                <button className="btn btn-primary btn-sm" onClick={() => onOrders(waiting[0].id)}>
                  Ir para os pedidos e reservar
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {(n.divergences ?? []).length ? (
          <div>
            <h3 className="sec-title">
              <ShieldAlert size={15} /> Divergências com o pedido
            </h3>
            <div className="pc-divs">
              {(n.divergences ?? []).map((d) => (
                <div key={d.id} className={`pc-div${d.status === 'resolvida' ? ' is-done' : d.blocking ? ' is-block' : ''}`}>
                  <div>
                    <b>{DIV_LABEL[d.kind]}</b>
                    <small>{d.text}</small>
                    {d.status === 'resolvida' ? (
                      <small>
                        <CheckCircle2 size={12} style={{ verticalAlign: '-2px' }} color="var(--mint)" /> {d.decision === 'autorizada' ? 'Autorizada' : 'Tratada'} por {d.by}: {d.resolution}
                      </small>
                    ) : d.blocking ? (
                      <small className="t-short">Trava a entrada até Compras/gestão tratar.</small>
                    ) : (
                      <small>Registrada; não trava a entrada do que foi aceito.</small>
                    )}
                  </div>
                  {d.status !== 'resolvida' && canTreat ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setTreat(d)}>
                      Tratar
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}

        <div>
          <h3 className="sec-title">Itens{edit ? ' · conferência física' : ''}</h3>
          <div className="o-items">
            {n.items.map((l, i) => {
              const inv = l.qty * factorOf(i);
              const left = inv - l.received - (l.refused ?? 0);
              const linked = links[i]?.item_id ?? l.item_id;
              return (
                <div key={i} className={`o-item${!linked ? ' is-check' : ''}`}>
                  <div className="o-item-top">
                    <b>{l.description}</b>
                    <span className={`pbadge ${left <= 0 ? 'green' : l.received ? 'amber' : 'lilac'}`}>{left <= 0 ? 'Recebido' : l.received ? `Faltam ${left}` : 'A receber'}</span>
                  </div>
                  <div className="o-nums">
                    <span>
                      Faturado <b>{num(l.qty)}</b>
                      {factorOf(i) !== 1 ? ` ${l.unit} × ${factorOf(i)} = ${num(inv)}` : ''}
                    </span>
                    {l.inspected_at ? (
                      <span>
                        Aceito <b>{num(l.accepted ?? 0)}</b>
                        {l.refused ? ` · recusado ${l.refused}` : ''}
                      </span>
                    ) : null}
                    <span>
                      No estoque <b>{num(l.received)}</b>
                    </span>
                    <span>
                      Custo <b>{brl(l.unit_cost / factorOf(i))}</b>/un
                    </span>
                  </div>
                  <small className="o-note">
                    {(l.parts ?? 1) > 1 ? `Parte ${l.part} de ${l.parts} da linha (dividida entre pedidos) · ` : ''}
                    {linked ? `Estoque: ${label(linked) ?? 'item ligado'}` : 'Ainda sem item do estoque: escolha abaixo (a próxima nota deste fornecedor já vem ligada).'}
                    {l.via === 'fornecedor' ? ' · reconhecido pelo código do fornecedor' : l.via === 'pedido' ? ' · reconhecido pelo código no pedido de compra' : ''}
                  </small>
                  {pc && (orders.length || l.po_id) ? (
                    <LinePO
                      parts={[l]}
                      orders={orders}
                      itemId={linked}
                      value={i in poLinks ? poLinks[i] : l.po_lock ? (l.po_id && l.po_key ? { po_id: l.po_id, po_key: l.po_key } : null) : undefined}
                      onChange={edit && !l.received ? (v) => void savePo(i, v) : undefined}
                      label={l.description}
                    />
                  ) : null}
                  {edit && !l.received ? (
                    <div className="o-qty-row" style={{ background: 'transparent', padding: 0 }}>
                      <ItemPicker label={`Item do estoque, linha ${i + 1}`} value={{ item_id: null, text: '' }} items={items} placeholder={linked ? 'Trocar o item do estoque…' : 'Escolha o item do estoque'} onPick={(it) => setLinks((x) => ({ ...x, [i]: { item_id: it.id, factor: x[i]?.factor ?? factorOf(i) } }))} onText={() => undefined} />
                      {pc ? (
                        <label className="pc-factor" title="Quantas unidades do estoque vêm em cada unidade da nota (ex.: caixa com 10)">
                          ×
                          <input className="input" inputMode="decimal" aria-label={`Fator de conversão da linha ${i + 1}`} value={links[i]?.factor ?? factorOf(i)} onChange={(e) => setLinks((x) => ({ ...x, [i]: { item_id: x[i]?.item_id ?? (l.item_id as string), factor: Number(e.target.value.replace(',', '.')) || 1 } }))} />
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {edit && left > 0 ? (
                    <div className="pc-conf">
                      <label>
                        Chegou
                        <input className="input pc-num" inputMode="numeric" aria-label={`Chegou, ${l.description}`} value={conf[i].delivered} onChange={(e) => setConf((c) => c.map((x, k) => (k === i ? { ...x, delivered: e.target.value.replace(/\D/g, '').slice(0, 7), touched: true } : x)))} />
                      </label>
                      {pc ? (
                        <>
                          <label>
                            Recusado
                            <input className="input pc-num" inputMode="numeric" aria-label={`Recusado, ${l.description}`} value={conf[i].refused} onChange={(e) => setConf((c) => c.map((x, k) => (k === i ? { ...x, refused: e.target.value.replace(/\D/g, '').slice(0, 7), touched: true } : x)))} />
                          </label>
                          {Number(conf[i].refused) > 0 ? <input className="input" placeholder="Motivo da recusa" aria-label={`Motivo da recusa, ${l.description}`} value={conf[i].note} onChange={(e) => setConf((c) => c.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} /> : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {pc ? (
          <div>
            <h3 className="sec-title">
              Parcelas <span className={`pbadge ${n.installments_status === 'validada' ? 'green' : 'amber'}`}>{n.installments_status === 'validada' ? 'validadas' : 'a conferir'}</span>
            </h3>
            <InstallmentsEditor
              list={inst}
              total={total}
              readOnly={!canEdit || n.status === 'estornada'}
              onChange={(l) => {
                setInst(l);
                setInstDirty(true);
              }}
            />
            {canEdit && n.status !== 'estornada' ? (
              <div className="drawer-actions">
                {instDirty ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => saveInst(false)} disabled={Boolean(busy)}>
                    Salvar parcelas
                  </button>
                ) : null}
                {n.installments_status !== 'validada' || instDirty ? (
                  <button className="btn btn-primary btn-sm" onClick={() => saveInst(true)} disabled={Boolean(busy) || gap !== 0 || !inst.length}>
                    {busy === 'inst' ? <span className="spinner" /> : <CheckCircle2 size={14} />} Validar parcelas
                  </button>
                ) : null}
              </div>
            ) : null}
            <small className="help">Previsão de pagamento: não indica que algo foi pago.</small>
          </div>
        ) : n.installments.length ? (
          <div>
            <h3 className="sec-title">Parcelas</h3>
            {n.installments.map((p, i) => (
              <div className="kv-row" key={i}>
                <span>
                  {p.n} · vence {dateBR(p.due)}
                </span>
                <b>{brl(Number(p.value))}</b>
              </div>
            ))}
          </div>
        ) : null}

        {edit ? (
          <div className="pc-decide">
            {!instOk || blockers.length ? (
              <p className="help">
                <ShieldAlert size={14} style={{ verticalAlign: '-2px' }} color="var(--amber)" /> Antes da entrada:{' '}
                {[!instOk ? 'valide as parcelas' : '', blockers.length ? `aguardando Compras tratar ${blockers.length === 1 ? 'a divergência' : `${blockers.length} divergências`}` : ''].filter(Boolean).join(' e ')}
                . A conferência já pode ser salva.
              </p>
            ) : null}
            <div className="drawer-actions">
              {pc ? (
                <button className="btn btn-ghost btn-sm" onClick={() => confirm(false)} disabled={Boolean(busy)}>
                  {busy === 'conf' ? <span className="spinner" /> : null} Salvar conferência
                </button>
              ) : null}
              <button className="btn btn-primary btn-sm" onClick={() => confirm(true)} disabled={Boolean(busy) || !instOk || blockers.length > 0}>
                {busy === 'post' ? <span className="spinner" /> : <PackageCheck size={15} />} Conferir e dar entrada
              </button>
            </div>
          </div>
        ) : null}

        <Attachments
          list={n.attachments ?? []}
          scope="nota"
          canEdit={canEdit && pc && n.status !== 'estornada'}
          label="DANFE e documentos"
          onChange={async (l) => {
            try {
              await api(`/api/almoxarifado/notas/${n.id}`, { method: 'PATCH', json: { attachments: l } });
              await reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />

        <div>
          <h3 className="sec-title">Dados</h3>
          {[
            ['Chave de acesso', n.access_key],
            ['Empresa compradora', n.company],
            ['Pagamento', n.payment],
            ['Desconto', n.totals?.discount ? brl(n.totals.discount) : null],
            ['Frete', n.totals?.freight ? brl(n.totals.freight) : null],
            ['Registrada por', n.created_by],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div className="kv-row" key={k as string}>
                <span>{k}</span>
                <b className="o-kv">{v}</b>
              </div>
            ))}
          {n.access_key ? (
            <a className="btn btn-ghost btn-sm" href={`/api/almoxarifado/notas/${n.id}?xml=1`} style={{ marginTop: 8 }} data-max="nota-xml">
              <Download size={14} /> Baixar XML
            </a>
          ) : null}
        </div>

        <div>
          <h3 className="sec-title">Histórico</h3>
          <ol className="p-history o-history">
            {[...n.history].reverse().map((h, i) => (
              <li key={i}>
                <span>
                  <em>{h.what}</em>
                  {h.by} · {formatDateTime(h.at)}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {canEdit && n.items.some((l) => l.received > 0) && n.status !== 'estornada' ? (
          <div className="drawer-actions" style={{ marginTop: 'auto' }}>
            <button className="btn btn-danger btn-sm" onClick={() => setReverse(true)} disabled={Boolean(busy)}>
              <RotateCcw size={15} /> Estornar nota
            </button>
          </div>
        ) : null}
      </div>
      <AnimatePresence>
        {reverse ? (
          <Sheet key="rev" title={`Estornar a NF ${n.number}?`} lead="As quantidades desta nota saem do estoque e voltam a ficar a receber no pedido." onClose={() => setReverse(false)} locked={Boolean(reason)}>
            <label className="label" htmlFor="n-rev">
              Motivo
            </label>
            <textarea id="n-rev" className="textarea" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setReverse(false)} disabled={Boolean(busy)}>
                Voltar
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const r = await call(`/api/almoxarifado/notas/${n.id}/reverse`, { reason }, 'reverse');
                  setReverse(false);
                  if (r) toast({ kind: 'success', title: `NF ${n.number} estornada` });
                  await reload();
                }}
                disabled={Boolean(busy) || !reason.trim()}
              >
                {busy ? <span className="spinner" /> : <RotateCcw size={16} />} Estornar
              </button>
            </div>
          </Sheet>
        ) : null}
        {treat ? (
          <DivergenceSheet
            key="treat"
            noteId={n.id}
            number={n.number}
            d={treat}
            canAuthorize={canAuthorize}
            onClose={() => setTreat(null)}
            onDone={async () => {
              setTreat(null);
              await reload();
            }}
          />
        ) : null}
      </AnimatePresence>
    </Drawer>
  );
}
