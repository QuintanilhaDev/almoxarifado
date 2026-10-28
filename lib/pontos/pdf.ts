import 'server-only';
import PDFDocument from 'pdfkit';
import { ORDEM, REGISTRO, SEMANA, SITUACAO, dataBR, hhmm, semRegistro, type Analise, type FuncAnalisado, type Situacao } from './types';
import { destaques } from './destaques';

/**
 * Relatório de apuração de ponto (A4) para a diretoria:
 *  1. capa com os números do período, ocorrências por tipo, situação da equipe e postos;
 *  2. resumo por funcionário (uma linha cada);
 *  3. detalhe de quem teve ocorrência, dia a dia;
 *  4. critérios usados nos cálculos.
 */
const INK = '#17112A';
const LILAC = '#6B3FD6';
const LILAC_SOFT = '#EFE8FF';
const TEXT = '#221A36';
const MUTED = '#6E6787';
const LINE = '#E6E0F2';
const PAPER = '#FAF8FF';
const RED = '#D6455D';
const RED_SOFT = '#FDECEF';
const AMBER = '#C98612';
const AMBER_SOFT = '#FFF4DE';
const GREEN = '#1E9E6A';
const GREEN_SOFT = '#E5F7EF';
const GRAY = '#9A93B0';
const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - M * 2;
const BOTTOM = H - 48;

