'use client';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImportPreview } from '@/lib/types';
import { money, num } from '@/lib/stockFormat';
import { useToast } from '../Toasts';
import { api } from './api';
import { Sheet } from './StockModals';

type Kind = 'postos' | 'itens';

const CONFIG: Record<
  Kind,
  { endpoint: string; title: string; singular: string; plural: string; cols: { key: string; label: string; fmt?: (v: string | number | null) => string }[] }
> = {
  postos: {
    endpoint: '/api/admin/postos/import',
    title: 'Importar postos por planilha',
    singular: 'posto',
    plural: 'postos',
    cols: [
      { key: 'name', label: 'Posto' },
      { key: 'code', label: 'Código' },
      { key: 'city', label: 'Cidade' },
      { key: 'address', label: 'Endereço' },
      { key: 'supervisor', label: 'Responsável' },
    ],
  },
  itens: {
    endpoint: '/api/admin/stock/import',
    title: 'Importar itens por planilha',
    singular: 'item',
    plural: 'itens',
    cols: [
      { key: 'name', label: 'Item' },
      { key: 'size', label: 'Tam.' },
      { key: 'unit', label: 'Unid.' },
      { key: 'quantity', label: 'Saldo', fmt: (v) => (v === null ? '' : num(Number(v))) },
      { key: 'min_quantity', label: 'Mín.', fmt: (v) => (v === null ? '' : num(Number(v))) },
      { key: 'cost', label: 'Custo', fmt: (v) => (v === null ? '' : money(Number(v))) },
    ],
  },
};

const FIELD_LABEL: Record<string, string> = {
  name: 'nome',
  code: 'código',
  city: 'cidade',
  address: 'endereço',
  supervisor: 'responsável',
  notes: 'observação',
  size: 'tamanho',
  unit: 'unidade',
  quantity: 'saldo',
  min_quantity: 'estoque mínimo',
  cost: 'custo',
};

const SHOW = 150;

export function ImportDialog({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: () => void }) {
  const cfg = CONFIG[kind];
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const read = async (file: File | undefined | null) => {
    if (!file) return;
    setError('');
    setBusy('reading');
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const j = await api<ImportPreview>(cfg.endpoint, { method: 'POST', body: fd });
      setPreview(j);
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const fresh = preview?.rows.filter((r) => r.status === 'new') ?? [];
  const exists = preview?.rows.filter((r) => r.status === 'exists').length ?? 0;
  const dup = preview?.rows.filter((r) => r.status === 'duplicate').length ?? 0;

  const save = async () => {
    if (!fresh.length) return;
    setBusy('saving');
    setError('');
    try {
      const j = await api<{ added: number; skipped: number }>(cfg.endpoint, {
        method: 'POST',
        json: { rows: fresh.map((r) => r.data) },
      });
      toast({
        kind: j.added ? 'success' : 'info',
        title: j.added
          ? `${num(j.added)} ${j.added === 1 ? cfg.singular + ' adicionado' : cfg.plural + ' adicionados'}`
          : `Nenhum ${cfg.singular} novo`,
        text: j.skipped ? `${j.skipped} já existia${j.skipped > 1 ? 'm' : ''} e foi mantido como estava` : undefined,
      });
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  return (
    <Sheet
      title={cfg.title}
      lead={`Envie a planilha (.xlsx ou .csv) em qualquer formato: eu encontro a tabela e as colunas sozinho. ${
        kind === 'postos' ? 'Postos que já existem não são alterados: só os novos entram.' : 'Itens que já existem (mesmo nome e tamanho) não são alterados: só os novos entram.'
      }`}
      onClose={onClose}
      wide={Boolean(preview)}
      locked={busy !== ''}
    >
      {!preview ? (
        <>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => read(e.target.files?.[0])}
          />
          <button
            type="button"
            className={`dz${over ? ' is-over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              read(e.dataTransfer.files?.[0]);
            }}
            disabled={busy !== ''}
          >
            {busy === 'reading' ? <span className="spinner" style={{ width: 28, height: 28 }} /> : <Upload size={30} />}
            <strong>{busy === 'reading' ? `Lendo ${fileName}…` : 'Escolha ou arraste a planilha aqui'}</strong>
            <span>Excel (.xlsx) ou CSV, até 4 MB</span>
          </button>
          {error ? (
            <div className="sx-error" role="alert" style={{ marginTop: 14 }}>
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}
          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="imp-sum">
            <span className="badge green">
              <CheckCircle2 size={13} /> {num(fresh.length)} {fresh.length === 1 ? 'novo' : 'novos'}
            </span>
            {exists ? <span className="badge gray">{num(exists)} já cadastrado{exists > 1 ? 's' : ''}</span> : null}
            {dup ? <span className="badge gray">{num(dup)} repetido{dup > 1 ? 's' : ''} na planilha</span> : null}
            {preview.ignored ? <span className="badge gray">{num(preview.ignored)} linha{preview.ignored > 1 ? 's' : ''} ignorada{preview.ignored > 1 ? 's' : ''} (títulos, totais, vazias)</span> : null}
          </div>

          {preview.warnings.map((w) => (
            <div key={w} className="imp-note warn">
              {w}
            </div>
          ))}

          <details className="imp-cols">
            <summary>
              <FileSpreadsheet size={14} style={{ verticalAlign: '-2px' }} /> Como li {fileName || 'a planilha'}
            </summary>
            <ul>
              {preview.sheets.map((s) => (
                <li key={s.name}>
                  Aba <b>{s.name}</b>: {s.read} linha{s.read === 1 ? '' : 's'} lida{s.read === 1 ? '' : 's'}
                  {s.headerRow ? `, cabeçalho na linha ${s.headerRow}` : ', sem cabeçalho'}
                  {s.columns.some((c) => c.field)
                    ? '. Colunas: ' +
                      s.columns
                        .filter((c) => c.field)
                        .map((c) => `${c.letter}${c.header ? ` (${c.header})` : ''} → ${FIELD_LABEL[c.field!] ?? c.field}`)
                        .join(', ')
                    : ''}
                </li>
              ))}
            </ul>
          </details>

          <div className="imp-table">
            <table>
              <thead>
                <tr>
                  <th />
                  {cfg.cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, SHOW).map((r, i) => (
                  <tr key={i} className={r.status === 'new' ? '' : 'skip'} title={r.source}>
                    <td>
                      {r.status === 'new' ? (
                        <span className="badge green">novo</span>
                      ) : (
                        <span className="badge gray">{r.status === 'exists' ? 'já existe' : 'repetido'}</span>
                      )}
                    </td>
                    {cfg.cols.map((c) => {
                      const v = r.data[c.key] ?? null;
                      return <td key={c.key}>{c.fmt ? c.fmt(v) : (v ?? '')}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > SHOW ? (
            <p className="help" style={{ marginTop: -6 }}>
              Mostrando as primeiras {SHOW} de {num(preview.rows.length)} linhas. Todas serão consideradas.
            </p>
          ) : null}

          {error ? (
            <div className="sx-error" role="alert">
              <AlertCircle size={16} /> {error}
            </div>
          ) : null}
          <div className="modal-actions">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setPreview(null);
                setError('');
              }}
              disabled={busy !== ''}
            >
              Escolher outro arquivo
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy !== '' || !fresh.length}>
              {busy === 'saving' ? <span className="spinner" /> : null}
              {fresh.length ? `Adicionar ${num(fresh.length)} ${fresh.length === 1 ? cfg.singular : cfg.plural}` : `Nada novo para adicionar`}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
