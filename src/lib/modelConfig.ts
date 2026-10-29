/** Central configuration for the on-device sketch model + runtime. */

export const MODEL_REPO = 'Willie999/photo-to-sketch-onnx';
export const MODEL_REVISION = 'bd0c2896cd5fb31414fb22e95b3108958f3fe8d0';
export const MODEL_FILE = 'model.onnx';

/** Resolving the anchor against a pinned revision keeps downloads reproducible. */
export const MODEL_URL = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${MODEL_FILE}`;

/** Verified on first release: `content-range` + `X-Linked-Size` from the CDN. */
export const MODEL_SIZE = 124_161_028;
export const MODEL_SHA256 = 'a4f32f965dd609c5eca8de0fcc21b7645714f671dc864b47adfc8061ada8bf49';

/** U-Net I/O contract (opset 17). */
export const MODEL_INPUT = 'image';
export const MODEL_OUTPUT = 'sketch';
export const MODEL_INPUT_DIMS = [1, 3, 256, 256] as const;
export const MODEL_TILE = 256;

/**
 * In dev we serve the model from `public/models/` so it does not have to be
 * re-downloaded on every cache clear while iterating.
 */
export function modelUrl(): string {
  return import.meta.env.DEV ? `${import.meta.env.BASE_URL}models/${MODEL_FILE}` : MODEL_URL;
}

export const RUNTIME_PATH = `${import.meta.env.BASE_URL}ort/`;

/** Rough minimum space needed: model + parts doubling during assembly. */
export const MIN_FREE_SPACE = MODEL_SIZE * 2.2;

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes == null || !isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
