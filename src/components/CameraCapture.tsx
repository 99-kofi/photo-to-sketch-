import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onPicked: (source: Blob | ImageBitmap, name: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

/** Long edge of the captured frame. More than enough for a 256px crop + preview. */
const MAX_CAPTURE_EDGE = 2048;
/** How long to wait for the first camera frame after opening the shutter. */
const FIRST_FRAME_TIMEOUT_MS = 4000;

function dataUrlToBlob(dataUrl: string): Blob | null {
  const [head, b64] = dataUrl.split(',');
  if (!head || !b64) return null;
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Encode a canvas without ever hanging or failing silently: some mobile
 * browsers return null (or never call back) for large PNG encodes.
 */
function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      resolve(blob);
    };
    try {
      canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.92);
    } catch {
      done(null);
    }
    // Fallback if the callback never fires (older mobile WebViews).
    window.setTimeout(() => done(null), 6000);
  });
}

export function CameraCapture({ onPicked, onError, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  /** The video has produced a real frame — Capture is meaningful. */
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let poll = 0;
    setReady(false);
    setBusy(false);

    // Mobile browsers are inconsistent about which media event signals the
    // first painted frame, so accept all of them and poll as a backstop.
    const markReady = () => {
      if (!cancelled && video.videoWidth > 0) setReady(true);
    };
    const MEDIA_EVENTS = ['loadedmetadata', 'loadeddata', 'canplay', 'playing'] as const;
    MEDIA_EVENTS.forEach((ev) => video.addEventListener(ev, markReady));

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('camera access needs HTTPS and a modern browser');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 2048 }, height: { ideal: 2048 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        track?.addEventListener('ended', () => {
          if (!cancelled) {
            onError('The camera was turned off or taken over by another app.');
            setOpen(false);
          }
        });
        setMirrored((track?.getSettings().facingMode ?? '') === 'user');

        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          // AbortError means the modal closed mid-start — benign.
          if (!cancelled && (err as Error)?.name !== 'AbortError') throw err;
        }
        markReady();

        const startedAt = Date.now();
        poll = window.setInterval(() => {
          if (cancelled) return;
          if (video.videoWidth > 0) {
            setReady(true);
            window.clearInterval(poll);
          } else if (Date.now() - startedAt > 8000) {
            window.clearInterval(poll);
          }
        }, 250);
      } catch (err) {
        if (cancelled) return;
        onError(`Camera unavailable: ${(err as Error).message}. You can still pick a photo instead.`);
        setOpen(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      MEDIA_EVENTS.forEach((ev) => video.removeEventListener(ev, markReady));
      video.pause();
      video.srcObject = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onError]);

  const close = useCallback(() => setOpen(false), []);

  // The dialog is portalled to <body>: any ancestor with backdrop-filter
  // (the glass cards) becomes the containing block for position:fixed
  // descendants, which pinned the "fullscreen" modal inside the card and
  // pushed the shutter button off-screen on short/landscape phones.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      // Cameras (especially on mobile) can take a moment to deliver frame 1.
      // Wait briefly instead of silently doing nothing.
      if (video.videoWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          const finish = (fn: () => void) => {
            window.clearTimeout(timer);
            video.removeEventListener('loadedmetadata', onFrame);
            video.removeEventListener('playing', onFrame);
            fn();
          };
          const onFrame = () => {
            if (video.videoWidth > 0) finish(resolve);
          };
          const timer = window.setTimeout(
            () => finish(() => reject(new Error('the camera is still starting'))),
            FIRST_FRAME_TIMEOUT_MS,
          );
          video.addEventListener('loadedmetadata', onFrame);
          video.addEventListener('playing', onFrame);
        });
      }
      // The modal may have been closed while we waited.
      if (videoRef.current !== video) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) throw new Error('the camera did not deliver a frame');

      // Cap the resolution: 12 MP sensors would otherwise allocate enormous
      // canvases that some mobile browsers fail to encode at all.
      const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(vw, vh));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2D is unavailable');
      if (mirrored) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);

      const blob =
        (await encodeCanvas(canvas)) ?? dataUrlToBlob(canvas.toDataURL('image/jpeg', 0.92));
      if (!blob || blob.size === 0) throw new Error('the photo could not be encoded');

      onPicked(blob, 'camera-capture.jpg');
      setOpen(false);
    } catch (err) {
      onError(`Could not take the photo: ${(err as Error).message}. Try again, or pick one from your gallery.`);
    } finally {
      setBusy(false);
    }
  }, [busy, mirrored, onError, onPicked]);

  return (
    <>
      <button className="btn btn--secondary" onClick={() => setOpen(true)} disabled={disabled}>
        📷 Camera
      </button>
      {open &&
        createPortal(
          <div className="modal" role="dialog" aria-modal="true" aria-label="Camera capture">
            <div className="modal__panel">
              <header className="modal__head">
                <h3>Take a photo</h3>
                <button className="btn btn--ghost" onClick={close} aria-label="Close camera">
                  ✕
                </button>
              </header>
              <div className={`camera ${mirrored ? 'camera--mirror' : ''}`}>
                <video ref={videoRef} playsInline muted autoPlay />
              </div>
              <div className="camera__actions">
                <button
                  className="btn btn--primary"
                  onClick={() => void capture()}
                  disabled={!ready || busy}
                  aria-busy={busy}
                >
                  {busy ? 'Saving…' : ready ? 'Capture' : 'Starting camera…'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
