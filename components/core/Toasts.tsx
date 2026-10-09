'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Bell, Check, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Kind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
}
type Push = (t: Omit<Toast, 'id'>, ms?: number) => void;

const Ctx = createContext<Push>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(
    (t, ms = 4200) => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.kind}`}
              initial={{ opacity: 0, y: -16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span className="toast-icon">
                {t.kind === 'error' ? <AlertCircle size={16} /> : t.kind === 'success' ? <Check size={16} /> : <Bell size={16} />}
              </span>
              <div className="toast-body">
                <b>{t.title}</b>
                {t.text ? <span>{t.text}</span> : null}
              </div>
              {t.action ? (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : (
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => dismiss(t.id)} aria-label="Fechar">
                  <X size={15} />
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
