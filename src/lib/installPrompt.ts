/**
 * In-app "add to home screen" support.
 *
 * Chromium fires `beforeinstallprompt` once the PWA criteria are met
 * (HTTPS + manifest + service worker); we capture it instead of letting the
 * browser show its own mini-infobar, so the app can install itself from a
 * button the user will actually notice — see the Setup card.
 *
 * iOS Safari never fires that event; there we show written instructions
 * instead (inviteInstallText below).
 */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

export function initInstallCapture(): () => void {
  const handler = (e: Event) => {
    e.preventDefault(); // suppress the default browser prompt
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l(true));
  };
  // Installed from the browser menu (or our own prompt): the captured event
  // is permanently spent, so hide the install row everywhere.
  const installed = () => markInstallFlowDone();
  window.addEventListener('beforeinstallprompt', handler);
  window.addEventListener('appinstalled', installed);
  return () => {
    window.removeEventListener('beforeinstallprompt', handler);
    window.removeEventListener('appinstalled', installed);
  };
}

/** Subscribe to availability changes; the callback runs immediately too. */
export function onInstallable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(deferred != null);
  return () => {
    listeners.delete(cb);
  };
}

/** After a successful/declined native install the prompt is gone. */
export function markInstallFlowDone(): void {
  deferred = null;
  listeners.forEach((l) => l(false));
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (deferred == null) return 'unavailable';
  const evt = deferred;
  // A beforeinstallprompt event can only be prompted once. Consume it up
  // front: re-tapping after a dismissal used to throw InvalidStateError as an
  // unhandled rejection and leave a dead "Install" button on screen.
  markInstallFlowDone();
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** True when the app is already running as an installed home-screen app. */
export function isStandalone(): boolean {
  const navAbove = window.matchMedia?.('(display-mode: standalone)').matches;
  const navIOS =
    'standalone' in window.navigator &&
    Boolean((window.navigator as { standalone?: boolean }).standalone); // iOS Safari
  return Boolean(navAbove || navIOS);
}

/** iOS/iPadOS detection — the only family that needs manual instructions. */
export function isAppleMobile(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
