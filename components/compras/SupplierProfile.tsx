'use client';
import { BadgeCheck, Ban, Clock3, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { HOMOLOGATION, type Supplier } from '@/lib/compras/fornecedores';
import { brl, poLabel } from '@/lib/compras/pc';
import { leadText } from '@/lib/compras/prazo';
import { ItemPicker, dateBR, type PickItem } from '../pedidos/ui';

interface Product {
  item_id: string;
  label: string;
  lead_days: number | null;
  lead_business: boolean;
  mode: 'pronta' | 'producao';
  in_contract: boolean;
  confirmed: boolean;
  note: string | null;
}
interface Profile {
  supplier: Supplier;
  products: Product[];
  equivalences: { supplier_code: string; unit: string | null; description: string | null; factor: number; label: string; validated_by: string | null }[];
  orders: { id: string; number: number; status: string; total: number; created_at: string; due: string | null }[];
  performance: { orders: number; delivered: number; on_time_pct: number | null; avg_delay: number | null; late_open: number; divergences: number; spent: number } | null;
  prices: { item: string; at: string; price: number; order: number }[];
}

/**
 * Parte de Compras na ficha do fornecedor: homologação, condições padrão, os itens que ele
 * fornece com o prazo de cada um (ex.: contrato Marvin), desempenho e histórico de preços.
 */
export function SupplierProfile({ id, canEdit, onChanged }: { id: string; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [catalog, setCatalog] = useState<PickItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [terms, setTerms] = useState<{ lead: string; business: boolean; pay: string; brands: string } | null>(null);
  const [adding, setAdding] = useState<{ item_id: string | null; text: string; days: string; business: boolean; mode: 'pronta' | 'producao'; contract: boolean; confirmed: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api<Profile>(`/api/compras/fornecedores/${id}/perfil`);
      setP(j);
      setTerms({ lead: j.supplier.lead_days === null || j.supplier.lead_days === undefined ? '' : String(j.supplier.lead_days), business: j.supplier.lead_business !== false, pay: j.supplier.payment_terms ?? '', brands: j.supplier.brands ?? '' });
    } catch (e) {
      if ((e as { data?: { setup?: boolean } }).data?.setup) setMissing(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (canEdit) api<{ items: PickItem[] }>('/api/compras/itens').then((j) => setCatalog(j.items)).catch(() => undefined);
  }, [canEdit]);

  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await api(`/api/compras/fornecedores/${id}/perfil`, { method: 'PATCH', json: body });
      toast({ kind: 'success', title: ok });
      await load();
      onChanged();
      return true;
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível', text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (missing) return <p className="help">Homologação e prazos aparecem depois de rodar o supabase/compras_pedidos.sql.</p>;
  if (!p || !terms) return <div className="skeleton" style={{ height: 90, borderRadius: 12 }} />;
  const h = p.supplier.homologation ?? 'homologado';
  const perf = p.performance;
  return (
    <div className="pc-profile">
      <div className={`pc-homolog is-${h}`}>
        <div>
          <span className={`pbadge ${HOMOLOGATION[h].tone}`}>{HOMOLOGATION[h].label}</span>
          {p.supplier.homologated_by ? (
            <small>
              {' '}
              por {p.supplier.homologated_by} em {dateBR(p.supplier.homologated_at ?? null)}
              {p.supplier.homologation_note ? ` — ${p.supplier.homologation_note}` : ''}
            </small>
          ) : h === 'pendente' ? (
            <small> Pode cotar, mas só é contratado depois de homologado.</small>
          ) : null}
        </div>
        {canEdit ? (
          <div className="pc-homolog-act">
            <input className="input" placeholder="Observação (obrigatória para bloquear)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Observação da homologação" />
            {h !== 'homologado' ? (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save({ homologation: 'homologado', homologation_note: note }, 'Fornecedor homologado').then(() => setNote(''))}>
                <BadgeCheck size={14} /> Homologar
              </button>
            ) : null}
            {h !== 'bloqueado' ? (
              <button className="btn btn-ghost btn-sm" disabled={busy || !note.trim()} onClick={() => save({ homologation: 'bloqueado', homologation_note: note }, 'Fornecedor bloqueado').then(() => setNote(''))}>
                <Ban size={14} /> Bloquear
              </button>
            ) : null}
            {h !== 'pendente' ? (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save({ homologation: 'pendente', homologation_note: note }, 'Voltou para avaliação').then(() => setNote(''))}>
                <Clock3 size={14} /> Reavaliar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <h3 className="sec-title">Condições padrão</h3>
      <fieldset disabled={!canEdit || busy} className="pc-fs">
        <div className="sx-grid">
          <div>
            <label className="label" htmlFor={`sp-lead-${id}`}>
              Prazo de entrega
            </label>
            <div className="o-sizes">
              <div>
                <input id={`sp-lead-${id}`} className="input" inputMode="numeric" placeholder="dias" value={terms.lead} onChange={(e) => setTerms({ ...terms, lead: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                <select className="select input" aria-label="Tipo de dia" value={terms.business ? 'u' : 'c'} onChange={(e) => setTerms({ ...terms, business: e.target.value === 'u' })}>
                  <option value="u">dias úteis</option>
                  <option value="c">dias corridos</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`sp-pay-${id}`}>
              Pagamento
            </label>
            <input id={`sp-pay-${id}`} className="input" placeholder="ex.: 30/60 boleto" value={terms.pay} onChange={(e) => setTerms({ ...terms, pay: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`sp-br-${id}`}>
              Marcas
            </label>
            <input id={`sp-br-${id}`} className="input" value={terms.brands} onChange={(e) => setTerms({ ...terms, brands: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <label className="pc-check">
              <input type="checkbox" checked={Boolean(p.supplier.exclusive)} onChange={(e) => save({ exclusive: e.target.checked }, e.target.checked ? 'Marcado como fornecedor exclusivo' : 'Exclusividade retirada')} /> Fornecedor exclusivo
            </label>
          </div>
        </div>
        {canEdit ? (
          <button className="btn btn-ghost btn-sm" onClick={() => save({ lead_days: terms.lead === '' ? null : Number(terms.lead), lead_business: terms.business, payment_terms: terms.pay, brands: terms.brands }, 'Condições salvas')}>
            Salvar condições
          </button>
        ) : null}
      </fieldset>

      <h3 className="sec-title">Itens que fornece e prazos</h3>
      <p className="help">Cada item pode ter prazo próprio (ex.: itens do contrato em 5 dias úteis; o que precisa ser produzido em 30). O pedido de compra usa este prazo para prever a chegada.</p>
      {p.products.length ? (
        <div className="t-wrap">
          <table className="t-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Prazo</th>
                <th>Tipo</th>
                <th>Contrato</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {p.products.map((x) => (
                <tr key={x.item_id}>
                  <td>{x.label}</td>
                  <td>{leadText(x.lead_days, x.lead_business)}</td>
                  <td>{x.mode === 'producao' ? 'sob produção' : 'pronta entrega'}</td>
                  <td>{x.in_contract ? (x.confirmed ? 'sim (confirmado)' : 'sim (a confirmar)') : '—'}</td>
                  {canEdit ? (
                    <td>
                      <button className="icon-btn" aria-label={`Tirar ${x.label}`} onClick={() => save({ remove_item: x.item_id }, 'Item retirado')}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="help">Nenhum item cadastrado. Os fornecedores também aparecem nas sugestões pelo que já venderam.</p>
      )}
      {canEdit ? (
        adding ? (
          <div className="pc-add-prod">
            <ItemPicker label="Item do estoque" value={{ item_id: adding.item_id, text: adding.text }} items={catalog} onPick={(it) => setAdding({ ...adding, item_id: it.id, text: `${it.name}${it.size ? ' ' + it.size : ''}` })} onText={(t) => setAdding({ ...adding, item_id: null, text: t })} />
            <div className="o-sizes">
              <div>
                <input className="input" inputMode="numeric" placeholder="dias" aria-label="Prazo em dias" value={adding.days} onChange={(e) => setAdding({ ...adding, days: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                <select className="select input" aria-label="Tipo de dia" value={adding.business ? 'u' : 'c'} onChange={(e) => setAdding({ ...adding, business: e.target.value === 'u' })}>
                  <option value="u">úteis</option>
                  <option value="c">corridos</option>
                </select>
                <select className="select input" aria-label="Pronta entrega ou produção" value={adding.mode} onChange={(e) => setAdding({ ...adding, mode: e.target.value as 'pronta' | 'producao' })}>
                  <option value="pronta">pronta entrega</option>
                  <option value="producao">sob produção</option>
                </select>
              </div>
            </div>
            <label className="pc-check">
              <input type="checkbox" checked={adding.contract} onChange={(e) => setAdding({ ...adding, contract: e.target.checked })} /> Item do contrato
            </label>
            <label className="pc-check">
              <input type="checkbox" checked={adding.confirmed} onChange={(e) => setAdding({ ...adding, confirmed: e.target.checked })} /> Prazo confirmado em contrato
            </label>
            <div className="drawer-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!adding.item_id || busy}
                onClick={async () => {
                  if (await save({ products: [{ item_id: adding.item_id, lead_days: adding.days === '' ? null : Number(adding.days), lead_business: adding.business, mode: adding.mode, in_contract: adding.contract, confirmed: adding.confirmed }] }, 'Item salvo')) setAdding(null);
                }}
              >
                Salvar item
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding({ item_id: null, text: '', days: terms.lead, business: terms.business, mode: 'pronta', contract: false, confirmed: false })}>
            <Plus size={14} /> Adicionar item
          </button>
        )
      ) : null}

      {perf && perf.orders ? (
        <>
          <h3 className="sec-title">Desempenho</h3>
          <div className="mini-stats">
            <div>
              <small>No prazo</small>
              <b>{perf.on_time_pct === null ? '—' : `${perf.on_time_pct}%`}</b>
            </div>
            <div>
              <small>Atraso médio</small>
              <b>{perf.avg_delay === null ? '—' : `${String(perf.avg_delay).replace('.', ',')} d.`}</b>
            </div>
            <div>
              <small>Divergências</small>
              <b>{perf.divergences}</b>
            </div>
          </div>
        </>
      ) : null}

      {p.prices.length ? (
        <>
          <h3 className="sec-title">Histórico de preços</h3>
          <div className="t-wrap">
            <table className="t-table">
              <tbody>
                {p.prices.slice(0, 15).map((x, i) => (
                  <tr key={i}>
                    <td>{x.item}</td>
                    <td>{dateBR(x.at)}</td>
                    <td>{poLabel(x.order)}</td>
                    <td style={{ textAlign: 'right' }}>{brl(x.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {p.equivalences.length ? (
        <>
          <h3 className="sec-title">Códigos deste fornecedor</h3>
          {p.equivalences.slice(0, 20).map((e) => (
            <div className="kv-row" key={e.supplier_code + (e.unit ?? '')}>
              <span>
                {e.supplier_code}
                {e.unit ? ` (${e.unit}${e.factor !== 1 ? ` × ${String(e.factor).replace('.', ',')}` : ''})` : ''}
              </span>
              <b className="o-kv">{e.label}</b>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
