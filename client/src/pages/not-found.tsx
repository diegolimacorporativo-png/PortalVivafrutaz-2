import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const LEGACY_OS_PATHS = ['/os', '/ordem-servico', '/ordemServico', '/service-order', '/serviceOrder'];

function isLegacyOsPath(path: string): boolean {
  return LEGACY_OS_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

export default function NotFound() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isStaff } = useAuth();
  const [countdown, setCountdown] = useState(5);

  const isOldOsPath = isLegacyOsPath(location);
  const redirectTarget = isOldOsPath
    ? (isStaff ? '/admin/tasks' : '/admin/tasks')
    : (isAuthenticated ? (isStaff ? '/admin' : '/client') : '/login');

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer);
          setLocation(redirectTarget);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [redirectTarget, setLocation]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="w-20 h-20 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto text-4xl">
          {isOldOsPath ? '🔄' : '🔍'}
        </div>

        {/* Message */}
        <div>
          {isOldOsPath ? (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Módulo atualizado</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Essa página foi atualizada para o novo módulo de <strong>Tarefas</strong>.
                <br />Você será redirecionado automaticamente em <span className="font-bold text-primary">{countdown}s</span>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-2">Página não encontrada</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                A página que você tentou acessar não existe ou foi movida.
                <br />Redirecionando em <span className="font-bold text-primary">{countdown}s</span>...
              </p>
            </>
          )}
        </div>

        {/* Path info */}
        <div className="bg-muted/50 rounded-lg px-4 py-2 text-xs text-muted-foreground font-mono">
          {location}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => window.history.back()} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
          <Button onClick={() => setLocation(redirectTarget)} className="gap-2">
            <Home className="w-4 h-4" />
            {isOldOsPath ? 'Ir para Tarefas' : 'Ir para Início'}
          </Button>
        </div>
      </div>
    </div>
  );
}