const NIVEL_COR = { alta: RED, media: AMBER, baixa: GRAY } as const;
const STATUS = {
  ok: { label: 'Regular', fg: GREEN, bg: GREEN_SOFT },
  atencao: { label: 'Atenção', fg: AMBER, bg: AMBER_SOFT },
  critico: { label: 'Crítico', fg: RED, bg: RED_SOFT },
} as const;
const n = (x: number) => x.toLocaleString('pt-BR');
const pct = (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const horas = (min: number) => `${n(Math.floor(min / 60))}h${String(Math.round(min % 60)).padStart(2, '0')}`;

export function pontoPdf(a: Analise): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Relatório de ponto ${dataBR(a.periodo.from)} a ${dataBR(a.periodo.to)}`, Author: a.geradoPor, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  const periodo = periodoTxt(a);
  const quando = new Date(a.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let y = 0;

  const newPage = (title?: string) => {
    doc.addPage();
    doc.rect(0, 0, W, 54).fill(INK);
    doc.rect(0, 54, W, 3).fill(LILAC);
    font(true).fontSize(8).fillColor('#BFA8FF').text('RELATÓRIO DE PONTO', M, 18, { characterSpacing: 1 });
    font().fontSize(8).fillColor('#D7CFEA').text(`Período ${periodo}`, M, 31);
    if (title) font(true).fontSize(13).fillColor('#FFFFFF').text(title, M, 20, { width: CW, align: 'right' });
    y = 76;
  };
  const need = (h: number, title?: string) => {
    if (y + h > BOTTOM) {
      newPage(title);
      return true;
    }
    return false;
  };
  const section = (t: string, sub?: string) => {
    need(46);
    doc.rect(M, y + 2, 3, 14).fill(LILAC);
    font(true).fontSize(12).fillColor(TEXT).text(t, M + 10, y);
    if (sub) font().fontSize(8).fillColor(MUTED).text(sub, M + 10, y + 16, { width: CW - 10 });
    y += sub ? 32 : 22;
  };
  const chip = (x: number, yy: number, label: string, fg: string, bg: string, size = 7.5) => {
    font(true).fontSize(size);
    const w = doc.widthOfString(label) + 12;
    doc.roundedRect(x, yy, w, size + 7, (size + 7) / 2).fill(bg);
    doc.fillColor(fg).text(label, x + 6, yy + 3.5, { lineBreak: false });
    return w;
  };

  /* ------------------------------------------------------------ capa */
  doc.rect(0, 0, W, 170).fill(INK);
  // faixas diagonais discretas (identidade do Max Hub)
  doc.save();
  doc.rect(0, 0, W, 170).clip();
  for (let i = 0; i < 9; i++) doc.polygon([W - 260 + i * 34, 0], [W - 220 + i * 34, 0], [W - 330 + i * 34, 170], [W - 370 + i * 34, 170]).fillOpacity(0.05 + (i % 3) * 0.02).fill('#B79CFF');
  doc.restore();
  doc.fillOpacity(1);
  doc.rect(0, 170, W, 4).fill(LILAC);
  font(true).fontSize(9).fillColor('#BFA8FF').text('GRUPO MAX FORTE  ·  APURAÇÃO DE PONTO', M, 34, { characterSpacing: 1.2 });
  font(true).fontSize(26).fillColor('#FFFFFF').text('Relatório Completo de Ponto', M, 52);
  font().fontSize(12).fillColor('#E6DDFB').text(`Período de apuração: ${periodo}`, M, 88);
  const postosTxt = a.resumo.postos.filter((p) => p.posto !== 'Sem posto informado').map((p) => p.posto);
  font().fontSize(9).fillColor('#B9AFD6').text(recorteTxt(a) || (postosTxt.length ? (postosTxt.length <= 3 ? postosTxt.join('  ·  ') : `${postosTxt.length} postos`) : 'Espelho exportado do GesOper'), M, 108, { width: CW - 40 });
  font().fontSize(8).fillColor('#9E94BC').text(`Gerado em ${quando}${a.geradoPor ? ` por ${a.geradoPor}` : ''}  ·  arquivo: ${a.arquivo || 'espelho'}`, M, 140, { width: CW });
  y = 196;

  // números do período
  const r = a.resumo;
  const cards: { k: string; v: string; s: string; c: string }[] = [
    { k: 'Funcionários', v: n(r.funcionarios), s: `${n(r.dias)} dias avaliados`, c: LILAC },
    { k: 'Ocorrências', v: n(r.ocorrencias), s: `${n(r.comOcorrencia)} funcionário(s) com ocorrência`, c: r.ocorrencias ? RED : GREEN },
    { k: 'Conformidade', v: pct(r.conformidade), s: 'dias sem ocorrência relevante', c: r.conformidade >= 95 ? GREEN : r.conformidade >= 85 ? AMBER : RED },
    { k: 'Horas trabalhadas', v: horas(r.horas), s: `${horas(r.extras)} além da jornada`, c: LILAC },
  ];
  const cw = (CW - 3 * 10) / 4;
  cards.forEach((c, i) => {
    const x = M + i * (cw + 10);
    doc.roundedRect(x, y, cw, 74, 10).fill(PAPER);
    doc.roundedRect(x, y, cw, 74, 10).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.rect(x + 12, y + 12, 18, 3).fill(c.c);
    font(true).fontSize(7.5).fillColor(MUTED).text(c.k.toUpperCase(), x + 12, y + 20, { width: cw - 24, characterSpacing: 0.4 });
    font(true).fontSize(20).fillColor(TEXT).text(c.v, x + 12, y + 32, { width: cw - 24 });
    font().fontSize(7.5).fillColor(MUTED).text(c.s, x + 12, y + 57, { width: cw - 24 });
  });
  y += 92;
  // aviso da leitura (ex.: batidas que parecem não ter sido importadas)
  for (const av of a.avisos) {
    font().fontSize(8.5);
    const h = doc.heightOfString(av, { width: CW - 40 }) + 18;
    doc.roundedRect(M, y, CW, h, 8).fill(AMBER_SOFT);
    doc.rect(M, y, 3, h).fill(AMBER);
    font(true).fontSize(8.5).fillColor(AMBER).text('Atenção:', M + 14, y + 9, { continued: true }).font('Helvetica').fillColor(TEXT).text(' ' + av, { width: CW - 40 });
    y += h + 10;
  }

  // ocorrências por tipo (barras)
  section('Ocorrências por tipo', 'Quantidade no período, da mais grave para a menos grave.');
  const tipos = ORDEM.filter((t) => (r.porTipo[t] ?? 0) > 0);
  if (!tipos.length) {
    doc.roundedRect(M, y, CW, 36, 8).fill(GREEN_SOFT);
    font(true).fontSize(10).fillColor(GREEN).text('Nenhuma ocorrência no período: todos os registros conferem.', M + 14, y + 12);
    y += 50;
  } else {
    const max = Math.max(...tipos.map((t) => r.porTipo[t] ?? 0));
    const lw = 170;
    const bw = CW - lw - 50;
    for (const t of tipos) {
      need(20);
      const v = r.porTipo[t] ?? 0;
      const s = SITUACAO[t];
      doc.circle(M + 4, y + 6, 3).fill(NIVEL_COR[s.nivel]);
      font().fontSize(9).fillColor(TEXT).text(s.label, M + 14, y + 1, { width: lw - 16, lineBreak: false });
      doc.roundedRect(M + lw, y + 1, bw, 10, 5).fill('#F2EEFA');
      doc.roundedRect(M + lw, y + 1, Math.max(8, (bw * v) / max), 10, 5).fill(NIVEL_COR[s.nivel]);
      font(true).fontSize(9).fillColor(TEXT).text(n(v), M + lw + bw + 8, y + 1, { width: 42, align: 'right' });
      y += 18;
    }
    font().fontSize(7.5).fillColor(MUTED);
    let lx = M + 14;
    for (const [lvl, lab] of [['alta', 'grave'], ['media', 'atenção'], ['baixa', 'informativo']] as const) {
      doc.circle(lx, y + 9, 3).fill(NIVEL_COR[lvl]);
      doc.fillColor(MUTED).text(lab, lx + 7, y + 5, { lineBreak: false });
      lx += 74;
    }
    y += 26;
  }

  // situação da equipe (barra empilhada)
  section('Situação da equipe');
  const st = { ok: a.funcionarios.filter((f) => f.status === 'ok').length, atencao: a.funcionarios.filter((f) => f.status === 'atencao').length, critico: a.funcionarios.filter((f) => f.status === 'critico').length };
  const tot = Math.max(1, a.funcionarios.length);
  let bx = M;
  for (const k of ['ok', 'atencao', 'critico'] as const) {
    const w = (CW * st[k]) / tot;
    if (w > 0) doc.rect(bx, y, w, 16).fill(STATUS[k].fg);
    bx += w;
  }
  y += 24;
  let sx = M;
  for (const k of ['ok', 'atencao', 'critico'] as const) {
    doc.roundedRect(sx, y, 10, 10, 2).fill(STATUS[k].fg);
    font(true).fontSize(9).fillColor(TEXT).text(`${STATUS[k].label}: ${n(st[k])}`, sx + 15, y, { lineBreak: false });
    font().fontSize(8).fillColor(MUTED).text(pct(Math.round((st[k] / tot) * 1000) / 10), sx + 15, y + 12, { lineBreak: false });
    sx += CW / 3;
  }
  y += 36;

  // postos
  if (a.resumo.postos.length > 1 || (a.resumo.postos[0] && a.resumo.postos[0].posto !== 'Sem posto informado')) {
    section('Por posto');
    for (const p of a.resumo.postos.slice(0, 10)) {
      need(18);
      font().fontSize(9).fillColor(TEXT).text(p.posto, M, y, { width: CW - 200, lineBreak: false, ellipsis: true, height: 12 });
      font().fontSize(9).fillColor(MUTED).text(`${n(p.funcionarios)} func.`, M + CW - 190, y, { width: 80, align: 'right' });
      font(true).fontSize(9).fillColor(p.ocorrencias ? RED : GREEN).text(`${n(p.ocorrencias)} ocorrência(s)`, M + CW - 110, y, { width: 110, align: 'right' });
      doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 18;
    }
    y += 8;
  }

  // destaques: os que mais precisam de atenção
  const top = a.funcionarios.filter((f) => f.status !== 'ok').slice(0, 5);
  if (top.length) {
    section('Precisam de atenção', 'Os funcionários com mais ocorrências graves no período.');
    for (const f of top) {
      need(22);
      const s = STATUS[f.status];
      chip(M, y, s.label, s.fg, s.bg);
      font(true).fontSize(9.5).fillColor(TEXT).text(f.name, M + 62, y + 1, { width: 230, lineBreak: false, ellipsis: true, height: 12 });
      const resumo = ORDEM.filter((t) => f.totais.porTipo[t] && SITUACAO[t].nivel !== 'baixa').map((t) => `${f.totais.porTipo[t]} ${SITUACAO[t].short.toLowerCase()}`).join(' · ');
      font().fontSize(8).fillColor(MUTED).text(resumo || '—', M + 300, y + 2, { width: CW - 300, lineBreak: false, ellipsis: true, height: 12 });
      y += 20;
    }
  }

  /* ------------------------------------------------------------ resumo por funcionário */
  newPage('Resumo por funcionário');
  const cols = [
    { t: 'Funcionário', w: 132 },
    { t: 'Escala', w: 38, a: 'center' as const },
    { t: 'Dias', w: 36, a: 'center' as const },
    { t: 'Horas', w: 46, a: 'right' as const },
    { t: 'Extras', w: 38, a: 'right' as const },
    { t: 'Atrasos', w: 40, a: 'right' as const },
    { t: 'Parcial', w: 38, a: 'center' as const },
    { t: 'Sem reg./ Falta', w: 42, a: 'center' as const },
    { t: 'Conf.', w: 38, a: 'right' as const },
    { t: 'Situação', w: CW - 448, a: 'center' as const },
  ];
  const head = () => {
    doc.roundedRect(M, y, CW, 24, 6).fill(INK);
    let x = M;
    for (const c of cols) {
      font(true).fontSize(7.2).fillColor('#FFFFFF').text(c.t, x + 4, y + (c.t.includes('/') ? 4 : 8.5), { width: c.w - 8, align: c.a ?? 'left' });
      x += c.w;
    }
    y += 28;
  };
  head();
  a.funcionarios.forEach((f, i) => {
    const rh = f.posto || f.matricula ? 28 : 20;
    if (need(rh + 4, 'Resumo por funcionário')) head();
    if (i % 2 === 1) doc.rect(M, y - 2, CW, rh).fill(PAPER);
    const cells = [
      '',
      escalaTxt(f, true),
      `${f.totais.trabalhados}/${f.totais.previstos}`,
      horas(f.totais.minutos),
      f.totais.extras ? hhmm(f.totais.extras) : '—',
      f.totais.atrasos ? hhmm(f.totais.atrasos) : '—',
      String(f.totais.porTipo.incompleta ?? 0),
      String((f.totais.porTipo.sem_registro ?? 0) + (f.totais.porTipo.falta ?? 0)),
      pct(f.totais.conformidade),
      '',
    ];
    let x = M;
    cols.forEach((c, k) => {
      if (k === 0) {
        font(true).fontSize(8.2).fillColor(TEXT).text(f.name, x + 4, y + 2, { width: c.w - 8, lineBreak: false, ellipsis: true, height: 12 });
        const sub = [f.matricula ? `Mat. ${f.matricula}` : '', f.posto ?? ''].filter(Boolean).join(' · ');
        if (sub) font().fontSize(6.8).fillColor(MUTED).text(sub, x + 4, y + 13, { width: c.w - 8, lineBreak: false, ellipsis: true, height: 12 });
      } else if (k === cols.length - 1) {
        const s = STATUS[f.status];
        font(true).fontSize(7);
        const w = doc.widthOfString(s.label) + 12;
        chip(x + (c.w - w) / 2, y + 2, s.label, s.fg, s.bg, 7);
      } else {
        const bad = (k === 6 || k === 7) && cells[k] !== '0';
        font(bad).fontSize(8.2).fillColor(bad ? RED : TEXT).text(cells[k], x + 4, y + 3, { width: c.w - 8, align: c.a ?? 'left', lineBreak: false });
      }
      x += c.w;
    });
    y += rh;
    doc.moveTo(M, y - 2).lineTo(M + CW, y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
  });
  y += 8;
  need(30);
  font().fontSize(7.5).fillColor(MUTED).text('Dias = trabalhados / previstos pela escala. Conf. = dias sem ocorrência grave ou de atenção ÷ dias avaliados. Extras e atrasos somam o que passou da tolerância.', M, y, { width: CW });

  /* ------------------------------------------------------------ detalhe */
  const comOc = a.funcionarios.filter((f) => f.dias.some((d) => d.ocorrencias.length));
  if (comOc.length) newPage('Ocorrências por funcionário');
  for (const f of comOc) detalhe(f);

  function detalhe(f: FuncAnalisado) {
    const dias = f.dias.filter((d) => d.ocorrencias.length);
    need(110, 'Ocorrências por funcionário');
    // cabeçalho do funcionário
    doc.roundedRect(M, y, CW, 50, 10).fill(LILAC_SOFT);
    font(true).fontSize(11.5).fillColor(TEXT).text(f.name, M + 14, y + 10, { width: CW - 140, lineBreak: false, ellipsis: true, height: 12 });
    const sub = [f.matricula ? `Matrícula ${f.matricula}` : null, f.posto, f.cargo, `Escala ${escalaTxt(f)}`, f.habitual.inicio ? `habitual ${f.habitual.inicio}${f.habitual.fim ? '–' + f.habitual.fim : ''}` : null].filter(Boolean).join('  ·  ');
    font().fontSize(8).fillColor(MUTED).text(sub, M + 14, y + 28, { width: CW - 140, lineBreak: false, ellipsis: true, height: 12 });
    const s = STATUS[f.status];
    font(true).fontSize(8);
    const sw = doc.widthOfString(s.label) + 12;
    chip(M + CW - 14 - sw, y + 10, s.label, s.fg, s.bg, 8);
    font().fontSize(7.5).fillColor(MUTED).text(`${f.totais.ocorrencias} ocorrência(s) · conf. ${pct(f.totais.conformidade)}`, M + CW - 160, y + 30, { width: 146, align: 'right' });
    y += 58;
    // dias
    const c1 = 62;
    const c2 = 128;
    const c3 = 52;
    for (const d of dias) {
      const linhas = d.ocorrencias.map((o) => o.texto);
      font().fontSize(8);
      const th = linhas.reduce((t, l) => t + doc.heightOfString(l, { width: CW - c1 - c2 - c3 - 24 }) + 2, 0);
      const rh = Math.max(20, th + 8);
      if (need(rh, 'Ocorrências por funcionário')) {
        font(true).fontSize(8).fillColor(MUTED).text(`${f.name} (continuação)`, M, y);
        y += 14;
      }
      font(true).fontSize(8.5).fillColor(TEXT).text(dataBR(d.date).slice(0, 5), M + 4, y + 4, { lineBreak: false });
      font().fontSize(7.5).fillColor(MUTED).text(SEMANA[d.weekday], M + 36, y + 5, { lineBreak: false });
      const batidas = d.punches.length ? d.punches.join('  ') : d.marks.length ? d.marks.join(', ') : 'sem batidas';
      font().fontSize(8).fillColor(d.punches.length ? TEXT : MUTED).text(batidas + (d.virada ? ' (+1)' : ''), M + c1, y + 4, { width: c2 - 6, lineBreak: false, ellipsis: true, height: 12 });
      font().fontSize(8).fillColor(MUTED).text(d.trabalhado ? hhmm(d.trabalhado) : '—', M + c1 + c2, y + 4, { width: c3 - 6, align: 'right', lineBreak: false });
      let ly = y + 4;
      for (const o of d.ocorrencias) {
        const cor = NIVEL_COR[SITUACAO[o.tipo].nivel];
        doc.circle(M + c1 + c2 + c3 + 8, ly + 4, 2.6).fill(cor);
        font().fontSize(8).fillColor(TEXT).text(o.texto, M + c1 + c2 + c3 + 16, ly, { width: CW - c1 - c2 - c3 - 24 });
        ly = doc.y + 2;
      }
      y += rh;
      doc.moveTo(M, y - 2).lineTo(M + CW, y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
    }
    y += 16;
  }

  const semOc = a.funcionarios.filter((f) => !f.dias.some((d) => d.ocorrencias.length));
  if (semOc.length) {
    need(60);
    section('Sem ocorrências', `${semOc.length} funcionário(s) com todos os registros em ordem no período.`);
    font().fontSize(8.5).fillColor(TEXT).text(semOc.map((f) => f.name).join('  ·  '), M, y, { width: CW });
    y = doc.y + 16;
  }

  /* ------------------------------------------------------------ critérios */
  need(200);
  section('Critérios usados', 'Todos os cálculos em minutos, a partir das batidas do espelho.');
  const c = a.config;
  const crit = [
    `Escala: ${c.escala === 'auto' ? 'identificada pela duração dos plantões (10h ou mais = 12x36; menos = diária)' : c.escala === '12x36' ? '12x36 para todos' : 'diária para todos'}. Jornada diária ${hhmm(c.jornada)}; plantão ${hhmm(c.plantao)}.`,
    `Dias previstos: no 12x36, dia sim, dia não, a partir dos plantões batidos; na diária, os dias da semana em que a pessoa costuma trabalhar. Folga, férias, atestado, feriado e afastamento marcados no espelho justificam o dia.`,
    `Horário de referência: o previsto no espelho, quando existe; senão, o horário habitual de cada pessoa (mediana das entradas e saídas no período).`,
    `Tolerância de ${c.tolerancia} minutos por dia para atraso, saída antecipada e hora extra (CLT, art. 58, § 1º).`,
    `Intervalo mínimo de ${hhmm(c.intervalo)} em jornada acima de 6 horas (art. 71). No 12x36 o intervalo costuma ser pré-assinalado e não é cobrado.`,
    `Descanso mínimo de ${hhmm(c.interjornada)} entre o fim de uma jornada e o início da seguinte (art. 66).`,
    'Batida repetida em até 3 minutos é desconsiderada. Saída menor que a entrada indica plantão que passou da meia-noite.',
  ];
  for (const t of crit) {
    font().fontSize(8.5);
    const h = doc.heightOfString(t, { width: CW - 16 });
    need(h + 6);
    doc.circle(M + 4, y + 5, 2).fill(LILAC);
    doc.fillColor(TEXT).text(t, M + 14, y, { width: CW - 16 });
    y = doc.y + 5;
  }
  {
    const t = 'Jornada prevista de cada dia: a calculada pelo próprio sistema de ponto (Hr. Dia − Dif.), quando o espelho traz. Dia escalado com 00:00 em todas as batidas conta como sem registro; 00:00 no intervalo conta como intervalo não feito.';
    font().fontSize(8.5);
    need(doc.heightOfString(t, { width: CW - 16 }) + 6);
    doc.circle(M + 4, y + 5, 2).fill(LILAC);
    doc.fillColor(TEXT).text(t, M + 14, y, { width: CW - 16 });
    y = doc.y + 5;
  }

  // rodapé
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, H - 34).lineTo(M + CW, H - 34).lineWidth(0.5).strokeColor(LINE).stroke();
    font().fontSize(7).fillColor(MUTED).text(`Max Hub · Relatório de ponto · ${periodo}`, M, H - 26, { width: CW / 2, lineBreak: false });
    font().fontSize(7).fillColor(MUTED).text(`Página ${i + 1} de ${range.count}`, M + CW / 2, H - 26, { width: CW / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

export const periodoTxt = (a: Analise) => `${dataBR(a.filtros?.de ?? a.periodo.from)} a ${dataBR(a.filtros?.ate ?? a.periodo.to)}`;
/** recorte escolhido nos filtros, em uma linha */
export const recorteTxt = (a: Analise) => [a.filtros?.posto, a.filtros?.filial, a.filtros?.funcao].filter(Boolean).join('  ·  ');
export const escalaTxt = (f: FuncAnalisado, curto = false) => (f.escala === '12x36' ? '12x36' : curto ? 'Diária' : `diária${f.jornadaTipica ? ' de ' + hhmm(f.jornadaTipica) : ''}`);

/** nome de arquivo seguro: sem barras, aspas, quebras de linha nem caracteres de controle */
export const safeFileName = (name: string) =>
  name
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|;]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'relatorio';
export const pdfName = (a: Analise) => safeFileName(`Relatorio-Ponto-${periodoTxt(a).replace(/\//g, '-').replace(/ /g, '-')}.pdf`);
export const zipName = (a: Analise) => safeFileName(`Relatório de Ponto ${periodoTxt(a).replace(/\//g, '-')}.zip`);
export type { Situacao };

/**
 * Relatório para a diretoria: limpo e objetivo. Números do período, destaques em frases,
 * quem está sem registro ou parcialmente sem registro (com os dias) e o resumo por posto.
 */
export function diretoriaPdf(a: Analise): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Relatório de ponto para a diretoria ${periodoTxt(a)}`, Author: a.geradoPor, Creator: 'Max Hub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const font = (bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  const periodo = periodoTxt(a);
  const quando = new Date(a.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const r = a.resumo;
  const X = 48;
  const WW = W - X * 2;
  let y = 0;
  const top = () => {
    doc.rect(0, 0, W, 6).fill(LILAC);
    y = 34;
  };
  const need = (h: number) => {
    if (y + h > H - 56) {
      doc.addPage();
      top();
      return true;
    }
    return false;
  };
  const title = (t: string) => {
    need(40);
    font(true).fontSize(12.5).fillColor(INK).text(t, X, y);
    y = doc.y + 4;
    doc.moveTo(X, y).lineTo(X + WW, y).lineWidth(0.6).strokeColor(LINE).stroke();
    y += 10;
  };

  /* ---------- cabeçalho */
  top();
  font(true).fontSize(8.5).fillColor(LILAC).text('GRUPO MAX FORTE', X, y, { characterSpacing: 1.5 });
  font(true).fontSize(24).fillColor(INK).text('Relatório de Ponto', X, y + 14);
  font().fontSize(11).fillColor(MUTED).text(`Resumo para a diretoria  ·  ${periodo}`, X, y + 46);
  const rec = recorteTxt(a);
  if (rec) font().fontSize(9).fillColor(MUTED).text(rec, X, y + 63, { width: WW });
  y += rec ? 88 : 76;

  /* ---------- números */
  const sem = (r.porTipo.sem_registro ?? 0) + (r.porTipo.falta ?? 0);
  const parcial = (r.porTipo.incompleta ?? 0) + (r.porTipo.sem_intervalo ?? 0);
  const kpis: [string, string, string][] = [
    ['Funcionários', n(r.funcionarios), `${n(r.comOcorrencia)} com ocorrência`],
    ['Conformidade', pct(r.conformidade), 'dias sem ocorrência'],
    ['Sem registro', n(sem), 'dias escalados sem batida'],
    ['Registro parcial', n(parcial), 'dias com batida faltando'],
  ];
  const kw = WW / 4;
  kpis.forEach(([k, v, s2], i) => {
    const x = X + i * kw;
    if (i) doc.moveTo(x, y + 2).lineTo(x, y + 52).lineWidth(0.6).strokeColor(LINE).stroke();
    const px = x + (i ? 14 : 0);
    font(true).fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), px, y, { width: kw - 18, characterSpacing: 0.3 });
    const bad = (i === 2 && sem > 0) || (i === 3 && parcial > 0) || (i === 1 && r.conformidade < 85);
    font(true).fontSize(22).fillColor(bad ? RED : INK).text(v, px, y + 13, { width: kw - 18 });
    font().fontSize(7.5).fillColor(MUTED).text(s2, px, y + 41, { width: kw - 18 });
  });
  y += 70;

  /* ---------- aviso */
  for (const av of a.avisos) {
    font().fontSize(8.5);
    const h = doc.heightOfString(av, { width: WW - 28 }) + 16;
    need(h + 8);
    doc.roundedRect(X, y, WW, h, 6).fill(AMBER_SOFT);
    doc.rect(X, y, 3, h).fill(AMBER);
    font().fontSize(8.5).fillColor(TEXT).text(av, X + 14, y + 8, { width: WW - 28 });
    y += h + 12;
  }

  /* ---------- destaques */
  title('Destaques do período');
  for (const t of destaques(a)) {
    font().fontSize(9.5);
    const h = doc.heightOfString(t, { width: WW - 16 });
    need(h + 6);
    doc.circle(X + 3, y + 5.5, 2.2).fill(LILAC);
    doc.fillColor(TEXT).text(t, X + 14, y, { width: WW - 16 });
    y = doc.y + 6;
  }
  y += 10;

  /* ---------- sem registro / parcialmente sem registro */
  const lista = a.funcionarios.map((f) => ({ f, ...semRegistro(f) })).filter((x) => x.total > 0).sort((p, q) => q.sem.length - p.sem.length || q.total - p.total || p.f.name.localeCompare(q.f.name, 'pt-BR'));
  title(lista.length ? `Funcionários sem registro ou parcialmente sem registro (${lista.length})` : 'Registros de ponto');
  if (!lista.length) {
    font().fontSize(9.5).fillColor(GREEN).text('Todos os funcionários registraram o ponto em todos os dias da escala.', X, y);
    y = doc.y + 14;
  } else {
    const cols = [
      { t: 'Funcionário', w: 158 },
      { t: 'Posto', w: 112 },
      { t: 'Sem reg.', w: 50, a: 'center' as const },
      { t: 'Parcial', w: 40, a: 'center' as const },
      { t: 'Dias', w: WW - 360 },
    ];
    const head = () => {
      let x = X;
      for (const c of cols) {
        font(true).fontSize(7.5).fillColor(MUTED).text(c.t.toUpperCase(), x, y, { width: c.w - 6, align: c.a ?? 'left', characterSpacing: 0.2 });
        x += c.w;
      }
      y += 14;
      doc.moveTo(X, y - 3).lineTo(X + WW, y - 3).lineWidth(0.8).strokeColor(INK).stroke();
    };
    head();
    const curto = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);
    for (const it of lista) {
      const diasTxt = [it.sem.length ? `sem: ${it.sem.map(curto).join(', ')}` : '', it.parcial.length ? `parcial: ${it.parcial.map(curto).join(', ')}` : ''].filter(Boolean).join('\n');
      font().fontSize(7.8);
      const nameH = font(true).fontSize(8.6).heightOfString(it.f.name, { width: cols[0].w - 8 });
      font().fontSize(7.8);
      const h = Math.max(nameH + 18, doc.heightOfString(diasTxt, { width: cols[4].w - 4 }) + 10, doc.heightOfString(it.f.posto ?? '—', { width: cols[1].w - 8 }) + 10);
      if (need(h + 2)) head();
      let x = X;
      font(true).fontSize(8.6).fillColor(TEXT).text(it.f.name, x, y + 3, { width: cols[0].w - 8 });
      if (it.f.matricula || it.f.cargo) font().fontSize(7).fillColor(MUTED).text([it.f.matricula ? `Mat. ${it.f.matricula}` : '', it.f.cargo ?? ''].filter(Boolean).join(' · '), x, y + 5 + nameH, { width: cols[0].w - 8, lineBreak: false, ellipsis: true, height: 12 });
      x += cols[0].w;
      font().fontSize(7.8).fillColor(MUTED).text(it.f.posto ?? '—', x, y + 3, { width: cols[1].w - 8 });
      x += cols[1].w;
      font(true).fontSize(10).fillColor(it.sem.length ? RED : MUTED).text(it.sem.length ? String(it.sem.length) : '—', x, y + 3, { width: cols[2].w - 6, align: 'center' });
      x += cols[2].w;
      font(true).fontSize(10).fillColor(it.parcial.length ? AMBER : MUTED).text(it.parcial.length ? String(it.parcial.length) : '—', x, y + 3, { width: cols[3].w - 6, align: 'center' });
      x += cols[3].w;
      font().fontSize(7.8).fillColor(TEXT).text(diasTxt, x, y + 3, { width: cols[4].w - 4 });
      y += h;
      doc.moveTo(X, y - 2).lineTo(X + WW, y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
    }
    y += 6;
    need(20);
    font().fontSize(7.5).fillColor(MUTED).text('Sem registro: dia de trabalho pela escala do funcionário, sem nenhuma batida (folgas não contam). Parcial: o dia tem batidas, mas faltou registrar entrada, saída ou o intervalo.', X, y, { width: WW });
    y = doc.y + 16;
  }

  /* ---------- outras ocorrências */
  const outros = ORDEM.filter((t) => !REGISTRO.includes(t) && t !== 'repetida' && (r.porTipo[t] ?? 0) > 0);
  if (outros.length) {
    title('Outras ocorrências');
    for (const t of outros) {
      need(16);
      const k = a.funcionarios.filter((f) => (f.totais.porTipo[t] ?? 0) > 0).length;
      doc.circle(X + 3, y + 5, 2.6).fill(NIVEL_COR[SITUACAO[t].nivel]);
      font().fontSize(9.2).fillColor(TEXT).text(SITUACAO[t].label, X + 12, y, { width: 220, lineBreak: false });
      font(true).fontSize(9.2).fillColor(TEXT).text(n(r.porTipo[t] ?? 0), X + 240, y, { width: 50, align: 'right' });
      font().fontSize(8.5).fillColor(MUTED).text(`${n(k)} funcionário(s)`, X + 310, y + 0.5, { width: WW - 310 });
      y += 16;
    }
    y += 10;
  }

  /* ---------- por posto */
  if (r.postos.length > 1 || (r.postos[0] && r.postos[0].posto !== 'Sem posto informado')) {
    title('Por posto');
    for (const p of r.postos) {
      need(18);
      font().fontSize(9).fillColor(TEXT).text(p.posto, X, y, { width: WW - 190, lineBreak: false, ellipsis: true, height: 12 });
      font().fontSize(8.5).fillColor(MUTED).text(`${n(p.funcionarios)} funcionário(s)`, X + WW - 190, y, { width: 100, align: 'right' });
      font(true).fontSize(9).fillColor(p.ocorrencias ? RED : GREEN).text(p.ocorrencias ? `${n(p.ocorrencias)} ocorrência(s)` : 'sem ocorrência', X + WW - 90, y, { width: 90, align: 'right' });
      y += 17;
    }
  }

  // rodapé
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    font().fontSize(7).fillColor(MUTED).text(`Gerado em ${quando}${a.geradoPor ? ` por ${a.geradoPor}` : ''} · Max Hub · O relatório completo traz o detalhe dia a dia.`, X, H - 30, { width: WW - 70, lineBreak: false, ellipsis: true, height: 12 });
    font().fontSize(7).fillColor(MUTED).text(`${i + 1}/${range.count}`, X + WW - 60, H - 30, { width: 60, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
