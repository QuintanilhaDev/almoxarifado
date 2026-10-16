'use client';
import { validKey } from './conferencia';

/**
 * Lê a chave de acesso (44 dígitos) no código de barras de uma foto do DANFE.
 * Usa o leitor do próprio navegador quando existe; senão, a biblioteca ZXing (gratuita),
 * carregada só quando precisa. Tenta a foto como está e girada (foto em pé).
 */
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

async function canvases(file: File): Promise<HTMLCanvasElement[]> {
  const bmp = await createImageBitmap(file);
  const max = 2400;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const out: HTMLCanvasElement[] = [];
  for (const rot of [0, 90, 270]) {
    const c = document.createElement('canvas');
    c.width = rot ? h : w;
    c.height = rot ? w : h;
    const g = c.getContext('2d')!;
    if (rot) {
      g.translate(c.width / 2, c.height / 2);
      g.rotate((rot * Math.PI) / 180);
      g.drawImage(bmp, -w / 2, -h / 2, w, h);
    } else g.drawImage(bmp, 0, 0, w, h);
    out.push(c);
  }
  return out;
}

const pick = (raw: string | null | undefined) => {
  const k = (raw ?? '').replace(/\D/g, '');
  return k.length === 44 && validKey(k) ? k : null;
};

export async function readKeyFromImage(file: File): Promise<string | null> {
  const list = await canvases(file);
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (BD) {
    try {
      const det = new BD({ formats: ['code_128', 'itf'] });
      for (const c of list) {
        for (const r of await det.detect(c)) {
          const k = pick(r.rawValue);
          if (k) return k;
        }
      }
    } catch {
      /* segue para o ZXing */
    }
  }
  const z = await import('@zxing/library');
  const hints = new Map();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.CODE_128, z.BarcodeFormat.ITF]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  const reader = new z.MultiFormatReader();
  reader.setHints(hints);
  for (const c of list) {
    try {
      const src = new z.HTMLCanvasElementLuminanceSource(c);
      const res = reader.decode(new z.BinaryBitmap(new z.HybridBinarizer(src)));
      const k = pick(res.getText());
      if (k) return k;
    } catch {
      /* tenta a próxima rotação */
    }
  }
  return null;
}
