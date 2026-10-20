'use client';
import { AlertCircle, AlertTriangle, CalendarRange, ChevronDown, Clock3, FileArchive, FileDown, FileSpreadsheet, FileUp, FolderOpen, RotateCcw, ScanLine, Search, Settings2, Sparkles, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../core/Toasts';
import { DEFAULT_HORAS, hm, type ApuracaoHoras, type FuncHoras, type HorasConfig } from '@/lib/horas/calculo';
import '../almoxarifado/estoque.css';
import '../pedidos/pedidos.css';
import '../compras/compras.css';
import '../pontos/pontos.css';
import './horas.css';

const CFG_KEY = 'maxhub-horas-config';
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const br = (d: string) => d.split('-').reverse().join('/');
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (s: string, d: number) => {
  const m = s.match(/^(\d{1,3}):?(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : d;
};
const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i;
const ACEITO = /\.(pdf|xlsx|xls|xlsm|csv|txt|tsv|htm|html|png|jpe?g|webp|gif|bmp)$/i;
const MAX_ARQ = 60;
const oculto = (f: File) => f.name.startsWith('.') || f.name.startsWith('~$') || /^(thumbs\.db|desktop\.ini)$/i.test(f.name);
const aceito = (f: File) => !oculto(f) && f.size > 0 && (ACEITO.test(f.name) || (f.type || '').startsWith('image/'));

/** o que saiu de cada arquivo: leitura direta (lido) ou transcrição da IA (docs) */
interface Parte {
  nome: string;
  lido?: unknown;
  docs?: unknown[];
  leitura: string;
}
/** a leitura sem IA (OCR/leitor simples) só vale se achou dias de verdade; manuscrito costuma virar lixo */
const leituraBoa = (lido: unknown) => {
  const fs = ((lido as { funcionarios?: { name?: string; days?: { punches?: string[] }[] }[] })?.funcionarios ?? []).filter((f) => /[A-Za-zÀ-ÿ]{3,}\s+[A-Za-zÀ-ÿ]{2,}/.test(f.name ?? ''));
  const dias = fs.reduce((t, f) => t + (f.days ?? []).filter((d) => (d.punches?.length ?? 0) >= 2).length, 0);
  return fs.length > 0 && dias >= 3;
};
const motivoDe = (e: Error) => e.message.replace(/^Não consegui ler esta parte: |\.$/g, '');
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesTxt = (ym: string) => `${MES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const ultimosMeses = () => {
  const h = new Date();
  return Array.from({ length: 24 }, (_, k) => {
    const d = new Date(h.getFullYear(), h.getMonth() - k, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};
const comAviso = (lido: unknown, aviso: string) => {
  const l = lido as { avisos?: unknown[] };
  return { ...l, avisos: [aviso, ...(Array.isArray(l.avisos) ? l.avisos : [])] };
};
const temPonto = (docs: unknown[]) =>
  docs.some((d) => ((d as { funcionarios?: { dias?: { batidas?: unknown[] }[] }[] }).funcionarios ?? []).some((f) => (f.dias ?? []).some((x) => Array.isArray(x.batidas) && x.batidas.length)));
const arquivosTxt = (ps: Parte[]) => (ps.length === 1 ? ps[0].nome : `${ps.length} arquivos`);
const leituraTxt = (ps: Parte[]) => {
  if (ps.length === 1) return ps[0].leitura;
  const ia = ps.filter((p) => /IA$/.test(p.leitura)).length;
  const ocr = ps.filter((p) => /OCR/.test(p.leitura)).length;
  const direto = ps.length - ia - ocr;
  return [direto ? `${direto} lido(s) direto` : null, ia ? `${ia} com IA` : null, ocr ? `${ocr} por OCR` : null].filter(Boolean).join(' · ');
};
/** pasta arrastada para a área: todos os arquivos dela e das subpastas */
async function arquivosDe(e: FileSystemEntry): Promise<File[]> {
  if (e.isFile) return new Promise((ok) => (e as FileSystemFileEntry).file((f) => ok([f]), () => ok([])));
  const reader = (e as FileSystemDirectoryEntry).createReader();
  const todos: FileSystemEntry[] = [];
  for (;;) {
    const lote = await new Promise<FileSystemEntry[]>((ok) => reader.readEntries(ok, () => ok([])));
    if (!lote.length) break;
    todos.push(...lote);
  }
  return (await Promise.all(todos.map(arquivosDe))).flat();
}

class Falha extends Error {
  constructor(
    msg: string,
    public status = 0,
    public espera = 0,
  ) {
    super(msg);
  }
}
async function post<T>(url: string, body: BodyInit, json = false): Promise<T> {
  const r = await fetch(url, { method: 'POST', body, headers: json ? { 'Content-Type': 'application/json' } : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Falha(j.error ?? 'Não consegui ler o arquivo.', r.status, Number(j.espera) || 0);
  return j as T;
}

/** imagem (arquivo ou canvas) → JPEG de até 1800 px, leve para mandar à IA */
async function paraJpeg(src: CanvasImageSource & { width: number; height: number }, max = 1800) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
async function imagemDoArquivo(f: File) {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise((ok, err) => {
      img.onload = ok;
      img.onerror = () => err(new Error('Não consegui abrir esta imagem. Envie em JPG ou PNG.'));
      img.src = url;
    });
    return await paraJpeg(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** PDF escaneado: cada página vira imagem (no próprio navegador) */
async function paginasDoPdf(f: File) {
  const pdfjs = await import('pdfjs-dist');
  // o "worker" roda na própria página (o pdf.js usa o globalThis.pdfjsWorker se existir): sem arquivo extra para servir
  const g = globalThis as { pdfjsWorker?: unknown };
  // @ts-expect-error módulo sem tipos
  g.pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.min.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2.5, 1800 / Math.max(vp0.width, vp0.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    out.push(await paraJpeg(c));
  }
  return out;
}
/** sem IA no servidor: OCR no navegador (texto impresso; manuscrito precisa da IA) */
async function ocr(paginas: string[], onPage: (i: number) => void) {
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('por');
  const out: string[] = [];
  try {
    for (const [i, p] of paginas.entries()) {
      onPage(i);
      const r = await w.recognize(p);
      out.push(r.data.text);
    }
  } finally {
    await w.terminate();
  }
  return out.join('\n');
}

async function baixarArquivo(url: string, body: unknown, fallback: string) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Não consegui gerar o arquivo.');
  const cd = r.headers.get('Content-Disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const name = star ? decodeURIComponent(star) : cd.match(/filename="([^"]+)"/)?.[1] ?? fallback;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return name;
}

/**
 * Apurador de horas extras (RH): joga qualquer arquivo (PDF, planilha, foto, escaneado ou
 * folha escrita à mão), a ferramenta lê, calcula pela regra de 44h semanais / 9h diárias e
 * mostra as horas extras de cada funcionário por mês. O relatório sai em .zip (PDF + planilha).
 */
export function HorasExtras() {
  const toast = useToast();
  const [cfg, setCfg] = useState<HorasConfig>(DEFAULT_HORAS);
  useEffect(() => {
    try {
      const c = localStorage.getItem(CFG_KEY);
      if (c) setCfg({ ...DEFAULT_HORAS, ...JSON.parse(c) });
    } catch {
      /* padrão */
    }
  }, []);
  const saveCfg = (c: HorasConfig) => {
    setCfg(c);
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
  };
  const [res, setRes] = useState<ApuracaoHoras | null>(null);
  /** o que foi lido de cada arquivo: mudar a regra recalcula sem ler de novo */
  const [partes, setPartes] = useState<Parte[] | null>(null);
  /** folhas sem o mês escrito (papel com dias 1 a 31): mês deduzido e, se a pessoa quiser, escolhido */
  const [mesesFolha, setMesesFolha] = useState<{ mes: string; certeza: string }[]>([]);
  const [mesFolha, setMesFolha] = useState('');
  const [falhas, setFalhas] = useState<{ nome: string; erro: string }[]>([]);
  const [etapa, setEtapa] = useState('');
  const [prog, setProg] = useState<{ i: number; n: number; nome: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'ler' | 'zip' | 'pdf' | 'xlsx'>('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [mes, setMes] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  /** a IA falhou neste envio: os próximos arquivos vão direto para a leitura de reserva */
  const semIa = useRef<Falha | null>(null);
  const pastaRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // escolher uma pasta inteira (o atributo não existe no tipo do React)
    pastaRef.current?.setAttribute('webkitdirectory', '');
    pastaRef.current?.setAttribute('directory', '');
  }, [res]);

  /** chama a IA; se a cota gratuita por minuto encher, espera o tempo que ela pedir e tenta de novo */
  const comIa = async (body: object, rotulo: string) => {
    for (let t = 0; ; t++) {
      try {
        setEtapa(rotulo);
        return await post<{ docs: unknown[] }>('/api/rh/horas-extras/ler', JSON.stringify(body), true);
      } catch (e) {
        if (!(e instanceof Falha) || e.status !== 429 || t >= 12) throw e;
        for (let s = Math.min(90, Math.max(3, e.espera || 20)); s > 0; s--) {
          setEtapa(`A IA gratuita pede uma pausa (limite por minuto). Continuo em ${s}s…`);
          await new Promise((ok) => setTimeout(ok, 1000));
        }
      }
    }
  };

  /** páginas como imagem → IA de visão (uma por vez); sem IA, OCR no navegador */
  const porImagem = async (f: File, paginas: string[]): Promise<Parte> => {
    const lista: unknown[] = [];
    try {
      if (semIa.current) throw semIa.current;
      for (const [i, p] of paginas.entries()) {
        const j = await comIa({ imagem: p }, `Lendo ${paginas.length > 1 ? `a página ${i + 1} de ${paginas.length}` : 'a imagem'} com a IA…`);
        lista.push(...j.docs);
      }
      return { nome: f.name, docs: lista, leitura: 'Imagem lida com IA' };
    } catch (e) {
      if (!(e instanceof Falha) || e.status < 500) throw e;
      // IA desligada ou fora do ar: não insiste nos próximos arquivos e tenta reconhecer o texto aqui mesmo
      if (e.status === 503 || /chave|cota diária/.test(e.message)) semIa.current = e;
      const motivo = motivoDe(e);
      const texto = await ocr(paginas, (i) => setEtapa(`Reconhecendo o texto da página ${i + 1} de ${paginas.length}…`));
      const fd = new FormData();
      fd.append('file', new File([texto], f.name.replace(/\.[^.]+$/, '') + '.txt', { type: 'text/plain' }));
      fd.append('config', JSON.stringify(cfg));
      const j = await post<{ lido?: unknown; heuristico?: unknown }>('/api/rh/horas-extras/analisar', fd);
      const lido = j.lido ?? j.heuristico;
      if (!lido || !leituraBoa(lido)) throw new Error(`a IA não respondeu (${motivo}). Sem ela, folhas escritas à mão ou fotos não podem ser lidas com segurança; tente de novo quando a IA voltar`);
      return { nome: f.name, lido: comAviso(lido, `A IA não respondeu (${motivo}); a imagem foi lida por OCR. Confira os horários com o original.`), leitura: 'Imagem lida por OCR' };
    }
  };

  /** lê um arquivo: direto quando dá; IA para texto solto, foto, escaneado e manuscrito */
  const lerUm = async (f: File): Promise<Parte> => {
    if ((f.type || '').startsWith('image/') || IMG.test(f.name)) return porImagem(f, [await imagemDoArquivo(f)]);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('config', JSON.stringify(cfg));
    const j = await post<{ lido?: unknown; leitura?: string; precisaIa?: 'imagem' | 'texto'; partes?: string[]; heuristico?: unknown }>('/api/rh/horas-extras/analisar', fd);
    if (j.lido) return { nome: f.name, lido: j.lido, leitura: j.leitura ?? 'direto' };
    if (j.precisaIa === 'texto') {
      const lista: unknown[] = [];
      try {
        if (semIa.current) throw semIa.current;
        for (const [i, t] of (j.partes ?? []).entries()) {
          lista.push(...(await comIa({ texto: t }, `Entendendo o documento com a IA (${i + 1} de ${j.partes!.length})…`)).docs);
        }
        return { nome: f.name, docs: lista, leitura: 'Texto lido com IA' };
      } catch (e) {
        if (!(e instanceof Falha) || e.status < 500) throw e;
        if (e.status === 503 || /chave|cota diária/.test(e.message)) semIa.current = e;
        const motivo = motivoDe(e);
        // reserva: leitor simples de texto do servidor
        if (!j.heuristico || !leituraBoa(j.heuristico)) throw new Error(`a IA não respondeu (${motivo}) e o formato deste arquivo não é reconhecido sem ela`);
        return { nome: f.name, lido: comAviso(j.heuristico, `A IA não respondeu (${motivo}); este arquivo foi lido pelo leitor simples. Confira os horários com o original.`), leitura: 'Texto lido sem IA (conferir)' };
      }
    }
    setEtapa('Preparando as páginas…');
    const paginas = /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? await paginasDoPdf(f) : [await imagemDoArquivo(f)];
    return porImagem(f, paginas);
  };

  const calcular = async (ps: Parte[], c = cfg, mf = mesFolha) => {
    const j = await post<{ apuracao: ApuracaoHoras; mesesFolha?: { mes: string; certeza: string }[] }>(
      '/api/rh/horas-extras/analisar',
      JSON.stringify({ partes: ps.map(({ nome, lido, docs }) => ({ nome, lido, docs })), nome: arquivosTxt(ps), leitura: leituraTxt(ps), config: c, mesFolha: mf || undefined }),
      true,
    );
    setMesesFolha(j.mesesFolha ?? []);
    return j.apuracao;
  };

  const ler = async (entrada: File[]) => {
    const validos = entrada.filter(aceito);
    const files = validos.slice(0, MAX_ARQ);
    // arquivos de sistema (.DS_Store, Thumbs.db) nem entram na conta
    const outros = entrada.filter((f) => !oculto(f) && !aceito(f));
    if (!files.length) {
      setError(entrada.length ? 'Nenhum arquivo de ponto nessa seleção (aceito PDF, Excel, CSV, texto e imagens).' : 'Escolha o arquivo.');
      return;
    }
    setBusy('ler');
    setError('');
    semIa.current = null;
    setMesFolha('');
    const ok: Parte[] = [];
    const erros: { nome: string; erro: string }[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setProg(files.length > 1 ? { i, n: files.length, nome: f.name } : null);
        setEtapa('Lendo o arquivo…');
        try {
          const parte = await lerUm(f);
          // a IA não achou ninguém com dias e horários neste arquivo
          if (parte.docs && !temPonto(parte.docs)) throw new Error('não encontrei funcionários com dias e horários');
          ok.push(parte);
        } catch (e) {
          // com um arquivo só, o erro é a resposta; numa pasta, segue com os outros
          if (files.length === 1) throw e;
          erros.push({ nome: f.name, erro: (e as Error).message });
        }
      }
      if (!ok.length) throw new Error(`Não consegui ler nenhum dos ${files.length} arquivos. ${erros[0] ? `Ex.: ${erros[0].nome}: ${erros[0].erro}` : ''}`);
      setProg(null);
      setEtapa(files.length > 1 ? `Juntando os ${ok.length} arquivos e calculando…` : 'Calculando…');
      const a = await calcular(ok, cfg, '');
      if (validos.length > MAX_ARQ) erros.push({ nome: `${validos.length - MAX_ARQ} arquivo(s)`, erro: `acima do máximo de ${MAX_ARQ} por vez` });
      for (const f of outros.slice(0, 8)) erros.push({ nome: f.name, erro: 'formato que não é de ponto' });
      if (outros.length > 8) erros.push({ nome: `mais ${outros.length - 8} arquivo(s)`, erro: 'formato que não é de ponto' });
      setRes(a);
      setPartes(ok);
      setFalhas(erros);
      setOpen(null);
      setMes('');
      toast({ kind: 'success', title: 'Horas extras apuradas', text: `${ok.length > 1 ? `${ok.length} arquivos · ` : ''}${a.total.funcionarios} funcionário(s) · ${hm(a.total.extras)} de horas extras.` }, 8000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setEtapa('');
      setProg(null);
      if (inputRef.current) inputRef.current.value = '';
      if (pastaRef.current) pastaRef.current.value = '';
    }
  };
  const soltar = async (dt: DataTransfer) => {
    // pasta arrastada: percorre as subpastas também
    const entries = [...dt.items].map((it) => it.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => Boolean(x));
    const files = entries.some((x) => x.isDirectory) ? (await Promise.all(entries.map(arquivosDe))).flat() : [...dt.files];
    void ler(files);
  };
  /** mudou a regra: recalcula (sem ler de novo com a IA) */
  const recalcular = async (mf = mesFolha) => {
    if (!partes) return;
    setBusy('ler');
    try {
      setRes(await calcular(partes, cfg, mf));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const baixar = async (format: 'zip' | 'pdf' | 'xlsx') => {
    if (!res) return;
    setBusy(format);
    try {
      const name = await baixarArquivo(`/api/rh/horas-extras/relatorio?format=${format}`, { apuracao: res }, 'horas-extras');
      toast({ kind: 'success', title: 'Arquivo baixado', text: name });
    } catch (e) {
      toast({ kind: 'error', title: 'Não consegui gerar', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const lista = useMemo(() => {
    if (!res) return [];
    const t = q
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return res.funcionarios.filter((f) => !t || `${f.name} ${f.matricula ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t));
  }, [res, q]);
  const extrasDe = (f: FuncHoras) => (mes ? f.meses.find((m) => m.chave === mes)?.extras ?? 0 : f.total.extras);

  return (
    <div className="section-scroll">
      <div className="section-pad wide pt-wrap">
        <div className="section-head">
          <div>
            <h1>Horas extras</h1>
            <p>Jogue as folhas ou os espelhos de ponto (PDF, planilha, foto ou escrito à mão; um arquivo ou uma pasta inteira): as horas extras de cada funcionário saem por mês, pela regra de {hm(cfg.semanal)} semanais e {hm(cfg.diaria)} por dia.</p>
          </div>
          {res ? (
            <div className="head-actions pt-actions">
              <button className="btn btn-ghost" onClick={() => baixar('xlsx')} disabled={Boolean(busy)} data-max="horas-planilha">
                {busy === 'xlsx' ? <span className="spinner" /> : <FileSpreadsheet size={17} />} Planilha
              </button>
              <button className="btn btn-ghost" onClick={() => baixar('pdf')} disabled={Boolean(busy)} data-max="horas-pdf">
                {busy === 'pdf' ? <span className="spinner" /> : <FileDown size={17} />} PDF
              </button>
              <button className="btn btn-primary" onClick={() => baixar('zip')} disabled={Boolean(busy)} data-max="horas-zip">
                {busy === 'zip' ? <span className="spinner" /> : <FileArchive size={17} />} Baixar relatório (.zip)
              </button>
            </div>
          ) : null}
        </div>

        {!res ? (
          <>
            <div
              className={`pt-drop${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Enviar o arquivo de ponto"
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
                if (!busy) void soltar(e.dataTransfer);
              }}
              data-max="horas-anexar"
            >
              <span className="pt-drop-icon">{busy ? <span className="spinner" /> : <FileUp size={28} />}</span>
              <strong>{busy ? (prog ? `Arquivo ${prog.i + 1} de ${prog.n}: ${prog.nome}` : etapa || 'Lendo…') : 'Jogue aqui os arquivos ou uma pasta inteira'}</strong>
              <span>{busy ? (prog ? etapa : 'Pode levar alguns segundos por página quando a leitura é com IA.') : 'PDF, Excel, CSV, foto do celular, documento escaneado ou folha preenchida à mão. Um ou vários de uma vez: tudo vira um relatório só.'}</span>
              {prog ? (
                <span className="hx-prog" aria-hidden>
                  <i style={{ width: `${Math.round((prog.i / prog.n) * 100)}%` }} />
                </span>
              ) : null}
              <input ref={inputRef} type="file" hidden multiple accept=".pdf,.xlsx,.xls,.xlsm,.csv,.tsv,.txt,.htm,.html,image/*" aria-label="Arquivo de ponto para horas extras" onChange={(e) => e.target.files?.length && ler([...e.target.files])} />
            </div>
            <div className="hx-pick">
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()} data-max="horas-arquivos">
                <FileUp size={16} /> Escolher arquivos
              </button>
              <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => pastaRef.current?.click()} data-max="horas-pasta">
                <FolderOpen size={16} /> Anexar uma pasta
              </button>
              <input ref={pastaRef} type="file" hidden multiple aria-label="Pasta com arquivos de ponto" onChange={(e) => e.target.files?.length && ler([...e.target.files])} />
            </div>
            {error ? (
              <div className="sx-error" role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <div className="pt-steps">
              {[
                [ScanLine, 'Lê qualquer arquivo', 'PDF e planilhas são lidos direto. Foto, escaneado e folha escrita à mão são lidos pela IA da Max, página por página.'],
                [Clock3, 'Calcula pela regra', `Acima de ${hm(cfg.diaria)} no dia é extra. Sábado só é extra depois de cumpridas as ${hm(cfg.semanal)} da semana. Domingo e feriado: tudo extra.`],
                [FileArchive, 'Relatório pronto', 'Total de cada funcionário por mês na tela, e um .zip com o PDF e a planilha.'],
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
            {showCfg ? <Regras cfg={cfg} save={saveCfg} /> : null}
          </>
        ) : (
          <>
            <div className="pt-bar">
              <span>
                <CalendarRange size={15} /> <b>{br(res.periodo.from)}</b> a <b>{br(res.periodo.to)}</b>
              </span>
              <span className="pt-file">
                {res.arquivo} · {res.leitura}
                {/ia/i.test(res.leitura) ? <Sparkles size={13} style={{ verticalAlign: '-2px', marginLeft: 4 }} color="var(--lilac)" /> : null}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRes(null);
                  setPartes(null);
                  setFalhas([]);
                  setError('');
                }}
                data-max="horas-novo"
              >
                <RotateCcw size={14} /> Outros arquivos
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCfg((s) => !s)} aria-expanded={showCfg}>
                <Settings2 size={14} /> Regras
              </button>
            </div>
            {mesesFolha.length ? (
              <div className="hx-mesfolha">
                <label htmlFor="hx-mesfolha">Mês das folhas (não está escrito nelas)</label>
                <select
                  id="hx-mesfolha"
                  className="select input"
                  disabled={Boolean(busy)}
                  value={mesFolha || (new Set(mesesFolha.map((m) => m.mes)).size === 1 ? mesesFolha[0].mes : '')}
                  onChange={(e) => {
                    setMesFolha(e.target.value);
                    void recalcular(e.target.value);
                  }}
                >
                  {new Set(mesesFolha.map((m) => m.mes)).size > 1 ? <option value="">Deduzido em cada folha</option> : null}
                  {ultimosMeses().map((m) => (
                    <option key={m} value={m}>
                      {mesTxt(m)}
                      {!mesFolha && mesesFolha.some((x) => x.mes === m) ? ' (deduzido)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {showCfg ? (
              <>
                <Regras cfg={cfg} save={saveCfg} />
                <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} disabled={Boolean(busy)} onClick={() => recalcular()}>
                  {busy === 'ler' ? <span className="spinner" /> : <RotateCcw size={14} />} Recalcular com estas regras
                </button>
              </>
            ) : null}
            {falhas.length ? (
              <div className="pt-aviso" role="status">
                <AlertTriangle size={17} />
                <span>
                  <b>Ficaram de fora do cálculo:</b> {falhas.map((x) => `${x.nome} (${x.erro})`).join('; ')}.
                </span>
              </div>
            ) : null}
            {partes && partes.length > 1 ? (
              <details className="hx-files">
                <summary>{partes.length} arquivos juntados neste relatório</summary>
                <ul>
                  {partes.map((p, i) => (
                    <li key={i}>
                      {p.nome} <small>· {p.leitura.toLowerCase()}</small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {res.avisos.map((av, i) => (
              <div key={i} className="pt-aviso" role="status">
                <AlertTriangle size={17} />
                <span>{av}</span>
              </div>
            ))}
            <div className="stat-grid">
              <div className="stat">
                <small>
                  <Users size={13} style={{ verticalAlign: '-2px' }} /> Funcionários
                </small>
                <b>{res.total.funcionarios}</b>
                <span className="pt-sub">{res.funcionarios.filter((f) => f.total.extras > 0).length} com hora extra</span>
              </div>
              <div className="stat">
                <small>
                  <Clock3 size={13} style={{ verticalAlign: '-2px' }} /> Horas extras
                </small>
                <b style={{ color: res.total.extras ? 'var(--danger)' : undefined }}>{hm(res.total.extras)}</b>
                <span className="pt-sub">de {hm(res.total.trabalhado)} trabalhadas</span>
              </div>
              <div className="stat">
                <small>Dias úteis e sábado</small>
                <b style={{ color: 'var(--amber)' }}>{hm(res.total.extra50)}</b>
                <span className="pt-sub">extras a 50%</span>
              </div>
              <div className="stat">
                <small>Domingo e feriado</small>
                <b style={{ color: res.total.extra100 ? 'var(--danger)' : undefined }}>{hm(res.total.extra100)}</b>
                <span className="pt-sub">extras a 100%</span>
              </div>
            </div>

            <div className="hx-meses" role="tablist" aria-label="Mês">
              <button className={!mes ? 'is-on' : ''} onClick={() => setMes('')}>
                <b>Período todo</b>
                <em>{hm(res.total.extras)}</em>
              </button>
              {res.meses.map((m) => (
                <button key={m.chave} className={mes === m.chave ? 'is-on' : ''} onClick={() => setMes(m.chave)}>
                  <b>{m.rotulo}</b>
                  <em>{hm(m.extras)}</em>
                </button>
              ))}
            </div>

            <div className="toolbar">
              <div className="search">
                <Search size={17} />
                <input className="input" placeholder="Buscar funcionário ou matrícula" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar funcionário" />
              </div>
            </div>

            <div className="t-wrap hx-table">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Funcionário</th>
                    {res.meses.map((m) => (
                      <th key={m.chave} className={`n${mes && mes !== m.chave ? ' hx-dim' : ''}`}>
                        {m.rotulo}
                      </th>
                    ))}
                    <th className="n">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lista]
                    .sort((a, b) => extrasDe(b) - extrasDe(a) || a.name.localeCompare(b.name, 'pt-BR'))
                    .map((f) => {
                      const k = f.name + (f.matricula ?? '');
                      return (
                        <Linha key={k} f={f} meses={res.meses.map((m) => m.chave)} mes={mes} open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Regras({ cfg, save }: { cfg: HorasConfig; save: (c: HorasConfig) => void }) {
  return (
    <div className="pt-cfg">
      <div>
        <label className="label" htmlFor="hx-sem">
          Horas semanais
        </label>
        <input id="hx-sem" className="input" defaultValue={toHM(cfg.semanal)} key={'s' + cfg.semanal} onBlur={(e) => save({ ...cfg, semanal: fromHM(e.target.value, cfg.semanal) })} />
      </div>
      <div>
        <label className="label" htmlFor="hx-dia">
          Limite por dia
        </label>
        <input id="hx-dia" className="input" defaultValue={toHM(cfg.diaria)} key={'d' + cfg.diaria} onBlur={(e) => save({ ...cfg, diaria: fromHM(e.target.value, cfg.diaria) })} />
      </div>
      <div>
        <label className="label" htmlFor="hx-tol">
          Tolerância por dia (min)
        </label>
        <input id="hx-tol" className="input" inputMode="numeric" value={cfg.tolerancia} onChange={(e) => save({ ...cfg, tolerancia: Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
      </div>
      <div>
        <label className="label" htmlFor="hx-mes">
          Mês de apuração
        </label>
        <select id="hx-mes" className="select input" value={cfg.inicioMes} onChange={(e) => save({ ...cfg, inicioMes: Number(e.target.value) })}>
          <option value={1}>Do dia 1º ao fim do mês</option>
          <option value={21}>Do dia 21 ao dia 20</option>
          <option value={26}>Do dia 26 ao dia 25</option>
          <option value={16}>Do dia 16 ao dia 15</option>
        </select>
      </div>
      <button type="button" className="link-btn" onClick={() => save(DEFAULT_HORAS)}>
        voltar ao padrão (44h / 9h)
      </button>
    </div>
  );
}

function Linha({ f, meses, mes, open, onToggle }: { f: FuncHoras; meses: string[]; mes: string; open: boolean; onToggle: () => void }) {
  const dias = f.dias.filter((d) => (d.extra50 + d.extra100 > 0 || d.incompleto) && (!mes || f.meses.find((m) => m.chave === mes && d.date >= m.de && d.date <= m.ate)));
  return (
    <>
      <tr className={`click hx-row${open ? ' is-open' : ''}`} onClick={onToggle} aria-expanded={open}>
        <td>
          <b>{f.name}</b>
          <small style={{ display: 'block' }}>{[f.matricula ? `Mat. ${f.matricula}` : null, f.cargo, `${f.total.dias} dias trabalhados`, f.total.incompletos ? `${f.total.incompletos} com batida faltando` : null].filter(Boolean).join(' · ')}</small>
        </td>
        {meses.map((k) => {
          const m = f.meses.find((x) => x.chave === k);
          return (
            <td key={k} className={`n${mes && mes !== k ? ' hx-dim' : ''}`}>
              {m ? (
                <>
                  <b className={m.extras ? 'hx-pos' : 'hx-zero'}>{m.extras ? hm(m.extras) : '0h00'}</b>
                  {m.extra100 ? <small style={{ display: 'block' }}>{hm(m.extra100)} a 100%</small> : null}
                </>
              ) : (
                <small>—</small>
              )}
            </td>
          );
        })}
        <td className="n">
          <b className={f.total.extras ? 'hx-pos' : 'hx-zero'}>{hm(f.total.extras)}</b>
          <ChevronDown size={15} className="hx-chev" />
        </td>
      </tr>
      {open ? (
        <tr className="hx-detail">
          <td colSpan={meses.length + 2}>
            {dias.length ? (
              <div className="hx-days">
                {dias.map((d) => (
                  <div key={d.date} className={`hx-day${d.extra100 ? ' is-100' : ''}${d.incompleto ? ' is-inc' : ''}`}>
                    <span className="hx-date">
                      <b>{br(d.date).slice(0, 5)}</b> <small>{d.feriado ? 'feriado' : SEM[d.weekday]}</small>
                    </span>
                    <span className="hx-punches">{d.punches.join('  ')}</span>
                    <span className="hx-worked">{hm(d.trabalhado)}</span>
                    <span className="hx-extra">{d.extra50 + d.extra100 ? `+${hm(d.extra50 + d.extra100)}` : '—'}</span>
                    <span className="hx-why">{[d.motivo, d.incompleto ? 'batida faltando: só os pares completos foram somados' : null].filter(Boolean).join('; ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="help">Nenhuma hora extra {mes ? 'neste mês' : 'no período'}.</p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
