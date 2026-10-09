'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard, Mic, SendHorizontal, Square, ThumbsDown, ThumbsUp, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking, loadVoices } from '@/lib/voice';
import { capabilities } from '@/lib/max/skills-core';
import { examplesFor, hear, think, type AgentAnswer, type RemoteAnswer } from '@/lib/max/engine';
import { Listener, listenSupported, type ListenState } from '@/lib/max/speech';
import { signatureKey, type Learned } from '@/lib/max/learn';

/** quanto ela espera alguém falar: depois do clique · depois de uma resposta (para continuar a conversa) */
const WAIT_MS = 14000;
const FOLLOW_MS = 8000;
import { sfx } from '@/lib/max/sfx';
import type { MaxCard, MaxHost, MaxMemory, MaxReply } from '@/lib/max/types';
import { MaxOrb, type OrbState } from './MaxOrb';
import './max.css';

interface Entry {
  id: number;
  who: 'you' | 'max';
  text: string;
  card?: MaxCard;
  chips?: string[];
  source?: string;
  /** pedido que gerou esta resposta (para o 👍/👎) */
  asked?: string;
  rated?: 'up' | 'down';
}

const VOICE_PREF = 'maxhub:voz';
const SOURCE_LABEL: Record<string, string> = { wikipedia: 'Wikipédia', clima: 'Open-Meteo', cambio: 'cotação online', ia: 'IA', web: 'pesquisa na web', memoria: 'aprendido com o uso' };

/**
 * A Max nas ferramentas dos setores: a esfera no canto inferior direito.
 * Clique nela, espere ficar verde e diga "Max, …". Também aceita o pedido digitado.
 */
