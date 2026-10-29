import { useCallback, useEffect, useState } from 'react';
import { SAMPLES, renderSampleToBitmap, type SampleImage } from '../lib/imageTools';
import type { SourceImageState } from '../lib/types';
import { CameraCapture } from './CameraCapture';

interface Props {
  image: SourceImageState | null;
  onPicked: (source: Blob | ImageBitmap, name: string) => void;
  onError: (message: string) => void;
  onGenerate: () => void;
  onReset: () => void;
  onClear: () => void;
  canGenerate: boolean;
  running: boolean;
  elapsedMs: number | null;
  note: string | null;
}

export function Workspace({
  image,
  onPicked,
  onError,
  onGenerate,
  onReset,
  onClear,
  canGenerate,
  running,
  elapsedMs,
  note,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Generate sample thumbnails once.
  useEffect(() => {
    let alive = true;
    (async () => {
      const urls: Record<string, string> = {};
      for (const sample of SAMPLES) {
        const bitmap = await renderSampleToBitmap(sample, 96);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        const blob = await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
        );
        urls[sample.id] = URL.createObjectURL(blob);
      }
      if (alive) setThumbs(urls);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const pickFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      onPicked(file, file.name);
    },
    [onPicked],
  );

  const pickSample = useCallback(
    async (sample: SampleImage) => {
      try {
        const bitmap = await renderSampleToBitmap(sample, 1024);
        onPicked(bitmap, `${sample.id}-sample.png`);
      } catch (err) {
        onError(`Could not build the sample scene: ${(err as Error).message}`);
      }
    },
    [onPicked, onError],
  );

  return (
    <section className="card" id="workspace">
      <header className="card__head">
        <h2>
          Image workspace
        </h2>
      </header>
      <div className="card__body">
        {!image && (
          <>
            <div
              className={`dropzone ${dragOver ? 'dropzone--over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFiles(e.dataTransfer.files);
              }}
            >
              <p className="dropzone__title">Drop a photo here</p>
              <p className="muted">JPG · PNG · WebP — processed locally, never uploaded</p>
              <div className="row row--wrap">
                <label className="btn btn--primary">
                  📁 Choose photo
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => pickFiles(e.target.files)}
                    disabled={running}
                  />
                </label>
                <CameraCapture onPicked={onPicked} onError={onError} disabled={running} />
              </div>
            </div>

            <div className="samples">
              <p className="samples__label muted">Or try a sample scene:</p>
              <div className="row row--wrap">
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    className="sample"
                    onClick={() => void pickSample(s)}
                    disabled={running || !thumbs[s.id]}
                    title={s.label}
                  >
                    {thumbs[s.id] ? (
                      <img src={thumbs[s.id]} alt="" width={72} height={72} />
                    ) : (
                      <span className="sample__ph" />
                    )}
                    <span className="sample__label">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {image && (
          <div className="workspace-preview">
            <img className="workspace-preview__img" src={image.previewUrl} alt={image.name} />
            <p className="muted">
              {image.name} · the model sees the center-square crop of this photo — that exact crop becomes the sketch.
            </p>
            <div className="row row--wrap workspace-preview__actions">
              <button className="btn btn--primary" onClick={onGenerate} disabled={!canGenerate}>
                🖌 Generate sketch
              </button>
              <button className="btn btn--secondary" onClick={onClear} disabled={running}>
                Replace photo
              </button>
              <button className="btn btn--ghost" onClick={onReset} disabled={running}>
                Reset
              </button>
            </div>
            {running ? (
              <div className="runningbar" role="status">
                <span className="spinner" aria-hidden />
                Generating… {elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : ''} <span className="muted">(inference can't be interrupted — it finishes in seconds)</span>
              </div>
            ) : (
              note && <p className="muted">{note}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
