'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Inbox as InboxIcon, Search, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { answerToText, initials, protocolLabel, timeAgo } from '@/lib/format';
import { STATUS_LABEL, type AdminUser, type AuthorizedEmail, type RequestRow, type RequestStatus } from '@/lib/almoxarifado/types';
import { RequestDetail } from './RequestDetail';
import { useMaxBus } from '@/lib/max/bus';

const AVATAR_TONES = ['#c6a8ff', '#d8c4ff', '#b394f7', '#e4d6ff', '#a982ff', '#cdb6ff'];
export function toneFor(s: string | null | undefined) {
  let h = 0;
  for (const c of s || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

const ORDER: RequestStatus[] = ['nova', 'pendente', 'resolvida'];

export function Inbox({
  requests,
  setRequests,
  reload,
  emailMap,
  detailVersion,
  me,
}: {
  requests: RequestRow[] | null;
  setRequests: React.Dispatch<React.SetStateAction<RequestRow[] | null>>;
  reload: () => Promise<void>;
  emailMap: Map<string, AuthorizedEmail>;
  detailVersion: number;
  me: AdminUser | null;
}) {
  const [filter, setFilter] = useState<RequestStatus>('nova');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setNow] = useState(0);
  const [wantProtocol, setWantProtocol] = useState<number | null>(null);

  // pedidos da Max: "mostrar as pendentes", "abrir a solicitação 12"
  useMaxBus('almox:inbox', (p) => {
    if (p.filter) setFilter(p.filter);
    setQuery(p.query ?? '');
    if (p.protocol !== undefined) setWantProtocol(p.protocol);
    else setSelectedId(null);
  });
  useEffect(() => {
    if (wantProtocol === null || !requests) return;
    const r = requests.find((x) => x.protocol === wantProtocol);
    if (r) {
      setFilter(r.status);
      setSelectedId(r.id);
    }
    setWantProtocol(null);
  }, [wantProtocol, requests]);

  // atualiza os "há x min" a cada 30s
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c: Record<RequestStatus, number> = { nova: 0, pendente: 0, resolvida: 0 };
    (requests || []).forEach((r) => c[r.status]++);
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (requests || []).filter((r) => {
      if (r.status !== filter) return false;
      if (!q) return true;
      const hay = [
        r.collaborator,
        r.posto,
        r.email,
        emailMap.get(r.email)?.supervisor_name,
        protocolLabel(r.protocol),
        String(r.protocol),
        ...r.answers.map((a) => answerToText(a.value)),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [requests, filter, query, emailMap]);

  const selected = useMemo(() => (requests || []).find((r) => r.id === selectedId) || null, [requests, selectedId]);

  // se a solicitação aberta foi apagada por outra pessoa, fecha
  useEffect(() => {
    if (selectedId && requests && !requests.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [requests, selectedId]);

  const preview = (r: RequestRow) => {
    const motivo = r.answers.find((a) => a.fieldId === 'motivo') || r.answers.find((a) => a.type === 'textarea');
    const parts = [r.posto, motivo ? answerToText(motivo.value) : null].filter(Boolean);
    return parts.join(' — ') || r.email;
  };

  const onStatusChanged = (row: RequestRow) => {
    setRequests((list) => (list ? list.map((r) => (r.id === row.id ? row : r)) : list));
  };

  return (
    <div className="inbox">
      <section className="list-pane" aria-label="Lista de solicitações">
        <div className="list-head">
          <h1>Solicitações</h1>
          <div className="search">
            <Search size={17} />
            <input
              className="input"
              placeholder="Buscar colaborador, posto, nº…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar solicitações"
            />
          </div>
          <div className="seg" role="tablist">
            {ORDER.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={filter === s}
                className={`seg-btn${filter === s ? ' is-active' : ''}`}
                onClick={() => setFilter(s)}
              >
                {filter === s ? (
                  <motion.span layoutId="filter-bg" className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                ) : null}
                <span>
                  {STATUS_LABEL[s]} <em>{counts[s]}</em>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="list">
          {requests === null ? (
            [0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 10px', alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 46, height: 46, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 14, width: '55%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '80%' }} />
                </div>
              </div>
            ))
          ) : visible.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">{query ? <SearchX size={24} /> : <InboxIcon size={24} />}</span>
              <strong>{query ? 'Nada encontrado' : emptyTitle(filter)}</strong>
              <span>{query ? 'Tente outro nome, posto ou número.' : emptyText(filter)}</span>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {visible.map((r) => (
                <motion.button
                  layout="position"
                  key={r.id}
                  className={`req-item${r.id === selectedId ? ' is-selected' : ''}${r.status === 'nova' ? ' is-new' : ''}`}
                  onClick={() => setSelectedId(r.id)}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <span className="avatar" style={{ background: toneFor(r.collaborator) }}>
                    {initials(r.collaborator)}
                  </span>
                  <span className="req-item-body">
                    <span className="req-item-top">
                      <span className="req-item-name">{r.collaborator || 'Sem nome'}</span>
                      <span className="req-item-time">{timeAgo(r.created_at)}</span>
                    </span>
                    <span className="req-item-sub" style={{ display: 'block' }}>
                      {protocolLabel(r.protocol)} {preview(r)}
                    </span>
                  </span>
                  {r.status === 'nova' ? <span className="unread" aria-label="nova" /> : <span />}
                </motion.button>
              ))}
            </AnimatePresence>
          )}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {selected ? (
          <motion.section
            key="detail"
            className="detail-pane"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <RequestDetail
              key={selected.id}
              request={selected}
              supervisor={emailMap.get(selected.email) || null}
              onBack={() => setSelectedId(null)}
              onChanged={onStatusChanged}
              onDeleted={() => {
                setRequests((l) => (l ? l.filter((x) => x.id !== selected.id) : l));
                setSelectedId(null);
                reload();
              }}
              version={detailVersion}
              me={me}
            />
          </motion.section>
        ) : (
          <motion.section
            key="none"
            className="detail-pane detail-empty desktop-only"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <div className="empty">
              <span className="empty-icon">
                <InboxIcon size={24} />
              </span>
              <strong>Escolha uma solicitação</strong>
              <span>Os detalhes aparecem aqui.</span>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function emptyTitle(s: RequestStatus) {
  return s === 'nova' ? 'Nenhuma solicitação nova' : s === 'pendente' ? 'Nada pendente' : 'Nenhuma resolvida ainda';
}
function emptyText(s: RequestStatus) {
  return s === 'nova'
    ? 'Quando um supervisor enviar o formulário, ela aparece aqui na hora.'
    : s === 'pendente'
      ? 'Marque uma solicitação como pendente quando ela estiver em andamento.'
      : 'As solicitações concluídas ficam guardadas aqui.';
}
