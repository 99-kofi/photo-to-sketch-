/**
 * Image helpers: decoding, center square cropping to the model input,
 * procedural sample scenes, sketch presentation rendering and export.
 */
import { MODEL_TILE } from './modelConfig';

export interface PreparedImage {
  /** Full preview bitmap for display. */
  bitmap: ImageBitmap;
  /** Center-cover square crop, RGBA, exactly MODEL_TILE × MODEL_TILE. */
  cropRgba: Uint8ClampedArray;
  /** Source rect used for the crop (bitmap pixels). */
  cropRect: { x: number; y: number; w: number; h: number };
  name: string;
}

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];

export function isSupportedImage(file: File): boolean {
  return SUPPORTED.includes(file.type);
}

export async function prepareImage(source: File | ImageBitmap | Blob, name: string): Promise<PreparedImage> {
  const bitmap =
    source instanceof File || source instanceof Blob
      ? await createImageBitmap(source)
      : (source as ImageBitmap);

  const w = bitmap.width;
  const h = bitmap.height;
  if (w < 8 || h < 8) throw new Error('That image is too small to sketch.');

  // Center-cover square crop: maximises resolution while matching the
  // model's square input exactly, so the before/after views align 1:1.
  const side = Math.min(w, h);
  const cropRect = { x: Math.round((w - side) / 2), y: Math.round((h - side) / 2), w: side, h: side };

  const target = MODEL_TILE;
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (ctx == null) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, target, target);

  const imageData = ctx.getImageData(0, 0, target, target);
  return { bitmap, cropRgba: imageData.data, cropRect, name };
}

/* ------------------------------------------------------------------ */
/* Sample scenes for first-time users (procedural, no bundled photos). */
/* ------------------------------------------------------------------ */

export interface SampleImage {
  id: string;
  label: string;
  draw: (g: CanvasRenderingContext2D, s: number) => void;
}

export const SAMPLES: SampleImage[] = [
  { id: 'cabin', label: 'Lakeside cabin', draw: drawCabinScene },
  { id: 'mountains', label: 'Mountain dawn', draw: drawMountainScene },
  { id: 'still-life', label: 'Still life', draw: drawStillLife },
];

export async function renderSampleToBitmap(sample: SampleImage, size = 768): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  sample.draw(ctx, size);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  return createImageBitmap(blob);
}

function grain(g: CanvasRenderingContext2D, s: number, amount = 10) {
  // NB: putImageData ignores globalAlpha/composite and would wipe the scene,
  // so the noise is composed through an offscreen canvas + drawImage.
  const off = document.createElement('canvas');
  off.width = s;
  off.height = s;
  const octx = off.getContext('2d');
  if (octx == null) return;
  const noise = octx.createImageData(s, s);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * amount * 2;
    noise.data[i] = v;
    noise.data[i + 1] = v;
    noise.data[i + 2] = v;
    noise.data[i + 3] = 255;
  }
  octx.putImageData(noise, 0, 0);
  g.save();
  g.globalAlpha = 0.06;
  g.globalCompositeOperation = 'overlay';
  g.drawImage(off, 0, 0);
  g.restore();
}

