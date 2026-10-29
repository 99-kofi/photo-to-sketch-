import type { EngineReady } from './engineClient';
import type { ModelMeta } from './modelStore';
import type { PreparedImage } from './imageTools';

export type ModelState =
  | { stage: 'checking' }
  | { stage: 'missing' }
  | { stage: 'downloading'; received: number; total: number; error: string | null }
  | { stage: 'error'; message: string }
  | { stage: 'ready'; meta: ModelMeta };

export interface SourceImageState {
  prepared: PreparedImage;
  /** object URL for <img> display */
  previewUrl: string;
  name: string;
}

export interface EngineState {
  status: 'idle' | 'loading' | 'ready';
  info: EngineReady | null;
  error: string | null;
}

export interface RunInfo {
  backend: string;
  runMs: number;
  at: number;
}

export interface SketchResult {
  sketch: Float32Array;
  side: number;
  run: RunInfo;
}

export interface DiagnosticsData {
  online: boolean;
  swActive: boolean;
  storageQuota: number | null;
  storageUsage: number | null;
  persisted: boolean;
  modelMeta: ModelMeta | null;
  engine: EngineState;
  lastRun: RunInfo | null;
  webgpuAvailable: boolean;
  crossOriginIsolated: boolean;
}
