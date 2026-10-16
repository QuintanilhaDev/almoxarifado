'use client';
import { AlertCircle, AlertTriangle, Camera, CheckCircle2, PackageCheck, ScanLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { num } from '@/lib/almoxarifado/stockFormat';
import { PO_OPEN, brl, paymentText, poDue, poLabel, poLeft, type Attachment, type PurchaseOrder } from '@/lib/compras/pc';
import { formatDoc } from '@/lib/compras/fornecedores';
import { installmentsGap, keyInfo, suggestInstallments, validKey, type Installment } from '@/lib/notas/conferencia';
import type { FiscalNote } from '@/lib/notas/server';
import { attachmentUrl, moneyIn, parseMoney, uploadAttachment } from '../compras/pcui';
import { dateBR, todayLocal } from '../pedidos/ui';

interface Line {
  key: string;
  item_id: string | null;
  name: string;
  unit: string;
  left: number;
  qty: string;
  price: string;
  delivered: string;
  refused: string;
  why: string;
  on: boolean;
}

/**
 * Receber pelo pedido de compra:
 *  1. escolhe o pedido (as linhas já vêm com o que falta receber e o preço combinado);
 *  2. anexa o DANFE (foto ou PDF): a chave preenche número, série e CNPJ, o PDF traz o total;
 *  3. confere o que chegou (por padrão, tudo certo); recusa precisa de motivo;
 *  4. as parcelas vêm da condição do pedido: é só conferir.
 * Sem divergência, registra e dá entrada num clique. Com divergência, fica esperando Compras.
 */
export function ReceiveSheet({ initial, onClose, onDone }: { initial?: PurchaseOrder | null; onClose: () => void; onDone: (note: FiscalNote) => void }) {
  const toast = useToast();
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(initial ? [initial] : null);
  const [po, setPo] = useState<PurchaseOrder | null>(initial ?? null);
  useEffect(() => {
    api<{ orders: PurchaseOrder[] }>('/api/compras/pedidos')
      .then((j) => setOrders(j.orders.filter((o) => PO_OPEN.includes(o.status) && o.items.some((i) => poLeft(i) > 0))))
      .catch(() => setOrders((o) => o ?? []));
  }, []);
  const [lines, setLines] = useState<Line[]>([]);
  const [head, setHead] = useState({ key: '', number: '', series: '1', issue: todayLocal(), total: '' });
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');
  const [inst, setInst] = useState<Installment[]>([]);
  const [instOk, setInstOk] = useState(false);
  const [allOk, setAllOk] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // pedido escolhido: linhas com o que falta receber
  useEffect(() => {
    if (!po) return;
    setLines(
      po.items
        .filter((i) => poLeft(i) > 0)
        .map((i) => ({ key: i.key, item_id: i.item_id, name: `${i.name}${i.size ? ' · ' + i.size : ''}`, unit: i.unit, left: poLeft(i), qty: String(poLeft(i)), price: moneyIn(i.unit_price), delivered: String(poLeft(i)), refused: '0', why: '', on: true })),
    );
  }, [po]);

  const goods = useMemo(() => lines.filter((l) => l.on).reduce((t, l) => t + (Number(l.qty) || 0) * (parseMoney(l.price) ?? 0), 0), [lines]);
  const freight = po?.freight ?? 0;
  const computed = Math.round((goods + freight - (po?.discount ?? 0) + (po?.other_costs ?? 0)) * 100) / 100;
  const total = parseMoney(head.total) ?? computed;
  // parcelas pela condição do pedido (refeitas quando o total muda, até a pessoa mexer)
  const [instTouched, setInstTouched] = useState(false);
  useEffect(() => {
    if (!po || instTouched || !(total > 0)) return;
    setInst(suggestInstallments(total, po.payment, head.issue || todayLocal()));
  }, [po, total, head.issue, instTouched]);
  const gap = installmentsGap(inst, total);

  const ki = head.key.replace(/\D/g, '').length === 44 ? keyInfo(head.key) : null;
  const keyBad = head.key.replace(/\D/g, '').length === 44 && !validKey(head.key);
  const cnpjMismatch = ki && po?.cnpj && ki.cnpj !== po.cnpj;
  const setKey = (k: string) => {
    const d = k.replace(/\D/g, '').slice(0, 44);
    const info = d.length === 44 ? keyInfo(d) : null;
    setHead((h) => ({ ...h, key: d, number: info ? info.number : h.number, series: info ? info.series : h.series }));
  };

  const readDanfe = async (file: File) => {
    setReading(true);
    setReadNote('');
    setError('');
    try {
      const a = await uploadAttachment(file, 'nota');
      setAtts((l) => [...l, a]);
      if (/pdf/i.test(file.type)) {
        const r = await api<{ found: boolean; key: string | null; total: number | null; issue_date: string | null; reason?: string }>(`/api/almoxarifado/notas/danfe?path=${encodeURIComponent(a.path)}`);
        if (r.key) setKey(r.key);
        setHead((h) => ({ ...h, total: r.total ? moneyIn(r.total) : h.total, issue: r.issue_date ?? h.issue }));
        setReadNote(r.found ? `Lido do DANFE: ${[r.key ? 'chave' : '', r.total ? 'valor total' : '', r.issue_date ? 'data de emissão' : ''].filter(Boolean).join(', ')}. Confira antes de gravar.` : r.reason ?? 'Não achei a chave no PDF. Digite a chave.');
      } else if (/^image\//.test(file.type)) {
        const { readKeyFromImage } = await import('@/lib/notas/barcode');
        const k = await readKeyFromImage(file);
        if (k) {
          setKey(k);
          setReadNote('Chave lida do código de barras. Número, série e CNPJ vieram dela: confira.');
        } else setReadNote('Não consegui ler o código de barras nesta foto. Digite a chave (ou tire outra foto, mais perto e reta).');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const set = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const active = lines.filter((l) => l.on && Number(l.qty) > 0);
  const refusing = active.some((l) => Number(l.refused) > 0);

  const submit = async (enter: boolean) => {
    setError('');
    if (!po) return setError('Escolha o pedido de compra.');
    if (!head.number.trim()) return setError('Informe o número da nota (ou a chave de acesso).');
    if (keyBad) return setError('A chave de acesso não confere (dígito verificador). Confira os 44 números.');
    if (!active.length) return setError('Marque pelo menos um item da nota.');
    for (const l of active) {
      const d = allOk ? Number(l.qty) : Number(l.delivered);
      const r = allOk ? 0 : Number(l.refused) || 0;
      if (d > Number(l.qty)) return setError(`${l.name}: chegou mais do que o faturado.`);
      if (r > d) return setError(`${l.name}: recusado maior que o que chegou.`);
      if (r > 0 && !l.why.trim()) return setError(`${l.name}: diga o motivo da recusa.`);
    }
    if (enter && !instOk) return setError('Confira as parcelas e marque "Conferi as parcelas".');
    if (enter && gap !== 0) return setError(`A soma das parcelas difere do total da nota em ${brl(Math.abs(gap))}.`);
    setBusy(enter ? 'enter' : 'save');
    try {
      const j = await api<{ note: FiscalNote }>('/api/almoxarifado/notas', {
        method: 'POST',
        json: {
          number: head.number.trim(),
          series: head.series.trim() || null,
          access_key: head.key || null,
          issue_date: head.issue || null,
          supplier_name: po.supplier_name,
          cnpj: po.cnpj,
          purchase_order_id: po.id,
          attachments: atts,
          items: active.map((l) => ({ code: '', description: l.name, unit: l.unit, qty: Number(l.qty), unit_value: parseMoney(l.price) ?? 0, total: Math.round(Number(l.qty) * (parseMoney(l.price) ?? 0) * 100) / 100, item_id: l.item_id, po_key: l.key })),
          totals: { freight, discount: po.discount ?? 0, other: po.other_costs ?? 0, total },
          installments: inst,
          validate_installments: instOk && gap === 0,
        },
      });
      let note = j.note;
      // conferência física (por padrão: tudo chegou e foi aceito)
      const conf = note.items.map((l, i) => {
        const src = active.find((a) => a.key === l.po_key) ?? active[i];
        const d = allOk ? l.qty : Number(src?.delivered ?? l.qty);
        const r = allOk ? 0 : Number(src?.refused ?? 0) || 0;
        return { i, delivered: d, accepted: d - r, refused: r, note: r ? src?.why : null };
      });
      const c = await api<{ note: FiscalNote; blockers: string[] }>(`/api/almoxarifado/notas/${note.id}/conferencia`, { method: 'POST', json: { lines: conf } });
      note = c.note;
      if (enter && !c.blockers.length) {
        const lines2 = note.items.map((l, i) => ({ i, qty: (l.accepted ?? 0) - (l.received ?? 0), item_id: l.item_id })).filter((x) => x.qty > 0);
        if (lines2.length) {
          const p = await api<{ note: FiscalNote; order: { number: number; status: string } | null }>(`/api/almoxarifado/notas/${note.id}/post`, { method: 'POST', json: { lines: lines2 } });
          note = p.note;
          toast({ kind: 'success', title: `NF ${note.number}: entrada confirmada`, text: p.order ? `${poLabel(p.order.number)} ${p.order.status === 'concluido' ? 'concluído' : 'com entrega parcial'}` : undefined }, 9000);
        }
      } else if (c.blockers.length) {
        toast({ kind: 'info', title: `NF ${note.number} registrada, aguardando Compras`, text: 'Há divergência com o pedido. Compras/gestão trata e depois você confirma a entrada.' }, 12000);
      } else toast({ kind: 'success', title: `NF ${note.number} registrada`, text: 'Ainda sem entrada no estoque.' });
      onDone(note);
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };

  return (
    <Sheet title="Receber mercadoria pelo pedido" lead="As linhas vêm do pedido. Anexe o DANFE: a chave preenche número, série e CNPJ." onClose={onClose} wide locked>
      {!po ? (
        !orders ? (
          <div className="skeleton" style={{ height: 80, borderRadius: 12 }} />
        ) : !orders.length ? (
          <p className="help">Nenhum pedido de compra esperando entrega. Para nota sem pedido, use "Importar XML" ou "Digitar nota".</p>
        ) : (
          <div className="pc-pick">
            {orders.map((o) => (
              <button key={o.id} type="button" className="pc-pick-row" onClick={() => setPo(o)} style={{ textAlign: 'left' }}>
                <span>
                  <b>
                    {poLabel(o.number)} · {o.supplier_name}
                  </b>
                  <small>
                    {num(o.items.reduce((t, i) => t + poLeft(i), 0))} a receber · {o.items.map((i) => i.name).slice(0, 3).join(', ')}
                    {poDue(o) ? ` · previsão ${dateBR(poDue(o))}` : ''}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="n-review-head">
            <div>
              <small>Pedido</small>
              <b>{poLabel(po.number)}</b>
            </div>
            <div>
              <small>Fornecedor</small>
              <b>{po.supplier_name}</b>
            </div>
            <div>
              <small>CNPJ</small>
              <b>{po.cnpj ? formatDoc(po.cnpj) : '—'}</b>
            </div>
            <div>
              <small>Pagamento</small>
              <b>{paymentText(po.payment)}</b>
            </div>
          </div>
          {!initial ? (
            <button type="button" className="link-btn" onClick={() => setPo(null)}>
              trocar pedido
            </button>
          ) : null}

          <h3 className="sec-title">DANFE</h3>
          <div className="drawer-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={reading} data-max="danfe-anexar">
              {reading ? <span className="spinner" /> : <Camera size={15} />} Foto ou PDF do DANFE
            </button>
            <input ref={fileRef} type="file" hidden accept="image/*,application/pdf" capture="environment" aria-label="DANFE" onChange={(e) => e.target.files?.[0] && readDanfe(e.target.files[0])} />
            {atts.map((a) => (
              <a key={a.path} className="link-btn" href={attachmentUrl(a)} target="_blank" rel="noreferrer">
                {a.name}
              </a>
            ))}
          </div>
          {readNote ? (
            <p className="help">
              <ScanLine size={14} style={{ verticalAlign: '-2px' }} /> {readNote}
            </p>
          ) : null}
          <div className="sx-grid">
            <div className="full">
              <label className="label" htmlFor="rv-key">
                Chave de acesso (44 números)
              </label>
              <input id="rv-key" className="input" inputMode="numeric" value={head.key.replace(/(\d{4})(?=\d)/g, '$1 ')} onChange={(e) => setKey(e.target.value)} placeholder="Leia do DANFE ou digite" />
              {keyBad ? <small className="t-short">Chave inválida: confira os números.</small> : cnpjMismatch ? <small className="t-short">A chave é do CNPJ {formatDoc(ki!.cnpj)}, diferente do fornecedor do pedido.</small> : ki ? <small className="help">Nota {ki.number}, série {ki.series}, emitida em {ki.month}/{ki.year}.</small> : null}
            </div>
            <div>
              <label className="label" htmlFor="rv-num">
                Número
              </label>
              <input id="rv-num" className="input" inputMode="numeric" value={head.number} onChange={(e) => setHead({ ...head, number: e.target.value.replace(/\D/g, '').slice(0, 9) })} />
            </div>
            <div>
              <label className="label" htmlFor="rv-ser">
                Série
              </label>
              <input id="rv-ser" className="input" value={head.series} onChange={(e) => setHead({ ...head, series: e.target.value.slice(0, 3) })} />
            </div>
            <div>
              <label className="label" htmlFor="rv-iss">
                Emissão
              </label>
              <input id="rv-iss" type="date" className="input" value={head.issue} onChange={(e) => setHead({ ...head, issue: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="rv-total">
                Valor total da nota
              </label>
              <input id="rv-total" className="input" inputMode="decimal" value={head.total} placeholder={moneyIn(computed)} onChange={(e) => setHead({ ...head, total: e.target.value.replace(/[^\d,.]/g, '') })} />
              {parseMoney(head.total) !== null && Math.abs((parseMoney(head.total) ?? 0) - computed) > 0.009 ? <small className="t-short">Pelo pedido daria {brl(computed)}.</small> : null}
            </div>
          </div>

          <h3 className="sec-title">
            Itens da nota
            <label className="pc-check" style={{ marginLeft: 'auto', fontWeight: 500 }}>
              <input type="checkbox" checked={allOk} onChange={(e) => setAllOk(e.target.checked)} /> Tudo chegou certo
            </label>
          </h3>
          <div className="t-wrap">
            <table className="t-table pc-lines">
              <thead>
                <tr>
                  <th />
                  <th>Item</th>
                  <th className="n">Faturado</th>
                  <th className="n">Preço na nota</th>
                  {!allOk ? (
                    <>
                      <th className="n">Chegou</th>
                      <th className="n">Recusado</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className={l.on ? '' : 'skip'}>
                    <td>
                      <input type="checkbox" checked={l.on} onChange={(e) => set(l.key, { on: e.target.checked })} aria-label={`${l.name} está na nota`} />
                    </td>
                    <td>
                      <b>{l.name}</b>
                      <small style={{ display: 'block' }}>
                        {num(l.left)} {l.unit} a receber no pedido
                      </small>
                      {!allOk && Number(l.refused) > 0 ? <input className="input" placeholder="Motivo da recusa" aria-label={`Motivo da recusa de ${l.name}`} value={l.why} onChange={(e) => set(l.key, { why: e.target.value })} /> : null}
                    </td>
                    <td className="n">
                      <input className="input pc-num" inputMode="numeric" aria-label={`Faturado de ${l.name}`} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/\D/g, ''), delivered: e.target.value.replace(/\D/g, '') })} disabled={!l.on} />
                    </td>
                    <td className="n">
                      <input className="input pc-num" inputMode="decimal" aria-label={`Preço na nota de ${l.name}`} value={l.price} onChange={(e) => set(l.key, { price: e.target.value.replace(/[^\d,.]/g, '') })} disabled={!l.on} />
                    </td>
                    {!allOk ? (
                      <>
                        <td className="n">
                          <input className="input pc-num" inputMode="numeric" aria-label={`Chegou de ${l.name}`} value={l.delivered} onChange={(e) => set(l.key, { delivered: e.target.value.replace(/\D/g, '') })} disabled={!l.on} />
                        </td>
                        <td className="n">
                          <input className="input pc-num" inputMode="numeric" aria-label={`Recusado de ${l.name}`} value={l.refused} onChange={(e) => set(l.key, { refused: e.target.value.replace(/\D/g, '') })} disabled={!l.on} />
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help">
            O preço vem do pedido: se a nota trouxer outro, troque aqui. A diferença vira uma divergência para Compras tratar, e o pedido não muda sozinho.
          </p>

          <h3 className="sec-title">Parcelas {instOk && gap === 0 ? <span className="pbadge green">conferidas</span> : null}</h3>
          <InstallmentsEditor
            list={inst}
            total={total}
            onChange={(l) => {
              setInst(l);
              setInstTouched(true);
              setInstOk(false);
            }}
          />
          <label className="pc-check">
            <input type="checkbox" checked={instOk} onChange={(e) => setInstOk(e.target.checked)} disabled={gap !== 0 || !inst.length} /> Conferi as parcelas com o boleto/DANFE
          </label>

          {refusing && !allOk ? (
            <p className="help">
              <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} color="var(--amber)" /> O que foi recusado não entra no estoque e fica registrado para Compras.
            </p>
          ) : null}
          {error ? (
            <div className="sx-error" role="alert">
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={Boolean(busy)}>
              Cancelar
            </button>
            <button className="btn btn-ghost" onClick={() => submit(false)} disabled={Boolean(busy)}>
              {busy === 'save' ? <span className="spinner" /> : null} Só registrar
            </button>
            <button className="btn btn-primary" onClick={() => submit(true)} disabled={Boolean(busy)} data-max="receber-confirmar">
              {busy === 'enter' ? <span className="spinner" /> : <PackageCheck size={17} />} Registrar e dar entrada
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** parcelas editáveis com a soma conferida na hora (precisão de centavos) */
export function InstallmentsEditor({ list, total, onChange, readOnly }: { list: Installment[]; total: number; onChange: (l: Installment[]) => void; readOnly?: boolean }) {
  const gap = installmentsGap(list, total);
  const upd = (i: number, p: Partial<Installment>) => onChange(list.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <div className="pc-inst">
      {list.map((p, i) => (
        <div key={i} className="pc-inst-row">
          <input className="input" aria-label={`Parcela ${i + 1}`} value={p.n} onChange={(e) => upd(i, { n: e.target.value.slice(0, 8) })} disabled={readOnly} />
          <input className="input" type="date" aria-label={`Vencimento da parcela ${i + 1}`} value={p.due ?? ''} onChange={(e) => upd(i, { due: e.target.value || null })} disabled={readOnly} />
          <input className="input pc-num" inputMode="decimal" aria-label={`Valor da parcela ${i + 1}`} value={moneyIn(p.value)} onChange={(e) => upd(i, { value: parseMoney(e.target.value) ?? 0 })} disabled={readOnly} />
          <input className="input" aria-label={`Forma / boleto da parcela ${i + 1}`} placeholder="Boleto, PIX… / nº" value={[p.method, p.ref].filter(Boolean).join(' / ')} onChange={(e) => {
            const [m, ...r] = e.target.value.split('/');
            upd(i, { method: m.trim() || null, ref: r.join('/').trim() || null });
          }} disabled={readOnly} />
          {!readOnly ? (
            <button type="button" className="icon-btn" aria-label={`Tirar parcela ${i + 1}`} onClick={() => onChange(list.filter((_, k) => k !== i))}>
              ×
            </button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const n = list.length + 1;
            const last = list[list.length - 1]?.due;
            const next = last ? new Date(new Date(last + 'T12:00:00Z').getTime() + 30 * 86400e3).toISOString().slice(0, 10) : null;
            onChange([...list.map((x, k) => ({ ...x, n: `${k + 1}/${n}` })), { n: `${n}/${n}`, due: next, value: Math.max(0, Math.round(-gap * 100) / 100), obs: null, method: null, ref: null }]);
          }}
        >
          + Parcela
        </button>
      ) : null}
      <small className={gap === 0 ? 'help' : 't-short'}>
        {gap === 0 ? (
          <>
            <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} color="var(--mint)" /> Soma {brl(total)}: bate com o total da nota.
          </>
        ) : (
          `Soma ${brl(total + gap)} — diferença de ${brl(Math.abs(gap))} para o total da nota (${brl(total)}).`
        )}
      </small>
    </div>
  );
}
