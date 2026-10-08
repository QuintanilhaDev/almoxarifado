'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet, ImageDown, Inbox as InboxIcon, Layers, Scale } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PERIOD_LIST, exportBaseName, type MetricsData, type Period } from '@/lib/almoxarifado/metrics';
import { COLORS, chartGeometry, chartSvg, fmt, fmtSigned, reportSvg } from '@/lib/almoxarifado/metricsChart';
import { useToast } from '../core/Toasts';
import { api } from '../core/api';
import { useMaxBus } from '@/lib/max/bus';
import './estoque.css';
import './metricas.css';

const STORAGE_KEY = 'almox:metricas:periodo';
const AUTO_REFRESH_MS = 60_000;

function readSavedPeriod(): Period {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (PERIOD_LIST.some((p) => p.id === v)) return v as Period;
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return 'ultima-semana';
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** SVG do relatório → PNG (2x, fundo opaco). PNG abre em qualquer lugar, inclusive no Power BI. */
async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Não foi possível desenhar o gráfico.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Seu navegador não conseguiu gerar a imagem.');
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** número que "rola" até o novo valor */
function Count({ value, signed }: { value: number; signed?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (value - start) * e);
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return <>{signed ? fmtSigned(shown) : fmt(shown)}</>;
}

export function Metricas({ version }: { version: number }) {
  const toast = useToast();
  const [period, setPeriodState] = useState<Period>(readSavedPeriod);
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState<'png' | 'xlsx' | null>(null);
  const seq = useRef(0);
  const periodRef = useRef<Period>(period);
  periodRef.current = period;

  const load = useCallback(async (p: Period, silent: boolean) => {
    const my = ++seq.current;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const j = await api<{ data: MetricsData }>(`/api/almoxarifado/metrics?period=${p}`);
      if (my !== seq.current) return; // chegou uma resposta mais nova
      setData(j.data);
      setError('');
      setAnimate(!silent);
    } catch (e) {
      if (my !== seq.current) return;
      if (!silent) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  // troca de período (e primeira carga)
  useEffect(() => {
    load(period, false);
  }, [period, load]);

  // atualização silenciosa: a cada minuto e quando o estoque/solicitações mudam
  useEffect(() => {
    const t = setInterval(() => load(periodRef.current, true), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    const t = setTimeout(() => load(periodRef.current, true), 500);
    return () => clearTimeout(t);
  }, [version, load]);

  const setPeriod = (p: Period) => {
    if (p === period) return;
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
    setPeriodState(p);
  };
  // pedido da Max: "métricas do último mês"
  useMaxBus('almox:metricas', (p) => setPeriod(p.period));

  // "o que está na tela" = data. Os botões só valem quando a tela e o período escolhido coincidem.
  const ready = Boolean(data) && !loading && data!.period === period;

  const downloadPng = async () => {
    if (!data || !ready || busy) return;
    setBusy('png');
    try {
      const { svg, width, height } = reportSvg(data);
      saveBlob(await svgToPng(svg, width, height), `${exportBaseName(data)}.png`);
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível baixar o gráfico', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const downloadXlsx = async () => {
    if (!data || !ready || busy) return;
    setBusy('xlsx');
    try {
      const res = await fetch(`/api/almoxarifado/metrics/export?period=${data.period}&at=${encodeURIComponent(data.generatedAt)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        let msg = 'Tente de novo em instantes.';
        try {
          msg = ((await res.json()) as { error?: string }).error || msg;
        } catch {
          /* resposta sem JSON */
        }
        throw new Error(msg);
      }
      saveBlob(await res.blob(), `${exportBaseName(data)}.xlsx`);
    } catch (e) {
      toast({ kind: 'error', title: 'Não foi possível baixar a planilha', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const t = data?.totals;
  const topItems = useMemo(() => (data?.items ?? []).filter((i) => i.out > 0).slice(0, 6), [data]);
  const topPostos = useMemo(() => (data?.postos ?? []).filter((p) => p.received > 0).slice(0, 6), [data]);
  const maxItem = Math.max(1, ...topItems.map((i) => i.out));
  const maxPosto = Math.max(1, ...topPostos.map((p) => p.received));

  return (
    <div className="section-scroll">
      <div className="section-pad mt-wrap">
        <div className="section-head">
          <div>
            <h1>Métricas</h1>
            <p>Entradas e saídas do almoxarifado. Escolha o período e o gráfico se atualiza na hora.</p>
          </div>
          <div className="mt-actions">
            <button className="btn btn-ghost btn-sm" onClick={downloadPng} disabled={!ready || busy !== null} data-testid="dl-png">
              {busy === 'png' ? <span className="spinner" /> : <ImageDown size={16} />} Baixar gráfico
            </button>
            <button className="btn btn-primary btn-sm" onClick={downloadXlsx} disabled={!ready || busy !== null} data-testid="dl-xlsx">
              {busy === 'xlsx' ? <span className="spinner" /> : <FileSpreadsheet size={16} />} Baixar planilha
            </button>
          </div>
        </div>

        <div className="mt-seg" role="tablist" aria-label="Período">
          {PERIOD_LIST.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={period === p.id}
              className={`mt-seg-btn${period === p.id ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.id)}
              data-period={p.id}
            >
              {period === p.id ? <motion.span layoutId="mt-seg-bg" className="mt-seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} /> : null}
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {error && !data ? (
          <div className="mt-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <b>Não foi possível carregar as métricas.</b>
              <span>{error}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => load(period, false)}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        {error && data ? (
          <div className="mt-error" role="alert">
            <AlertCircle size={18} />
            <div>
              <b>Não foi possível carregar este período.</b>
              <span>{error}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => load(period, false)}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        <div className={`mt-body${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          <div className="mt-kpis">
            <Kpi icon={<ArrowDownToLine size={18} />} tone="in" label="Entradas" value={t ? <Count value={t.in} /> : '—'} sub="unidades" />
            <Kpi icon={<ArrowUpFromLine size={18} />} tone="out" label="Saídas" value={t ? <Count value={t.out} /> : '—'} sub="unidades" />
            <Kpi icon={<Scale size={18} />} tone={t && t.net < 0 ? 'neg' : 'plain'} label="Saldo líquido" value={t ? <Count value={t.net} signed /> : '—'} sub="entradas − saídas" />
            <Kpi icon={<Layers size={18} />} tone="plain" label="Movimentações" value={t ? <Count value={t.moves} /> : '—'} sub="registros" />
            <Kpi icon={<InboxIcon size={18} />} tone="amber" label="Solicitações" value={t ? <Count value={t.requests} /> : '—'} sub={t ? `${fmt(t.requestsOpen)} aberta${t.requestsOpen === 1 ? '' : 's'}` : 'recebidas'} />
          </div>

          <section className="mt-card" aria-label="Gráfico de entradas e saídas">
            <div className="mt-card-head">
              <div>
                <h2>{data?.periodLabel ?? '—'}</h2>
                <p>{data?.rangeLabel ?? ' '}</p>
              </div>
              <div className="mt-legend" aria-hidden>
                <span>
                  <i style={{ background: COLORS.in }} /> Entradas
                </span>
                <span>
                  <i style={{ background: COLORS.out }} /> Saídas
                </span>
              </div>
            </div>
            <Chart data={data} animate={animate} />
          </section>

          <div className="mt-lists">
            <RankList
              title="Itens que mais saíram"
              empty="Nenhuma saída de item neste período."
              rows={topItems.map((i) => ({ key: i.key, name: i.name, value: i.out, extra: i.in ? `+${fmt(i.in)} entradas` : '' }))}
              max={maxItem}
              tone="out"
            />
            <RankList
              title="Postos que mais receberam"
              empty="Nenhuma transferência para postos neste período."
              rows={topPostos.map((p) => ({ key: p.name, name: p.name, value: p.received, extra: p.returned ? `${fmt(p.returned)} devolvidas` : '' }))}
              max={maxPosto}
              tone="in"
            />
          </div>

          <p className="mt-foot">
            <b>Entradas</b> = entrada + devolução de posto. <b>Saídas</b> = saída + transferência a posto. Ajustes, consumo nos postos e criação/exclusão de item ficam só na planilha. Horário da Bahia.
            {data?.truncated ? <span className="mt-warn"> Havia mais registros do que o limite de leitura: os números podem estar incompletos.</span> : null}
          </p>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: 'in' | 'out' | 'neg' | 'amber' | 'plain'; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className={`mt-kpi tone-${tone}`}>
      <span className="mt-kpi-ico" aria-hidden>
        {icon}
      </span>
      <small>{label}</small>
      <b data-testid={`kpi-${label.toLowerCase().replace(/[^a-z]/g, '')}`}>{value}</b>
      <em>{sub}</em>
    </div>
  );
}

function RankList({ title, rows, max, tone, empty }: { title: string; rows: { key: string; name: string; value: number; extra: string }[]; max: number; tone: 'in' | 'out'; empty: string }) {
  return (
    <section className="mt-card mt-rank">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-empty">{empty}</p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.key}>
              <div className="mt-rank-top">
                <span title={r.name}>{r.name}</span>
                <b>{fmt(r.value)}</b>
              </div>
              <div className="mt-bar">
                <motion.i
                  className={tone}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              {r.extra ? <small>{r.extra}</small> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** O gráfico em si: SVG na largura real do cartão + dica ao passar o mouse/dedo. */
function Chart({ data, animate }: { data: MetricsData | null; animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const h = w < 520 ? 250 : w < 900 ? 310 : 360;
  const html = useMemo(() => (data && w > 80 ? chartSvg(data, w, h, { animate, id: 'mc', fontSize: w < 520 ? 11 : 12 }) : ''), [data, w, h, animate]);
  const g = useMemo(() => (data && w > 80 ? chartGeometry(data, w, h) : null), [data, w, h]);

  useEffect(() => setHover(null), [data?.period, data?.generatedAt]);

  const pick = (clientX: number) => {
    if (!g || !data || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const slot = g.innerW / g.n;
    const i = Math.floor((clientX - rect.left - g.padL) / slot);
    if (i < 0 || i >= g.n || data.buckets[i].future) return setHover(null);
    setHover(i);
  };

  const b = hover !== null && data ? data.buckets[hover] : null;
  const flip = g && hover !== null ? g.x(hover) > w * 0.62 : false;

  return (
    <div
      className="mt-chart"
      ref={ref}
      style={{ height: h }}
      tabIndex={0}
      role="group"
      aria-label={data ? `Gráfico: ${fmt(data.totals.in)} unidades entraram e ${fmt(data.totals.out)} saíram. Use as setas para ver cada ${data.granularity === 'hour' ? 'hora' : 'dia'}.` : 'Gráfico'}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (!data) return;
        const live = data.buckets.filter((x) => !x.future).length;
        if (e.key === 'ArrowRight') setHover((v) => Math.min(live - 1, (v ?? -1) + 1));
        else if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? live) - 1));
        else if (e.key === 'Escape') setHover(null);
        else return;
        e.preventDefault();
      }}
      data-testid="chart"
      data-at={data?.generatedAt}
    >
      <div className="mt-svg" key={data?.period} dangerouslySetInnerHTML={{ __html: html }} />
      <AnimatePresence>
        {g && b && hover !== null ? (
          <motion.div key="hv" className="mt-hover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <i className="mt-guide" style={{ left: g.x(hover), top: g.padT, height: g.innerH }} />
            <i className="mt-dot in" style={{ left: g.x(hover), top: g.y(b.in) }} />
            <i className="mt-dot out" style={{ left: g.x(hover), top: g.y(b.out) }} />
            <div className="mt-tip" style={flip ? { right: w - g.x(hover) + 14 } : { left: g.x(hover) + 14 }} data-testid="tip">
              <strong>{b.title}</strong>
              <span>
                <i style={{ background: COLORS.in }} /> Entradas <b>{fmt(b.in)}</b>
              </span>
              <span>
                <i style={{ background: COLORS.out }} /> Saídas <b>{fmt(b.out)}</b>
              </span>
              <small>
                {fmt(b.moves)} movimentaç{b.moves === 1 ? 'ão' : 'ões'} · {fmt(b.requests)} solicitaç{b.requests === 1 ? 'ão' : 'ões'}
              </small>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {!data ? <div className="mt-skel" aria-hidden /> : null}
    </div>
  );
}
