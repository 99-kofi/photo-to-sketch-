import { useEffect, useRef, useState } from 'react';

interface Props {
  onPicked: (source: Blob | ImageBitmap, name: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function CameraCapture({ onPicked, onError, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [mirrored, setMirrored] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 2048 }, height: { ideal: 2048 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMirrored((stream.getVideoTracks()[0]?.getSettings().facingMode ?? 'environment') === 'user');
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        onError(`Camera unavailable: ${(err as Error).message}. You can still pick a photo instead.`);
        setOpen(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onError]);

  const close = () => setOpen(false);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    if (mirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onPicked(blob, 'camera-capture.png');
    }, 'image/png');
    close();
  };

  return (
    <>
      <button className="btn btn--secondary" onClick={() => setOpen(true)} disabled={disabled}>
        📷 Camera
      </button>
      {open && (
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
              <button className="btn btn--primary" onClick={capture}>
                Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
