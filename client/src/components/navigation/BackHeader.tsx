import { useCallback } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BackHeaderBreadcrumb {
  label: string;
  href?: string;
}

interface BackHeaderProps {
  fallback?: string;
  breadcrumb?: BackHeaderBreadcrumb[];
  sticky?: boolean;
  preserveSearch?: boolean;
  className?: string;
}

export function BackHeader({
  fallback = "/admin",
  breadcrumb,
  sticky = false,
  preserveSearch = false,
  className,
}: BackHeaderProps) {
  const [, navigate] = useLocation();

  const handleBack = useCallback(() => {
    const hasHistory = window.history.length > 1;
    const sameOrigin =
      !!document.referrer &&
      document.referrer.startsWith(window.location.origin);

    if (hasHistory && (sameOrigin || !fallback)) {
      window.history.go(-1);
    } else {
      const target = preserveSearch
        ? `${fallback}${window.location.search}`
        : fallback;
      navigate(target);
    }
  }, [navigate, fallback, preserveSearch]);

  return (
    <nav
      data-testid="back-header"
      className={cn(
        "flex items-center gap-1.5 pb-4 mb-6 border-b border-border/40 flex-wrap",
        sticky && "sticky top-0 z-20 bg-background pt-3 -mx-6 px-6",
        className
      )}
      aria-label="Navegação de retorno"
    >
      <button
        type="button"
        onClick={handleBack}
        data-testid="button-back"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted/50 -ml-2 shrink-0"
        aria-label="Voltar"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Voltar</span>
      </button>

      {breadcrumb && breadcrumb.length > 0 && (
        <>
          <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {item.href ? (
                <Link
                  href={item.href}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
                  data-testid={`breadcrumb-link-${i}`}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className="text-sm text-foreground font-medium truncate"
                  data-testid={`breadcrumb-page-${i}`}
                >
                  {item.label}
                </span>
              )}
              {i < breadcrumb.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              )}
            </span>
          ))}
        </>
      )}
    </nav>
  );
}
