import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || 'Erro desconhecido' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const page = this.props.pageName || window.location.pathname;
    console.error(`[ErrorBoundary][${page}] Erro capturado:`, error, info);
    try {
      fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'FRONTEND_ERROR',
          description: `[${page}] ${error?.message || 'Erro desconhecido'} | Stack: ${info?.componentStack?.split('\n')?.[1]?.trim() || '?'}`,
          level: 'ERROR',
        }),
      }).catch(() => {});
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      const isPage = !!this.props.pageName;
      return (
        <div className={`flex items-center justify-center p-6 ${isPage ? 'min-h-[60vh]' : 'min-h-screen bg-background'}`}>
          <div className="max-w-md w-full text-center space-y-5">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Ocorreu um erro inesperado</h2>
              {this.props.pageName && (
                <p className="text-xs text-muted-foreground mb-1 font-mono bg-muted px-2 py-0.5 rounded inline-block">
                  Tela: {this.props.pageName}
                </p>
              )}
              <p className="text-muted-foreground text-sm mt-2">
                Nossa equipe já foi notificada. Tente recarregar a página. Se o problema persistir, entre em contato: <strong>11 99411-3911</strong>
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  if (!isPage) {
                    window.location.reload();
                  } else {
                    this.setState({ hasError: false, errorMessage: '' });
                  }
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors text-sm"
                data-testid="button-error-retry"
              >
                <RefreshCw className="w-4 h-4" /> Tentar novamente
              </button>
              {isPage && (
                <button
                  onClick={() => { window.location.href = '/admin/dashboard'; }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-foreground font-bold rounded-xl hover:bg-muted transition-colors text-sm"
                  data-testid="button-error-home"
                >
                  <Home className="w-4 h-4" /> Ir para o início
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Thin page-level wrapper ────────────────────────────────────────────────
export function PageBoundary({ children, name }: { children: ReactNode; name: string }) {
  return <ErrorBoundary pageName={name}>{children}</ErrorBoundary>;
}