export function MaxAssistant({ host }: { host: MaxHost }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<OrbState>('idle');
  const [listen, setListen] = useState<ListenState>('off');
  const [interim, setInterim] = useState('');
  const [feed, setFeed] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [voiceOn, setVoiceOn] = useState(true);
  const [note, setNote] = useState('');
  const [typing, setTyping] = useState(false);

  const hostRef = useRef(host);
  hostRef.current = host;
  const listener = useRef<Listener | null>(null);
  const seq = useRef(0);
  const idSeq = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const followUp = useRef(false);
  const startRef = useRef<(follow?: boolean) => void>(() => undefined);
  const memory = useRef<MaxMemory>({ last: null, lastInput: '', voiceOn: true, setVoice: () => undefined });

  const setVoice = useCallback((on: boolean) => {
    memory.current.voiceOn = on;
    setVoiceOn(on);
    if (!on) stopSpeaking();
    try {
      localStorage.setItem(VOICE_PREF, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);
  memory.current.setVoice = setVoice;

  useEffect(() => {
    try {
      if (localStorage.getItem(VOICE_PREF) === 'off') {
        memory.current.voiceOn = false;
        setVoiceOn(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const push = useCallback((e: Omit<Entry, 'id'>) => {
    setFeed((f) => [...f.slice(-11), { ...e, id: ++idSeq.current }]);
  }, []);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed, interim, status]);

  const remote = useCallback(async (text: string, examples: string[], mode?: 'route'): Promise<RemoteAnswer | null> => {
    const h = hostRef.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), mode === 'route' ? 7000 : 15000);
    try {
      const r = await fetch('/api/max/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ text, examples, mode, scope: h.scope, sector: h.sector?.slug ?? null }),
      });
      if (!r.ok) return null;
      return (await r.json()) as RemoteAnswer;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  /** O que a Max já aprendeu nesta tela (pedidos resolvidos antes viram resposta na hora). */
  const learned = useRef<Learned[]>([]);
  const place = () => {
    const h = hostRef.current;
    return { scope: h.scope, sector: h.sector?.slug ?? null };
  };
  const loadLearned = useCallback(async () => {
    const { scope, sector } = place();
    if (scope === 'login') return;
    try {
      const r = await fetch(`/api/max/memoria?scope=${scope}&sector=${sector ?? ''}`, { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const j = (await r.json()) as { learned?: Learned[] };
      if (Array.isArray(j.learned)) learned.current = j.learned;
    } catch {
      /* sem memória: segue normal */
    }
  }, []);
  useEffect(() => {
    void loadLearned();
  }, [loadLearned, host.scope, host.sector?.slug]);
  const tell = useCallback((body: Record<string, unknown>) => {
    void fetch('/api/max/memoria', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...place(), ...body }) }).catch(() => undefined);
  }, []);

  /** Agente do servidor: IA com ferramentas (consulta, prepara alterações, pesquisa na web). */
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const agent = useCallback(async (text: string, examples: string[], hint?: string): Promise<AgentAnswer | null> => {
    const h = hostRef.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    try {
      const r = await fetch('/api/max/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ text, examples, hint, scope: h.scope, sector: h.sector?.slug ?? null, history: history.current.slice(-6) }),
      });
      if (!r.ok) return null;
      const ans = (await r.json()) as AgentAnswer;
      if (ans.route) setTimeout(() => void loadLearned(), 1500); // acabou de aprender um comando: atualiza a memória
      return ans;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }, [loadLearned]);

  const close = useCallback(() => {
    seq.current++;
    listener.current?.stop();
    stopSpeaking();
    setStatus('idle');
    setInterim('');
    setOpen(false);
    setTyping(false);
  }, []);

  /** Processa um pedido (falado ou digitado). */
  const ask = useCallback(
    async (raw: string, byVoice = false) => {
      const shown = raw.trim();
      if (!shown) return;
      const my = ++seq.current;
      listener.current?.stop();
      stopSpeaking();
      setInterim('');
      setNote('');
      const h = hear(shown);
      // o clique já é a chamada: "Max," no começo é aceito, mas não obrigatório
      const command = h.wake === 'strong' ? h.command : shown;
      push({ who: 'you', text: shown });
      setStatus('thinking');
      let reply: MaxReply;
      try {
        reply = await think(command, hostRef.current, {
          memory: memory.current,
          remote,
          agent,
          raw: shown,
          learned: learned.current,
          report: (e) => {
            if (e.type === 'feedback') {
              const k = signatureKey(shown);
              learned.current = learned.current.filter((l) => signatureKey(l.phrase) !== k);
            }
            tell({ ...e, phrase: shown });
          },
        });
      } catch {
        reply = { say: 'Tive um problema para responder. Tente de novo.' };
      }
      if (my !== seq.current) return;
      if (reply.source === 'stop') return close();
      memory.current.last = reply;
      memory.current.lastInput = shown;
      history.current = [...history.current, { role: 'user' as const, content: shown }, { role: 'assistant' as const, content: reply.say || reply.text || '' }].filter((m) => m.content).slice(-8);
      push({ who: 'max', text: reply.text ?? reply.say, card: reply.card, chips: reply.chips, source: reply.source, asked: reply.source === 'bloqueio' || reply.source === 'stop' ? undefined : shown });
      try {
        await reply.act?.();
      } catch (e) {
        console.error('[max] ação', e);
      }
      const done = () => {
        if (my !== seq.current) return;
        setStatus('idle');
        reply.afterSpeech?.();
        // conversa natural: quem falou pode continuar falando, sem clicar de novo
        if (byVoice && !reply.afterSpeech && !reply.unknown && openRef.current) startRef.current(true);
      };
      if (!reply.say || !memory.current.voiceOn) {
        if (reply.afterSpeech) {
          setStatus('idle');
          setTimeout(done, 900);
        } else done();
        return;
      }
      setStatus('speaking');
      speak(reply.say, {
        onEnd: (result) => {
          if (result === 'cancelled' && my !== seq.current) return;
          done();
        },
      });
    },
    [close, push, remote, agent, tell],
  );

  /** 👍/👎: é assim que a Max aprende o que acertou e o que errou. */
  const rate = useCallback(
    (e: Entry, good: boolean) => {
      if (!e.asked || e.rated) return;
      setFeed((f) => f.map((x) => (x.id === e.id ? { ...x, rated: good ? 'up' : 'down' } : x)));
      if (!good) {
        const k = signatureKey(e.asked);
        learned.current = learned.current.filter((l) => signatureKey(l.phrase) !== k);
      }
      tell({ type: 'feedback', good, phrase: e.asked, answer: e.text });
    },
    [tell],
  );

  const startListening = useCallback((follow = false) => {
    const l = listener.current;
    if (!l) return;
    followUp.current = follow;
    if (follow && (l.state === 'denied' || !listenSupported())) return;
    seq.current++;
    stopSpeaking();
    setInterim('');
    setNote('');
    if (!listenSupported()) {
      setTyping(true);
      setNote('Este navegador não tem reconhecimento de voz (use Chrome, Edge ou Safari). Digite o pedido abaixo.');
      setStatus('idle');
      setTimeout(() => inputRef.current?.focus(), 60);
      return;
    }
    setStatus('listening');
    l.start(follow ? FOLLOW_MS : WAIT_MS);
  }, []);
  startRef.current = startListening;

  useEffect(() => {
    const l = new Listener({
      mode: 'once',
      onTrouble: (kind) => {
        setStatus('idle');
        setTyping(true);
        setNote(
          kind === 'mic'
            ? 'Não encontrei um microfone neste aparelho. Digite o pedido abaixo.'
            : 'O reconhecimento de voz deste navegador não respondeu (alguns, como Brave e Opera, bloqueiam). No Chrome ou no Edge eu ouço normalmente. Por aqui, digite o pedido.',
        );
      },
      onState: (s) => {
        setListen(s);
        if (s === 'denied') {
          setStatus('idle');
          setTyping(true);
          setNote('O microfone está bloqueado para este site. Libere no cadeado da barra de endereço, ou digite o pedido.');
        }
      },
      onInterim: (t) => setInterim(t),
      onFinal: (text, alts) => {
        // entre as alternativas ouvidas, prefere a que começa com "Max"
        const best = alts.find((a) => hear(a).wake === 'strong') ?? text;
        sfx.heard();
        void ask(best, true);
      },
      onSilence: () => {
        setInterim('');
        setStatus((s) => (s === 'listening' ? 'idle' : s));
        // depois de uma resposta, o silêncio só encerra a conversa (sem aviso)
        if (openRef.current && !followUp.current) setNote('Não ouvi nada. Clique em mim e fale de novo, ou digite o pedido.');
      },
    });
    listener.current = l;
    return () => {
      l.destroy();
      listener.current = null;
      stopSpeaking();
    };
  }, [ask]);

  const orbClick = () => {
    if (!open) {
      setOpen(true);
      loadVoices();
      startListening();
      return;
    }
    if (status === 'listening') {
      listener.current?.stop();
      setStatus('idle');
      setInterim('');
      return;
    }
    startListening();
  };

  // Esc fecha; Alt+M abre/ouve
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        // não rouba o Esc de janelas abertas por cima
        if (document.querySelector('.overlay, .drawer-overlay')) return;
        close();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM') {
        e.preventDefault();
        if (!openRef.current) {
          setOpen(true);
          loadVoices();
        }
        startListening();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close, startListening]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput('');
    void ask(t);
  };

  const label = status === 'listening' ? 'Ouvindo…' : status === 'thinking' ? 'Pensando…' : status === 'speaking' ? 'Falando…' : 'Pronta';
  const chips = feed.length ? [] : capabilities(host);
  const micReady = listen !== 'unsupported' && listen !== 'denied';

  return (
    <div className={`max-dock${open ? ' is-open' : ''}`}>
      <AnimatePresence>
        {open ? (
          <motion.section
            className="max-panel"
            role="dialog"
            aria-label="Max, assistente virtual"
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <header className="max-head">
              <div>
                <strong>Max</strong>
                <span className={`max-status is-${status}`} aria-live="polite">
                  {label}
                </span>
              </div>
              <button className="icon-btn" onClick={() => setVoice(!voiceOn)} aria-label={voiceOn ? 'Desligar a voz da Max' : 'Ligar a voz da Max'} title={voiceOn ? 'Voz ligada' : 'Voz desligada'}>
                {voiceOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
              <button className="icon-btn" onClick={close} aria-label="Fechar a Max" title="Fechar (Esc)">
                <X size={17} />
              </button>
            </header>

            <div className="max-feed" ref={feedRef}>
              {feed.length === 0 && !interim ? (
                <p className="max-empty">
                  {status === 'listening' ? 'Pode falar. Comece com “Max,” e diga o que precisa.' : 'Clique na esfera e diga “Max,” seguido do pedido.'}
                </p>
              ) : null}
              {feed.map((e) => (
                <div key={e.id} className={`max-msg ${e.who}`}>
                  {e.text ? <p>{e.text}</p> : null}
                  {e.card ? <Card card={e.card} /> : null}
                  {e.source && SOURCE_LABEL[e.source] ? <small className="max-source">Fonte: {SOURCE_LABEL[e.source]}</small> : null}
                  {e.who === 'max' && e.asked ? (
                    <div className={`max-rate${e.rated ? ' is-rated' : ''}`}>
                      {e.rated ? (
                        <small>{e.rated === 'up' ? 'Obrigada! Guardei que acertei.' : 'Anotado. Vou melhorar nisso.'}</small>
                      ) : (
                        <>
                          <button onClick={() => rate(e, true)} aria-label="Resposta certa" title="Acertou">
                            <ThumbsUp size={13} />
                          </button>
                          <button onClick={() => rate(e, false)} aria-label="Resposta errada" title="Errou">
                            <ThumbsDown size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                  {e.chips?.length ? (
                    <div className="max-chips">
                      {e.chips.map((c) => (
                        <button key={c} onClick={() => void ask(c)}>
                          {c}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {interim ? (
                <div className="max-msg you is-interim">
                  <p>{interim}</p>
                </div>
              ) : null}
              {status === 'thinking' ? (
                <div className="max-msg max is-thinking" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {note ? <p className="max-note">{note}</p> : null}
              {chips.length ? (
                <div className="max-chips">
                  {chips.map((c) => (
                    <button key={c} onClick={() => void ask(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {typing ? (
              <form className="max-input" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className="input"
                  value={input}
                  maxLength={300}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Max, …"
                  aria-label="Pedido para a Max"
                  autoComplete="off"
                />
                <button className="icon-btn" type="submit" disabled={!input.trim()} aria-label="Enviar pedido">
                  <SendHorizontal size={18} />
                </button>
              </form>
            ) : (
              <div className="max-foot">
                {status === 'speaking' ? (
                  <button
                    className="max-foot-btn"
                    onClick={() => {
                      seq.current++;
                      stopSpeaking();
                      setStatus('idle');
                    }}
                  >
                    <Square size={13} /> Parar de falar
                  </button>
                ) : micReady ? (
                  <button className="max-foot-btn" onClick={orbClick}>
                    <Mic size={14} /> {status === 'listening' ? 'Parar de ouvir' : 'Falar'}
                  </button>
                ) : null}
                <button
                  className="max-foot-btn"
                  onClick={() => {
                    setTyping(true);
                    setTimeout(() => inputRef.current?.focus(), 60);
                  }}
                >
                  <Keyboard size={14} /> Digitar
                </button>
              </div>
            )}
          </motion.section>
        ) : null}
      </AnimatePresence>

      <button
        className={`max-fab is-${status}`}
        onClick={orbClick}
        aria-label={open ? (status === 'listening' ? 'Max está ouvindo. Clique para parar' : 'Falar com a Max') : 'Abrir a Max, assistente virtual'}
        aria-expanded={open}
        title="Max (Alt+M)"
      >
        <MaxOrb size={128} state={status} />
      </button>
    </div>
  );
}

function Card({ card }: { card: MaxCard }) {
  if (card.kind === 'stats') {
    return (
      <div className="max-card">
        {card.title ? <b className="max-card-title">{card.title}</b> : null}
        <div className="max-stats">
          {card.stats.map((s) => (
            <div key={s.label} className={`max-stat ${s.tone ?? 'plain'}${s.value.length > 8 ? ' is-long' : ''}`}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {card.foot ? <small>{card.foot}</small> : null}
      </div>
    );
  }
  return (
    <div className="max-card">
      {card.title ? <b className="max-card-title">{card.title}</b> : null}
      <ul className="max-rows">
        {card.rows.map((r, i) => (
          <li key={i}>
            <span>
              {r.label}
              {r.sub ? <small>{r.sub}</small> : null}
            </span>
            {r.value ? <b>{r.value}</b> : null}
          </li>
        ))}
      </ul>
      {card.foot ? <small>{card.foot}</small> : null}
    </div>
  );
}
