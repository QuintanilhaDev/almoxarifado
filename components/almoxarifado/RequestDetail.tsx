'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Copy, Download, Mail, PackageMinus, Play, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { answerToText, formatBytes, formatDateTime, initials, protocolLabel } from '@/lib/format';
import { STATUS_SINGULAR, type StockApplication, type AdminUser, type Attachment, type AuthorizedEmail, type RequestRow, type RequestStatus } from '@/lib/almoxarifado/types';
import { useToast } from '../core/Toasts';
import { api } from '../core/api';
import { ConfirmModal } from '../core/Modal';
import { toneFor } from './Inbox';
import { ReplyComposer } from './ReplyComposer';
import './reply.css';

const STATUS_COLOR: Record<RequestStatus, string> = {
  nova: 'var(--lilac)',
  pendente: 'var(--amber)',
  resolvida: 'var(--mint)',
};

export function RequestDetail({
  request,
  supervisor,
  onBack,
  onChanged,
  onDeleted,
  version,
  me,
}: {
  request: RequestRow;
  supervisor: AuthorizedEmail | null;
  onBack: () => void;
  onChanged: (r: RequestRow) => void;
  onDeleted: () => void;
  version: number;
  me: AdminUser | null;
}) {
  const toast = useToast();
  const [attachments, setAttachments] = useState<Attachment[] | null>(request.attachments.length ? null : []);
  const [saving, setSaving] = useState<RequestStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewer, setViewer] = useState<Attachment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [composer, setComposer] = useState(false);
  const [apps, setApps] = useState<StockApplication[]>(request.stock_applications ?? []);
  const [revert, setRevert] = useState<StockApplication | null>(null);
  const [reverting, setReverting] = useState(false);
  useEffect(() => {
    setApps(request.stock_applications ?? []);
  }, [request.id, request.stock_applications]);
  const doRevert = async () => {
    if (!revert) return;
    setReverting(true);
    try {
      const j = await api<{ applications: StockApplication[] }>(`/api/almoxarifado/requests/${request.id}/baixa?app=${encodeURIComponent(revert.id)}`, { method: 'DELETE' });
      setApps(j.applications ?? []);
      toast({ kind: 'success', title: 'Baixa estornada', text: 'Os itens voltaram ao almoxarifado.' });
      setRevert(null);
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível estornar', text: (e as Error).message });
    } finally {
      setReverting(false);
    }
  };

  // busca links temporários dos anexos
  useEffect(() => {
    if (!request.attachments.length) return;
    let alive = true;
    api<{ request: RequestRow }>(`/api/almoxarifado/requests/${request.id}`)
      .then((j) => alive && setAttachments(j.request.attachments))
      .catch(() => alive && setAttachments(request.attachments));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, version]);

  useEffect(() => {
    if (!viewer) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setViewer(null);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [viewer]);

  const setStatus = async (status: RequestStatus) => {
    if (status === request.status || saving) return;
    setSaving(status);
    const optimistic = { ...request, status, handled_by: status === 'nova' ? null : me?.display_name || request.handled_by };
    onChanged(optimistic);
    try {
      const j = await api<{ request: RequestRow }>(`/api/almoxarifado/requests/${request.id}`, {
        method: 'PATCH',
        json: { status },
      });
      onChanged(j.request);
      toast({
        kind: 'success',
        title: status === 'resolvida' ? 'Marcada como resolvida' : status === 'pendente' ? 'Marcada como pendente' : 'Voltou para novas',
      });
    } catch (e) {
      onChanged(request);
      toast({ kind: 'error', title: 'Não foi possível mudar o status', text: (e as Error).message });
    } finally {
      setSaving(null);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(request.email);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = request.email;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/almoxarifado/requests/${request.id}`, { method: 'DELETE' });
      setConfirmDelete(false);
      toast({ kind: 'success', title: `Solicitação ${protocolLabel(request.protocol)} apagada` });
      onDeleted();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível apagar', text: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  const note =
    request.status === 'resolvida' && request.handled_by
      ? `Resolvida por ${request.handled_by} em ${formatDateTime(request.updated_at)}`
      : request.status === 'pendente' && request.handled_by
        ? `Em andamento com ${request.handled_by} desde ${formatDateTime(request.updated_at)}`
        : `Recebida em ${formatDateTime(request.created_at)}`;

  return (
    <div className="detail">
      <div className="detail-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="icon-btn back-btn" onClick={onBack} aria-label="Voltar para a lista">
            <ArrowLeft size={20} />
          </button>
          <span className="detail-protocol">{protocolLabel(request.protocol)}</span>
        </div>
        <button className="icon-btn edit-only" onClick={() => setConfirmDelete(true)} aria-label="Apagar solicitação" title="Apagar">
          <Trash2 size={18} />
        </button>
      </div>

      <motion.div
        className="detail-hero"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="avatar" style={{ background: toneFor(request.collaborator) }}>
          {initials(request.collaborator)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2>{request.collaborator || 'Sem nome'}</h2>
          <p>{request.posto || 'Posto não informado'}</p>
        </div>
      </motion.div>

      <div className="status-seg" role="radiogroup" aria-label="Status">
        {(['nova', 'pendente', 'resolvida'] as RequestStatus[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={request.status === s}
            className={`seg-btn${request.status === s ? ' is-active' : ''}`}
            style={{ ['--status-color' as string]: STATUS_COLOR[s] }}
            onClick={() => setStatus(s)}
            disabled={Boolean(saving)}
          >
            {request.status === s ? (
              <motion.span layoutId="status-bg" className="seg-bg" transition={{ type: 'spring', stiffness: 460, damping: 34 }} />
            ) : null}
            <span>
              {saving === s ? <span className="spinner" style={{ width: 14, height: 14 }} /> : request.status === s ? <Check size={15} strokeWidth={3} /> : null}
              {STATUS_SINGULAR[s]}
            </span>
          </button>
        ))}
      </div>
      <div className="status-note">{note}</div>

      <div className="contact">
        <span className="contact-icon">
          <Mail size={19} />
        </span>
        <div className="contact-body">
          <small>{supervisor?.supervisor_name ? `Supervisor ${supervisor.supervisor_name}` : 'E-mail do supervisor'}</small>
          <b>{request.email}</b>
        </div>
        <div className="contact-actions">
          <button className="btn btn-ghost btn-sm" onClick={copyEmail}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? 'ok' : 'copy'}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                style={{ display: 'inline-flex' }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </motion.span>
            </AnimatePresence>
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button className="btn btn-primary btn-sm edit-only" onClick={() => setComposer(true)}>
            <Mail size={16} /> Responder
          </button>
        </div>
      </div>

      <dl className="answers">
        {request.answers
          .filter((a) => a.fieldId !== 'colaborador' && a.fieldId !== 'posto')
          .map((a) => (
          <div className="answer" key={a.fieldId}>
            <dt>{a.label}</dt>
            <dd>
              {Array.isArray(a.value) ? (
                <span className="chips">
                  {a.value.map((v) => (
                    <span className="tag" key={v}>
                      {v}
                    </span>
                  ))}
                </span>
              ) : a.type === 'date' ? (
                String(a.value).split('-').reverse().join('/')
              ) : (
                answerToText(a.value)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {request.attachments.length > 0 && (
        <>
          <h3 className="block-title">Fotos e vídeos ({request.attachments.length})</h3>
          <div className="gallery">
            {(attachments || request.attachments).map((a) =>
              !attachments ? (
                <div key={a.path} className="skeleton" style={{ aspectRatio: '1' }} />
              ) : (
                <button key={a.path} onClick={() => a.url && setViewer(a)} aria-label={`Abrir ${a.name}`} title={`${a.name} (${formatBytes(a.size)})`}>
                  {a.type.startsWith('video/') ? (
                    <>
                      <video src={a.url ? a.url + '#t=0.1' : undefined} muted playsInline preload="metadata" />
                      <span className="play">
                        <Play size={26} fill="white" />
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} loading="lazy" />
                  )}
                </button>
              ),
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {viewer ? (
          <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewer(null)}>
            <div className="lightbox-bar">
              <a className="icon-btn" href={viewer.url} target="_blank" rel="noreferrer" aria-label="Abrir em nova aba" onClick={(e) => e.stopPropagation()}>
                <Download size={18} />
              </a>
              <button className="icon-btn" aria-label="Fechar" onClick={() => setViewer(null)}>
                <X size={18} />
              </button>
            </div>
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              {viewer.type.startsWith('video/') ? (
                <video className="lightbox-media" src={viewer.url} controls autoPlay playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="lightbox-media" src={viewer.url} alt={viewer.name} />
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {apps.length > 0 ? (
        <div className="apps-box">
          <h3 className="block-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <PackageMinus size={18} /> Baixas de estoque
          </h3>
          {apps.map((a) => (
            <div key={a.id} className={`app-card${a.reverted ? ' is-reverted' : ''}`}>
              <div className="app-top">
                <small>
                  {formatDateTime(a.at)} · {a.by}
                  {a.mode === 'transferencia' && a.posto_name ? ` · para ${a.posto_name}` : ' · saída'}
                  {a.reverted ? ` · estornada${a.reverted_by ? ' por ' + a.reverted_by : ''}` : ''}
                </small>
                {!a.reverted ? (
                  <button className="btn btn-ghost btn-sm edit-only" onClick={() => setRevert(a)}>
                    <Undo2 size={15} /> Estornar
                  </button>
                ) : null}
              </div>
              <ul>
                {a.lines.map((l, i) => (
                  <li key={i}>
                    {l.quantity}× {l.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {composer ? (
        <ReplyComposer request={request} supervisor={supervisor} applications={apps} onClose={() => setComposer(false)} onApplied={setApps} />
      ) : null}
      <ConfirmModal
        open={Boolean(revert)}
        title="Estornar esta baixa?"
        text="Os itens voltam ao almoxarifado (e saem do posto, se houve transferência). Só dá para estornar uma vez."
        confirmLabel="Estornar"
        danger
        busy={reverting}
        onConfirm={doRevert}
        onClose={() => setRevert(null)}
      />

      <ConfirmModal
        open={confirmDelete}
        title={`Apagar ${protocolLabel(request.protocol)}?`}
        text="A solicitação e os anexos serão apagados para sempre. Para só guardar, marque como resolvida."
        confirmLabel="Apagar"
        danger
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
