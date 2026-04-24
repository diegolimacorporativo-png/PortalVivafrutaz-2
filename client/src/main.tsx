import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

(window as any).APP_NAME = "VivaFrutaz";

// ── Global error handlers ─────────────────────────────────────────────────────
const _reportedErrors = new Set<string>();
function reportError(message: string, source?: string) {
  const key = `${source}:${message}`;
  if (_reportedErrors.has(key)) return;
  _reportedErrors.add(key);
  setTimeout(() => _reportedErrors.delete(key), 10000);
  try {
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'FRONTEND_RUNTIME_ERROR',
        description: `[${source || window.location.pathname}] ${message}`,
        level: 'ERROR',
      }),
    }).catch(() => {});
  } catch {}
}

window.addEventListener('error', (event) => {
  if (event.filename?.includes('extension') || event.filename?.includes('chrome-extension')) return;
  reportError(`Uncaught: ${event.message} @ ${event.filename}:${event.lineno}`, 'window.error');
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason) || 'Promise rejection';
  reportError(`UnhandledRejection: ${msg}`, 'unhandledrejection');
});

// Service Worker: in development, clear stale caches and re-register
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {}
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
