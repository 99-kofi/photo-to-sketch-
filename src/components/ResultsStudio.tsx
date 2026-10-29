import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  drawCropRegion,
  renderSketchToCanvas,
  sketchPngBlob,
  downloadBlob,
  shareBlob,
  detectOrientation,
  type RenderOptions,
} from '../lib/imageTools';
import type { SketchResult, SourceImageState } from '../lib/types';

interface Props {
  image: SourceImageState;
  result: SketchResult;
  renderOptions: RenderOptions;
  onRenderOptionsChange: (next: RenderOptions) => void;
  notify: (message: string, kind: 'error' | 'info' | 'success') => void;
  onNextPhoto: () => void;
  onRegenerate: () => void;
  busy: boolean;
}

type ViewMode = 'slider' | 'side' | 'sketch';

const ZOOMS = [1, 1.5, 2, 3, 4];
const SCALES: Array<{ value: 1 | 2 | 4; label: string }> = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
];

function paintInto(ref: React.RefObject<HTMLCanvasElement | null>, src: HTMLCanvasElement | null) {
  const el = ref.current;
  if (!el) return;
  if (src) {
    el.width = src.width;
    el.height = src.height;
    el.getContext('2d')!.drawImage(src, 0, 0);
  } else {
    el.width = 0;
    el.height = 0;
  }
}

