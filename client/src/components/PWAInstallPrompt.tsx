import { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    // Check if already installed as PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Check if already dismissed in this session
    const wasDismissed = sessionStorage.getItem('pwa-prompt-dismissed');
    if (wasDismissed) return;

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    if (ios) {
      // Show iOS install guide after a short delay
      const t = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(t);
    }

    // Handle Android/Desktop install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowBanner(true), 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setInstallPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIOSGuide(false);
    setDismissed(true);
    sessionStorage.setItem('pwa-prompt-dismissed', '1');
  };

  if (dismissed || !showBanner) return null;

  // iOS Guide
  if (isIOS && showIOSGuide) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 p-4 safe-area-inset-bottom">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-5 max-w-sm mx-auto">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              <p className="font-bold text-sm text-foreground">Instalar VivaFrutaz no iPhone</p>
            </div>
            <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="font-bold text-primary">1.</span> Toque em <strong>Compartilhar</strong> (ícone de seta para cima) no Safari</li>
            <li className="flex gap-2"><span className="font-bold text-primary">2.</span> Role para baixo e toque em <strong>"Adicionar à Tela de Início"</strong></li>
            <li className="flex gap-2"><span className="font-bold text-primary">3.</span> Toque em <strong>Adicionar</strong> para confirmar</li>
          </ol>
          <button
            onClick={handleDismiss}
            className="mt-4 w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
          >
            Entendido
          </button>
        </div>
      </div>
    );
  }

  // iOS Banner (before guide)
  if (isIOS) {
    return (
      <div className="fixed inset-x-0 bottom-20 z-50 px-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 max-w-sm mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground leading-tight">Instalar VivaFrutaz</p>
            <p className="text-xs text-muted-foreground mt-0.5">Adicione à tela inicial do celular</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowIOSGuide(true)}
              data-testid="button-pwa-install"
              className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold"
            >
              Como?
            </button>
            <button onClick={handleDismiss} className="p-2 text-muted-foreground hover:text-foreground rounded-xl">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Android/Desktop Banner
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 px-4 md:bottom-6 md:left-auto md:right-6 md:inset-x-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 max-w-sm flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight">Instalar VivaFrutaz</p>
          <p className="text-xs text-muted-foreground mt-0.5">Use como aplicativo no celular</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleInstall}
            data-testid="button-pwa-install"
            className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold whitespace-nowrap"
          >
            Instalar
          </button>
          <button onClick={handleDismiss} className="p-2 text-muted-foreground hover:text-foreground rounded-xl">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
