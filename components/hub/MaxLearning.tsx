'use client';
import { Brain, CircleHelp, NotebookPen, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../core/api';
import { useToast } from '../core/Toasts';
import { getSector } from '@/lib/sectors';

interface LearnedRow {
  id: string;
  phrase: string;
  scope: string;
  sector: string | null;
  route: string | null;
  tool: string | null;
  hits: number;
  good: number;
  bad: number;
  trusted: boolean;
  updated_at: string;
}
interface NoteRow {
  id: string;
  sector: string | null;
  text: string;
  created_by: string | null;
}
interface MissRow {
  id: string;
  phrase: string;
  scope: string | null;
  sector: string | null;
  reason: string;
  answer: string | null;
  user_name: string | null;
  created_at: string;
}
interface Data {
  enabled: boolean;
  learned: LearnedRow[];
  notes: NoteRow[];
  misses: MissRow[];
}

const REASON: Record<string, string> = { nao_entendeu: 'não entendeu', desistiu: 'IA não soube', negativo: 'marcada como errada', limite: 'limite da IA' };
const where = (scope: string | null, sector: string | null) => (scope === 'hub' ? 'Painel master' : getSector(sector)?.name ?? 'Setor');
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' });

/** Painel master: o que a Max aprendeu, o que foi ensinado a ela e o que ela não soube atender. */
export function MaxLearning() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api<Data>('/api/max/memoria?painel=1'));
      setFailed('');
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (kind: 'aprendido' | 'nota' | 'falha', id: string) => {
    try {
      await api('/api/max/memoria', { method: 'DELETE', json: { kind, id } });
      await load();
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível apagar', text: (e as Error).message });
    }
  };

  const commands = data?.learned.filter((l) => l.route) ?? [];
  const tools = data?.learned.filter((l) => !l.route) ?? [];
  const used = data?.learned.reduce((t, l) => t + Math.max(0, l.hits - 1), 0) ?? 0;

  return (
    <div className="section-scroll">
      <div className="section-pad wide">
        <div className="section-head">
          <div>
            <h1>Aprendizado da Max</h1>
            <p>O que ela já aprendeu com o uso, o que a equipe ensinou e os pedidos que ela ainda não soube atender.</p>
          </div>
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={load} disabled={busy}>
              <RefreshCw size={17} /> Atualizar
            </button>
          </div>
        </div>

        {failed ? (
          <div className="banner">{failed}</div>
        ) : data && !data.enabled && !data.learned.length && !data.misses.length && !data.notes.length ? (
          <div className="banner" role="note">
            <Brain size={20} color="var(--lilac)" />
            <span>
              A memória ainda não está ativada (ou está vazia). Se ainda não rodou, cole o arquivo <b>supabase/max_aprendizado.sql</b> no SQL Editor do Supabase. Sem ele a Max funciona normalmente, só não guarda o que aprende.
            </span>
          </div>
        ) : null}

        <div className="learn-stats">
          <div className="learn-stat">
            <small>Comandos aprendidos</small>
            <b>{data ? commands.length : '…'}</b>
          </div>
          <div className="learn-stat">
            <small>Exemplos para a IA</small>
            <b>{data ? tools.length : '…'}</b>
          </div>
          <div className="learn-stat">
            <small>Vezes que a memória ajudou</small>
            <b>{data ? used : '…'}</b>
          </div>
          <div className="learn-stat">
            <small>Pedidos não atendidos</small>
            <b>{data ? data.misses.length : '…'}</b>
          </div>
        </div>

        <section className="learn-block">
          <h3 className="sec-title">
            <CircleHelp size={16} /> Pedidos que ela não soube atender
            {data?.misses.length ? (
              <button className="btn btn-ghost btn-sm" onClick={() => remove('falha', 'todas')}>
                Limpar lista
              </button>
            ) : null}
          </h3>
          {!data ? (
            <div className="skeleton" style={{ height: 60 }} />
          ) : data.misses.length === 0 ? (
            <div className="empty-line">Nada por aqui. Quando alguém pedir algo que ela não entenda, ou marcar 👎, aparece nesta lista.</div>
          ) : (
            data.misses.map((m) => (
              <div className="learn-row" key={m.id}>
                <div>
                  <b>“{m.phrase}”</b>
                  <small>
                    {[REASON[m.reason] ?? m.reason, where(m.scope, m.sector), m.user_name, when(m.created_at)].filter(Boolean).join(' · ')}
                    {m.answer ? ` · respondeu: “${m.answer}”` : ''}
                  </small>
                </div>
                <button className="icon-btn" onClick={() => remove('falha', m.id)} aria-label="Apagar registro">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </section>

        <section className="learn-block">
          <h3 className="sec-title">
            <NotebookPen size={16} /> Anotações ensinadas
          </h3>
          {!data ? null : data.notes.length === 0 ? (
            <div className="empty-line">Nenhuma ainda. Diga, por exemplo: “Max, lembre que o fornecedor de botas é a Casa do Vigilante”.</div>
          ) : (
            data.notes.map((n) => (
              <div className="learn-row" key={n.id}>
                <div>
                  <b>{n.text}</b>
                  <small>{[n.sector ? getSector(n.sector)?.name : 'Todos os setores', n.created_by].filter(Boolean).join(' · ')}</small>
                </div>
                <button className="icon-btn" onClick={() => remove('nota', n.id)} aria-label="Apagar anotação">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </section>

        <section className="learn-block">
          <h3 className="sec-title">
            <Brain size={16} /> O que ela aprendeu com o uso
          </h3>
          {!data ? null : data.learned.length === 0 ? (
            <div className="empty-line">Ainda vazio. Cada pedido que a IA resolve vira um exemplo aqui, e os próximos pedidos parecidos saem mais rápidos e certeiros.</div>
          ) : (
            data.learned.slice(0, 200).map((l) => (
              <div className={`learn-row${l.trusted ? '' : ' is-off'}`} key={l.id}>
                <div>
                  <b>“{l.phrase}”</b>
                  <small>
                    → {l.route ? `comando “${l.route}”` : `ferramenta ${l.tool}`} · {where(l.scope, l.sector)} · usado {l.hits}× · 👍 {l.good} · 👎 {l.bad}
                    {l.trusted ? '' : ' · desativado pelos 👎'}
                  </small>
                </div>
                <button className="icon-btn" onClick={() => remove('aprendido', l.id)} aria-label="Esquecer este aprendizado" title="Esquecer">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