function drawCabinScene(g: CanvasRenderingContext2D, s: number) {
  // sky
  const sky = g.createLinearGradient(0, 0, 0, s * 0.6);
  sky.addColorStop(0, '#2a3550');
  sky.addColorStop(0.55, '#86665f');
  sky.addColorStop(1, '#d99a63');
  g.fillStyle = sky;
  g.fillRect(0, 0, s, s * 0.62);
  // sun
  g.fillStyle = '#ffe3b0';
  g.beginPath();
  g.arc(s * 0.68, s * 0.42, s * 0.09, 0, Math.PI * 2);
  g.fill();
  // clouds
  g.fillStyle = 'rgba(255,235,220,0.35)';
  for (const [cx, cy, r] of [[0.2, 0.18, 0.1], [0.35, 0.24, 0.13], [0.5, 0.18, 0.09]] as const) {
    g.beginPath();
    g.ellipse(s * cx, s * cy, s * r, s * r * 0.45, 0, 0, Math.PI * 2);
    g.fill();
  }
  // far mountains
  g.fillStyle = '#3f4a63';
  g.beginPath();
  g.moveTo(0, s * 0.62);
  g.lineTo(s * 0.18, s * 0.42);
  g.lineTo(s * 0.38, s * 0.6);
  g.lineTo(s * 0.58, s * 0.44);
  g.lineTo(s * 0.8, s * 0.63);
  g.lineTo(s, s * 0.52);
  g.lineTo(s, s * 0.62);
  g.closePath();
  g.fill();
  // ground / lake
  const lake = g.createLinearGradient(0, s * 0.62, 0, s);
  lake.addColorStop(0, '#5a6e86');
  lake.addColorStop(1, '#2c3e52');
  g.fillStyle = lake;
  g.fillRect(0, s * 0.62, s, s * 0.38);
  // cabin
  g.fillStyle = '#5b3d2e';
  g.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.26);
  g.fillStyle = '#402a20';
  g.beginPath();
  g.moveTo(s * 0.27, s * 0.43);
  g.lineTo(s * 0.5, s * 0.3);
  g.lineTo(s * 0.73, s * 0.43);
  g.closePath();
  g.fill();
  // door + windows
  g.fillStyle = '#2c1d16';
  g.fillRect(s * 0.46, s * 0.52, s * 0.08, s * 0.16);
  g.fillStyle = '#ffd98a';
  g.fillRect(s * 0.34, s * 0.5, s * 0.07, s * 0.07);
  g.fillRect(s * 0.59, s * 0.5, s * 0.07, s * 0.07);
  // fence
  g.strokeStyle = '#2c1d16';
  g.lineWidth = Math.max(2, s * 0.006);
  for (let i = 0; i < 8; i++) {
    const x = s * (0.1 + i * 0.02);
    g.beginPath();
    g.moveTo(x, s * 0.62);
    g.lineTo(x, s * 0.55);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(s * 0.09, s * 0.57);
  g.lineTo(s * 0.27, s * 0.57);
  g.stroke();
  grain(g, s, 12);
}

function drawMountainScene(g: CanvasRenderingContext2D, s: number) {
  const sky = g.createLinearGradient(0, 0, 0, s * 0.7);
  sky.addColorStop(0, '#1c2440');
  sky.addColorStop(0.6, '#6a5a77');
  sky.addColorStop(1, '#e8b98c');
  g.fillStyle = sky;
  g.fillRect(0, 0, s, s * 0.7);
  // low sun
  g.fillStyle = '#ffdca8';
  g.beginPath();
  g.arc(s * 0.32, s * 0.58, s * 0.075, 0, Math.PI * 2);
  g.fill();
  // ridge layers
  const ridges: Array<[number, string]> = [
    [0.42, '#39455e'],
    [0.5, '#2e3850'],
    [0.58, '#232c40'],
  ];
  for (let i = 0; i < ridges.length; i++) {
    const [top, color] = ridges[i];
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, s);
    const baseY = s * top;
    for (let x = 0; x <= s; x += s * 0.08) {
      const peak = baseY - Math.abs(Math.sin((x / s) * (2 + i) * Math.PI)) * s * (0.16 - i * 0.04);
      g.lineTo(x, peak);
    }
    g.lineTo(s, s);
    g.closePath();
    g.fill();
  }
  // snow caps hint
  g.fillStyle = 'rgba(240,245,255,0.8)';
  g.beginPath();
  g.moveTo(s * 0.6, s * 0.42);
  g.lineTo(s * 0.66, s * 0.5);
  g.lineTo(s * 0.72, s * 0.42);
  g.closePath();
  g.fill();
  // pines in foreground
  g.fillStyle = '#141a28';
  for (let i = 0; i < 5; i++) {
    const x = s * (0.12 + i * 0.19);
    const y = s * 0.95;
    const h = s * (0.18 + 0.02 * (i % 3));
    g.beginPath();
    g.moveTo(x, y - h);
    g.lineTo(x - h * 0.16, y);
    g.lineTo(x + h * 0.16, y);
    g.closePath();
    g.fill();
  }
  g.fillRect(0, s * 0.94, s, s * 0.06);
  grain(g, s, 14);
}

