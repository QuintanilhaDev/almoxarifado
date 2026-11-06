'use client';
import { Inbox, LifeBuoy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { FrameTab } from './AppFrame';
import { useToast } from './Toasts';
import { useRealtime } from '@/lib/realtime';
import { chime } from '@/lib/chime';
import { maxEmit } from '@/lib/max/bus';
import { isDev, unseenByOwner, waitingDev, type Ticket, type TicketMessage } from '@/lib/chamados';

type Lista = { tickets: Ticket[] };
type Me = { username: string; display_name: string } | null;
export type ChamadoTab = 'chamados' | 'responder';

/** Conversa que está aberta e visível agora (aí não precisa de aviso: a mensagem já aparece no chat). */
let chatVisivel: string | null = null;
export function setChatVisivel(id: string | null) {
  chatVisivel = id;
}

const resumoTexto = (m: TicketMessage) => {
  const t = m.text.replace(/\s+/g, ' ').trim();
  const corpo = t.length > 160 ? `${t.slice(0, 157)}…` : t;
  return corpo || (m.attachments?.length ? '📎 anexo' : '');
};

/**
 * Contadores do menu e avisos de mensagem nova nos chamados.
 * Quem abriu: resposta do desenvolvedor → som, aviso com o texto da mensagem e a Max pisca em amarelo.
 * Desenvolvedor: chamado novo ou mensagem nova de quem abriu → o mesmo aviso.
 */
export function useChamadosResumo(user: Me, go?: (tab: ChamadoTab) => void) {
  const dev = isDev(user);
  const on = !!user;
  const toast = useToast();
  const [r, setR] = useState({ novas: 0, aguardando: 0 });
  const since = useRef<string | null>(null);
  const goRef = useRef(go);
  goRef.current = go;
  const me = user?.display_name ?? '';

  const avisar = useCallback(
    (t: Ticket, m: TicketMessage, tab: ChamadoTab) => {
      if (chatVisivel === t.id && document.visibilityState === 'visible') return;
      chime();
      const abrir = () => {
        goRef.current?.(tab);
        maxEmit('chamados:open', { id: t.id });
      };
      const novo = tab === 'responder' && t.messages.length === 1;
      toast(
        {
          kind: 'info',
          title: tab === 'chamados' ? `Resposta no chamado #${t.number} — ${m.by}` : novo ? `Chamado novo #${t.number} — ${m.by}` : `Mensagem no chamado #${t.number} — ${m.by}`,
          text: resumoTexto(m),
          action: { label: 'Abrir chat', onClick: abrir },
        },
        12000,
      );
      maxEmit('max:announce', {
        text: tab === 'chamados' ? `Você recebeu uma resposta no chamado ${t.number}: ${resumoTexto(m)}` : novo ? `Chamado novo de ${m.by}: ${t.title}` : `${m.by} escreveu no chamado ${t.number}.`,
        tone: 'alert',
      });
    },
    [toast],
  );

  const load = useCallback(async () => {
    if (!on) return;
    try {
      const mine = await api<Lista>('/api/chamados');
      const all = dev ? await api<Lista>('/api/chamados?todos=1') : null;
      const novas = mine.tickets.filter(unseenByOwner).length;
      const aguardando = all ? all.tickets.filter(waitingDev).length : 0;
      setR((o) => (o.novas === novas && o.aguardando === aguardando ? o : { novas, aguardando }));

      // mensagens que chegaram desde a última consulta
      const vistos = [...mine.tickets, ...(all?.tickets ?? [])];
      const ultima = vistos.reduce((mx, t) => t.messages.reduce((a, m) => (m.at > a ? m.at : a), mx), since.current ?? '');
      if (since.current !== null) {
        const de = since.current;
        const avisados = new Set<string>();
        for (const t of mine.tickets) {
          const m = [...t.messages].reverse().find((x) => x.dev && x.at > de && x.by !== me && x.text);
          if (m) {
            avisados.add(t.id);
            avisar(t, m, 'chamados');
          }
        }
        for (const t of all?.tickets ?? []) {
          if (avisados.has(t.id)) continue;
          const m = [...t.messages].reverse().find((x) => !x.dev && x.at > de && x.by !== me && (x.text || x.attachments?.length));
          if (m) avisar(t, m, 'responder');
        }
      }
      since.current = ultima || new Date().toISOString();
    } catch {
      /* o contador é só um aviso */
    }
  }, [dev, on, me, avisar]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime((ev) => ev === 'ticket:update' && load(), load, 30_000);
  return r;
}

/** Abas "Chamados" (todos) e "Responder chamados" (só o desenvolvedor), iguais em todos os painéis. */
export function chamadoTabs(user: { username: string } | null, r: { novas: number; aguardando: number }): FrameTab[] {
  return [
    { id: 'chamados', label: 'Chamados', short: 'Chamados', icon: LifeBuoy, badge: r.novas, badgeTitle: 'Respostas novas do desenvolvedor' },
    ...(isDev(user) ? [{ id: 'responder', label: 'Responder chamados', short: 'Responder', icon: Inbox, badge: r.aguardando, badgeTone: 'warn' as const, badgeTitle: 'Chamados esperando a sua resposta' }] : []),
  ];
}

/** Abas para a Max ("abrir chamado", "responder chamados"). */
export function chamadoMaxTabs(user: { username: string } | null) {
  return [
    { id: 'chamados', label: 'Chamados', aliases: ['chamado', 'chamados', 'abrir chamado', 'suporte', 'desenvolvedor', 'reportar erro', 'relatar erro', 'bug', 'sugestao', 'sugerir melhoria'] },
    ...(isDev(user) ? [{ id: 'responder', label: 'Responder chamados', aliases: ['responder chamados', 'responder chamado', 'fila de chamados', 'chamados abertos'] }] : []),
  ];
}
