'use client';
import { AlertCircle, ArrowLeft, Check, CheckCheck, ChevronDown, LifeBuoy, Paperclip, Plus, Search, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useToast } from './Toasts';
import { shrink } from './shrink';
import { setChatVisivel } from './chamadoTabs';
import { useRealtime } from '@/lib/realtime';
import { useMaxBus } from '@/lib/max/bus';
import { getSector } from '@/lib/sectors';
import {
  APAGAR_RESOLVIDO_MS,
  KIND_SHORT,
  PRIORITIES,
  PRIORITY_TONE,
  STATUSES,
  STATUS_TONE,
  isOpen,
  unseenByOwner,
  waitingDev,
  type Ticket,
  type TicketAttachment,
  type TicketKind,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/chamados';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import '../almoxarifado/estoque.css';
import '../compras/compras.css';
import './chamados.css';

type Lista = { tickets: Ticket[]; dev: boolean; setup?: boolean };
type Msg = TicketMessage & { pending?: boolean };
const sectorName = (s: string | null) => (s === 'hub' ? 'Painel master' : getSector(s)?.name ?? 'Sem setor');
const anexoUrl = (a: TicketAttachment) => `/api/chamados/anexo?path=${encodeURIComponent(a.path)}`;
const TZ = 'America/Bahia';
const hora = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dia = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
function quando(iso: string) {
  const d = dia(iso);
  if (d === dia(new Date().toISOString())) return hora(iso);
  if (d === dia(new Date(Date.now() - 86_400_000).toISOString())) return 'ontem';
  return d.slice(0, 5);
}
function rotuloDia(iso: string) {
  const d = dia(iso);
  if (d === dia(new Date().toISOString())) return 'Hoje';
  if (d === dia(new Date(Date.now() - 86_400_000).toISOString())) return 'Ontem';
  return d;
}
const iniciais = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

async function enviarAnexo(f: File): Promise<TicketAttachment> {
  const fd = new FormData();
  fd.append('file', await shrink(f));
  const j = await api<{ attachment: TicketAttachment }>('/api/chamados/anexo', { method: 'POST', body: fd });
  return j.attachment;
}

/** Aba Chamados (todos os setores): conversar com o desenvolvedor. */
export function Chamados({ sector }: { sector: string | null }) {
  return <ChatChamados dev={false} sector={sector} />;
}
/** Aba do desenvolvedor: todos os chamados, em formato de chat. */
export function ChamadosDev() {
  return <ChatChamados dev sector={null} />;
}

function ChatChamados({ dev, sector }: { dev: boolean; sector: string | null }) {
  const [data, setData] = useState<Lista | null>(null);
  const [failed, setFailed] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'abertos' | 'aguardando' | 'encerrados' | 'todos'>('abertos');
  const [q, setQ] = useState('');
  const [setor, setSetor] = useState('');
  const [pend, setPend] = useState<Record<string, Msg[]>>({});

  const load = useCallback(async () => {
    try {
      setData(await api<Lista>(`/api/chamados${dev ? '?todos=1' : ''}`));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, [dev]);
  useEffect(() => {
    load();
  }, [load]);
  // com uma conversa aberta, confere mais vezes (além do aviso em tempo real)
  useRealtime((ev) => ev === 'ticket:update' && load(), load, sel && sel !== 'novo' ? 8000 : 30000);
  useMaxBus('chamados:open', (p) => {
    setFiltro('todos');
    setSel(p.id);
    load();
  });

  const upsert = useCallback((t: Ticket) => setData((d) => (d ? { ...d, tickets: [t, ...d.tickets.filter((x) => x.id !== t.id)] } : d)), []);
  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const atual = sel && sel !== 'novo' ? tickets.find((t) => t.id === sel) ?? null : null;
  const atualId = atual?.id ?? null;
  // a conversa aberta foi apagada (resolvido há mais de 10 minutos): volta para a lista
  useEffect(() => {
    if (data && sel && sel !== 'novo' && !data.tickets.some((t) => t.id === sel)) setSel(null);
  }, [data, sel]);

  useEffect(() => {
    const vis = () => setChatVisivel(atualId && document.visibilityState === 'visible' ? atualId : null);
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      setChatVisivel(null);
    };
  }, [atualId]);

  const setores = useMemo(() => [...new Set(tickets.map((t) => t.sector ?? ''))].sort(), [tickets]);
  const termo = fold(q.trim());
  const cont = { abertos: tickets.filter((t) => isOpen(t.status)).length, aguardando: tickets.filter(waitingDev).length };
  const lista = tickets
    .filter((t) => t.id === sel || (filtro === 'abertos' ? isOpen(t.status) : filtro === 'aguardando' ? waitingDev(t) : filtro === 'encerrados' ? !isOpen(t.status) : true))
    .filter((t) => !setor || (t.sector ?? '') === setor)
    .filter((t) => !termo || fold(`${t.number} ${t.title} ${t.opened_by} ${t.opened_by_user ?? ''}`).includes(termo));

  if (failed && !data) return <Estado failed={failed} />;
  if (data?.setup) return <Estado setup />;

  return (
    <div className={`ch-app${sel ? ' has-sel' : ''}`} data-no-tilt>
      <aside className="ch-side">
        <div className="ch-side-head">
          <div>
            <h1>{dev ? 'Responder chamados' : 'Chamados'}</h1>
            <p>{dev ? 'Chamados de todos os setores. Só você vê esta aba.' : 'Fale com o desenvolvedor (@mateus): erro, ideia ou dúvida.'}</p>
          </div>
          {!dev ? (
            <button className="btn btn-primary btn-sm" onClick={() => setSel('novo')} data-max="chamado-novo">
              <Plus size={16} /> Novo
            </button>
          ) : null}
        </div>
        <div className="ch-filters">
          <div className="filter-seg" role="tablist" aria-label="Ver">
            {dev ? (
              <button className={filtro === 'aguardando' ? 'is-active' : ''} onClick={() => setFiltro('aguardando')}>
                Aguardando <em>{num(cont.aguardando)}</em>
              </button>
            ) : null}
            <button className={filtro === 'abertos' ? 'is-active' : ''} onClick={() => setFiltro('abertos')}>
              Abertos <em>{num(cont.abertos)}</em>
            </button>
            <button className={filtro === 'encerrados' ? 'is-active' : ''} onClick={() => setFiltro('encerrados')}>
              Encerrados
            </button>
            <button className={filtro === 'todos' ? 'is-active' : ''} onClick={() => setFiltro('todos')}>
              Todos
            </button>
          </div>
          {dev ? (
            <div className="ch-filter-row">
              <div className="search">
                <Search size={16} />
                <input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
              </div>
              <div className="select-wrap">
                <select className="select" value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Setor">
                  <option value="">Todos os setores</option>
                  {setores.map((s) => (
                    <option key={s} value={s}>
                      {sectorName(s || null)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} />
              </div>
            </div>
          ) : null}
        </div>
        <div className="ch-convs">
          {!data ? (
            <div className="skeleton" style={{ height: 180, borderRadius: 14, margin: 10 }} />
          ) : lista.length === 0 ? (
            <div className="ch-empty">
              <LifeBuoy size={20} />
              <span>{tickets.length ? 'Nenhum chamado aqui.' : dev ? 'Nenhum chamado ainda.' : 'Você ainda não abriu nenhum chamado.'}</span>
            </div>
          ) : (
            lista.map((t) => {
              const last = t.messages[t.messages.length - 1];
              const novo = dev ? waitingDev(t) : unseenByOwner(t);
              return (
                <button key={t.id} type="button" className={`ch-conv${t.id === sel ? ' is-active' : ''}${novo ? ' is-new' : ''}`} onClick={() => setSel(t.id)} data-ticket={t.number}>
                  <span className={`ch-av${dev ? '' : ' dev'}`}>{dev ? iniciais(t.opened_by) : <LifeBuoy size={16} />}</span>
                  <span className="ch-conv-main">
                    <span className="ch-conv-top">
                      <b>
                        #{t.number} · {t.title}
                      </b>
                      <small>{quando(t.updated_at)}</small>
                    </span>
                    <span className="ch-conv-bottom">
                      <span className="ch-prev">
                        {dev ? `${t.opened_by.split(' ')[0]} · ${sectorName(t.sector)}: ` : ''}
                        {last ? (last.dev === dev ? 'Você: ' : '') + (last.text || (last.status ? `situação: ${STATUSES[last.status]}` : 'anexo')) : ''}
                      </span>
                      {novo ? <span className="ch-dot" title={dev ? 'Aguardando você' : 'Resposta nova'} /> : <span className={`pbadge ${STATUS_TONE[t.status]} ch-st-mini`}>{STATUSES[t.status]}</span>}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
      <section className="ch-pane">
        {sel === 'novo' ? (
          <NovoChamado
            sector={sector}
            onCancel={() => setSel(null)}
            onSaved={(t) => {
              upsert(t);
              setFiltro('abertos');
              setSel(t.id);
            }}
          />
        ) : atual ? (
          <Conversa key={atual.id} t={atual} dev={dev} pend={pend[atual.id] ?? []} setPend={(l) => setPend((p) => ({ ...p, [atual.id]: l }))} onSaved={upsert} onBack={() => setSel(null)} />
        ) : (
          <div className="ch-blank">
            <LifeBuoy size={34} />
            <b>{dev ? 'Escolha um chamado para responder' : 'Escolha uma conversa ou abra um chamado novo'}</b>
            <span>{dev ? 'As mensagens chegam aqui em tempo real.' : 'Quando o desenvolvedor responder, você recebe um aviso com som e a Max pisca em amarelo.'}</span>
            {!dev ? (
              <button className="btn btn-primary" onClick={() => setSel('novo')}>
                <Plus size={18} /> Abrir chamado
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function Estado({ failed, setup }: { failed?: string; setup?: boolean }) {
  return (
    <div className="section-scroll" data-no-tilt>
      <div className="section-pad">
        <div className="empty">
          <span className="empty-icon">
            <AlertCircle size={24} />
          </span>
          <strong>{setup ? 'Chamados ainda não ativados' : 'Não foi possível carregar'}</strong>
          <span>{setup ? 'Rode o arquivo supabase/chamados.sql no SQL Editor do Supabase.' : failed}</span>
        </div>
      </div>
    </div>
  );
}

function Conversa({ t, dev, pend, setPend, onSaved, onBack }: { t: Ticket; dev: boolean; pend: Msg[]; setPend: (l: Msg[]) => void; onSaved: (t: Ticket) => void; onBack: () => void }) {
  const toast = useToast();
  const fim = useRef<HTMLDivElement>(null);
  const seenSent = useRef('');
  const owner = !dev;
  const msgs: Msg[] = [...t.messages, ...pend];

  // quem abriu está vendo a resposta: tira o aviso de "nova resposta"
  useEffect(() => {
    if (!owner || !unseenByOwner(t) || document.visibilityState !== 'visible' || seenSent.current === t.updated_at) return;
    seenSent.current = t.updated_at;
    api<{ ticket: Ticket }>(`/api/chamados?id=${t.id}`, { method: 'PATCH', json: { seen: true } })
      .then((r) => onSaved(r.ticket))
      .catch(() => undefined);
  }, [owner, t, onSaved]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);

  const patch = async (json: Record<string, unknown>, okMsg?: string) => {
    try {
      const r = await api<{ ticket: Ticket }>(`/api/chamados?id=${t.id}`, { method: 'PATCH', json });
      onSaved(r.ticket);
      if (okMsg) toast({ kind: 'success', title: okMsg });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
      return false;
    }
  };
  const enviar = async (text: string, attachments: TicketAttachment[]) => {
    setPend([...pend, { at: new Date().toISOString(), by: 'Você', dev, text, attachments, pending: true }]);
    const ok = await patch({ text, attachments });
    setPend([]);
    return ok;
  };

  const aberto = isOpen(t.status);
  let ultimoDia = '';
  return (
    <div className="ch-conv-pane">
      <header className="ch-head">
        <button className="icon-btn ch-back" onClick={onBack} aria-label="Voltar para a lista">
          <ArrowLeft size={18} />
        </button>
        <span className={`ch-av${dev ? '' : ' dev'}`}>{dev ? iniciais(t.opened_by) : <LifeBuoy size={16} />}</span>
        <div className="ch-head-main">
          <b>
            #{t.number} · {t.title}
          </b>
          <small>
            {dev ? `${t.opened_by}${t.opened_by_user ? ` (@${t.opened_by_user})` : ''} · ${sectorName(t.sector)} · ` : 'Desenvolvedor (@mateus) · '}
            {KIND_SHORT[t.kind]}
            {t.page ? ` · tela: ${t.page}` : ''}
          </small>
        </div>
        <div className="ch-head-actions">
          {dev ? (
            <>
              <div className="select-wrap ch-mini-sel">
                <select className="select" value={t.priority} onChange={(e) => patch({ priority: e.target.value })} aria-label="Urgência">
                  {(Object.keys(PRIORITIES) as TicketPriority[]).map((p) => (
                    <option key={p} value={p}>
                      Urgência: {PRIORITIES[p]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              <div className="select-wrap ch-mini-sel">
                <select className="select" value={t.status} onChange={(e) => patch({ status: e.target.value }, `Chamado: ${STATUSES[e.target.value as TicketStatus].toLowerCase()}`)} aria-label="Situação">
                  {(Object.keys(STATUSES) as TicketStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUSES[s]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </>
          ) : (
            <>
              <span className={`pbadge ${STATUS_TONE[t.status]}`}>{STATUSES[t.status]}</span>
              {aberto ? (
                <button className="btn btn-ghost btn-sm" onClick={() => patch({ status: 'resolvido' }, 'Chamado resolvido')}>
                  <CheckCheck size={15} /> Resolvido
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => patch({ status: 'aberto' }, 'Chamado reaberto')}>
                  Reabrir
                </button>
              )}
            </>
          )}
        </div>
      </header>
      {dev && t.priority !== 'normal' ? <div className={`ch-banner ${PRIORITY_TONE[t.priority]}`}>Urgência {PRIORITIES[t.priority].toLowerCase()}</div> : null}

      <div className="ch-msgs" role="log" aria-live="polite">
        {msgs.map((m, i) => {
          const d = rotuloDia(m.at);
          const sep = d !== ultimoDia;
          ultimoDia = d;
          const mine = m.dev === dev;
          return (
            <div key={i} className="ch-msg-wrap">
              {sep ? <div className="ch-day">{d}</div> : null}
              {m.text || m.attachments?.length ? (
                <div className={`ch-bubble${mine ? ' mine' : ''}${m.pending ? ' is-pending' : ''}`}>
                  {!mine ? <b className="ch-author">{m.dev ? `${m.by} · desenvolvedor` : m.by}</b> : null}
                  {m.attachments?.length ? (
                    <div className="ch-files">
                      {m.attachments.map((a) =>
                        a.type.startsWith('image/') ? (
                          <a key={a.path} href={anexoUrl(a)} target="_blank" rel="noreferrer" className="ch-img">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={anexoUrl(a)} alt={a.name} loading="lazy" />
                          </a>
                        ) : (
                          <a key={a.path} href={anexoUrl(a)} target="_blank" rel="noreferrer" className="ch-file">
                            <Paperclip size={14} /> <span>{a.name}</span>
                          </a>
                        ),
                      )}
                    </div>
                  ) : null}
                  {m.text ? <p>{m.text}</p> : null}
                  <span className="ch-time">
                    {hora(m.at)}
                    {mine ? m.pending ? <span className="spinner ch-spin" /> : <Check size={13} /> : null}
                  </span>
                </div>
              ) : null}
              {m.status ? (
                <div className="ch-sys">
                  {m.by} marcou como <b>{STATUSES[m.status].toLowerCase()}</b> · {hora(m.at)}
                </div>
              ) : null}
            </div>
          );
        })}
        {t.status === 'resolvido' && t.resolved_at ? (
          <div className="ch-sys ch-warn">
            Chamado resolvido. A conversa será apagada às <b>{hora(new Date(new Date(t.resolved_at).getTime() + APAGAR_RESOLVIDO_MS).toISOString())}</b>
            {owner ? ' — escreva algo ou clique em Reabrir para mantê-la.' : '.'}
          </div>
        ) : null}
        <div ref={fim} />
      </div>
      <Composer placeholder={dev ? `Responder ${t.opened_by.split(' ')[0]}` : aberto ? 'Escreva uma mensagem' : 'Escreva para reabrir o chamado'} onSend={enviar} />
    </div>
  );
}

function useUpload(max: number, count: number, onAdd: (l: TicketAttachment[]) => void) {
  const toast = useToast();
  const [up, setUp] = useState(false);
  const run = async (files: File[]) => {
    const list = files.slice(0, Math.max(0, max - count));
    if (!list.length) return;
    setUp(true);
    try {
      const added: TicketAttachment[] = [];
      for (const f of list) added.push(await enviarAnexo(f));
      onAdd(added);
    } catch (err) {
      toast({ kind: 'error', title: 'Anexo não enviado', text: (err as Error).message });
    } finally {
      setUp(false);
    }
  };
  return { up, run };
}

function Chips({ list, onChange }: { list: TicketAttachment[]; onChange: (l: TicketAttachment[]) => void }) {
  return (
    <>
      {list.map((a) => (
        <span className="ch-chip" key={a.path}>
          {a.name}
          <button type="button" aria-label={`Tirar ${a.name}`} onClick={() => onChange(list.filter((x) => x.path !== a.path))}>
            <X size={12} />
          </button>
        </span>
      ))}
    </>
  );
}

function Composer({ placeholder, onSend }: { placeholder: string; onSend: (text: string, att: TicketAttachment[]) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [att, setAtt] = useState<TicketAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const { up, run } = useUpload(5, att.length, (l) => setAtt((x) => [...x, ...l]));
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const send = async () => {
    const body = text.trim();
    if (!body || busy || up) return;
    setBusy(true);
    const keep = { text, att };
    setText('');
    setAtt([]);
    if (!(await onSend(body, keep.att))) {
      setText(keep.text);
      setAtt(keep.att);
    }
    setBusy(false);
    ta.current?.focus();
  };
  return (
    <div className="ch-composer">
      {att.length ? (
        <div className="ch-att">
          <Chips list={att} onChange={setAtt} />
        </div>
      ) : null}
      <div className="ch-compose-row">
        <button type="button" className="icon-btn" onClick={() => file.current?.click()} disabled={up || att.length >= 5} aria-label="Anexar print ou PDF" title="Anexar print ou PDF">
          {up ? <span className="spinner" /> : <Paperclip size={18} />}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept="image/*,application/pdf,.txt"
          multiple
          onChange={async (e) => {
            await run([...(e.target.files ?? [])]);
            if (file.current) file.current.value = '';
          }}
        />
        <textarea
          ref={ta}
          className="ch-input"
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={placeholder}
          aria-label="Mensagem"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            // colar um print (Ctrl+V) já anexa
            const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (!imgs.length) return;
            e.preventDefault();
            run(imgs.map((f) => new File([f], f.name || 'print.png', { type: f.type })));
          }}
        />
        <button type="button" className="ch-send" onClick={send} disabled={busy || up || !text.trim()} aria-label="Enviar" data-max="chamado-responder">
          <Send size={18} />
        </button>
      </div>
      <small className="ch-hint">Enter envia · Shift+Enter quebra a linha · Ctrl+V cola um print</small>
    </div>
  );
}

/** Tela em que a pessoa está (aba e setor), para o desenvolvedor achar o problema. */
function telaAtual(): string {
  const tab = document.querySelector('.nav-item.is-active span:not(.nav-count):not(.nav-bg)')?.textContent?.trim();
  const where = document.querySelector('.side .brand small, .brand small')?.textContent?.trim();
  return [where, tab, `${location.pathname}${location.hash}`].filter(Boolean).join(' › ').slice(0, 120);
}

function NovoChamado({ sector, onCancel, onSaved }: { sector: string | null; onCancel: () => void; onSaved: (t: Ticket) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TicketKind>('erro');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [text, setText] = useState('');
  const [att, setAtt] = useState<TicketAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { up, run } = useUpload(5, att.length, (l) => setAtt((x) => [...x, ...l]));
  const page = useMemo(() => (typeof window === 'undefined' ? '' : telaAtual()), []);
  const salvar = async () => {
    setBusy(true);
    try {
      const r = await api<{ ticket: Ticket }>('/api/chamados', { method: 'POST', json: { title, description: text, kind, priority, sector, page, attachments: att } });
      toast({ kind: 'success', title: `Chamado #${r.ticket.number} aberto`, text: 'O desenvolvedor foi avisado. A conversa continua aqui.' });
      onSaved(r.ticket);
    } catch (e) {
      toast({ kind: 'error', title: 'Chamado não aberto', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ch-conv-pane">
      <header className="ch-head">
        <button className="icon-btn ch-back" onClick={onCancel} aria-label="Voltar para a lista">
          <ArrowLeft size={18} />
        </button>
        <span className="ch-av dev">
          <Plus size={16} />
        </span>
        <div className="ch-head-main">
          <b>Novo chamado</b>
          <small>Para o desenvolvedor (@mateus)</small>
        </div>
      </header>
      <div className="ch-new">
        <label className="label">Tipo</label>
        <div className="filter-seg ch-kinds" role="radiogroup" aria-label="Tipo">
          {(['erro', 'melhoria', 'duvida', 'outro'] as TicketKind[]).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>
              {KIND_SHORT[k]}
            </button>
          ))}
        </div>
        <label className="label" htmlFor="ch-t" style={{ marginTop: 12 }}>
          Assunto
        </label>
        <input id="ch-t" className="input" value={title} maxLength={140} placeholder={kind === 'erro' ? 'Ex.: botão de salvar não responde no estoque' : kind === 'melhoria' ? 'Ex.: filtrar solicitações por posto' : 'Resumo em poucas palavras'} onChange={(e) => setTitle(e.target.value)} />
        <label className="label" htmlFor="ch-d" style={{ marginTop: 12 }}>
          Mensagem
        </label>
        <textarea id="ch-d" className="textarea" rows={6} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder={kind === 'erro' ? 'O que você fez, o que esperava que acontecesse e o que aconteceu (mensagem de erro, se apareceu).' : 'Explique com detalhes.'} />
        <div className="sx-grid" style={{ marginTop: 12 }}>
          <div>
            <label className="label" htmlFor="ch-p">
              Urgência
            </label>
            <div className="select-wrap">
              <select id="ch-p" className="select" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {(Object.keys(PRIORITIES) as TicketPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITIES[p]}
                    {p === 'urgente' ? ' (está parando o trabalho)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={18} />
            </div>
          </div>
          <div>
            <label className="label">Tela</label>
            <div className="ch-page" title={page}>
              {page || '—'}
            </div>
          </div>
        </div>
        <div className="ch-att" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => file.current?.click()} disabled={up || att.length >= 5}>
            {up ? <span className="spinner" /> : <Paperclip size={14} />} Anexar print ou PDF
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept="image/*,application/pdf,.txt"
            multiple
            onChange={async (e) => {
              await run([...(e.target.files ?? [])]);
              if (file.current) file.current.value = '';
            }}
          />
          <Chips list={att} onChange={setAtt} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={salvar} disabled={busy || up || !title.trim() || !text.trim()} data-max="chamado-enviar">
            {busy ? <span className="spinner" /> : <Send size={16} />} Enviar chamado
          </button>
        </div>
      </div>
    </div>
  );
}