function drawStillLife(g: CanvasRenderingContext2D, s: number) {
  const bg = g.createLinearGradient(0, 0, s, s);
  bg.addColorStop(0, '#4a4038');
  bg.addColorStop(1, '#2a2521');
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  // table
  g.fillStyle = '#6b5140';
  g.fillRect(0, s * 0.68, s, s * 0.32);
  // bowl
  g.fillStyle = '#e8e4dc';
  g.beginPath();
  g.ellipse(s * 0.3, s * 0.72, s * 0.2, s * 0.09, 0, Math.PI, 0);
  g.fill();
  // apples
  for (const [cx, cy, r, color] of [
    [0.26, 0.66, 0.055, '#b8402e'],
    [0.35, 0.66, 0.06, '#c75239'],
    [0.305, 0.615, 0.05, '#9c3325'],
  ] as const) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(s * cx, s * cy, s * r, 0, Math.PI * 2);
    g.fill();
  }
  // bottle
  g.fillStyle = '#3d5a52';
  g.fillRect(s * 0.52, s * 0.42, s * 0.05, s * 0.08);
  g.beginPath();
  g.moveTo(s * 0.48, s * 0.5);
  g.quadraticCurveTo(s * 0.585, s * 0.54, s * 0.585, s * 0.72);
  g.lineTo(s * 0.505, s * 0.72);
  g.quadraticCurveTo(s * 0.505, s * 0.54, s * 0.48, s * 0.5);
  g.fill();
  // book
  g.fillStyle = '#24304d';
  g.save();
  g.translate(s * 0.78, s * 0.72);
  g.rotate(-0.06);
  g.fillRect(-s * 0.13, -s * 0.02, s * 0.26, s * 0.05);
  g.fillStyle = '#d9d3c6';
  g.fillRect(-s * 0.13, s * 0.01, s * 0.26, s * 0.02);
  g.restore();
  grain(g, s, 10);
}

/* ------------------------------------------------------------------ */
/* Presentation + export                                               */
/* ------------------------------------------------------------------ */

export interface RenderOptions {
  /**
   * Model confidence semantics: when true the raw sigmoid value represents
   * "paper/background" (high = keep light). The invert toggle flips it.
   */
  flip: boolean;
  /** 0..200 — 100 is neutral, lower softens, higher sharpens strokes. */
  strength: number;
  mode: 'paper' | 'ink-dark' | 'ink-white';
}

/**
 * Maps sigmoid confidence values [0,1] to an RGBA sketch canvas following
 * the user's presentation settings.
 */
export function renderSketchToCanvas(
  sketch: Float32Array,
  side: number,
  opts: RenderOptions,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(side, side);

  // strength 0 → gamma 2.4 (soft), 100 → gamma 1.0, 200 → gamma 0.45 (crisp)
  const t = (opts.strength - 100) / 100; // -1..1
  const gamma = Math.pow(2.4, -t);

  const paperColor = 245; // warm-ish paper level
  const inkColor = 24;

  for (let i = 0; i < sketch.length; i++) {
    let conf = Math.min(1, Math.max(0, sketch[i]));
    if (opts.flip) conf = 1 - conf;
    if (gamma !== 1) conf = Math.pow(conf, gamma);

    const o = i * 4;
    if (opts.mode === 'paper') {
      const lum = inkColor + (paperColor - inkColor) * conf;
      img.data[o] = lum;
      img.data[o + 1] = lum;
      img.data[o + 2] = Math.min(255, lum + 3); // touch of warmth
      img.data[o + 3] = 255;
    } else {
      // Transparent modes: ink strokes over transparency.
      const alpha = 1 - conf;
      const ink = opts.mode === 'ink-white' ? paperColor : inkColor;
      img.data[o] = ink;
      img.data[o + 1] = ink;
      img.data[o + 2] = opts.mode === 'ink-white' ? paperColor : inkColor;
      img.data[o + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  ctx.clearRect(0, 0, side, side);
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Estimates the output orientation using border statistics: photos usually
 * have region borders that map to the paper/background rather than strokes.
 * Returns true when high confidence == paper (no flip needed).
 */
export function detectOrientation(sketch: Float32Array, side: number): boolean {
  const margin = Math.max(2, Math.round(side * 0.04));
  let sum = 0;
  let n = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x < margin || y < margin || x >= side - margin || y >= side - margin) {
        sum += sketch[y * side + x];
        n++;
      }
    }
  }
  return n > 0 ? sum / n >= 0.5 : true;
}

export function drawCropRegion(bitmap: ImageBitmap, crop: PreparedImage['cropRect'], side = MODEL_TILE): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, side, side);
  return c;
}

export function sketchPngBlob(sketchCanvas: HTMLCanvasElement, scale = 1): Promise<Blob> {
  let out = sketchCanvas;
  if (scale > 1) {
    const up = document.createElement('canvas');
    up.width = sketchCanvas.width * scale;
    up.height = sketchCanvas.height * scale;
    const ctx = up.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sketchCanvas, 0, 0, up.width, up.height);
    out = up;
  }
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shareBlob(blob: Blob, filename: string, text?: string): Promise<'shared' | 'downloaded' | 'unsupported'> {
  try {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    const file = new File([blob], filename, { type: 'image/png' });
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ ...(text ? { text } : {}), files: [file], title: 'My sketch' });
      return 'shared';
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'downloaded'; // user cancelled
  }
  await downloadBlob(blob, filename);
  return 'downloaded';
}
