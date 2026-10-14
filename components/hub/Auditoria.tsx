'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Bot, LogIn, MapPin, MousePointerClick, Pause, PenLine, Play, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserSupabase } from '@/lib/realtime';
import { getSector } from '@/lib/sectors';
import { AUDIT_EVENT, type AuditEvent, type AuditKind } from '@/lib/auditTypes';
import { fold, num } from '@/lib/almoxarifado/stockFormat';
import './hub.css';

const KIND: Record<AuditKind, { label: string; icon: typeof LogIn }> = {
  acesso: { label: 'Acessos', icon: LogIn },
  tela: { label: 'Telas', icon: MousePointerClick },
  acao: { label: 'Alterações', icon: PenLine },
  max: { label: 'Max', icon: Bot },
  local: { label: 'Localização', icon: MapPin },
  erro: { label: 'Erros', icon: AlertTriangle },
};
const FILTERS: ('tudo' | AuditKind)[] = ['tudo', 'acao', 'acesso', 'tela', 'max', 'local', 'erro'];
const POLL_MS = 4000;
const KEEP = 1500;

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? 'Hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/**
 * Auditoria: tudo o que as pessoas fazem na plataforma, ao vivo (sem botão de atualizar).
 * Os registros chegam pelo Realtime na hora; a lista também confere o servidor a cada poucos segundos.
 * Não é gravada em banco: recomeça quando a plataforma é publicada de novo.
 */
