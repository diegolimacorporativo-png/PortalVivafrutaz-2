import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Building2, Package, ShoppingCart, ScrollText, Receipt, FolderOpen, UserCog, X, Loader2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';

interface SearchResult {
  id: number | string;
  label: string;
  sublabel?: string;
  href: string;
  category: string;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
}

const CATEGORY_ICONS: Record<string, any> = {
  'Clientes': Building2,
  'Produtos': Package,
  'Pedidos': ShoppingCart,
  'Contratos': ScrollText,
  'Notas Fiscais': Receipt,
  'Categorias': FolderOpen,
  'Usuários': UserCog,
};

const CATEGORY_ORDER = ['Clientes', 'Produtos', 'Pedidos', 'Contratos', 'Notas Fiscais', 'Categorias', 'Usuários'];

export function GlobalSearch() {
  const { isStaff } = useAuth();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();

  const fetchResults = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' });
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data.results || []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => fetchResults(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, fetchResults]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  if (!isStaff) return null;

  const grouped: Record<string, SearchResult[]> = {};
  results.forEach(r => {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  });

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery('');
    navigate(href);
  };

  const hasResults = results.length > 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md" data-testid="global-search-container">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          data-testid="input-global-search"
          placeholder="Buscar empresas, produtos, pedidos... (Ctrl+K)"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-9 pr-9 py-2 text-sm bg-muted/50 border border-border/50 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
        )}
      </div>

      {open && query.trim() && (
        <div
          className="absolute top-full mt-2 left-0 right-0 bg-card border border-border/50 rounded-xl shadow-lg shadow-black/10 z-50 max-h-[480px] overflow-y-auto"
          data-testid="search-results-dropdown"
        >
          {!loading && !hasResults && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Nenhum resultado encontrado para "<strong>{query}</strong>"
            </div>
          )}

          {hasResults && (
            <div className="py-2">
              {CATEGORY_ORDER.filter(cat => grouped[cat]?.length).map(cat => {
                const Icon = CATEGORY_ICONS[cat] || Search;
                return (
                  <div key={cat}>
                    <div className="px-4 py-1.5 flex items-center gap-2">
                      <Icon className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{cat}</span>
                    </div>
                    {grouped[cat].map(item => (
                      <button
                        key={`${cat}-${item.id}`}
                        type="button"
                        data-testid={`search-result-${cat.toLowerCase().replace(' ', '-')}-${item.id}`}
                        onClick={() => handleSelect(item.href)}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors flex items-start gap-3 group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {item.label}
                          </p>
                          {item.sublabel && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{item.sublabel}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 mt-0.5 shrink-0 hidden sm:block">{cat}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="px-4 py-2 border-t border-border/50">
                <p className="text-[10px] text-muted-foreground text-center">{results.length} resultado{results.length !== 1 ? 's' : ''} encontrado{results.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
