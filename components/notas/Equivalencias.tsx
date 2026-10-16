'use client';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, Link2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { Sheet } from '../almoxarifado/StockModals';
import { fold } from '@/lib/almoxarifado/stockFormat';
import { formatDoc } from '@/lib/compras/fornecedores';
import { ItemPicker, dateBR, type PickItem } from '../pedidos/ui';
import { SupplierPicker } from '../compras/SupplierPicker';

interface Eq {
  supplier_id: string;
  supplier: string;
  cnpj: string | null;
  supplier_code: string;
  unit: string | null;
  unit_key: string;
  description: string | null;
  factor: number;
  item_id: string;
  item: string;
  validated_by: string | null;
  validated_at: string | null;
}

/**
 * Equivalência de códigos: o código (e a unidade) que cada fornecedor usa → o item do
 * estoque, com o fator de conversão. Nasce sozinha na primeira entrada de cada código;
 * aqui dá para conferir, corrigir ou cadastrar antes de a nota chegar.
 */
export function Equivalencias({ items, canEdit }: { items: PickItem[]; canEdit: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<Eq[] | null>(null);
  const [failed, setFailed] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ supplier_id: string; supplierText: string; code: string; unit: string; description: string; factor: string; item_id: string | null; itemText: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setList((await api<{ equivalences: Eq[] }>('/api/almoxarifado/equivalencias')).equivalences);
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const shown = (list ?? []).filter((e) => !q.trim() || fold(`${e.supplier} ${e.cnpj ?? ''} ${e.supplier_code} ${e.description ?? ''} ${e.item}`).includes(fold(q.trim())));
  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/almoxarifado/equivalencias', { method: 'POST', json: { supplier_id: form.supplier_id, code: form.code, unit: form.unit, description: form.description, factor: form.factor, item_id: form.item_id } });
      toast({ kind: 'success', title: 'Equivalência salva', text: `${form.code} → ${form.itemText}` });
      setForm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input className="input" placeholder="Buscar por fornecedor, código ou item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar equivalências" />
        </div>
        {canEdit ? (
          <button className="btn btn-ghost" onClick={() => setForm({ supplier_id: '', supplierText: '', code: '', unit: '', description: '', factor: '1', item_id: null, itemText: '' })}>
            <Plus size={16} /> Nova equivalência
          </button>
        ) : null}
      </div>
      <p className="help">Quando a nota de um fornecedor traz um código já conhecido, o item do estoque vem ligado sozinho. Pela descrição o sistema só sugere: a primeira ligação é sempre confirmada por alguém.</p>
      {failed && !list ? (
        <div className="sx-error" role="alert">
          <AlertCircle size={16} /> {failed}
        </div>
      ) : !list ? (
        <div className="skeleton" style={{ height: 80, borderRadius: 12 }} />
      ) : !shown.length ? (
        <div className="empty">
          <span className="empty-icon">
            <Link2 size={24} />
          </span>
          <strong>{list.length ? 'Nada encontrado' : 'Nenhuma equivalência ainda'}</strong>
          <span>{list.length ? 'Tente outra busca.' : 'Elas aparecem conforme as notas são lançadas.'}</span>
        </div>
      ) : (
        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Código · descrição do fornecedor</th>
                <th>Unid. · fator</th>
                <th>Item do estoque</th>
                <th>Validado</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.supplier_id + e.supplier_code + e.unit_key}>
                  <td>
                    {e.supplier}
                    {e.cnpj ? <small style={{ display: 'block' }}>{formatDoc(e.cnpj)}</small> : null}
                  </td>
                  <td>
                    <b>{e.supplier_code}</b>
                    {e.description ? <small style={{ display: 'block' }}>{e.description}</small> : null}
                  </td>
                  <td>
                    {e.unit ?? '—'}
                    {Number(e.factor) !== 1 ? ` · 1 = ${String(e.factor).replace('.', ',')} un.` : ''}
                  </td>
                  <td>{e.item}</td>
                  <td>
                    {e.validated_by ?? '—'}
                    {e.validated_at ? <small style={{ display: 'block' }}>{dateBR(e.validated_at)}</small> : null}
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`Apagar ${e.supplier_code}`}
                        onClick={async () => {
                          try {
                            await api(`/api/almoxarifado/equivalencias?supplier_id=${e.supplier_id}&code=${encodeURIComponent(e.supplier_code)}&unit=${encodeURIComponent(e.unit_key)}`, { method: 'DELETE' });
                            await load();
                          } catch (err) {
                            toast({ kind: 'error', title: 'Não foi possível', text: (err as Error).message });
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AnimatePresence>
        {form ? (
          <Sheet key="eq" title="Nova equivalência" lead="Código e unidade que o fornecedor usa na nota → o item do estoque." onClose={() => setForm(null)} locked>
            <div className="sx-grid">
              <div className="full">
                <label className="label" htmlFor="eq-sup">
                  Fornecedor
                </label>
                <SupplierPicker id="eq-sup" value={form.supplierText} onChange={(v) => setForm({ ...form, supplierText: v, supplier_id: '' })} onPick={(s) => setForm({ ...form, supplier_id: s.id, supplierText: s.trade_name || s.name })} />
              </div>
              <div>
                <label className="label" htmlFor="eq-code">
                  Código do fornecedor
                </label>
                <input id="eq-code" className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="eq-unit">
                  Unidade na nota
                </label>
                <input id="eq-unit" className="input" placeholder="UN, CX, PAR…" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase().slice(0, 10) })} />
              </div>
              <div className="full">
                <label className="label" htmlFor="eq-desc">
                  Descrição do fornecedor <span className="opt-tag">(opcional)</span>
                </label>
                <input id="eq-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="full">
                <span className="label">Item do estoque</span>
                <ItemPicker label="Item do estoque" value={{ item_id: form.item_id, text: form.itemText }} items={items} onPick={(it) => setForm({ ...form, item_id: it.id, itemText: `${it.name}${it.size ? ' ' + it.size : ''}` })} onText={(t) => setForm({ ...form, item_id: null, itemText: t })} />
              </div>
              <div>
                <label className="label" htmlFor="eq-factor">
                  Fator de conversão
                </label>
                <input id="eq-factor" className="input" inputMode="decimal" value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value.replace(/[^\d,.]/g, '') })} />
                <small className="help">1 {form.unit || 'unidade da nota'} = {form.factor || '1'} unidade(s) do estoque.</small>
              </div>
            </div>
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setForm(null)} disabled={busy}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={save} disabled={busy || !form.supplier_id || !form.code.trim() || !form.item_id}>
                {busy ? <span className="spinner" /> : null} Salvar
              </button>
            </div>
          </Sheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
