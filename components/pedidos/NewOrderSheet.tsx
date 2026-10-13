'use client';
import { AlertCircle, CalendarClock, Flame, PackagePlus, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api';
import { Sheet } from '../almoxarifado/StockModals';
import { fold } from '@/lib/almoxarifado/stockFormat';
import type { MaterialOrder } from '@/lib/pedidos/types';
import { ItemPicker, todayLocal, type PickItem } from './ui';

interface Catalog {
  items: PickItem[];
  postos: { id: string; name: string }[];
  roles: string[];
}
interface Collab {
  id: string;
  name: string;
  matricula: string | null;
  role: string | null;
  posto_id: string | null;
  posto_name: string | null;
  company: string | null;
  sizes: Record<string, string>;
  active: boolean;
}
interface Line {
  key: number;
  item_id: string | null;
  text: string;
  size: string;
  qty: string;
  note: string | null;
}

/** Novo pedido: Operação (Uesley) ou RH/DP (admissão com kit automático, troca extraordinária). */
export function NewOrderSheet({ scope, onClose, onSaved }: { scope: 'operacao' | 'rh'; onClose: () => void; onSaved: (o: MaterialOrder) => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [type, setType] = useState<'operacao' | 'rh_admissao' | 'rh_extra'>(scope === 'rh' ? 'rh_admissao' : 'operacao');
  const seq = useRef(0);
  const blank = (): Line => ({ key: ++seq.current, item_id: null, text: '', size: '', qty: '1', note: null });
  const [lines, setLines] = useState<Line[]>(() => [blank()]);
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({ posto: '', collaborator: '', matricula: '', role: '', company: '', supervisor: '', camisa: '', calca: '', calcado: '', start: '', needed: '', reason: '' });
  const [priority, setPriority] = useState<'normal' | 'urgente'>('normal');
  const [forward, setForward] = useState(true);
  const [kitInfo, setKitInfo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Catalog>('/api/pedidos/catalogo').then(setCat).catch((e) => setError((e as Error).message));
    api<{ collaborators: Collab[] }>('/api/rh/colaboradores')
      .then((j) => setCollabs(j.collaborators.filter((c) => c.active)))
      .catch(() => setCollabs([]));
  }, []);

  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setError('');
  };
  const chosen = useMemo(() => {
    const key = fold(f.collaborator.trim());
    if (!key) return null;
    const same = collabs.filter((c) => fold(c.name) === key || (c.matricula && fold(`${c.name} (${c.matricula})`) === key));
    return same.length === 1 ? same[0] : null;
  }, [f.collaborator, collabs]);

  // escolheu um colaborador cadastrado: preenche o resto
  useEffect(() => {
    if (!chosen) return;
    setF((x) => ({
      ...x,
      matricula: x.matricula || chosen.matricula || '',
      role: x.role || chosen.role || '',
      posto: x.posto || chosen.posto_name || '',
      company: x.company || chosen.company || '',
      camisa: x.camisa || chosen.sizes?.camisa || '',
      calca: x.calca || chosen.sizes?.calca || '',
      calcado: x.calcado || chosen.sizes?.calcado || '',
    }));
  }, [chosen]);

  // admissão: o kit da função entra sozinho (enquanto a pessoa não mexer nos itens)
  useEffect(() => {
    if (type !== 'rh_admissao' || touched || !f.role.trim() || !cat) return;
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ role: f.role.trim(), camisa: f.camisa, calca: f.calca, calcado: f.calcado });
        const j = await api<{ kit: { role: string; period_months: number } | null; lines: { item_id: string | null; name: string; size: string | null; qty: number; note?: string | null }[] }>(`/api/rh/kits?${qs}`);
        if (!j.kit) {
          setKitInfo(`A função "${f.role.trim()}" não tem kit cadastrado: adicione os itens abaixo (ou cadastre o kit em Colaboradores › Kits).`);
          return;
        }
        setKitInfo(`Kit da função ${j.kit.role} (troca a cada ${j.kit.period_months} meses), já com os tamanhos. Confira e ajuste se precisar.`);
        setLines(
          j.lines.map((l) => {
            const it = l.item_id ? cat.items.find((x) => x.id === l.item_id) : null;
            return { key: ++seq.current, item_id: it?.id ?? null, text: it ? `${it.name}${it.size ? ' ' + it.size : ''}` : l.name, size: it ? '' : l.size ?? '', qty: String(l.qty), note: l.note ?? null };
          }),
        );
      } catch {
        /* sem kit: segue à mão */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [type, touched, f.role, f.camisa, f.calca, f.calcado, cat]);

  const setLine = (key: number, p: Partial<Line>) => {
    setTouched(true);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const filled = lines.filter((l) => l.item_id || l.text.trim());
    if (!filled.length) return setError('Adicione pelo menos um item.');
    if (type !== 'operacao' && !f.collaborator.trim()) return setError('Informe o colaborador.');
    if (type === 'rh_extra' && !chosen) return setError('Escolha um colaborador cadastrado (troca extraordinária é para quem já recebeu).');
    if (type === 'rh_extra' && !f.reason.trim()) return setError('Diga o motivo da troca extraordinária (desgaste, perda, mudança de função).');
    if (type === 'rh_admissao' && !f.start) return setError('Informe a data de início do colaborador.');
    setBusy(true);
    try {
      const posto = cat?.postos.find((p) => fold(p.name) === fold(f.posto.trim()));
      const j = await api<{ order: MaterialOrder }>('/api/pedidos', {
        method: 'POST',
        json: {
          type,
          forward: type === 'operacao' ? forward : undefined,
          posto_id: posto?.id,
          posto_name: f.posto.trim() || undefined,
          collaborator_id: chosen?.id,
          collaborator_name: chosen ? undefined : f.collaborator.trim() || undefined,
          matricula: f.matricula.trim() || undefined,
          role: f.role.trim() || undefined,
          company: f.company.trim() || undefined,
          supervisor: f.supervisor.trim() || undefined,
          sizes: type === 'rh_admissao' ? { camisa: f.camisa, calca: f.calca, calcado: f.calcado } : undefined,
          start_date: type === 'rh_admissao' ? f.start : undefined,
          needed_by: f.needed || undefined,
          priority,
          reason: f.reason.trim() || undefined,
          items: filled.map((l) => (l.item_id ? { item_id: l.item_id, qty: Number(l.qty) || 0, note: l.note } : { name: l.text.trim(), size: l.size.trim() || null, qty: Number(l.qty) || 0, note: l.note })),
        },
      });
      onSaved(j.order);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const today = todayLocal();
  const items = cat?.items ?? [];
  return (
    <Sheet title={scope === 'rh' ? 'Novo pedido do RH/DP' : 'Novo pedido de material'} lead={scope === 'rh' ? 'Vai direto ao Almoxarifado, que reserva, entrega e avisa o que falta comprar.' : 'Registre o pedido do posto; ele segue para o Almoxarifado quando você encaminhar.'} onClose={onClose} wide locked>
      <form onSubmit={submit} noValidate>
        {scope === 'rh' ? (
          <div className="filter-seg" role="group" aria-label="Tipo de pedido" style={{ marginBottom: 14 }}>
            <button type="button" className={type === 'rh_admissao' ? 'is-active' : ''} onClick={() => setType('rh_admissao')} aria-pressed={type === 'rh_admissao'}>
              Admissão (kit)
            </button>
            <button type="button" className={type === 'rh_extra' ? 'is-active' : ''} onClick={() => setType('rh_extra')} aria-pressed={type === 'rh_extra'}>
              Troca extraordinária
            </button>
          </div>
        ) : null}

        <datalist id="o-collabs">
          {collabs.map((c) => (
            <option key={c.id} value={c.name}>
              {[c.matricula, c.role, c.posto_name].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
        <datalist id="o-postos">
          {(cat?.postos ?? []).map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <datalist id="o-roles">
          {(cat?.roles ?? []).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        <div className="sx-grid">
          <div className={type === 'operacao' ? '' : 'full'}>
            <label className="label" htmlFor="o-col">
              Colaborador {type === 'operacao' ? <span className="opt-tag">(opcional)</span> : null}
            </label>
            <input id="o-col" className="input" list="o-collabs" value={f.collaborator} maxLength={120} onChange={(e) => set('collaborator', e.target.value)} placeholder={type === 'rh_admissao' ? 'Nome completo do novo colaborador' : 'Comece a digitar o nome'} />
            <small className="help">{chosen ? `Cadastrado${chosen.matricula ? ` · matrícula ${chosen.matricula}` : ''}${chosen.role ? ` · ${chosen.role}` : ''}` : type === 'rh_admissao' && f.collaborator.trim() ? 'Novo: o cadastro é criado junto com o pedido.' : ' '}</small>
          </div>
          <div>
            <label className="label" htmlFor="o-posto">
              Posto
            </label>
            <input id="o-posto" className="input" list="o-postos" value={f.posto} maxLength={120} onChange={(e) => set('posto', e.target.value)} />
          </div>
          {type === 'operacao' ? (
            <div>
              <label className="label" htmlFor="o-sup">
                Supervisor <span className="opt-tag">(opcional)</span>
              </label>
              <input id="o-sup" className="input" value={f.supervisor} maxLength={120} onChange={(e) => set('supervisor', e.target.value)} />
            </div>
          ) : null}
          {type === 'rh_admissao' ? (
            <>
              <div>
                <label className="label" htmlFor="o-mat">
                  Matrícula <span className="opt-tag">(opcional)</span>
                </label>
                <input id="o-mat" className="input" value={f.matricula} maxLength={40} onChange={(e) => set('matricula', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="o-role">
                  Função
                </label>
                <input id="o-role" className="input" list="o-roles" value={f.role} maxLength={80} onChange={(e) => set('role', e.target.value)} placeholder="Ex.: Vigilante" />
              </div>
              <div>
                <label className="label" htmlFor="o-comp">
                  Empresa <span className="opt-tag">(opcional)</span>
                </label>
                <input id="o-comp" className="input" value={f.company} maxLength={80} onChange={(e) => set('company', e.target.value)} placeholder="Ex.: Max Forte" />
              </div>
              <div className="full o-sizes">
                <span className="label">Tamanhos</span>
                <div>
                  <input className="input" aria-label="Tamanho da camisa" placeholder="Camisa (P, M, G…)" value={f.camisa} maxLength={6} onChange={(e) => set('camisa', e.target.value.toUpperCase())} />
                  <input className="input" aria-label="Tamanho da calça" placeholder="Calça (38, 40…)" value={f.calca} maxLength={6} onChange={(e) => set('calca', e.target.value.toUpperCase())} />
                  <input className="input" aria-label="Número do calçado" placeholder="Calçado (40, 42…)" value={f.calcado} maxLength={6} onChange={(e) => set('calcado', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="o-start">
                  <CalendarClock size={14} style={{ verticalAlign: '-2px' }} /> Data de início
                </label>
                <input id="o-start" type="date" className="input" value={f.start} onChange={(e) => set('start', e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <label className="label" htmlFor="o-need">
                <CalendarClock size={14} style={{ verticalAlign: '-2px' }} /> Precisa até <span className="opt-tag">(opcional)</span>
              </label>
              <input id="o-need" type="date" className="input" min={today} value={f.needed} onChange={(e) => set('needed', e.target.value)} />
            </div>
          )}
          <div>
            <span className="label">Prioridade</span>
            <div className="filter-seg" role="group" aria-label="Prioridade">
              <button type="button" className={priority === 'normal' ? 'is-active' : ''} onClick={() => setPriority('normal')} aria-pressed={priority === 'normal'}>
                Normal
              </button>
              <button type="button" className={priority === 'urgente' ? 'is-active' : ''} onClick={() => setPriority('urgente')} aria-pressed={priority === 'urgente'}>
                <Flame size={14} /> Urgente
              </button>
            </div>
          </div>
          <div className="full">
            <label className="label" htmlFor="o-reason">
              Motivo {type === 'rh_extra' ? null : <span className="opt-tag">(opcional)</span>}
            </label>
            <textarea id="o-reason" className="textarea" rows={2} maxLength={600} value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder={type === 'rh_extra' ? 'Ex.: farda rasgada em serviço; mudou de função' : 'Ex.: reposição; posto novo'} />
          </div>
        </div>

        <h3 className="sec-title" style={{ marginTop: 6 }}>
          Itens
        </h3>
        {kitInfo && type === 'rh_admissao' ? (
          <p className="o-kit">
            <Sparkles size={14} /> {kitInfo}
          </p>
        ) : null}
        <div className="p-lines">
          {lines.map((l, n) => (
            <div className="p-line" key={l.key}>
              <span className="p-line-n">{n + 1}</span>
              <div className="p-line-item">
                <ItemPicker
                  label={`Item ${n + 1}`}
                  value={{ item_id: l.item_id, text: l.text }}
                  items={items}
                  taken={lines.filter((x) => x.key !== l.key && x.item_id).map((x) => x.item_id!)}
                  onPick={(it) => setLine(l.key, { item_id: it.id, text: `${it.name}${it.size ? ' ' + it.size : ''}`, size: '' })}
                  onText={(t) => setLine(l.key, { item_id: null, text: t })}
                />
                <small className="p-line-hint">
                  {l.item_id ? `Do estoque · disponível ${items.find((i) => i.id === l.item_id)?.available ?? 0}` : l.note ? l.note : l.text.trim() ? 'Não está no estoque com esse nome: o Almoxarifado confere' : ' '}
                </small>
              </div>
              <input className="input p-line-size" aria-label={`Tamanho do item ${n + 1}`} placeholder="Tam." value={l.item_id ? '' : l.size} readOnly={Boolean(l.item_id)} tabIndex={l.item_id ? -1 : undefined} maxLength={40} onChange={(e) => setLine(l.key, { size: e.target.value })} />
              <input className="input p-line-qty" aria-label={`Quantidade do item ${n + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
              {lines.length > 1 ? (
                <button type="button" className="icon-btn" onClick={() => { setTouched(true); setLines((ls) => ls.filter((x) => x.key !== l.key)); }} aria-label={`Remover item ${n + 1}`}>
                  <X size={16} />
                </button>
              ) : (
                <span className="p-line-gap" />
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, blank()])} disabled={lines.length >= 40} style={{ marginBottom: 14 }}>
          <Plus size={15} /> Adicionar item
        </button>

        {type === 'operacao' ? (
          <label className="o-check">
            <input type="checkbox" checked={forward} onChange={(e) => setForward(e.target.checked)} /> Encaminhar direto ao Almoxarifado (desmarque para conferir antes)
          </label>
        ) : null}

        {error ? (
          <div className="sx-error" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !cat}>
            {busy ? <span className="spinner" /> : <PackagePlus size={18} />} {type === 'operacao' && !forward ? 'Salvar pedido' : 'Enviar ao Almoxarifado'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