export function Auditoria() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState('');
  const [live, setLive] = useState<'conectando' | 'ao vivo' | 'conferindo'>('conectando');
  const [filter, setFilter] = useState<'tudo' | AuditKind>('tudo');
  const [person, setPerson] = useState('');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const held = useRef<AuditEvent[]>([]);
  const [heldCount, setHeldCount] = useState(0);
  const [, tick] = useState(0);

  const merge = (incoming: AuditEvent[]) => {
    if (!incoming.length) return;
    if (pausedRef.current) {
      held.current.push(...incoming);
      setHeldCount(held.current.length);
      return;
    }
    setEvents((cur) => {
      const seen = new Set(cur.map((e) => e.id));
      const add = incoming.filter((e) => !seen.has(e.id));
      if (!add.length) return cur;
      return [...cur, ...add].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, KEEP);
    });
  };

  useEffect(() => {
    let alive = true;
    let topic: string | null = null;
    const sb = browserSupabase();
    let channel: ReturnType<NonNullable<typeof sb>['channel']> | null = null;
    const load = async () => {
      try {
        const r = await fetch('/api/hub/auditoria', { cache: 'no-store', credentials: 'same-origin' });
        const j = (await r.json()) as { events?: AuditEvent[]; topic?: string; error?: string };
        if (!r.ok) throw new Error(j.error || 'Não consegui carregar a auditoria.');
        if (!alive) return;
        merge(j.events ?? []);
        setLoaded(true);
        setFailed('');
        // canal ao vivo (o nome vem do servidor e só o master recebe)
        if (!topic && j.topic && sb) {
          topic = j.topic;
          channel = sb.channel(topic, { config: { broadcast: { self: false } } });
          channel.on('broadcast', { event: AUDIT_EVENT }, (msg) => merge([msg.payload as AuditEvent]));
          channel.subscribe((status) => alive && setLive(status === 'SUBSCRIBED' ? 'ao vivo' : 'conferindo'));
        } else if (!sb) setLive('conferindo');
      } catch (e) {
        if (alive) setFailed((e as Error).message);
      }
    };
    void load();
    const poll = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    // "há 5 s" vai mudando sozinho
    const clock = setInterval(() => tick((n) => n + 1), 15_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
      if (channel && sb) void sb.removeChannel(channel);
    };
    // merge usa refs: não precisa recriar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    events.forEach((e) => m.set(e.user.id ?? e.user.name, e.user.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const shown = useMemo(() => {
    const t = fold(query.trim());
    return events.filter(
      (e) =>
        (filter === 'tudo' || e.kind === filter || (filter === 'erro' && !e.ok)) &&
        (!person || (e.user.id ?? e.user.name) === person) &&
        (!t || fold(`${e.user.name} ${e.user.username ?? ''} ${e.action} ${e.detail ?? ''} ${e.device ?? ''}`).includes(t)),
    );
  }, [events, filter, person, query]);

  const stats = useMemo(() => {
    const now = Date.now();
    const today = new Date().toDateString();
    const active = new Set(events.filter((e) => now - Date.parse(e.at) < 10 * 60_000 && e.user.id).map((e) => e.user.id));
    return {
      active: active.size,
      today: events.filter((e) => new Date(e.at).toDateString() === today && e.kind === 'acao').length,
      errors: events.filter((e) => !e.ok && new Date(e.at).toDateString() === today).length,
      blocked: events.filter((e) => e.kind === 'local' && !e.ok && new Date(e.at).toDateString() === today).length,
    };
  }, [events]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { tudo: events.length };
    for (const e of events) {
      c[e.kind] = (c[e.kind] ?? 0) + 1;
      if (!e.ok && e.kind !== 'erro') c.erro = (c.erro ?? 0) + 1;
    }
    return c;
  }, [events]);

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Auditoria</h1>
            <p>Tudo o que cada pessoa faz na plataforma, na hora em que acontece.</p>
          </div>
          <div className="head-actions">
            <span className={`au-live is-${live === 'ao vivo' ? 'on' : 'poll'}`} title={live === 'ao vivo' ? 'Recebendo na hora' : 'Conferindo a cada poucos segundos'}>
              <i /> {live === 'ao vivo' ? 'Ao vivo' : live === 'conectando' ? 'Conectando…' : 'Atualizando sozinho'}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (paused) {
                  const h = held.current.splice(0);
                  setHeldCount(0);
                  setPaused(false);
                  pausedRef.current = false;
                  merge(h);
                } else setPaused(true);
              }}
            >
              {paused ? <Play size={17} /> : <Pause size={17} />} {paused ? `Continuar${heldCount ? ` (${heldCount} novos)` : ''}` : 'Pausar'}
            </button>
          </div>
        </div>

        <div className="au-stats">
          <div>
            <small>Pessoas ativas agora</small>
            <b>{num(stats.active)}</b>
            <span>nos últimos 10 minutos</span>
          </div>
          <div>
            <small>Alterações hoje</small>
            <b>{num(stats.today)}</b>
            <span>cadastros, entradas, saídas…</span>
          </div>
          <div className={stats.errors ? 'is-warn' : ''}>
            <small>Erros e recusas hoje</small>
            <b>{num(stats.errors)}</b>
            <span>senha errada, sem permissão…</span>
          </div>
          <div className={stats.blocked ? 'is-warn' : ''}>
            <small>Bloqueios de localização</small>
            <b>{num(stats.blocked)}</b>
            <span>fora da área da empresa</span>
          </div>
        </div>

        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input className="input" placeholder="Buscar por pessoa, ação ou detalhe" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar na auditoria" />
          </div>
          <select className="select au-person" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filtrar por pessoa">
            <option value="">Todas as pessoas</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-seg au-kinds" role="tablist" aria-label="Tipo">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
              {f === 'tudo' ? 'Tudo' : KIND[f].label} <em>{num(counts[f] ?? 0)}</em>
            </button>
          ))}
        </div>

        {failed && !loaded ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertTriangle size={24} />
            </span>
            <strong>Não foi possível carregar</strong>
            <span>{failed}</span>
          </div>
        ) : !loaded ? (
          <div className="skeleton" style={{ height: 260, borderRadius: 16 }} />
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <ShieldCheck size={24} />
            </span>
            <strong>{events.length ? 'Nada com esse filtro' : 'Nenhum registro ainda'}</strong>
            <span>{events.length ? 'Tente outro filtro ou outra busca.' : 'Assim que alguém entrar, abrir uma tela ou fizer uma alteração, aparece aqui na hora.'}</span>
          </div>
        ) : (
          <ol className="au-list">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.slice(0, 400).map((e) => {
                const K = KIND[e.ok || e.kind !== 'acao' ? e.kind : 'erro'] ?? KIND.acao;
                const sector = e.user.master ? 'Master geral' : e.user.sector ? getSector(e.user.sector)?.name ?? e.user.sector : null;
                return (
                  <motion.li
                    key={e.id}
                    layout="position"
                    className={`au-row k-${e.kind}${e.ok ? '' : ' is-bad'}`}
                    initial={{ opacity: 0, y: -14, rotateX: -35, transformPerspective: 900 }}
                    animate={{ opacity: 1, y: 0, rotateX: 0, transitionEnd: { transform: 'none' } }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  >
                    <span className="au-time" title={new Date(e.at).toLocaleString('pt-BR')}>
                      <b>{time(e.at)}</b>
                      <small>{day(e.at)}</small>
                    </span>
                    <span className="au-ico" aria-hidden>
                      <K.icon size={16} />
                    </span>
                    <span className="au-who">
                      <span className="au-avatar">{initials(e.user.name)}</span>
                      <span>
                        <b>{e.user.name}</b>
                        <small>{[e.user.username ? '@' + e.user.username : null, sector].filter(Boolean).join(' · ')}</small>
                      </span>
                    </span>
                    <span className="au-what">
                      <b>{e.action}</b>
                      {e.detail ? <small>{e.detail}</small> : null}
                    </span>
                    <span className="au-meta">
                      {e.ok ? null : <span className="au-bad">não deu certo</span>}
                      <small>{[e.device, e.ip].filter(Boolean).join(' · ')}</small>
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
        <p className="help" style={{ marginTop: 14 }}>
          Os registros ficam só na memória da plataforma (não são gravados em banco) e recomeçam quando ela é publicada de novo.
        </p>
      </div>
    </div>
  );
}
