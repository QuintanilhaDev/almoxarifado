'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Copy, Mail, PackageMinus, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { answerToText, formatDateTime, protocolLabel } from '@/lib/format';
import { buildIndex, parseReply, type ParsedLine, type Polarity } from '@/lib/almoxarifado/replyParser';
import { fold, itemLabel, num } from '@/lib/almoxarifado/stockFormat';
import type { AuthorizedEmail, Posto, RequestRow, StockApplication, StockItem } from '@/lib/almoxarifado/types';
import { useToast } from '../core/Toasts';
import { api } from '../core/api';
import { Sheet } from './StockModals';
import { ConfirmModal } from '../core/Modal';
import './estoque.css';
import './reply.css';

const POLARITY_LABEL: Record<Polarity, string> = {
  sent: 'Enviado',
  negated: 'Não enviado',
  future: 'Envio futuro',
  info: 'Só informação',
  return: 'Devolução/troca',
};

interface Override {
  selected?: boolean;
  qty?: string;
  itemId?: string | null;
  removed?: boolean;
}
interface Manual {
  id: string;
  itemId: string;
  qty: string;
  selected: boolean;
}
interface Eff {
  okey: string;
  line: ParsedLine | null; // null = linha manual
  itemId: string | null;
  qty: string;
  selected: boolean;
  manualId?: string;
}

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function ReplyComposer({
  request,
  supervisor,
  applications,
  onClose,
  onApplied,
}: {
  request: RequestRow;
  supervisor: AuthorizedEmail | null;
  applications: StockApplication[];
  onClose: () => void;
  onApplied: (apps: StockApplication[]) => void;
}) {
  const toast = useToast();
  const greeting = supervisor?.supervisor_name ? `Olá, ${supervisor.supervisor_name.split(' ')[0]}!` : 'Olá!';
  const template = `${greeting}\n\nSobre a solicitação ${protocolLabel(request.protocol)} do colaborador ${request.collaborator || ''}:\n\n`;

  const [items, setItems] = useState<StockItem[] | null>(null);
  const [postos, setPostos] = useState<Posto[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState(template);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [manual, setManual] = useState<Manual[]>([]);
  const [pickFor, setPickFor] = useState<string | null>(null); // okey da linha que está trocando o item
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'transferencia' | 'saida'>('saida');
  const [modeTouched, setModeTouched] = useState(false);
  const [postoId, setPostoId] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [ackPrev, setAckPrev] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const keyRef = useRef(newKey());

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [a, b] = await Promise.all([
        api<{ items: StockItem[] }>('/api/almoxarifado/stock'),
        api<{ postos: Posto[] }>('/api/almoxarifado/postos'),
      ]);
      setItems(a.items);
      setPostos(b.postos);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const index = useMemo(
    () => buildIndex((items ?? []).map((i) => ({ id: i.id, name: i.name, size: i.size, quantity: i.quantity }))),
    [items],
  );

  // posto do pedido = posto cadastrado com o mesmo nome
  const matchedPosto = useMemo(() => {
    const k = fold((request.posto || '').trim());
    return k ? (postos ?? []).find((p) => fold(p.name.trim()) === k) ?? null : null;
  }, [postos, request.posto]);
  useEffect(() => {
    if (!postos) return;
    if (!postoId && matchedPosto) setPostoId(matchedPosto.id);
    if (!modeTouched) setMode(matchedPosto ? 'transferencia' : 'saida');
  }, [postos, matchedPosto, postoId, modeTouched]);

  const parsed = useMemo(() => {
    if (!items) return null;
    const hints = request.answers.filter((a) => a.fieldId === 'itens').map((a) => answerToText(a.value));
    const exclude = [request.posto, request.collaborator, supervisor?.supervisor_name].filter((x): x is string => Boolean(x));
    return parseReply(text, index, { hints, exclude });
  }, [items, text, index, request.answers, request.posto, request.collaborator, supervisor?.supervisor_name]);

  // linhas do texto + linhas manuais, já com as edições da pessoa
  const effective: Eff[] = useMemo(() => {
    const out: Eff[] = [];
    const seen = new Map<string, number>();
    for (const l of parsed?.lines ?? []) {
      const n = (seen.get(l.source) ?? 0) + 1;
      seen.set(l.source, n);
      const okey = `${l.source}#${n}`;
      const ov = overrides[okey] ?? {};
      if (ov.removed) continue;
      const itemId = ov.itemId !== undefined ? ov.itemId : l.itemId;
      out.push({
        okey,
        line: l,
        itemId,
        qty: ov.qty ?? String(l.qty),
        selected: Boolean(itemId) && (ov.selected ?? l.selected),
      });
    }
    for (const m of manual) out.push({ okey: m.id, line: null, itemId: m.itemId, qty: m.qty, selected: m.selected, manualId: m.id });
    return out;
  }, [parsed, overrides, manual]);

  // conferência das linhas marcadas
  const check = useMemo(() => {
    const perLine = new Map<string, string>();
    const sums = new Map<string, number>();
    for (const e of effective) {
      if (!e.selected || !e.itemId) continue;
      const n = Number(e.qty);
      if (!Number.isInteger(n) || n < 1) {
        perLine.set(e.okey, 'Informe a quantidade (número inteiro, maior que zero).');
        continue;
      }
      sums.set(e.itemId, (sums.get(e.itemId) ?? 0) + n);
    }
    for (const e of effective) {
      if (!e.selected || !e.itemId || perLine.has(e.okey)) continue;
      const it = byId.get(e.itemId);
      if (!it) {
        perLine.set(e.okey, 'Este item não existe mais.');
        continue;
      }
      const total = sums.get(e.itemId) ?? 0;
      if (total > it.quantity) perLine.set(e.okey, `Saldo insuficiente: há ${num(it.quantity)} no almoxarifado e a baixa pede ${num(total)}.`);
    }
    const chosen = effective.filter((e) => e.selected && e.itemId);
    const units = [...sums.values()].reduce((a, b) => a + b, 0);
    return { perLine, count: sums.size, units, chosen, bad: perLine.size > 0 };
  }, [effective, byId]);

  const activePrev = applications.filter((a) => !a.reverted);
  const needAck = activePrev.length > 0;
  const destOk = mode === 'saida' || Boolean(postoId);
  const canApply = !busy && check.chosen.length > 0 && !check.bad && destOk && (!needAck || ackPrev);

  const setOv = (okey: string, patch: Override) => setOverrides((o) => ({ ...o, [okey]: { ...(o[okey] ?? {}), ...patch } }));

  const dirty = text.trim() !== template.trim() || manual.length > 0;
  const tryClose = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };

  const subject = `Solicitação ${protocolLabel(request.protocol)} - ${request.collaborator || ''}`.trim();
  const openMail = () => {
    const body = text.trim() + '\n';
    let url = `mailto:${request.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (url.length > 1900) {
      // mailto grande demais costuma ser cortado pelo programa de e-mail
      copyText(body);
      toast({ kind: 'info', title: 'Texto grande: copiei a mensagem', text: 'Cole no corpo do e-mail.' });
      url = `mailto:${request.email}?subject=${encodeURIComponent(subject)}`;
    }
    window.location.href = url;
  };

  const apply = async (thenMail: boolean) => {
    if (!canApply) return;
    setBusy(true);
    setError('');
    try {
      const j = await api<{ already?: boolean; items?: number; units?: number; applications: StockApplication[] }>(
        `/api/almoxarifado/requests/${request.id}/baixa`,
        {
          method: 'POST',
          json: {
            key: keyRef.current,
            mode,
            posto_id: mode === 'transferencia' ? postoId : null,
            text: text.trim(),
            lines: check.chosen.map((e) => ({ item_id: e.itemId, quantity: Number(e.qty) })),
          },
        },
      );
      onApplied(j.applications ?? []);
      toast(
        j.already
          ? { kind: 'info', title: 'Esta baixa já estava registrada', text: 'Nada foi baixado de novo.' }
          : {
              kind: 'success',
              title: 'Baixa registrada',
              text: `${num(j.units ?? check.units)} unidade${(j.units ?? check.units) === 1 ? '' : 's'} em ${num(j.items ?? check.count)} ite${(j.items ?? check.count) === 1 ? 'm' : 'ns'}`,
            },
      );
      onClose();
      if (thenMail) setTimeout(openMail, 150);
    } catch (e) {
      setError((e as Error).message);
      setStep('edit');
      setBusy(false);
      load();
    }
  };

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(text.trim() + '\n');
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const destLabel = mode === 'transferencia' ? postos?.find((p) => p.id === postoId)?.name ?? 'o posto' : null;

  /* ---------------------------- passo 2: conferir ---------------------------- */
  if (step === 'confirm') {
    return (
      <Sheet title="Confirmar baixa" lead="Confira uma última vez. Isso muda o estoque agora." onClose={() => !busy && setStep('edit')} locked wide>
        <ul className="rc-confirm">
          {check.chosen.map((e) => {
            const it = e.itemId ? byId.get(e.itemId) : null;
            return (
              <li key={e.okey}>
                <b>{num(Number(e.qty))}×</b> <span>{it ? itemLabel(it) : '—'}</span>
                {it ? <small>saldo {num(it.quantity)} → {num(it.quantity - Number(e.qty))}</small> : null}
              </li>
            );
          })}
        </ul>
        <p className="rc-dest-note">
          {mode === 'transferencia' ? (
            <>
              Sai do almoxarifado e <b>entra no estoque do posto {destLabel}</b>.
            </>
          ) : (
            <>Sai do almoxarifado (baixa simples, sem destino).</>
          )}{' '}
          Total: <b>{num(check.units)}</b> unidade{check.units === 1 ? '' : 's'} em <b>{num(check.count)}</b> ite{check.count === 1 ? 'm' : 'ns'}.
        </p>
        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}
        <div className="modal-actions rc-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setStep('edit')} disabled={busy}>
            <ArrowLeft size={17} /> Voltar
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => apply(false)} disabled={busy}>
            {busy ? <span className="spinner" /> : <PackageMinus size={17} />} Só dar baixa
          </button>
          <button type="button" className="btn btn-primary" onClick={() => apply(true)} disabled={busy}>
            {busy ? <span className="spinner" /> : <Mail size={17} />} Dar baixa e abrir e-mail
          </button>
        </div>
      </Sheet>
    );
  }

  /* ---------------------------- passo 1: escrever ---------------------------- */
  return (
    <>
      <Sheet
        title="Responder e dar baixa"
        lead="Escreva a resposta (ou cole o e-mail que você já enviou). A ferramenta lê o texto e encontra os itens que saíram para você conferir."
        onClose={tryClose}
        locked
        wide
      >
        <div className="rc-grid">
          <div className="rc-col">
            <label className="label" htmlFor="rc-text">
              Mensagem para {request.email}
            </label>
            <textarea
              id="rc-text"
              className="textarea rc-text"
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck
              placeholder="Ex.: Enviamos 2 camisas M/C Max Serviços tamanho 7 e 1 par de botina 42. Não temos coturno 40."
            />
            <div className="rc-tip">
              <Sparkles size={15} />
              <span>
                Escreva o que <b>saiu</b> (“Enviamos 2 …”). O que for “não temos”, “em falta” ou “amanhã enviaremos” não é marcado para baixa.
              </span>
            </div>
          </div>

          <div className="rc-col">
            <div className="rc-head">
              <span className="label" style={{ margin: 0 }}>
                Itens encontrados no texto
              </span>
              {check.count > 0 ? (
                <span className="badge green">
                  {num(check.units)} un. · {num(check.count)} ite{check.count === 1 ? 'm' : 'ns'} marcados
                </span>
              ) : (
                <span className="badge gray">nenhum marcado</span>
              )}
            </div>

            {loadError ? (
              <div className="rc-empty">
                Não consegui carregar o estoque. <button className="btn btn-ghost btn-sm" onClick={load}>Tentar de novo</button>
              </div>
            ) : !items ? (
              <div className="rc-empty">
                <span className="spinner" /> Carregando o estoque…
              </div>
            ) : (
              <div className="rc-lines">
                {effective.length === 0 ? (
                  <div className="rc-empty">
                    Nenhum item reconhecido ainda. Escreva algo como <i>“Enviamos 2 camisas M/C Max Serviços tamanho 7”</i> ou use “Adicionar item”.
                  </div>
                ) : null}
                <AnimatePresence initial={false}>
                  {effective.map((e) => {
                    const it = e.itemId ? byId.get(e.itemId) : null;
                    const err = check.perLine.get(e.okey);
                    const l = e.line;
                    const polarity = l?.polarity ?? 'sent';
                    const level = !l ? 'ok' : e.itemId === l.itemId && l.confidence === 'high' && polarity === 'sent' && !l.qtyAssumed ? 'ok' : 'review';
                    const warns = l ? l.warnings : [];
                    return (
                      <motion.div
                        key={e.okey}
                        className={`rc-line${e.selected ? ' is-on' : ''}${polarity !== 'sent' ? ' is-neg' : ''}`}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 16, transition: { duration: 0.12 } }}
                      >
                        <label className="rc-check" title={it ? 'Marcar para dar baixa' : 'Escolha o item primeiro'}>
                          <input
                            type="checkbox"
                            checked={e.selected}
                            disabled={!it}
                            onChange={(ev) => (e.manualId ? setManual((m) => m.map((x) => (x.id === e.manualId ? { ...x, selected: ev.target.checked } : x))) : setOv(e.okey, { selected: ev.target.checked }))}
                            aria-label="Dar baixa neste item"
                          />
                          <span aria-hidden>
                            <Check size={14} strokeWidth={3} />
                          </span>
                        </label>
                        <div className="rc-body">
                          {l ? <div className="rc-quote">“{l.source}”</div> : <div className="rc-quote">Adicionado por você</div>}
                          <div className="rc-item">
                            {it ? (
                              <>
                                <b>{itemLabel(it)}</b>
                                <small>{num(it.quantity)} em estoque</small>
                              </>
                            ) : (
                              <b className="rc-none">Item não definido</b>
                            )}
                          </div>
                          <div className="rc-chips">
                            {polarity !== 'sent' ? <span className="badge red">{POLARITY_LABEL[polarity]}</span> : null}
                            {l && polarity === 'sent' ? (
                              level === 'ok' ? (
                                <span className="badge green">Identificado</span>
                              ) : (
                                <span className="badge">Confira</span>
                              )
                            ) : null}
                            <button type="button" className="rc-link" onClick={() => setPickFor(pickFor === e.okey ? null : e.okey)}>
                              {it ? 'Trocar item' : 'Escolher item'}
                            </button>
                          </div>
                          {warns.length ? (
                            <ul className="rc-warns">
                              {warns.slice(0, 3).map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          ) : null}
                          {err ? <div className="rc-err">{err}</div> : null}
                          {pickFor === e.okey ? (
                            <ItemPicker
                              items={items}
                              suggestions={l?.candidates ?? []}
                              onPick={(id) => {
                                if (e.manualId) setManual((m) => m.map((x) => (x.id === e.manualId ? { ...x, itemId: id, selected: true } : x)));
                                else setOv(e.okey, { itemId: id, selected: true });
                                setPickFor(null);
                              }}
                              onClose={() => setPickFor(null)}
                            />
                          ) : null}
                        </div>
                        <input
                          className="input rc-qty"
                          inputMode="numeric"
                          aria-label="Quantidade"
                          value={e.qty}
                          onChange={(ev) => {
                            const v = ev.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                            if (e.manualId) setManual((m) => m.map((x) => (x.id === e.manualId ? { ...x, qty: v } : x)));
                            else setOv(e.okey, { qty: v });
                          }}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Tirar da lista"
                          onClick={() => (e.manualId ? setManual((m) => m.filter((x) => x.id !== e.manualId)) : setOv(e.okey, { removed: true }))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {adding ? (
                  <div className="rc-add">
                    <ItemPicker
                      items={items}
                      suggestions={[]}
                      onPick={(id) => {
                        setManual((m) => [...m, { id: `m${newKey()}`, itemId: id, qty: '1', selected: true }]);
                        setAdding(false);
                      }}
                      onClose={() => setAdding(false)}
                    />
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm rc-add-btn" onClick={() => setAdding(true)}>
                    <Plus size={16} /> Adicionar item que o texto não citou
                  </button>
                )}
                {parsed?.notes.map((n) => (
                  <div key={n} className="rc-note">
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rc-dest">
          <span className="label">O que fazer com o estoque</span>
          <div className="rc-dest-opts">
            <label className={`rc-opt${mode === 'transferencia' ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="rc-mode"
                checked={mode === 'transferencia'}
                onChange={() => {
                  setMode('transferencia');
                  setModeTouched(true);
                }}
              />
              <span>
                <b>Transferir para um posto</b>
                <small>Sai do almoxarifado e entra no estoque do posto.</small>
              </span>
            </label>
            <label className={`rc-opt${mode === 'saida' ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="rc-mode"
                checked={mode === 'saida'}
                onChange={() => {
                  setMode('saida');
                  setModeTouched(true);
                }}
              />
              <span>
                <b>Só dar baixa</b>
                <small>Sai do almoxarifado, sem registrar destino.</small>
              </span>
            </label>
          </div>
          {mode === 'transferencia' ? (
            <div style={{ marginTop: 10 }}>
              <div className="select-wrap">
                <select className="select" value={postoId} onChange={(e) => setPostoId(e.target.value)} aria-label="Posto de destino" data-empty={postoId ? undefined : ''}>
                  <option value="">{postos?.length ? 'Escolha o posto' : 'Nenhum posto cadastrado'}</option>
                  {(postos ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} />
              </div>
              {request.posto && !matchedPosto && postos ? (
                <div className="rc-note">O posto “{request.posto}” do pedido não está cadastrado em Postos. Escolha o destino ou use “Só dar baixa”.</div>
              ) : null}
            </div>
          ) : null}
        </div>

        {activePrev.length > 0 ? (
          <div className="rc-prev">
            <AlertCircle size={17} />
            <div>
              <b>Esta solicitação já teve baixa registrada.</b>
              <ul>
                {activePrev.map((a) => (
                  <li key={a.id}>
                    {formatDateTime(a.at)} por {a.by}: {a.lines.map((x) => `${x.quantity}× ${x.name}`).join(', ')}
                  </li>
                ))}
              </ul>
              <label className="rc-ack">
                <input type="checkbox" checked={ackPrev} onChange={(e) => setAckPrev(e.target.checked)} /> Quero registrar outra baixa (envio parcial/complementar)
              </label>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}

        <div className="modal-actions rc-actions">
          <button type="button" className="btn btn-ghost" onClick={tryClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-ghost" onClick={copy} title="Copiar a mensagem">
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar texto'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={openMail} title="Abre o e-mail sem mexer no estoque">
            <Mail size={16} /> E-mail sem baixa
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canApply}
            onClick={() => {
              setError('');
              setStep('confirm');
            }}
            title={!canApply && check.chosen.length === 0 ? 'Marque pelo menos um item' : undefined}
          >
            <PackageMinus size={17} /> Revisar baixa{check.count ? ` (${num(check.units)})` : ''}
          </button>
        </div>
      </Sheet>
      <ConfirmModal
        open={discard}
        title="Descartar o texto?"
        text="O que você escreveu e as escolhas de itens serão perdidos."
        confirmLabel="Descartar"
        danger
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
        onClose={() => setDiscard(false)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* buscador de item                                                    */
/* ------------------------------------------------------------------ */
function ItemPicker({
  items,
  suggestions,
  onPick,
  onClose,
}: {
  items: StockItem[];
  suggestions: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const t = fold(q.trim());
  const sug = useMemo(
    () => (t ? [] : suggestions.map((id) => byId.get(id)).filter((x): x is StockItem => Boolean(x)).slice(0, 12)),
    [suggestions, byId, t],
  );
  const rest = useMemo(() => {
    const skip = new Set(sug.map((s) => s.id));
    return items.filter((i) => !skip.has(i.id) && (!t || t.split(/\s+/).every((w) => fold(itemLabel(i)).includes(w)))).slice(0, 40);
  }, [items, sug, t]);

  return (
    <div className="rc-picker" ref={ref}>
      <div className="search" style={{ margin: 0 }}>
        <Search size={16} />
        <input
          className="input"
          autoFocus
          placeholder="Buscar item pelo nome ou tamanho"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
          autoComplete="off"
        />
      </div>
      <div className="rc-picker-list">
        {sug.length ? <div className="rc-picker-h">Sugestões do texto</div> : null}
        {sug.map((i) => (
          <button type="button" key={i.id} onClick={() => onPick(i.id)}>
            <span>{itemLabel(i)}</span>
            <small>{num(i.quantity)} disp.</small>
          </button>
        ))}
        {sug.length && rest.length ? <div className="rc-picker-h">Todos os itens</div> : null}
        {rest.map((i) => (
          <button type="button" key={i.id} onClick={() => onPick(i.id)}>
            <span>{itemLabel(i)}</span>
            <small>{num(i.quantity)} disp.</small>
          </button>
        ))}
        {!sug.length && !rest.length ? <div className="picker-empty">Nenhum item encontrado.</div> : null}
      </div>
    </div>
  );
}
