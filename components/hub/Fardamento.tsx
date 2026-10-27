'use client';
import { AlertTriangle, CalendarRange, ChevronDown, FileSpreadsheet, FileUp, Filter, Search, Shirt, TrendingDown, TrendingUp, Upload, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../core/Toasts';
import { num } from '@/lib/almoxarifado/stockFormat';
import { SEM_FILTRO, filtrar, grade, mesesEntre, opcoesFarda, resumir, type Fatia, type FiltrosFarda } from '@/lib/fardamento/analise';
import { grupoDe, mesCurto, mesLongo, type ControleFarda, type Entrega, type Grupo } from '@/lib/fardamento/types';
import './fardamento.css';

const COR: Record<Grupo, string> = {
  Camisas: 'var(--lilac)',
  Calças: 'var(--amber)',
  Calçados: 'var(--mint)',
  Acessórios: 'var(--muted)',
};
const dataBR = (d: string) => d.split('-').reverse().join('/');
const pctTxt = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const anoMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const menos = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  return anoMes(new Date(y, m - 1 - n, 1));
};
type Metrica = 'pecas' | 'entregas' | 'funcionarios';
const METRICA: Record<Metrica, string> = {
  pecas: 'Peças',
  entregas: 'Entregas',
  funcionarios: 'Funcionários',
};

/**
 * Controle de fardamento na Gestão: a planilha do RH/DP (cada entrega feita a cada funcionário)
 * vira números, gráficos e listas, com filtros por período, empresa, função, posto, solicitante e peça.
 */
