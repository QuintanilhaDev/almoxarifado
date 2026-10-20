'use client';
import { AlertCircle, AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, Clock3, FileArchive, FileDown, FileSpreadsheet, FileUp, Filter, RotateCcw, Search, Settings2, ShieldAlert, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../core/Toasts';
import { filtrar, opcoes } from '@/lib/pontos/analyze';
import { destaques } from '@/lib/pontos/destaques';
import { DEFAULT_PONTO, ORDEM, SEMANA, SITUACAO, dataBR, hhmm, semRegistro, type Analise, type Filtros, type FuncAnalisado, type PontoConfig, type Situacao } from '@/lib/pontos/types';
import '../almoxarifado/estoque.css';
import '../pedidos/pedidos.css';
import '../compras/compras.css';
import './pontos.css';

type Filtro = 'todos' | 'critico' | 'atencao' | 'ok';
const STATUS = { ok: { label: 'Regular', tone: 'green' }, atencao: { label: 'Atenção', tone: 'amber' }, critico: { label: 'Crítico', tone: 'red' } } as const;
const AUTO_KEY = 'maxhub-pontos-autozip';
const CFG_KEY = 'maxhub-pontos-config';
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (s: string, d: number) => {
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : d;
};
const curto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diaAntes = (d: string) => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const semAcento = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** baixa a resposta como arquivo (vai para a pasta Downloads) */
async function download(url: string, body: unknown, fallback: string) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Não consegui gerar o arquivo.');
  const cd = r.headers.get('Content-Disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const name = star ? decodeURIComponent(star) : cd.match(/filename="([^"]+)"/)?.[1] ?? fallback;
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

/**
 * Aba Pontos (só da Evelyn): anexa o espelho exportado do GesOper (PDF, Excel ou CSV), a
 * ferramenta lê cada funcionário seguindo a escala dele (folga não conta como falta), mostra
 * quem está sem registro ou parcialmente sem registro e baixa um .zip com o relatório completo
 * e o relatório para a diretoria. Nada fica gravado no servidor.
 */
export function PontosPanel() {
  const toast = useToast();
  const [cfg, setCfg] = useState<PontoConfig>(DEFAULT_PONTO);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    try {
      const c = localStorage.getItem(CFG_KEY);
      if (c) setCfg({ ...DEFAULT_PONTO, ...JSON.parse(c) });
      setAuto(localStorage.getItem(AUTO_KEY) !== '0');
    } catch {
      /* sem armazenamento: usa o padrão */
    }
  }, []);
  const saveCfg = (c: PontoConfig) => {
    setCfg(c);
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
  };
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Analise | null>(null);
  const [fl, setFl] = useState<Filtros>({});
  const [busy, setBusy] = useState<'' | 'analise' | 'zip' | 'pdf' | 'diretoria' | 'xlsx'>('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [tipo, setTipo] = useState<Situacao | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // o recorte (período, posto, filial, função) vale para a tela e para os relatórios
  const view = useMemo(() => (res ? filtrar(res, fl) : null), [res, fl]);
  const ops = useMemo(() => (res ? opcoes(res) : { postos: [], filiais: [], funcoes: [] }), [res]);
  const recortado = Boolean(view?.filtros);

  const analisar = async (f: File, c = cfg, baixar = auto) => {
    setBusy('analise');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('config', JSON.stringify(c));
      const r = await fetch('/api/pontos/analisar', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Não consegui analisar o arquivo.');
      const a = j.analise as Analise;
      setRes(a);
      setFile(f);
      setFl({});
      setOpen(null);
      setTipo(null);
      setFiltro('todos');
      if (baixar) {
        setBusy('zip');
        const name = await download('/api/pontos/relatorio?format=zip', { analise: a }, 'Relatorio de Ponto.zip');
        toast({ kind: 'success', title: 'Relatórios baixados', text: `${name}: o completo e o da diretoria. ${a.resumo.funcionarios} funcionário(s) analisado(s).` }, 9000);
      } else toast({ kind: 'success', title: 'Espelho analisado', text: `${a.resumo.funcionarios} funcionário(s), ${a.resumo.ocorrencias} ocorrência(s).` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const baixar = async (format: 'zip' | 'pdf' | 'diretoria' | 'xlsx') => {
    if (!view) return;
    setBusy(format);
    try {
      const name = await download(`/api/pontos/relatorio?format=${format}`, { analise: view }, 'relatorio');
      toast({ kind: 'success', title: 'Arquivo baixado', text: name + (recortado ? ' (com o recorte escolhido)' : '') });
    } catch (e) {
      toast({ kind: 'error', title: 'Não consegui gerar', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const lista = useMemo(() => {
    if (!view) return [];
    const t = semAcento(q.trim());
    return view.funcionarios.filter(
      (f) => (filtro === 'todos' || f.status === filtro) && (!tipo || (f.totais.porTipo[tipo] ?? 0) > 0) && (!t || semAcento(`${f.name} ${f.matricula ?? ''} ${f.posto ?? ''}`).includes(t)),
    );
  }, [view, q, filtro, tipo]);
  const registro = useMemo(() => (view ? view.funcionarios.map((f) => ({ f, ...semRegistro(f) })).filter((x) => x.total > 0).sort((a, b) => b.sem.length - a.sem.length || b.total - a.total || a.f.name.localeCompare(b.f.name, 'pt-BR')) : []), [view]);
  const frases = useMemo(() => (view ? destaques(view) : []), [view]);

  const regras = (
    <div className="pt-cfg">
      <div>
        <label className="label" htmlFor="pt-escala">
          Escala
        </label>
        <select id="pt-escala" className="select input" value={cfg.escala} onChange={(e) => saveCfg({ ...cfg, escala: e.target.value as PontoConfig['escala'] })}>
          <option value="auto">A de cada funcionário (do espelho)</option>
          <option value="12x36">12x36 para todos</option>
          <option value="diaria">Diária para todos</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="pt-tol">
          Tolerância por dia (min)
        </label>
        <input id="pt-tol" className="input" inputMode="numeric" value={cfg.tolerancia} onChange={(e) => saveCfg({ ...cfg, tolerancia: Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
      </div>
      <div>
        <label className="label" htmlFor="pt-jor">
          Jornada diária (sem escala no espelho)
        </label>
        <input id="pt-jor" className="input" defaultValue={toHM(cfg.jornada)} key={'j' + cfg.jornada} onBlur={(e) => saveCfg({ ...cfg, jornada: fromHM(e.target.value, cfg.jornada) })} />
      </div>
      <div>
        <label className="label" htmlFor="pt-int">
          Intervalo mínimo
        </label>
        <input id="pt-int" className="input" defaultValue={toHM(cfg.intervalo)} key={'i' + cfg.intervalo} onBlur={(e) => saveCfg({ ...cfg, intervalo: fromHM(e.target.value, cfg.intervalo) })} />
      </div>
      <div>
        <label className="label" htmlFor="pt-inter">
          Descanso entre jornadas
        </label>
        <input id="pt-inter" className="input" defaultValue={toHM(cfg.interjornada)} key={'x' + cfg.interjornada} onBlur={(e) => saveCfg({ ...cfg, interjornada: fromHM(e.target.value, cfg.interjornada) })} />
      </div>
      <label className="pc-check pt-auto">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            try {
              localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0');
            } catch {
              /* ignore */
            }
          }}
        />{' '}
        Baixar os relatórios (.zip) sozinho depois da análise
      </label>
      <button type="button" className="link-btn" onClick={() => saveCfg(DEFAULT_PONTO)}>
        voltar ao padrão (CLT)
      </button>
    </div>
  );

  return (
    <div className="section-scroll">
      <div className="section-pad wide pt-wrap">
        <div className="section-head">
          <div>
            <h1>Pontos</h1>
            <p>Anexe o espelho do GesOper: cada funcionário é conferido pela própria escala e os relatórios saem prontos para a diretoria.</p>
          </div>
          {view ? (
            <div className="head-actions pt-actions">
              <button className="btn btn-ghost" onClick={() => baixar('xlsx')} disabled={Boolean(busy)} data-max="pontos-planilha" title="Planilha de controle">
                {busy === 'xlsx' ? <span className="spinner" /> : <FileSpreadsheet size={17} />} Planilha
              </button>
              <button className="btn btn-ghost" onClick={() => baixar('diretoria')} disabled={Boolean(busy)} data-max="pontos-diretoria">
                {busy === 'diretoria' ? <span className="spinner" /> : <FileDown size={17} />} Só o da diretoria
              </button>
              <button className="btn btn-primary" onClick={() => baixar('zip')} disabled={Boolean(busy)} data-max="pontos-zip">
                {busy === 'zip' ? <span className="spinner" /> : <FileArchive size={17} />} Baixar relatórios (.zip)
              </button>
            </div>
          ) : null}
        </div>

        {!res || !view ? (
          <>
            <div
              className={`pt-drop${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Anexar o espelho de ponto"
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f && !busy) void analisar(f);
              }}
              data-max="pontos-anexar"
            >
              <span className="pt-drop-icon">{busy ? <span className="spinner" /> : <FileUp size={28} />}</span>
              <strong>{busy === 'analise' ? 'Lendo o espelho…' : busy === 'zip' ? 'Gerando os relatórios…' : 'Anexe o espelho de ponto'}</strong>
              <span>{busy ? 'Conferindo cada funcionário pela escala dele, dia por dia.' : 'Arraste o arquivo exportado do GesOper para cá ou toque para escolher. PDF, Excel (.xlsx) ou CSV, do jeito que sair do sistema.'}</span>
              <input ref={inputRef} type="file" hidden accept=".pdf,.xlsx,.xls,.csv,.txt,.htm,.html" aria-label="Arquivo do espelho de ponto" onChange={(e) => e.target.files?.[0] && analisar(e.target.files[0])} />
            </div>
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <div className="pt-steps">
              {[
                [FileUp, 'Anexe o espelho', 'O arquivo do período (21 a 20) exportado do GesOper, de um posto ou de vários.'],
                [ShieldAlert, 'A ferramenta confere', 'Pela escala de cada um (folga não conta): sem registro, registro parcial, falta, atraso, hora extra, intervalo e descanso.'],
                [FileArchive, 'Relatórios prontos', 'Um .zip baixa sozinho com o RELATÓRIO COMPLETO e o RELATÓRIO PARA DIRETORIA.'],
              ].map(([I, t, d], i) => {
                const Icon = I as typeof FileUp;
                return (
                  <div key={i} className="pt-step">
                    <span>
                      <Icon size={18} />
                    </span>
                    <b>{t as string}</b>
                    <small>{d as string}</small>
                  </div>
                );
              })}
            </div>
            <button type="button" className="pt-cfg-toggle" onClick={() => setShowCfg((s) => !s)} aria-expanded={showCfg}>
              <Settings2 size={15} /> Regras do cálculo <ChevronDown size={15} style={{ transform: showCfg ? 'rotate(180deg)' : undefined }} />
            </button>
            {showCfg ? regras : null}
          </>
        ) : (
          <>
            <div className="pt-bar">
              <span>
                <CalendarRange size={15} /> <b>{dataBR(res.periodo.from)}</b> a <b>{dataBR(res.periodo.to)}</b>
              </span>
              <span className="pt-file">
                {res.arquivo} · {res.formato}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRes(null);
                  setFile(null);
                  setError('');
                }}
                data-max="pontos-novo"
              >
                <RotateCcw size={14} /> Novo espelho
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCfg((s) => !s)} aria-expanded={showCfg}>
                <Settings2 size={14} /> Regras
              </button>
            </div>
            {showCfg ? (
              <>
                {regras}
                <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} disabled={!file || Boolean(busy)} onClick={() => file && analisar(file, cfg, false)}>
                  {busy === 'analise' ? <span className="spinner" /> : <RotateCcw size={14} />} Recalcular com estas regras
                </button>
              </>
            ) : null}

            {/* filtros: período, cliente/posto, filial e função */}
            <div className="pt-filters" role="group" aria-label="Filtros">
              <Filter size={15} className="pt-filters-icon" />
              <label>
                <span>De</span>
                <input type="date" className="input" min={res.periodo.from} max={res.periodo.to} value={fl.de ?? res.periodo.from} onChange={(e) => setFl({ ...fl, de: e.target.value || undefined })} aria-label="Período: de" />
              </label>
              <label>
                <span>Até</span>
                <input type="date" className="input" min={res.periodo.from} max={res.periodo.to} value={fl.ate ?? res.periodo.to} onChange={(e) => setFl({ ...fl, ate: e.target.value || undefined })} aria-label="Período: até" />
              </label>
              <label className="pt-grow">
                <span>Cliente/posto</span>
                <select className="select input" value={fl.posto ?? ''} onChange={(e) => setFl({ ...fl, posto: e.target.value || undefined })} aria-label="Cliente/posto">
                  <option value="">Todos ({ops.postos.length})</option>
                  {ops.postos.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Filial</span>
                <select className="select input" value={fl.filial ?? ''} onChange={(e) => setFl({ ...fl, filial: e.target.value || undefined })} aria-label="Filial">
                  <option value="">Todas ({ops.filiais.length})</option>
                  {ops.filiais.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Função</span>
                <select className="select input" value={fl.funcao ?? ''} onChange={(e) => setFl({ ...fl, funcao: e.target.value || undefined })} aria-label="Função">
                  <option value="">Todas ({ops.funcoes.length})</option>
                  {ops.funcoes.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              {recortado ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setFl({})} aria-label="Limpar filtros">
                  <X size={14} /> Limpar
                </button>
              ) : null}
            </div>

            {view.avisos.map((av, i) => (
              <div key={i} className="pt-aviso" role="status">
                <AlertTriangle size={17} />
                <span>{av}</span>
                {res.corte && i === view.avisos.length - 1 && av.startsWith('A partir de') ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setFl({ ...fl, ate: diaAntes(res.corte!) })} data-max="pontos-corte">
                    Considerar só até {curto(diaAntes(res.corte))}
                  </button>
                ) : null}
              </div>
            ))}

            <div className="stat-grid">
              <div className="stat">
                <small>
                  <Users size={13} style={{ verticalAlign: '-2px' }} /> Funcionários
                </small>
                <b>{view.resumo.funcionarios}</b>
                <span className="pt-sub">{view.resumo.dias} dias avaliados</span>
              </div>
              <div className="stat">
                <small>
                  <ShieldAlert size={13} style={{ verticalAlign: '-2px' }} /> Sem registro
                </small>
                <b style={{ color: (view.resumo.porTipo.sem_registro ?? 0) + (view.resumo.porTipo.falta ?? 0) ? 'var(--danger)' : 'var(--mint)' }}>{(view.resumo.porTipo.sem_registro ?? 0) + (view.resumo.porTipo.falta ?? 0)}</b>
                <span className="pt-sub">dias escalados sem batida</span>
              </div>
              <div className="stat">
                <small>
                  <AlertTriangle size={13} style={{ verticalAlign: '-2px' }} /> Registro parcial
                </small>
                <b style={{ color: (view.resumo.porTipo.incompleta ?? 0) + (view.resumo.porTipo.sem_intervalo ?? 0) ? 'var(--amber)' : 'var(--mint)' }}>{(view.resumo.porTipo.incompleta ?? 0) + (view.resumo.porTipo.sem_intervalo ?? 0)}</b>
                <span className="pt-sub">dias com batida faltando</span>
              </div>
              <div className="stat">
                <small>
                  <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> Conformidade
                </small>
                <b style={{ color: view.resumo.conformidade >= 95 ? 'var(--mint)' : view.resumo.conformidade >= 85 ? 'var(--amber)' : 'var(--danger)' }}>{view.resumo.conformidade.toLocaleString('pt-BR')}%</b>
                <span className="pt-sub">
                  <Clock3 size={11} style={{ verticalAlign: '-1px' }} /> {hhmm(view.resumo.extras)} além da jornada
                </span>
              </div>
            </div>

            {/* o que ela procura primeiro: quem está sem registro ou com registro parcial */}
            <section className="pt-reg" aria-label="Sem registro ou parcialmente sem registro">
              <h3 className="sec-title">
                {registro.length ? `Precisam de atenção: sem registro ou registro parcial (${registro.length})` : 'Registros de ponto'}
              </h3>
              {!registro.length ? (
                <p className="help">
                  <CheckCircle2 size={14} color="var(--mint)" style={{ verticalAlign: '-2px' }} /> Todos registraram o ponto em todos os dias da escala{recortado ? ' neste recorte' : ''}.
                </p>
              ) : (
                <div className="pt-reg-list">
                  {registro.map(({ f, sem, parcial }) => (
                    <button key={f.name + (f.matricula ?? '')} className="pt-reg-row" onClick={() => setOpen(f.name + (f.matricula ?? ''))} aria-label={`Ver os dias de ${f.name}`}>
                      <span className="pt-reg-who">
                        <b>{f.name}</b>
                        <small>{[f.matricula ? `Mat. ${f.matricula}` : null, f.posto].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="pt-reg-days">
                        {sem.length ? (
                          <span className="pt-reg-line">
                            <em className="n-alta">{sem.length} sem registro</em>
                            {sem.map((d) => (
                              <i key={d} className="n-alta">
                                {curto(d)}
                              </i>
                            ))}
                          </span>
                        ) : null}
                        {parcial.length ? (
                          <span className="pt-reg-line">
                            <em className="n-media">{parcial.length} parcial</em>
                            {parcial.map((d) => (
                              <i key={d} className="n-media">
                                {curto(d)}
                              </i>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {frases.length ? (
              <section className="pt-dest">
                <h3 className="sec-title">Destaques</h3>
                <ul>
                  {frases.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <h3 className="sec-title">Todos os funcionários</h3>
            <div className="pt-tipos" role="group" aria-label="Filtrar por situação">
              {ORDEM.filter((t) => view.resumo.porTipo[t]).map((t) => (
                <button key={t} className={`pt-tipo n-${SITUACAO[t].nivel}${tipo === t ? ' is-on' : ''}`} onClick={() => setTipo(tipo === t ? null : t)} title={SITUACAO[t].desc}>
                  <i /> {SITUACAO[t].label} <em>{view.resumo.porTipo[t]}</em>
                </button>
              ))}
              {!view.resumo.ocorrencias ? (
                <span className="pt-tipo n-ok">
                  <CheckCircle2 size={14} /> Nenhuma ocorrência
                </span>
              ) : null}
            </div>
            <div className="toolbar">
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar funcionário, matrícula ou posto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar funcionário" />
              </div>
              <div className="filter-seg" role="tablist" aria-label="Situação">
                {(['todos', 'critico', 'atencao', 'ok'] as Filtro[]).map((f) => (
                  <button key={f} className={filtro === f ? 'is-active' : ''} onClick={() => setFiltro(f)}>
                    {f === 'todos' ? 'Todos' : STATUS[f].label} <em>{f === 'todos' ? view.funcionarios.length : view.funcionarios.filter((x) => x.status === f).length}</em>
                  </button>
                ))}
              </div>
            </div>
            <div className="pt-list">
              {!lista.length ? <p className="help">Ninguém neste filtro.</p> : null}
              {lista.map((f) => {
                const k = f.name + (f.matricula ?? '');
                return <Funcionario key={k} f={f} open={open === k} onToggle={() => setOpen(open === k ? null : k)} tipo={tipo} />;
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Funcionario({ f, open, onToggle, tipo }: { f: FuncAnalisado; open: boolean; onToggle: () => void; tipo: Situacao | null }) {
  const s = STATUS[f.status];
  const chips = ORDEM.filter((t) => f.totais.porTipo[t]);
  const dias = f.dias.filter((d) => d.ocorrencias.length && (!tipo || d.ocorrencias.some((o) => o.tipo === tipo)));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [open]);
  return (
    <div ref={ref} className={`pt-func${open ? ' is-open' : ''}`}>
      <button className="pt-func-row" onClick={onToggle} aria-expanded={open} aria-label={`Dias de ${f.name}`}>
        <span className="pt-func-main">
          <b>{f.name}</b>
          <small>
            {[f.matricula ? `Mat. ${f.matricula}` : null, f.cargo, f.posto, f.escala === '12x36' ? '12x36' : `Diária${f.jornadaTipica ? ' ' + hhmm(f.jornadaTipica) : ''}`, `${f.totais.trabalhados}/${f.totais.previstos} dias`].filter(Boolean).join(' · ')}
          </small>
        </span>
        <span className="pt-func-chips">
          {chips.slice(0, 4).map((t) => (
            <span key={t} className={`pt-mini n-${SITUACAO[t].nivel}`}>
              {f.totais.porTipo[t]} {SITUACAO[t].short.toLowerCase()}
            </span>
          ))}
          {chips.length > 4 ? <span className="pt-mini">+{chips.length - 4}</span> : null}
        </span>
        <span className="pt-conf" title="Conformidade">
          <i style={{ width: `${f.totais.conformidade}%` }} className={f.totais.conformidade >= 95 ? 'ok' : f.totais.conformidade >= 85 ? 'mid' : 'bad'} />
          <small>{f.totais.conformidade.toLocaleString('pt-BR')}%</small>
        </span>
        <span className={`pbadge ${s.tone}`}>{s.label}</span>
        <ChevronDown size={17} className="pt-chev" />
      </button>
      {open ? (
        <div className="pt-func-body">
          <div className="pt-cal" aria-label="Dias do período">
            {f.dias.map((d) => {
              const worst = d.ocorrencias.reduce<'alta' | 'media' | 'baixa' | null>((w, o) => {
                const n = SITUACAO[o.tipo].nivel;
                return w === 'alta' || n === 'alta' ? 'alta' : w === 'media' || n === 'media' ? 'media' : 'baixa';
              }, null);
              const cls = worst ? `n-${worst}` : d.punches.length ? 'is-work' : d.previsto ? 'is-empty' : 'is-off';
              return (
                <span key={d.date} className={`pt-day ${cls}`} title={`${dataBR(d.date)} (${SEMANA[d.weekday]}) · ${d.punches.join(' ') || d.marks.join(', ') || (d.previsto ? 'sem batidas' : 'folga')}${d.ocorrencias.length ? ' · ' + d.ocorrencias.map((o) => SITUACAO[o.tipo].short).join(', ') : ''}`}>
                  <small>{SEMANA[d.weekday].slice(0, 1).toUpperCase()}</small>
                  {Number(d.date.slice(8))}
                </span>
              );
            })}
          </div>
          <div className="pt-legend">
            <span>
              <i className="is-work" /> trabalhou
            </span>
            <span>
              <i className="is-off" /> folga da escala
            </span>
            <span>
              <i className="n-alta" /> grave
            </span>
            <span>
              <i className="n-media" /> atenção
            </span>
            <span>
              <i className="n-baixa" /> informativo
            </span>
            {f.habitual.inicio ? (
              <span>
                Horário habitual {f.habitual.inicio}
                {f.habitual.fim ? `–${f.habitual.fim}` : ''}
              </span>
            ) : null}
          </div>
          {dias.length ? (
            <div className="t-wrap">
              <table className="t-table pt-days">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Batidas</th>
                    <th className="n">Trabalhado</th>
                    <th>Ocorrência</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((d) => (
                    <tr key={d.date}>
                      <td>
                        <b>{dataBR(d.date).slice(0, 5)}</b> <small>{SEMANA[d.weekday]}</small>
                      </td>
                      <td>
                        {d.punches.length ? d.punches.join('  ') + (d.virada ? ' (+1)' : '') : <small>{d.marks.join(', ') || 'sem batidas'}</small>}
                        {d.local ? <small style={{ display: 'block' }}>{d.local}</small> : null}
                      </td>
                      <td className="n">{d.trabalhado ? hhmm(d.trabalhado) : '—'}</td>
                      <td>
                        {d.ocorrencias.map((o, k) => (
                          <div key={k} className={`pt-oc n-${SITUACAO[o.tipo].nivel}`}>
                            <i /> <b>{SITUACAO[o.tipo].short}:</b> {o.texto}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="help">
              <CheckCircle2 size={14} color="var(--mint)" style={{ verticalAlign: '-2px' }} /> Nenhuma ocorrência{tipo ? ' deste tipo' : ''} no período.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
