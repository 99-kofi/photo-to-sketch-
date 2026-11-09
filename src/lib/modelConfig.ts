/** Central configuration for the on-device sketch model + runtime. */

export const MODEL_REPO = 'Willie999/photo-to-sketch-onnx';
export const MODEL_REVISION = 'bd0c2896cd5fb31414fb22e95b3108958f3fe8d0';

/**
 * We ship a float16 conversion of the U-Net. It is committed with the app so
 * it is served same-origin (no CORS flakiness) at half the fp32 size — both
 * the download and the resident session memory drop ~50%, which keeps
 * memory-constrained devices (phones, small laptops) from OOM-crashing.
 * Verified equivalent to the fp32 original: output max diff 0.00065.
 */
export const MODEL_FILE = 'model.fp16.onnx';
export const MODEL_SIZE = 62_111_066;
export const MODEL_SHA256 = 'c63008f085f5b36511ecfacdce586116f3b632c08bcca68c8197d42529739983';

/** Original fp32 upstream (kept for provenance / future fallback). */
export const MODEL_FILE_FP32 = 'model.onnx';
export const MODEL_SIZE_FP32 = 124_161_028;
export const MODEL_SHA256_FP32 = 'a4f32f965dd609c5eca8de0fcc21b7645714f671dc864b47adfc8061ada8bf49';
export const MODEL_URL_FP32 = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${MODEL_FILE_FP32}`;

/**
 * The fp16 file lives in `public/models/`, committed with the repo, so both
 * dev and production fetch it same-origin.
 */
export function modelUrl(): string {
  return `${import.meta.env.BASE_URL}models/${MODEL_FILE}`;
}

/** U-Net I/O contract (opset 17). */
export const MODEL_INPUT = 'image';
export const MODEL_OUTPUT = 'sketch';
export const MODEL_INPUT_DIMS = [1, 3, 256, 256] as const;
export const MODEL_TILE = 256;

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