export function Fardamento() {
  const toast = useToast();
  const [dados, setDados] = useState<ControleFarda | null>(null);
  const [vazio, setVazio] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    try {
      const r = await fetch('/api/gestao/fardamento', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não consegui carregar o controle de fardamento.');
      if (j.vazio) setVazio(true);
      else setDados(j);
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  useEffect(() => {
    void carregar();
  }, []);

  const importar = async (f: File) => {
    setEnviando(true);
    setErro('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/gestao/fardamento', {
        method: 'POST',
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Não consegui ler a planilha.');
      setDados(j);
      setVazio(false);
      toast(
        {
          kind: 'success',
          title: 'Planilha importada',
          text: `${num(j.entregas.length)} entregas lidas da aba "${j.aba}".`,
        },
        7000,
      );
    } catch (e) {
      setErro((e as Error).message);
      toast({
        kind: 'error',
        title: 'Não consegui importar',
        text: (e as Error).message,
      });
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const input = <input ref={inputRef} type="file" hidden accept=".xlsx,.xlsm" aria-label="Planilha de controle de fardamento" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />;

  if (!dados) {
    return (
      <div className="fd" data-no-tilt>
        {input}
        {vazio || erro ? (
          <div className="fd-drop" role="button" tabIndex={0} onClick={() => !enviando && inputRef.current?.click()} onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()} data-max="farda-importar">
            <span className="fd-drop-icon">{enviando ? <span className="spinner" /> : <FileUp size={26} />}</span>
            <strong>{enviando ? 'Lendo a planilha…' : 'Importe a planilha de controle de fardamento'}</strong>
            <span>A planilha do RH/DP com cada entrega (empresa, funcionário, função, posto, data e as peças com tamanho e quantidade). As abas de resumo são ignoradas: tudo é recalculado.</span>
            {erro ? (
              <span className="fd-erro">
                <AlertTriangle size={15} /> {erro}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="skeleton" style={{ height: 240, borderRadius: 16 }} />
        )}
      </div>
    );
  }
  return (
    <Painel key={dados.importadoEm} dados={dados} enviando={enviando} trocar={() => inputRef.current?.click()}>
      {input}
    </Painel>
  );
}

function Painel({ dados, enviando, trocar, children }: { dados: ControleFarda; enviando: boolean; trocar: () => void; children: React.ReactNode }) {
  const todas = dados.entregas;
  const op = useMemo(() => opcoesFarda(todas), [todas]);
  const presets = useMemo(() => {
    const ult = op.ultimo;
    const anos = [...new Set(todas.map((e) => e.m.slice(0, 4)))].sort().reverse();
    return [
      {
        id: '12m',
        label: 'Últimos 12 meses',
        de: menos(ult, 11) < op.primeiro ? op.primeiro : menos(ult, 11),
        ate: ult,
      },
      {
        id: '6m',
        label: 'Últimos 6 meses',
        de: menos(ult, 5) < op.primeiro ? op.primeiro : menos(ult, 5),
        ate: ult,
      },
      ...anos.map((a) => ({
        id: a,
        label: a,
        de: `${a}-01` < op.primeiro ? op.primeiro : `${a}-01`,
        ate: `${a}-12` > ult ? ult : `${a}-12`,
      })),
      { id: 'tudo', label: 'Tudo', de: op.primeiro, ate: ult },
    ];
  }, [todas, op]);
  const [f, setF] = useState<FiltrosFarda>(() => ({
    ...SEM_FILTRO,
    de: presets[0].de,
    ate: presets[0].ate,
  }));
  const set = (p: Partial<FiltrosFarda>) => setF((x) => ({ ...x, ...p }));
  const preset = presets.find((p) => p.de === f.de && p.ate === f.ate)?.id ?? '';
  const r = useMemo(() => resumir(todas, f), [todas, f]);
  const [metrica, setMetrica] = useState<Metrica>('pecas');
  const [pecaGrade, setPecaGrade] = useState('');
  const gradePeca = pecaGrade || f.peca || r.pecas.find((p) => p.grupo !== 'Acessórios')?.peca || r.pecas[0]?.peca || '';
  const tamanhos = useMemo(() => (gradePeca ? grade(todas, f, gradePeca) : []), [todas, f, gradePeca]);
  const mesesTodos = useMemo(() => mesesEntre(op.primeiro, op.ultimo), [op]);
  const filtrosAtivos = [f.empresa, f.funcao, f.posto, f.solicitante, f.peca].filter(Boolean).length;
  const [abrir, setAbrir] = useState(false);

  return (
    <div className="fd" data-no-tilt>
      {children}
      <div className="fd-meta">
        <span>
          <FileSpreadsheet size={15} /> <b>{dados.arquivo}</b> · aba {dados.aba} · {num(todas.length)} entregas de {mesLongo(op.primeiro)} a {mesLongo(op.ultimo)}
        </span>
        <span className="fd-meta-quem">
          importada em{' '}
          {new Date(dados.importadoEm).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}{' '}
          por {dados.por}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={trocar} disabled={enviando} data-max="farda-atualizar">
          {enviando ? <span className="spinner" /> : <Upload size={14} />} Atualizar planilha
        </button>
      </div>

      {/* ---------------- filtros ---------------- */}
      <div className="fd-filtros">
        <div className="fd-presets" role="group" aria-label="Período">
          <CalendarRange size={15} />
          {presets.map((p) => (
            <button key={p.id} className={`fd-chip${preset === p.id ? ' is-on' : ''}`} onClick={() => set({ de: p.de, ate: p.ate })}>
              {p.label}
            </button>
          ))}
          <span className="fd-range">
            <Sel label="De" value={f.de} onChange={(v) => set({ de: v, ate: v > f.ate ? v : f.ate })} opts={mesesTodos.map((m) => ({ v: m, t: mesCurto(m) }))} />
            <Sel label="até" value={f.ate} onChange={(v) => set({ ate: v, de: v < f.de ? v : f.de })} opts={mesesTodos.map((m) => ({ v: m, t: mesCurto(m) }))} />
          </span>
        </div>
        <button type="button" className="fd-toggle" onClick={() => setAbrir((a) => !a)} aria-expanded={abrir}>
          <Filter size={15} /> Filtros{filtrosAtivos ? ` (${filtrosAtivos})` : ''} <ChevronDown size={14} style={{ transform: abrir ? 'rotate(180deg)' : undefined }} />
        </button>
        <div className={`fd-selects${abrir ? ' is-open' : ''}`}>
          <Filter size={15} className="fd-only-wide" />
          <Sel label="Empresa" value={f.empresa} onChange={(v) => set({ empresa: v })} opts={op.empresas.map((o) => ({ v: o.nome, t: o.nome }))} todos="Todas as empresas" />
          <Sel label="Função" value={f.funcao} onChange={(v) => set({ funcao: v })} opts={op.funcoes.map((o) => ({ v: o.nome, t: o.nome }))} todos="Todas as funções" />
          <Busca label="Posto" value={f.posto} onChange={(v) => set({ posto: v })} opts={op.postos.map((o) => o.nome)} todos="Todos os postos" />
          <Sel label="Solicitante" value={f.solicitante} onChange={(v) => set({ solicitante: v })} opts={op.solicitantes.map((o) => ({ v: o.nome, t: o.nome }))} todos="Todos os solicitantes" />
          <Sel label="Peça" value={f.peca} onChange={(v) => set({ peca: v })} opts={op.pecas.map((o) => ({ v: o.nome, t: o.nome }))} todos="Todas as peças" />
          {filtrosAtivos ? (
            <button className="link-btn" onClick={() => set(SEM_FILTRO)}>
              <X size={13} /> limpar {filtrosAtivos > 1 ? `${filtrosAtivos} filtros` : 'filtro'}
            </button>
          ) : null}
        </div>
      </div>

      {dados.avisos.length ? <p className="help fd-avisos">{dados.avisos.join(' ')}</p> : null}

      {/* ---------------- números ---------------- */}
      <div className="stat-grid">
        <div className="stat">
          <small>Entregas</small>
          <b>{num(r.total.entregas)}</b>
          <span className="fd-sub">{num(r.total.entregasMes)} por mês, em média</span>
        </div>
        <div className="stat">
          <small>Funcionários atendidos</small>
          <b>{num(r.total.funcionarios)}</b>
          <span className="fd-sub">em {num(r.total.postos)} postos</span>
        </div>
        <div className="stat">
          <small>{f.peca ? `${f.peca} entregues` : 'Peças entregues'}</small>
          <b>{num(r.total.pecas)}</b>
          <span className="fd-sub">
            {num(r.total.pecasMes)} por mês · {r.total.porEntrega.toLocaleString('pt-BR')} por entrega
          </span>
        </div>
        <div className="stat">
          <small>{r.anoAnterior ? 'Peças × mesmo período do ano anterior' : r.tendencia ? `Últimos 3 meses${r.parcial ? ' completos' : ''} × 3 anteriores` : 'Mês com mais entregas'}</small>
          {r.anoAnterior ? (
            <Variacao pct={r.anoAnterior.pct} sub={`${num(r.anoAnterior.pecas)} peças antes`} />
          ) : r.tendencia ? (
            <Variacao pct={r.tendencia.pct} sub={`${num(r.tendencia.atual)} × ${num(r.tendencia.anterior)} peças`} />
          ) : (
            <>
              <b>{r.pico ? mesCurto(r.pico.mes) : '—'}</b>
              <span className="fd-sub">{r.pico ? `${num(r.pico.entregas)} entregas` : ''}</span>
            </>
          )}
        </div>
      </div>

      {r.total.entregas === 0 ? (
        <div className="empty">
          <strong>Nenhuma entrega com esses filtros</strong>
          <span>Troque o período ou limpe os filtros.</span>
        </div>
      ) : (
        <>
          {/* ---------------- por mês ---------------- */}
          <div className="g-card fd-chart-card">
            <div className="fd-card-head">
              <h3>{METRICA[metrica]} por mês</h3>
              <div className="fd-mini-seg" role="tablist" aria-label="O que mostrar no gráfico">
                {(Object.keys(METRICA) as Metrica[]).map((m) => (
                  <button key={m} role="tab" aria-selected={metrica === m} className={metrica === m ? 'is-on' : ''} onClick={() => setMetrica(m)}>
                    {METRICA[m]}
                  </button>
                ))}
              </div>
            </div>
            <Barras dados={r.porMes.map((m) => ({ mes: m.mes, v: m[metrica] }))} parcial={r.parcial?.mes} />
            <div className="fd-insights">
              {r.pico ? (
                <span>
                  Mês com mais entregas: <b>{mesLongo(r.pico.mes)}</b> ({num(r.pico.entregas)} entregas, {num(r.pico.pecas)} peças)
                </span>
              ) : null}
              {r.tendencia && r.anoAnterior ? (
                <span>
                  Últimos 3 meses {r.parcial ? 'completos ' : ''}× 3 anteriores: <b className={tendCls(r.tendencia.pct)}>{pctTxt(r.tendencia.pct)}</b> em peças
                </span>
              ) : null}
              {r.parcial ? (
                <span>
                  * {mesLongo(r.parcial.mes)} ainda em andamento: a planilha tem entregas até {dataBR(r.parcial.ate)}.
                </span>
              ) : null}
            </div>
          </div>

          <div className="g-grid">
            {/* ---------------- peças ---------------- */}
            <div className="g-card">
              <h3>O que mais saiu</h3>
              <div className="fd-grupos">
                {r.porGrupo.map((g) => (
                  <span key={g.grupo}>
                    <i style={{ background: COR[g.grupo] }} /> {g.grupo} <b>{num(g.qtd)}</b>
                  </span>
                ))}
              </div>
              <Lista
                itens={r.pecas.map((p) => ({
                  nome: p.peca,
                  valor: p.qtd,
                  cor: COR[p.grupo],
                  extra: `${num(p.entregas)} entregas`,
                }))}
                ativo={f.peca}
                onPick={(v) => set({ peca: f.peca === v ? '' : v })}
                n={12}
                unidade="peças"
              />
            </div>

            {/* ---------------- grade de tamanhos ---------------- */}
            <div className="g-card">
              <div className="fd-card-head">
                <h3>Grade de tamanhos</h3>
                <div className="select-wrap fd-sel-sm">
                  <select className="select" value={gradePeca} onChange={(e) => setPecaGrade(e.target.value)} aria-label="Peça da grade de tamanhos">
                    {r.pecas
                      .filter((p) => p.grupo !== 'Acessórios' || p.qtd >= 20)
                      .map((p) => (
                        <option key={p.peca} value={p.peca}>
                          {p.peca}
                        </option>
                      ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>
              <p className="help" style={{ marginTop: 0 }}>
                Quanto saiu de cada tamanho no período e a média por mês: base para a compra.
              </p>
              <table className="fd-grade">
                <thead>
                  <tr>
                    <th>Tamanho</th>
                    <th className="n">Qtd</th>
                    <th className="n">%</th>
                    <th className="n">Média/mês</th>
                  </tr>
                </thead>
                <tbody>
                  {tamanhos.map((t) => (
                    <tr key={t.tam}>
                      <td>
                        <b>{t.tam}</b>
                      </td>
                      <td className="n">{num(t.qtd)}</td>
                      <td className="n">
                        <span className="fd-pct">
                          <i
                            style={{
                              width: `${Math.min(100, t.pct * (100 / Math.max(...tamanhos.map((x) => x.pct), 1)))}%`,
                              background: COR[grupoDe(gradePeca)],
                            }}
                          />
                          <em>
                            {t.pct.toLocaleString('pt-BR', {
                              maximumFractionDigits: 1,
                            })}
                            %
                          </em>
                        </span>
                      </td>
                      <td className="n">
                        {t.porMes.toLocaleString('pt-BR', {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="g-card">
              <h3>Por empresa</h3>
              <Lista itens={fat(r.empresas)} ativo={f.empresa} onPick={(v) => set({ empresa: f.empresa === v ? '' : v })} n={6} unidade="peças" />
            </div>

            <div className="g-card">
              <h3>Postos que mais receberam</h3>
              <Lista itens={fat(r.postos)} ativo={f.posto} onPick={(v) => set({ posto: f.posto === v ? '' : v })} n={10} unidade="peças" />
            </div>

            <div className="g-card">
              <h3>Por função</h3>
              <Lista itens={fat(r.funcoes)} ativo={f.funcao} onPick={(v) => set({ funcao: f.funcao === v ? '' : v })} n={10} unidade="peças" />
            </div>

            <div className="g-card">
              <h3>Quem solicitou</h3>
              <Lista itens={fat(r.solicitantes)} ativo={f.solicitante} onPick={(v) => set({ solicitante: f.solicitante === v ? '' : v })} n={10} unidade="peças" />
            </div>
          </div>

          {r.recorrentes.length ? (
            <div className="g-card fd-rec">
              <h3>
                <Users size={15} style={{ verticalAlign: '-2px' }} /> Funcionários com 3 ou mais entregas no período ({num(r.recorrentes.length)})
              </h3>
              <p className="help" style={{ marginTop: 0 }}>
                Vale conferir: pode ser troca por desgaste, mudança de posto ou farda entregue a mais.
              </p>
              <Recorrentes lista={r.recorrentes} />
            </div>
          ) : null}

          <Entregas todas={todas} f={f} />
        </>
      )}
    </div>
  );
}

const fat = (xs: Fatia[]) =>
  xs.map((x) => ({
    nome: x.nome,
    valor: x.pecas,
    extra: `${num(x.entregas)} entregas · ${num(x.funcionarios)} func.`,
  }));
const tendCls = (p: number | null) => (p === null ? '' : p > 0 ? 'fd-up' : p < 0 ? 'fd-down' : '');

function Variacao({ pct, sub }: { pct: number | null; sub: string }) {
  const Icon = pct !== null && pct < 0 ? TrendingDown : TrendingUp;
  return (
    <>
      <b className={tendCls(pct)}>
        {pct !== null ? <Icon size={20} style={{ verticalAlign: '-3px', marginRight: 4 }} /> : null}
        {pctTxt(pct)}
      </b>
      <span className="fd-sub">{sub}</span>
    </>
  );
}

function Sel({ label, value, onChange, opts, todos }: { label: string; value: string; onChange: (v: string) => void; opts: { v: string; t: string }[]; todos?: string }) {
  return (
    <label className={`fd-sel${value && todos ? ' is-on' : ''}`}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {todos ? <option value="">{todos}</option> : null}
        {opts.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

/** posto: são centenas, então é um campo de busca com sugestões */
function Busca({ label, value, onChange, opts, todos }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; todos: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const id = `fd-${label}`;
  return (
    <label className={`fd-sel fd-busca${value ? ' is-on' : ''}`}>
      <span>{label}</span>
      <input
        list={id}
        value={txt}
        placeholder={todos}
        aria-label={label}
        onChange={(e) => {
          setTxt(e.target.value);
          if (opts.includes(e.target.value)) onChange(e.target.value);
          if (!e.target.value) onChange('');
        }}
        onBlur={() => !opts.includes(txt) && setTxt(value)}
      />
      <datalist id={id}>
        {opts.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {value ? (
        <button type="button" aria-label={`Limpar ${label}`} onClick={() => onChange('')}>
          <X size={12} />
        </button>
      ) : (
        <Search size={13} />
      )}
    </label>
  );
}

function Lista({ itens, ativo, onPick, n, unidade }: { itens: { nome: string; valor: number; extra?: string; cor?: string }[]; ativo: string; onPick: (v: string) => void; n: number; unidade: string }) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const vis = todos ? itens : itens.slice(0, n);
  return (
    <>
      {vis.map((i) => (
        <button key={i.nome} type="button" className={`g-row fd-row${ativo === i.nome ? ' is-on' : ''}`} onClick={() => onPick(i.nome)} title={ativo === i.nome ? 'Tirar o filtro' : 'Filtrar por este'}>
          <div>
            <span>{i.nome}</span>
            <b>
              {num(i.valor)} <small>{unidade}</small>
            </b>
          </div>
          <div className="g-bar">
            <i style={{ width: `${(i.valor / max) * 100}%`, background: i.cor }} />
          </div>
          {i.extra ? <small className="fd-extra">{i.extra}</small> : null}
        </button>
      ))}
      {itens.length > n ? (
        <button className="link-btn fd-mais" onClick={() => setTodos((t) => !t)}>
          {todos ? 'mostrar menos' : `ver todos (${num(itens.length)})`}
        </button>
      ) : null}
    </>
  );
}

/** gráfico de barras por mês (SVG na largura real do quadro), com o ano marcado e o valor no topo */
function Barras({ dados, parcial }: { dados: { mes: string; v: number }[]; parcial?: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 190 : 240;
  const pad = { t: 24, b: 30, l: 4, r: 4 };
  const max = Math.max(1, ...dados.map((d) => d.v));
  const bw = (W - pad.l - pad.r) / Math.max(1, dados.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const media = dados.reduce((t, d) => t + d.v, 0) / Math.max(1, dados.length);
  // rótulos: todos quando cabem; senão, um a cada tantos meses
  const passo = Math.max(1, Math.ceil(42 / bw));
  const valores = bw >= 34;
  return (
    <div className="fd-chart" ref={box} style={{ height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico por mês">
        <line x1={pad.l} x2={W - pad.r} y1={y(media)} y2={y(media)} className="fd-media" />
        <text x={W - pad.r} y={y(media) - 5} textAnchor="end" className="fd-media-t">
          média {Math.round(media).toLocaleString('pt-BR')}
        </text>
        {dados.map((d, i) => {
          const x = pad.l + i * bw;
          const novoAno = i > 0 && d.mes.endsWith('-01');
          const emAndamento = parcial === d.mes;
          return (
            <g key={d.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
              {novoAno ? <line x1={x} x2={x} y1={pad.t - 12} y2={H - pad.b + 4} className="fd-ano" /> : null}
              <rect x={x} y={pad.t - 14} width={bw} height={H - pad.t - pad.b + 14} fill="transparent" />
              <rect x={x + bw * 0.16} y={y(d.v)} width={bw * 0.68} height={Math.max(0, H - pad.b - y(d.v))} rx={Math.min(5, bw * 0.2)} className={`fd-bar${hover === i ? ' is-hover' : ''}${emAndamento ? ' is-parcial' : ''}`}>
                <title>{`${mesLongo(d.mes)}: ${d.v.toLocaleString('pt-BR')}${emAndamento ? ' (mês em andamento)' : ''}`}</title>
              </rect>
              {valores || hover === i ? (
                <text x={x + bw / 2} y={y(d.v) - 6} textAnchor="middle" className="fd-val">
                  {d.v.toLocaleString('pt-BR')}
                </text>
              ) : null}
              {i % passo === 0 || hover === i ? (
                <text x={Math.min(Math.max(x + bw / 2, 20), W - 20)} y={H - pad.b + 17} textAnchor="middle" className={`fd-mes${emAndamento ? ' is-parcial' : ''}`}>
                  {mesCurto(d.mes)}
                  {emAndamento ? '*' : ''}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Recorrentes({
  lista,
}: {
  lista: {
    nome: string;
    funcao: string;
    posto: string;
    entregas: number;
    pecas: number;
    datas: string[];
  }[];
}) {
  const [todos, setTodos] = useState(false);
  const vis = todos ? lista : lista.slice(0, 8);
  return (
    <>
      <div className="t-wrap">
        <table className="t-table">
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Posto</th>
              <th className="n">Entregas</th>
              <th className="n">Peças</th>
              <th>Datas</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((r) => (
              <tr key={r.nome}>
                <td>
                  <b>{r.nome}</b>
                  <small style={{ display: 'block' }}>{r.funcao}</small>
                </td>
                <td>
                  <small>{r.posto}</small>
                </td>
                <td className="n">
                  <b>{r.entregas}</b>
                </td>
                <td className="n">{num(r.pecas)}</td>
                <td>
                  <small>{r.datas.map((d) => (d.length > 7 ? dataBR(d).slice(0, 5) + '/' + d.slice(2, 4) : mesCurto(d))).join(' · ')}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > 8 ? (
        <button className="link-btn fd-mais" onClick={() => setTodos((t) => !t)}>
          {todos ? 'mostrar menos' : `ver todos (${num(lista.length)})`}
        </button>
      ) : null}
    </>
  );
}

/** lista de entregas do período (com busca por funcionário, posto ou peça) */
function Entregas({ todas, f }: { todas: Entrega[]; f: FiltrosFarda }) {
  const [q, setQ] = useState('');
  const [n, setN] = useState(30);
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return filtrar(todas, f)
      .filter((e) => !t || `${e.f} ${e.p} ${e.fn} ${e.i.map((i) => i[0]).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t))
      .sort((a, b) => (b.d ?? b.m).localeCompare(a.d ?? a.m));
  }, [todas, f, q]);
  return (
    <div className="g-card fd-lista">
      <div className="fd-card-head">
        <h3>
          <Shirt size={15} style={{ verticalAlign: '-2px' }} /> Entregas ({num(lista.length)})
        </h3>
        <div className="search fd-search">
          <Search size={15} />
          <input className="input" placeholder="Buscar funcionário, posto ou peça" value={q} onChange={(e) => (setQ(e.target.value), setN(30))} aria-label="Buscar entregas" />
        </div>
      </div>
      <div className="t-wrap">
        <table className="t-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Funcionário</th>
              <th>Posto</th>
              <th>Peças</th>
            </tr>
          </thead>
          <tbody>
            {lista.slice(0, n).map((e, i) => (
              <tr key={i}>
                <td>
                  <b>{e.d ? dataBR(e.d) : mesCurto(e.m)}</b>
                  <small style={{ display: 'block' }}>{e.e}</small>
                </td>
                <td>
                  <b>{e.f}</b>
                  <small style={{ display: 'block' }}>
                    {e.fn} · pedido por {e.q}
                  </small>
                </td>
                <td>
                  <small>{e.p}</small>
                </td>
                <td>
                  <span className="fd-itens">
                    {e.i.map((it, k) => (
                      <span key={k} style={{ borderColor: COR[grupoDe(it[0])] }}>
                        {it[2] > 1 ? `${it[2]}× ` : ''}
                        {it[0]}
                        {it[1] ? <em> {it[1]}</em> : null}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lista.length > n ? (
        <button className="link-btn fd-mais" onClick={() => setN((x) => x + 50)}>
          mostrar mais ({num(lista.length - n)} restantes)
        </button>
      ) : null}
    </div>
  );
}
