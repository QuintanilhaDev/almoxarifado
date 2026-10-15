'use client';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImportPreview } from '@/lib/almoxarifado/types';
import { money, num } from '@/lib/almoxarifado/stockFormat';
import { useToast } from '../core/Toasts';
import { api } from '../core/api';
import { Sheet } from './StockModals';
import { formatDoc } from '@/lib/compras/fornecedores';

type Kind = 'postos' | 'itens' | 'fornecedores';

const CONFIG: Record<
  Kind,
  {
    endpoint: string;
    /** onde grava (sem isso, o próprio endpoint em JSON) */
    saveEndpoint?: string;
    /** quem já existe é completado com o que veio na planilha (em vez de ficar como está) */
    updates?: boolean;
    title: string;
    singular: string;
    plural: string;
    lead: string;
    cols: { key: string; label: string; fmt?: (v: string | number | null) => string }[];
  }
> = {
  postos: {
    endpoint: '/api/almoxarifado/postos/import',
    title: 'Importar postos por planilha',
    singular: 'posto',
    plural: 'postos',
    lead: 'Postos que já existem não são alterados: só os novos entram.',
    cols: [
      { key: 'name', label: 'Posto' },
      { key: 'code', label: 'Código' },
      { key: 'city', label: 'Cidade' },
      { key: 'address', label: 'Endereço' },
      { key: 'supervisor', label: 'Responsável' },
    ],
  },
  itens: {
    endpoint: '/api/almoxarifado/stock/import',
    title: 'Importar itens por planilha',
    singular: 'item',
    plural: 'itens',
    lead: 'Os itens novos entram. Nos que já existem (mesmo nome e tamanho), o saldo, o mínimo e o custo ficam iguais aos da planilha, e a mudança de saldo fica registrada no histórico como ajuste.',
    cols: [
      { key: 'name', label: 'Item' },
      { key: 'size', label: 'Tam.' },
      { key: 'categories', label: 'Categoria' },
      { key: 'unit', label: 'Unid.' },
      { key: 'quantity', label: 'Saldo', fmt: (v) => (v === null ? '' : num(Number(v))) },
      { key: 'min_quantity', label: 'Mín.', fmt: (v) => (v === null ? '' : num(Number(v))) },
      { key: 'cost', label: 'Custo', fmt: (v) => (v === null ? '' : money(Number(v))) },
    ],
  },
  fornecedores: {
    endpoint: '/api/compras/fornecedores/import',
    saveEndpoint: '/api/compras/fornecedores',
    updates: true,
    title: 'Importar fornecedores por planilha',
    singular: 'fornecedor',
    plural: 'fornecedores',
    lead: 'Quem já está cadastrado (mesmo CNPJ ou, sem CNPJ, mesmo nome) é completado com o que vier na planilha; o resto entra como novo.',
    cols: [
      { key: 'name', label: 'Fornecedor' },
      { key: 'cnpj', label: 'CNPJ/CPF', fmt: (v) => formatDoc(v === null ? null : String(v)) },
      { key: 'category', label: 'O que fornece' },
      { key: 'contact', label: 'Contato' },
      { key: 'phone', label: 'Telefone' },
      { key: 'city', label: 'Cidade' },
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
  trade_name: 'nome fantasia',
  cnpj: 'CNPJ/CPF',
  phone: 'telefone',
  email: 'e-mail',
  contact: 'contato',
  category: 'o que fornece',
  uf: 'UF',
  size: 'tamanho',
  categories: 'categoria',
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
  const known = preview?.rows.filter((r) => r.status === 'exists') ?? [];
  const changes = preview?.rows.filter((r) => r.status === 'update') ?? [];
  const exists = known.length;
  const dup = preview?.rows.filter((r) => r.status === 'duplicate').length ?? 0;
  const invalid = preview?.rows.filter((r) => r.status === 'invalid').length ?? 0;
  /** o que vai ser gravado */
  const toSave = cfg.updates ? [...fresh, ...known] : [...fresh, ...changes];

  const save = async () => {
    if (!toSave.length) return;
    setBusy('saving');
    setError('');
    try {
      const j = await api<{ added?: number; created?: number; skipped?: number; updated?: number; errors?: string[] }>(cfg.saveEndpoint ?? cfg.endpoint, {
        method: 'POST',
        json: { rows: toSave.map((r) => r.data) },
      });
      const added = j.added ?? j.created ?? 0;
      const updated = j.updated ?? 0;
      const errs = j.errors ?? [];
      toast(
        {
          kind: errs.length ? 'info' : added || updated ? 'success' : 'info',
          title:
            added || updated
              ? [added ? `${num(added)} ${added === 1 ? cfg.singular + ' adicionado' : cfg.plural + ' adicionados'}` : '', updated ? `${num(updated)} ${updated === 1 ? 'atualizado' : 'atualizados'}` : ''].filter(Boolean).join(' · ')
              : `Nenhum ${cfg.singular} novo`,
          text: errs.length
            ? `${errs.length} ${errs.length === 1 ? 'linha não entrou' : 'linhas não entraram'}: ${errs.slice(0, 2).join('; ')}`
            : j.skipped
              ? `${j.skipped} já estava${j.skipped > 1 ? 'm' : ''} igual${j.skipped > 1 ? 'is' : ''} à planilha`
              : undefined,
        },
        errs.length ? 10000 : undefined,
      );
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
      lead={`Envie a planilha (.xlsx ou .csv). ${cfg.lead}`}
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
            {changes.length ? (
              <span className="badge lilac">
                {num(changes.length)} já cadastrado{changes.length > 1 ? 's' : ''}: {changes.length > 1 ? 'serão atualizados' : 'será atualizado'}
              </span>
            ) : null}
            {exists ? (
              cfg.updates ? (
                <span className="badge lilac">{num(exists)} já cadastrado{exists > 1 ? 's' : ''}: {exists > 1 ? 'serão completados' : 'será completado'}</span>
              ) : (
                <span className="badge gray">
                  {num(exists)} já {exists > 1 ? 'estão iguais' : 'está igual'} à planilha
                </span>
              )
            ) : null}
            {invalid ? <span className="badge amber">{num(invalid)} com problema</span> : null}
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
                  <tr key={i} className={r.status === 'new' || r.status === 'update' || (cfg.updates && r.status === 'exists') ? '' : 'skip'} title={r.error ? `${r.source}: ${r.error}` : r.source}>
                    <td>
                      {r.status === 'new' ? (
                        <span className="badge green">novo</span>
                      ) : r.status === 'invalid' ? (
                        <span className="badge amber" title={r.error} style={{ maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }}>
                          {r.error}
                        </span>
                      ) : r.status === 'update' ? (
                        <span className="badge lilac">atualiza</span>
                      ) : r.status === 'exists' && cfg.updates ? (
                        <span className="badge lilac">completa</span>
                      ) : (
                        <span className="badge gray">{r.status === 'exists' ? (kind === 'itens' ? 'igual' : 'já existe') : 'repetido'}</span>
                      )}
                    </td>
                    {cfg.cols.map((c) => {
                      const v = r.data[c.key] ?? null;
                      const show = (x: string | number | null) => (c.fmt ? c.fmt(x) : (x ?? ''));
                      const before = r.status === 'update' && r.current && c.key in r.current ? r.current[c.key] : undefined;
                      if (before !== undefined && v !== null && Number(before) !== Number(v)) {
                        return (
                          <td key={c.key} className="imp-diff">
                            <s>{show(before)}</s> → <b>{show(v)}</b>
                          </td>
                        );
                      }
                      return <td key={c.key}>{show(v)}</td>;
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
            <button className="btn btn-primary" onClick={save} disabled={busy !== '' || !toSave.length}>
              {busy === 'saving' ? <span className="spinner" /> : null}
              {!toSave.length
                ? changes.length === 0 && exists
                  ? 'Tudo já está igual à planilha'
                  : 'Nada novo para adicionar'
                : cfg.updates && exists
                  ? `Gravar ${num(toSave.length)} ${toSave.length === 1 ? cfg.singular : cfg.plural}`
                  : changes.length
                    ? [fresh.length ? `Adicionar ${num(fresh.length)}` : '', `${fresh.length ? 'atualizar' : 'Atualizar'} ${num(changes.length)} ${changes.length === 1 ? cfg.singular : cfg.plural}`].filter(Boolean).join(' e ')
                    : `Adicionar ${num(fresh.length)} ${fresh.length === 1 ? cfg.singular : cfg.plural}`}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