export function ResultsStudio({
  image,
  result,
  renderOptions,
  onRenderOptionsChange,
  notify,
  onNextPhoto,
  onRegenerate,
  busy,
}: Props) {
  const [view, setView] = useState<ViewMode>('slider');
  const [sliderPct, setSliderPct] = useState(50);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [exportScale, setExportScale] = useState<1 | 2 | 4>(1);

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sketchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);

  const front = useMemo(
    () => drawCropRegion(image.prepared.bitmap, image.prepared.cropRect, result.side),
    [image, result.side],
  );

  // Paper/background orientation: auto-detected per result, user-flippable.
  // detectOrientation returns `true` when high confidence already means paper
  // (nothing to invert); the renderer flips when `flip` is set, so the default
  // is its inverse.
  const detected = useMemo(() => detectOrientation(result.sketch, result.side), [result]);
  const [flipOverride, setFlipOverride] = useState<boolean | null>(null);
  useEffect(() => setFlipOverride(null), [detected]);
  const flip = flipOverride ?? !detected;

  const back = useMemo(
    () => renderSketchToCanvas(result.sketch, result.side, { ...renderOptions, flip }),
    [result, renderOptions, flip],
  );

  useEffect(() => {
    paintInto(origCanvasRef, view === 'sketch' ? null : front);
    paintInto(sketchCanvasRef, back);
  }, [front, back, view]);

  const zoom = ZOOMS[zoomIdx];
  useEffect(() => setPan({ x: 0, y: 0 }), [zoom, view]);

  const draggingSlider = useRef(false);
  const draggingPan = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);

  const onSliderMove = useCallback((clientX: number) => {
    const el = areaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSliderPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (draggingSlider.current && e.isPrimary) onSliderMove(e.clientX);
      if (draggingPan.current && draggingPan.current.id === e.pointerId) {
        e.preventDefault();
        setPan({
          x: draggingPan.current.px + (e.clientX - draggingPan.current.x) / zoom,
          y: draggingPan.current.py + (e.clientY - draggingPan.current.y) / zoom,
        });
      }
    };
    const up = () => {
      draggingSlider.current = false;
      draggingPan.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onSliderMove, zoom]);

  const exportPng = async () => {
    try {
      const blob = await sketchPngBlob(back, exportScale);
      const name = `sketch-${Date.now() % 100000}.png`;
      await downloadBlob(blob, name);
      notify(`Sketch saved — ${name} at ${result.side * exportScale}px`, 'success');
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, 'error');
    }
  };

  const sharePng = async () => {
    try {
      const blob = await sketchPngBlob(back, 1);
      const outcome = await shareBlob(blob, 'sketch.png', 'Made with Sketch Studio — on-device photo to sketch');
      if (outcome === 'shared') notify('Shared ✓', 'success');
    } catch (err) {
      notify(`Sharing failed: ${(err as Error).message}`, 'error');
    }
  };

  const zoomable = zoom > 1;
  const renderOptionsWithFlip: RenderOptions = { ...renderOptions, flip };

  return (
    <section className="card" id="results">
      <header className="card__head">
        <h2>
          Results studio
        </h2>
        <div className="seg" role="tablist" aria-label="View mode">
          {(
            [
              ['slider', 'Compare'],
              ['side', 'Side by side'],
              ['sketch', 'Sketch'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              role="tab"
              aria-selected={view === mode}
              className={`seg__btn ${view === mode ? 'seg__btn--on' : ''}`}
              onClick={() => setView(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="card__body">
        <div
          className={`stage ${zoomable ? 'stage--pannable' : ''}`}
          ref={areaRef}
          onPointerDown={(e) => {
            if (view === 'slider' && !zoomable) {
              draggingSlider.current = true;
              onSliderMove(e.clientX);
            } else if (zoomable) {
              draggingPan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            }
          }}
        >
          {view === 'slider' && (
            <div
              className="compare"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
              <canvas className="compare__layer" ref={origCanvasRef} />
              <div className="compare__clip" style={{ clipPath: `inset(0 0 0 ${sliderPct}%)` }}>
                <canvas className="compare__layer" ref={sketchCanvasRef} />
              </div>
              <div className="compare__handle" style={{ left: `${sliderPct}%` }}>
                <span />
              </div>
              <span className="compare__tag compare__tag--l">Photo</span>
              <span className="compare__tag compare__tag--r">Sketch</span>
            </div>
          )}
          {view === 'side' && (
            <div className="sidebyside" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <canvas className="compare__layer" ref={origCanvasRef} />
              <canvas className="compare__layer" ref={sketchCanvasRef} />
            </div>
          )}
          {view === 'sketch' && (
            <div className="solo" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <canvas className="compare__layer" ref={sketchCanvasRef} />
            </div>
          )}
        </div>

        <div className="row row--wrap row--between studio-tools">
          <div className="row row--wrap">
            <button
              className="btn btn--ghost"
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              disabled={zoomIdx === 0}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="muted zoom-label">
              {zoom}× {zoomable ? '· drag to pan' : ''}
            </span>
            <button
              className="btn btn--ghost"
              onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
              disabled={zoomIdx === ZOOMS.length - 1}
              aria-label="Zoom in"
            >
              ＋
            </button>
            <button
              className={`btn btn--ghost ${flipOverride !== null ? 'btn--active' : ''}`}
              onClick={() => setFlipOverride((f) => (f === null ? detected : !f))}
              title="Flip the light/dark interpretation of the result"
            >
              ⇅ Flip
            </button>
          </div>
        </div>

        <div className="controls-grid">
          <label className="control">
            <span>Curve strength</span>
            <input
              type="range"
              min={0}
              max={200}
              step={10}
              value={renderOptionsWithFlip.strength}
              onChange={(e) => onRenderOptionsChange({ ...renderOptions, strength: Number(e.target.value) })}
            />
            <span className="muted control__value">{renderOptions.strength}</span>
          </label>
          <label className="control">
            <span>Output style</span>
            <select
              value={renderOptions.mode}
              onChange={(e) => onRenderOptionsChange({ ...renderOptions, mode: e.target.value as RenderOptions['mode'] })}
            >
              <option value="paper">Paper (light)</option>
              <option value="ink-dark">Ink on transparent (dark)</option>
              <option value="ink-white">Ink on transparent (white)</option>
            </select>
          </label>
        </div>

        <div className="row row--wrap row--between">
          <div className="row row--wrap">
            <button className="btn btn--secondary" onClick={onRegenerate} disabled={busy}>
              ↻ Generate again
            </button>
            <button className="btn btn--primary" onClick={onNextPhoto} disabled={busy}>
              ＋ New photo
            </button>
          </div>
          <div className="row row--wrap">
            <button className="btn btn--secondary" onClick={() => void sharePng()}>
              ↗ Share
            </button>
            <span className="png-export">
              <button className="btn btn--primary" onClick={() => void exportPng()} disabled={busy}>
                ⤓ PNG
              </button>
              <select
                value={exportScale}
                onChange={(e) => setExportScale(Number(e.target.value) as 1 | 2 | 4)}
                aria-label="Export resolution"
              >
                {SCALES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} ({result.side * s.value}px)
                  </option>
                ))}
              </select>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
