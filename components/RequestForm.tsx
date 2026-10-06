'use client';
import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { AlertCircle, ImagePlus, Play, RotateCcw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from './Brand';
import { DiagonalField } from './DiagonalField';
import { FieldInput } from './FieldInput';
import { ToastProvider, useToast } from './Toasts';
import { useRealtime } from '@/lib/realtime';
import { validateAnswers } from '@/lib/validate';
import { formatBytes, protocolLabel } from '@/lib/format';
import { MAX_FILE_BYTES, MAX_FILES } from '@/lib/limits';
import type { FormField } from '@/lib/types';

interface LocalFile {
  id: string;
  file: File;
  url: string;
  progress: number;
}

const EMAIL_KEY = 'almox:supervisor-email';

function uploadWithProgress(signedUrl: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) {
      xhr.setRequestHeader('apikey', anon);
      if (anon.startsWith('eyJ')) xhr.setRequestHeader('Authorization', `Bearer ${anon}`);
    }
    xhr.setRequestHeader('x-upsert', 'false');
    const fd = new FormData();
    fd.append('cacheControl', '3600');
    fd.append('', file);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('rede'));
    xhr.send(fd);
  });
}

export function RequestForm() {
  return (
    <ToastProvider>
      <DiagonalField />
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const toast = useToast();
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState('');
  const [done, setDone] = useState<{ protocol: number } | null>(null);
  const [over, setOver] = useState(false);
  const [cardScope, animate] = useAnimate();
  const fileInput = useRef<HTMLInputElement>(null);
  const filesRef = useRef<LocalFile[]>([]);
  const fieldsRef = useRef<FormField[] | null>(null);
  filesRef.current = files;

  const load = useCallback(async (silent = false) => {
    try {
      const r = await fetch('/api/form', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const j = await r.json();
      const prev = fieldsRef.current;
      if (prev && JSON.stringify(prev) === JSON.stringify(j.fields)) return;
      if (silent && prev) {
        toast({ kind: 'info', title: 'O formulário foi atualizado', text: 'Suas respostas foram mantidas.' });
      }
      fieldsRef.current = j.fields;
      setFields(j.fields);
      setLoadError(false);
    } catch {
      if (!silent) setLoadError(true);
    }
  }, [toast]);

  useEffect(() => {
    load();
    try {
      const saved = localStorage.getItem(EMAIL_KEY);
      if (saved) setValues((v) => ({ email: saved, ...v }));
    } catch {
      /* sem storage */
    }
  }, [load]);

  // libera as pré-visualizações ao sair
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  useRealtime(
    (ev) => {
      if (ev === 'form:update') load(true);
    },
    () => load(true),
    60000,
  );

  const emailField = useMemo(() => fields?.find((f) => f.system === 'email'), [fields]);

  // se o id do campo de e-mail mudar, reaproveita o e-mail salvo
  useEffect(() => {
    if (emailField && emailField.id !== 'email' && values.email && !values[emailField.id]) {
      setValues((v) => ({ ...v, [emailField.id]: v.email }));
    }
  }, [emailField, values]);

  const setValue = (id: string, v: unknown) => {
    setValues((s) => ({ ...s, [id]: v }));
    if (errors[id]) setErrors((e) => ({ ...e, [id]: '' }));
    if (formError) setFormError('');
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const accepted: LocalFile[] = [];
    let rejected = '';
    for (const f of incoming) {
      if (!/^(image|video)\//.test(f.type)) {
        rejected = `"${f.name}" não é foto nem vídeo.`;
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        rejected = `"${f.name}" passa de 50 MB.`;
        continue;
      }
      accepted.push({ id: Math.random().toString(36).slice(2), file: f, url: URL.createObjectURL(f), progress: 0 });
    }
    setFiles((cur) => {
      const room = MAX_FILES - cur.length;
      if (accepted.length > room) {
        accepted.slice(room).forEach((a) => URL.revokeObjectURL(a.url));
        toast({ kind: 'error', title: `Máximo de ${MAX_FILES} arquivos` });
      }
      return [...cur, ...accepted.slice(0, Math.max(0, room))];
    });
    if (rejected) toast({ kind: 'error', title: 'Arquivo não aceito', text: rejected });
    const anexos = fields?.find((f) => f.type === 'file');
    if (anexos && errors[anexos.id]) setErrors((e) => ({ ...e, [anexos.id]: '' }));
  };

  const removeFile = (id: string) =>
    setFiles((cur) => {
      const f = cur.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return cur.filter((x) => x.id !== id);
    });

  const shake = () => {
    if (cardScope.current) animate(cardScope.current, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.45 });
  };

  const focusFirstError = (errs: Record<string, string>) => {
    const first = fields?.find((f) => errs[f.id]);
    if (!first) return;
    const el = document.getElementById('field-' + first.id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = document.getElementById('in-' + first.id) as HTMLElement | null;
    setTimeout(() => input?.focus?.({ preventScroll: true }), 350);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fields || sending) return;
    setFormError('');
    const check = validateAnswers(fields, values, files.length > 0);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('Confira os campos destacados.');
      shake();
      focusFirstError(check.errors);
      return;
    }
    const email = emailField ? String(values[emailField.id] || '').trim().toLowerCase() : '';
    setSending(true);
    try {
      let attachments: { path: string; name: string; type: string; size: number }[] = [];
      if (files.length) {
        setStage('Preparando envio dos arquivos…');
        const r = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            files: files.map((f) => ({ name: f.file.name, type: f.file.type, size: f.file.size })),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (j.field === 'email' && emailField) {
            setErrors({ [emailField.id]: j.error });
            focusFirstError({ [emailField.id]: j.error });
          }
          throw new Error(j.error || 'Não foi possível enviar os arquivos.');
        }
        setStage('Enviando fotos e vídeos…');
        await Promise.all(
          files.map((f, i) =>
            uploadWithProgress(j.uploads[i].signedUrl, f.file, (p) =>
              setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: p } : x))),
            ).then(() => setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, progress: 1 } : x)))),
          ),
        ).catch(() => {
          throw new Error('Falha ao enviar um dos arquivos. Verifique a internet e tente de novo.');
        });
        attachments = files.map((f, i) => ({
          path: j.uploads[i].path,
          name: f.file.name,
          type: f.file.type,
          size: f.file.size,
        }));
      }
      setStage('Registrando solicitação…');
      const r = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values, attachments }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.errors) {
          setErrors(j.errors);
          focusFirstError(j.errors);
        }
        throw new Error(j.error || 'Não foi possível enviar agora.');
      }
      try {
        localStorage.setItem(EMAIL_KEY, email);
      } catch {
        /* ignore */
      }
      setDone({ protocol: j.protocol });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível enviar agora.');
      shake();
      setFiles((cur) => cur.map((x) => ({ ...x, progress: 0 })));
    } finally {
      setSending(false);
      setStage('');
    }
  };

  const reset = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setFiles([]);
    setErrors({});
    setFormError('');
    setValues(emailField ? { [emailField.id]: String(values[emailField.id] || '').trim().toLowerCase() } : {});
    setDone(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="req-page page-layer">
      <div className="req-shell">
        <div className="req-top">
          <Brand sub="Central de solicitações" />
        </div>

        <motion.div
          className="req-hero"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1>Pedir item ao almoxarifado</h1>
          <p>Fardamento, calçado ou EPI para um colaborador do seu posto. A equipe recebe na hora e responde no seu e-mail.</p>
        </motion.div>

        <motion.div
          ref={cardScope}
          className="req-card"
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.div
                key="done"
                className="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.div
                  className="success-check"
                  initial={{ scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.1 }}
                >
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                    <motion.path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      stroke="currentColor"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, delay: 0.35, ease: 'easeOut' }}
                    />
                  </svg>
                </motion.div>
                <h2>Solicitação enviada</h2>
                <p>O almoxarifado já recebeu. Se precisarem de algo, vão falar com você pelo e-mail informado.</p>
                <div className="protocol">
                  <span>Número da solicitação</span>
                  <b>{protocolLabel(done.protocol)}</b>
                </div>
                <div>
                  <button className="btn btn-primary" onClick={reset}>
                    <RotateCcw size={17} /> Fazer outra solicitação
                  </button>
                </div>
              </motion.div>
            ) : !fields ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {loadError ? (
                  <div className="empty">
                    <span className="empty-icon">
                      <AlertCircle size={24} />
                    </span>
                    <strong>Não foi possível abrir o formulário</strong>
                    <p>Verifique sua internet e tente de novo.</p>
                    <button className="btn btn-ghost" onClick={() => load()}>
                      Tentar de novo
                    </button>
                  </div>
                ) : (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ padding: '18px 0' }}>
                      <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 12 }} />
                      <div className="skeleton" style={{ height: 48 }} />
                    </div>
                  ))
                )}
              </motion.div>
            ) : (
              <motion.form key="form" noValidate onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AnimatePresence initial={false}>
                  {fields.map((f, i) => (
                    <motion.div
                      key={f.id}
                      id={'field-' + f.id}
                      layout="position"
                      className={`req-field${errors[f.id] ? ' has-error' : ''}${f.system === 'email' ? ' is-key' : ''}`}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={{ duration: 0.5, delay: Math.min(i * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }}
                    >
                      <label className="label" htmlFor={'in-' + f.id} id={'in-' + f.id + '-label'}>
                        {f.label}
                        {f.required ? <span className="req" aria-label="obrigatório">*</span> : null}
                      </label>
                      {f.help ? <span className="help">{f.help}</span> : <span style={{ display: 'block', height: 6 }} />}

                      {f.type === 'file' ? (
                        <>
                          <label
                            className={`dropzone${over ? ' is-over' : ''}`}
                            htmlFor={'in-' + f.id}
                            onDragOver={(e) => {
                              e.preventDefault();
                              setOver(true);
                            }}
                            onDragLeave={() => setOver(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setOver(false);
                              if (!sending) addFiles(e.dataTransfer.files);
                            }}
                          >
                            <span className="dz-icon">
                              <ImagePlus size={22} />
                            </span>
                            <strong>Toque para escolher ou arraste aqui</strong>
                            <span>
                              Fotos e vídeos, até {MAX_FILES} arquivos de 50 MB
                            </span>
                          </label>
                          <input
                            ref={fileInput}
                            id={'in-' + f.id}
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            hidden
                            disabled={sending}
                            onChange={(e) => {
                              addFiles(e.target.files);
                              e.target.value = '';
                            }}
                          />
                          {files.length > 0 && (
                            <div className="thumbs">
                              <AnimatePresence>
                                {files.map((lf) => (
                                  <motion.div
                                    key={lf.id}
                                    className="thumb"
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                                  >
                                    {lf.file.type.startsWith('video/') ? (
                                      <video src={lf.url} muted playsInline preload="metadata" />
                                    ) : (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={lf.url} alt={lf.file.name} />
                                    )}
                                    <span className="thumb-badge">
                                      {lf.file.type.startsWith('video/') ? <Play size={10} /> : null}
                                      {formatBytes(lf.file.size)}
                                    </span>
                                    {!sending && (
                                      <button
                                        type="button"
                                        className="thumb-remove"
                                        onClick={() => removeFile(lf.id)}
                                        aria-label={`Remover ${lf.file.name}`}
                                      >
                                        <X size={14} />
                                      </button>
                                    )}
                                    {sending && (
                                      <div className="thumb-progress">
                                        <i style={{ width: `${Math.round(lf.progress * 100)}%` }} />
                                      </div>
                                    )}
                                  </motion.div>
                                ))}
                              </AnimatePresence>
                            </div>
                          )}
                        </>
                      ) : (
                        <FieldInput field={f} inputId={'in-' + f.id} value={values[f.id]} onChange={(v) => setValue(f.id, v)} />
                      )}

                      <AnimatePresence>
                        {errors[f.id] ? (
                          <motion.div
                            className="field-error"
                            role="alert"
                            initial={{ opacity: 0, y: -4, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <AlertCircle size={14} /> {errors[f.id]}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                  ))}
                </AnimatePresence>

                <div className="req-submit">
                  <AnimatePresence>
                    {formError ? (
                      <motion.div
                        className="form-alert"
                        role="alert"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                      >
                        <AlertCircle size={17} /> {formError}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                  <button className="btn btn-primary btn-block" type="submit" disabled={sending}>
                    {sending ? (
                      <>
                        <span className="spinner" /> {stage || 'Enviando…'}
                      </>
                    ) : (
                      <>
                        <Upload size={18} /> Enviar solicitação
                      </>
                    )}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>

        <p className="req-foot">
          É da equipe do almoxarifado? <a href="/login">Entrar no painel</a>
        </p>
      </div>
    </main>
  );
}

