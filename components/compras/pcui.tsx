'use client';
import { deg } from '@/lib/fx';
import { motion } from 'framer-motion';
import { Paperclip, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { PO_STATUS, QUOTE_STATUS, parseBRL, poLate, type Attachment, type ComprasConfig, type POStatus, type PurchaseOrder, type Quote, type QuoteStatus } from '@/lib/compras/pc';
import { useRealtime } from '@/lib/realtime';

export function POBadge({ o }: { o: Pick<PurchaseOrder, 'status' | 'promised_date' | 'expected_date'> }) {
  const s = PO_STATUS[o.status as POStatus];
  return (
    <>
      <span className={`pbadge ${s.tone}`}>{s.label}</span>
      {poLate(o) ? <span className="pbadge red">Atrasado</span> : null}
    </>
  );
}
export function QuoteBadge({ status }: { status: QuoteStatus }) {
  return <span className={`pbadge ${QUOTE_STATUS[status].tone}`}>{QUOTE_STATUS[status].label}</span>;
}

/** gaveta lateral (mesmo jeito das outras telas) */
export function Drawer({ label, onClose, children, wide, blockEsc }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean; blockEsc?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !blockEsc && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, blockEsc]);
  return (
    <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside
        className={`drawer o-drawer${wide ? ' pc-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ x: 60, opacity: 0, rotateY: deg(-24), transformPerspective: 1400 }}
        animate={{ x: 0, opacity: 1, rotateY: 0, transitionEnd: { transform: 'none' } }}
        exit={{ x: 60, opacity: 0, rotateY: deg(-18) }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.aside>
    </motion.div>
  );
}
export function DrawerTop({ title, sub, onClose }: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="drawer-top">
      <div style={{ minWidth: 0 }}>
        <h2 className="p-title">{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Fechar">
        <X size={19} />
      </button>
    </div>
  );
}

/** reduz foto grande antes de enviar (DANFE fotografado fica legível e leve) */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
export async function uploadAttachment(file: File, scope: 'nota' | 'cotacao' | 'pedido'): Promise<Attachment> {
  const fd = new FormData();
  fd.append('file', await shrink(file));
  fd.append('scope', scope);
  const j = await api<{ attachment: Attachment }>('/api/anexos', { method: 'POST', body: fd });
  return j.attachment;
}
export const attachmentUrl = (a: Attachment) => `/api/anexos?path=${encodeURIComponent(a.path)}`;

/** lista de anexos com botão de enviar (foto, PDF, planilha…) */
export function Attachments({ list, scope, canEdit, onChange, label = 'Anexos' }: { list: Attachment[]; scope: 'nota' | 'cotacao' | 'pedido'; canEdit: boolean; onChange?: (l: Attachment[]) => void; label?: string }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="pc-att">
      <div className="pc-att-head">
        <Paperclip size={14} /> <b>{label}</b>
        {canEdit && onChange ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()} disabled={busy}>
              {busy ? <span className="spinner" /> : <Upload size={14} />} Anexar
            </button>
            <input
              ref={ref}
              type="file"
              hidden
              accept="image/*,application/pdf,.xml,.xlsx,.xls,.doc,.docx,.txt"
              multiple
              onChange={async (e) => {
                const files = [...(e.target.files ?? [])];
                if (!files.length) return;
                setBusy(true);
                try {
                  const added: Attachment[] = [];
                  for (const f of files.slice(0, 6)) added.push(await uploadAttachment(f, scope));
                  onChange([...list, ...added]);
                } catch (err) {
                  toast({ kind: 'error', title: 'Anexo não enviado', text: (err as Error).message });
                } finally {
                  setBusy(false);
                  if (ref.current) ref.current.value = '';
                }
              }}
            />
          </>
        ) : null}
      </div>
      {list.length ? (
        <ul>
          {list.map((a, i) => (
            <li key={a.path}>
              <a href={attachmentUrl(a)} target="_blank" rel="noreferrer">
                {a.name}
              </a>
              <small>{Math.max(1, Math.round(a.size / 1024))} KB</small>
              {canEdit && onChange ? (
                <button type="button" className="link-btn" onClick={() => onChange(list.filter((_, k) => k !== i))} aria-label={`Tirar ${a.name}`}>
                  tirar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <small className="help">Nenhum arquivo.</small>
      )}
    </div>
  );
}

/** cotações, pedidos de compra e regras, sempre atualizados (tempo real + conferência a cada 30 s) */
export function usePC(enabled = true) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [config, setConfig] = useState<{ config: ComprasConfig; canEdit: boolean } | null>(null);
  const [failed, setFailed] = useState('');
  const [setup, setSetup] = useState(false);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [q, o, c] = await Promise.all([
        api<{ quotes: Quote[] }>('/api/compras/cotacoes'),
        api<{ orders: PurchaseOrder[] }>('/api/compras/pedidos'),
        api<{ config: ComprasConfig; canEdit: boolean }>('/api/compras/config'),
      ]);
      setQuotes(q.quotes);
      setOrders(o.orders);
      setConfig(c);
      setFailed('');
      setSetup(false);
    } catch (e) {
      const err = e as Error & { data?: { setup?: boolean } };
      setFailed(err.message);
      setSetup(Boolean(err.data?.setup));
    }
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(
    (ev) => {
      if (ev === 'purchase:new' || ev === 'purchase:update' || ev === 'note:update') void load();
    },
    () => void load(),
    30_000,
  );
  return { quotes, orders, config, failed, setup, reload: load };
}

export function SetupNote({ text }: { text: string }) {
  return (
    <div className="banner">
      <span>{text}</span>
    </div>
  );
}

/** campo de dinheiro (aceita 1.234,56) */
export const parseMoney = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = parseBRL(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export const moneyIn = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
