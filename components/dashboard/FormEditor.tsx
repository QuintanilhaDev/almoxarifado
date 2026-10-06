'use client';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, GripVertical, Lock, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FIELDS } from '@/lib/defaultForm';
import { EDITABLE_TYPES, FIELD_TYPE_LABEL, type AdminUser, type FieldType, type FormField } from '@/lib/types';
import { useToast } from '../Toasts';
import { api } from './api';
import { ConfirmModal } from './Modal';

const SYSTEM_NOTE: Record<string, string> = {
  email: 'Campo fixo: é ele que confere se o supervisor está autorizado.',
  colaborador: 'Campo fixo: aparece como nome na lista de solicitações.',
  posto: 'Campo fixo: as opções viram a lista de postos.',
  anexos: 'Campo fixo: fotos e vídeos.',
};

export function FormEditor({ version, me }: { version: { n: number; by: string }; me: AdminUser | null }) {
  const toast = useToast();
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [remoteChange, setRemoteChange] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const lastVersion = useRef(version.n);

  const dirty = useMemo(() => fields !== null && JSON.stringify(fields) !== saved, [fields, saved]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    try {
      const j = await api<{ fields: FormField[] }>('/api/admin/form');
      setFields(j.fields);
      setSaved(JSON.stringify(j.fields));
      setRemoteChange('');
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível carregar o formulário', text: (e as Error).message });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // alguém salvou o formulário em outra tela
  useEffect(() => {
    if (version.n === lastVersion.current) return;
    lastVersion.current = version.n;
    if (version.by && version.by === me?.display_name && !dirtyRef.current) return;
    if (dirtyRef.current) setRemoteChange(version.by || 'Outra pessoa');
    else {
      load();
      if (version.by && version.by !== me?.display_name)
        toast({ kind: 'info', title: `${version.by} atualizou o formulário` });
    }
  }, [version, me, load, toast]);

  // avisa antes de sair com alterações não salvas
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const update = (id: string, patch: Partial<FormField>) =>
    setFields((list) => (list ? list.map((f) => (f.id === id ? { ...f, ...patch } : f)) : list));

  const move = (id: string, dir: -1 | 1) =>
    setFields((list) => {
      if (!list) return list;
      const i = list.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const remove = (id: string) => {
    if (!fields) return;
    const index = fields.findIndex((f) => f.id === id);
    const removed = fields[index];
    setFields(fields.filter((f) => f.id !== id));
    toast(
      {
        kind: 'info',
        title: 'Pergunta removida',
        text: removed.label,
        action: {
          label: 'Desfazer',
          onClick: () =>
            setFields((list) => {
              if (!list || list.some((f) => f.id === id)) return list;
              const copy = [...list];
              copy.splice(Math.min(index, copy.length), 0, removed);
              return copy;
            }),
        },
      },
      6000,
    );
  };

  const add = () => {
    const id = 'q_' + Math.random().toString(36).slice(2, 8);
    const field: FormField = { id, label: 'Nova pergunta', type: 'text', required: true };
    setFields((list) => {
      if (!list) return list;
      const anexos = list.findIndex((f) => f.system === 'anexos');
      const copy = [...list];
      // novas perguntas entram antes dos anexos, se eles estiverem no fim
      if (anexos === copy.length - 1) copy.splice(anexos, 0, field);
      else copy.push(field);
      return copy;
    });
    setOpenId(id);
    setTimeout(() => {
      const el = document.getElementById('fe-' + id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el?.querySelector('input') as HTMLInputElement | null)?.select();
    }, 380);
  };

  const save = async () => {
    if (!fields) return;
    const bad = fields.find((f) => !f.label.trim());
    if (bad) {
      setOpenId(bad.id);
      toast({ kind: 'error', title: 'Toda pergunta precisa de um título' });
      return;
    }
    const noOpts = fields.find((f) => (f.type === 'select' || f.type === 'checkbox') && !(f.options || []).length);
    if (noOpts) {
      setOpenId(noOpts.id);
      toast({ kind: 'error', title: 'Adicione opções', text: `"${noOpts.label}" precisa de pelo menos uma opção.` });
      return;
    }
    setSaving(true);
    try {
      const j = await api<{ fields: FormField[] }>('/api/admin/form', { method: 'PUT', json: { fields } });
      setFields(j.fields);
      setSaved(JSON.stringify(j.fields));
      setRemoteChange('');
      toast({ kind: 'success', title: 'Formulário salvo', text: 'Os supervisores já veem a nova versão.' });
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível salvar', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section-scroll">
      <div className="section-pad">
        <div className="section-head">
          <div>
            <h1>Formulário</h1>
            <p>Edite as perguntas que os supervisores respondem. Arraste pela alça para mudar a ordem.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)} disabled={!fields}>
              <RotateCcw size={15} /> Restaurar padrão
            </button>
            <a className="btn btn-ghost btn-sm" href="/solicitacao" target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Ver formulário
            </a>
          </div>
        </div>

        <AnimatePresence>
          {remoteChange ? (
            <motion.div className="banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span>{remoteChange} salvou outra versão do formulário enquanto você editava.</span>
              <button className="btn btn-ghost btn-sm" onClick={load}>
                Carregar a versão dele(a)
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!fields ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 62, marginBottom: 10, borderRadius: 18 }} />)
        ) : (
          <>
            <Reorder.Group axis="y" values={fields} onReorder={setFields} className="fe-list">
              {fields.map((f, i) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  open={openId === f.id}
                  first={i === 0}
                  last={i === fields.length - 1}
                  onToggle={() => setOpenId((o) => (o === f.id ? null : f.id))}
                  onChange={(p) => update(f.id, p)}
                  onRemove={() => remove(f.id)}
                  onMove={(d) => move(f.id, d)}
                />
              ))}
            </Reorder.Group>
            <button className="add-q" onClick={add}>
              <Plus size={18} /> Adicionar pergunta
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {dirty ? (
          <motion.div
            className="savebar"
            initial={{ y: 80, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 80, opacity: 0, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <span>Alterações não salvas</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFields(JSON.parse(saved));
                setRemoteChange('');
              }}
              disabled={saving}
            >
              Descartar
            </button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" style={{ width: 15, height: 15 }} /> : null} Salvar formulário
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmModal
        open={confirmReset}
        title="Restaurar o formulário padrão?"
        text="As perguntas voltam para a versão original. Nada muda para os supervisores até você salvar."
        confirmLabel="Restaurar"
        onConfirm={() => {
          // mantém as opções de posto já cadastradas
          const posto = fields?.find((f) => f.system === 'posto');
          setFields(DEFAULT_FIELDS.map((f) => (f.system === 'posto' && posto ? { ...f, options: posto.options } : { ...f })));
          setConfirmReset(false);
          setOpenId(null);
        }}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}

function FieldCard({
  field,
  open,
  first,
  last,
  onToggle,
  onChange,
  onRemove,
  onMove,
}: {
  field: FormField;
  open: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onChange: (p: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const controls = useDragControls();
  const hasOptions = field.type === 'select' || field.type === 'checkbox';
  const typeOptions: FieldType[] = field.system ? [field.type] : EDITABLE_TYPES;

  const changeType = (type: FieldType) => {
    const patch: Partial<FormField> = { type };
    if ((type === 'select' || type === 'checkbox') && !(field.options || []).length) patch.options = ['Opção 1', 'Opção 2'];
    onChange(patch);
  };

  return (
    <Reorder.Item
      value={field}
      id={'fe-' + field.id}
      dragListener={false}
      dragControls={controls}
      className={`fe-card${open ? ' is-open' : ''}`}
      whileDrag={{ scale: 1.02, boxShadow: '0 30px 60px -20px rgba(0,0,0,.9)', zIndex: 5 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
    >
      <div className="fe-head">
        <span className="fe-grip" onPointerDown={(e) => controls.start(e)} aria-label="Arrastar para reordenar" role="button" tabIndex={-1}>
          <GripVertical size={18} />
        </span>
        <button className="fe-title" onClick={onToggle} aria-expanded={open}>
          <b>{field.label || 'Sem título'}</b>
          <small>
            {FIELD_TYPE_LABEL[field.type]}
            {field.required ? <span className="pill lilac">Obrigatória</span> : <span className="pill">Opcional</span>}
            {field.system ? (
              <span className="pill">
                <Lock size={10} /> Fixo
              </span>
            ) : null}
          </small>
        </button>
        <button className="icon-btn" onClick={onToggle} aria-label={open ? 'Fechar edição' : 'Editar pergunta'}>
          <ChevronDown size={19} className="fe-chevron" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="fe-body">
              <div>
                <label className="fe-label" htmlFor={'lbl-' + field.id}>
                  Pergunta
                </label>
                <input
                  id={'lbl-' + field.id}
                  className="input"
                  value={field.label}
                  maxLength={200}
                  onChange={(e) => onChange({ label: e.target.value })}
                />
              </div>
              <div className="fe-row">
                <div>
                  <label className="fe-label" htmlFor={'help-' + field.id}>
                    Texto de ajuda (opcional)
                  </label>
                  <input
                    id={'help-' + field.id}
                    className="input"
                    value={field.help || ''}
                    maxLength={300}
                    placeholder="Aparece abaixo da pergunta"
                    onChange={(e) => onChange({ help: e.target.value || undefined })}
                  />
                </div>
                <div>
                  <label className="fe-label" htmlFor={'type-' + field.id}>
                    Tipo de resposta
                  </label>
                  <div className="select-wrap">
                    <select
                      id={'type-' + field.id}
                      className="select"
                      value={field.type}
                      disabled={Boolean(field.system)}
                      onChange={(e) => changeType(e.target.value as FieldType)}
                    >
                      {typeOptions.map((t) => (
                        <option key={t} value={t}>
                          {FIELD_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </div>
              </div>

              {['text', 'textarea', 'number', 'email'].includes(field.type) && (
                <div>
                  <label className="fe-label" htmlFor={'ph-' + field.id}>
                    Exemplo dentro do campo (opcional)
                  </label>
                  <input
                    id={'ph-' + field.id}
                    className="input"
                    value={field.placeholder || ''}
                    maxLength={200}
                    onChange={(e) => onChange({ placeholder: e.target.value || undefined })}
                  />
                </div>
              )}

              {hasOptions && <OptionsEditor options={field.options || []} onChange={(options) => onChange({ options })} />}

              <div className="fe-foot">
                <label className="fe-toggle">
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={field.required}
                    disabled={field.system === 'email'}
                    onClick={() => onChange({ required: !field.required })}
                  />
                  Resposta obrigatória
                </label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button className="icon-btn" onClick={() => onMove(-1)} disabled={first} aria-label="Subir">
                    <ArrowUp size={17} />
                  </button>
                  <button className="icon-btn" onClick={() => onMove(1)} disabled={last} aria-label="Descer">
                    <ArrowDown size={17} />
                  </button>
                  {field.system ? null : (
                    <button className="btn btn-danger btn-sm" onClick={onRemove}>
                      <Trash2 size={15} /> Remover
                    </button>
                  )}
                </div>
              </div>
              {field.system ? (
                <span className="fe-lock">
                  <Lock size={12} /> {SYSTEM_NOTE[field.system]}
                </span>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Reorder.Item>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = (text: string) => {
    const parts = text
      .split(/[\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...options];
    parts.forEach((p) => {
      if (!next.includes(p)) next.push(p.slice(0, 120));
    });
    onChange(next);
    setDraft('');
  };

  return (
    <div>
      <span className="fe-label">Opções (Enter para adicionar; cole várias, uma por linha)</span>
      <div className="opt-editor">
        <AnimatePresence initial={false}>
          {options.map((o) => (
            <motion.span
              key={o}
              className="opt"
              layout
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              {o}
              <button type="button" onClick={() => onChange(options.filter((x) => x !== o))} aria-label={`Remover ${o}`}>
                <X size={13} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          className="opt-input"
          value={draft}
          placeholder="Nova opção…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && options.length) {
              onChange(options.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[\n;]/.test(t)) {
              e.preventDefault();
              commit(t);
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
    </div>
  );
}
