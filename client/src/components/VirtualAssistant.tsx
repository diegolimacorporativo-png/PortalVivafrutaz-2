import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle, X, Send, Bot, User, Clock, RefreshCw, ChevronRight,
  Loader2, Download, ArrowLeft, FileSpreadsheet, TrendingUp, Package,
  Truck, ShoppingCart, AlertTriangle, Users, BarChart3, Plus, CheckSquare,
  Building2, Leaf, Search, HelpCircle, Sparkles, Link2, Receipt, Tag, Globe
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';

interface Message {
  id: number;
  from: 'bot' | 'user';
  text: string;
  timestamp: Date;
  isError?: boolean;
  downloadUrl?: string;
}

interface SessionContext {
  action?: string;
  step?: string;
  data?: Record<string, any>;
}

function renderMarkdown(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isBot = msg.from === 'bot';
  return (
    <div className={`flex items-start gap-2 ${isBot ? '' : 'flex-row-reverse'}`}>
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isBot ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
        {isBot ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>
      <div className="flex flex-col gap-2 max-w-[80%]">
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isBot
            ? msg.isError
              ? 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:text-red-400'
              : 'bg-muted text-foreground'
            : 'bg-primary text-primary-foreground'
        }`}>
          {isBot ? renderMarkdown(msg.text) : msg.text}
        </div>
        {msg.downloadUrl && (
          <a
            href={msg.downloadUrl}
            download
            data-testid="button-download-export"
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-semibold hover:bg-green-700 transition-colors w-fit"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar Excel
          </a>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-full flex-shrink-0 bg-primary/10 text-primary flex items-center justify-center">
        <Bot className="w-4 h-4" />
      </div>
      <div className="bg-muted rounded-2xl px-4 py-3 flex items-center gap-1.5">
        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// Panel shortcuts — grouped
const PANEL_SECTIONS_ADMIN = [
  {
    title: '📦 Pedidos & Clientes',
    items: [
      { label: 'Pedidos hoje', icon: Package, message: 'Como está o movimento de pedidos hoje?' },
      { label: 'Pendentes', icon: Clock, message: 'Quais pedidos estão pendentes?' },
      { label: 'Sem pedido', icon: AlertTriangle, message: 'Quais empresas ainda não fizeram pedido nesta semana?' },
      { label: 'Clientes em risco', icon: Users, message: 'Analisar clientes em risco' },
    ],
  },
  {
    title: '📊 Inteligência',
    items: [
      { label: 'Faturamento', icon: TrendingUp, message: 'Prever faturamento deste mês' },
      { label: 'Top clientes', icon: BarChart3, message: 'Ranking de clientes por faturamento' },
      { label: 'Logística', icon: Truck, message: 'Analisar logística e agenda de entregas' },
      { label: 'Eficiência', icon: CheckSquare, message: 'Eficiência do sistema' },
    ],
  },
  {
    title: '📤 Exportar Dados',
    items: [
      { label: 'Pedidos da semana', icon: FileSpreadsheet, message: 'Exportar pedidos da semana', isExport: true, exportParams: 'type=orders&period=week' },
      { label: 'Pedidos do mês', icon: FileSpreadsheet, message: 'Exportar pedidos do mês', isExport: true, exportParams: 'type=orders&period=month' },
      { label: 'Faturamento do mês', icon: FileSpreadsheet, message: 'Exportar faturamento do mês', isExport: true, exportParams: 'type=financial&period=month' },
      { label: 'Faturamento do mês passado', icon: FileSpreadsheet, message: 'Exportar faturamento do mês passado', isExport: true, exportParams: 'type=financial&period=lastmonth' },
    ],
  },
  {
    title: '⚙️ Operacional',
    items: [
      { label: 'Estoque baixo', icon: AlertTriangle, message: 'Quais produtos estão com estoque baixo?' },
      { label: 'Lista de compras', icon: ShoppingCart, message: 'Lista de compras da semana' },
      { label: 'Nova tarefa', icon: CheckSquare, message: 'Criar tarefa' },
      { label: 'Criar empresa', icon: Plus, message: 'Adicionar nova empresa no sistema' },
    ],
  },
  {
    title: '❓ Perguntas Rápidas',
    items: [
      { label: 'Escopo contratual', icon: Link2, message: 'Como funciona o escopo contratual?' },
      { label: 'Gerar NF', icon: Receipt, message: 'Como gerar uma nota fiscal?' },
      { label: 'Cadastrar produto', icon: Package, message: 'Como cadastrar um novo produto?' },
      { label: 'Custo médio', icon: TrendingUp, message: 'Como funciona o cálculo de custo médio?' },
      { label: 'Exportar Bling', icon: Globe, message: 'Como exportar notas fiscais para o Bling?' },
      { label: 'ID de produto', icon: Tag, message: 'Como funciona o ID de produto base?' },
    ],
  },
];

const PANEL_SECTIONS_CLIENT = [
  {
    title: '📦 Meus Pedidos',
    items: [
      { label: 'Ver meus pedidos', icon: Package, message: 'Como estão meus pedidos?' },
      { label: 'Previsão de entrega', icon: Truck, message: 'Qual a previsão de entrega?' },
      { label: 'Suporte', icon: Users, message: 'Como entrar em contato com o suporte?' },
    ],
  },
  {
    title: '📋 Meu Contrato',
    items: [
      { label: 'Meu escopo', icon: Link2, message: 'Quais produtos recebo no meu contrato?' },
      { label: 'Dias de entrega', icon: Truck, message: 'Em quais dias recebo entregas?' },
      { label: 'Alterar escopo', icon: Sparkles, message: 'Como solicitar alteração de escopo?' },
      { label: 'Falar com equipe', icon: HelpCircle, message: 'Como falar com o atendimento?' },
    ],
  },
];

let msgId = 1;
const nextId = () => msgId++;

const INITIAL_BOT_MESSAGE = (isClient: boolean, name: string) => ({
  id: nextId(),
  from: 'bot' as const,
  text: isClient
    ? `Olá${name ? `, ${name}` : ''}! 👋 Sou a **Clara**, assistente da VivaFrutaz. Como posso ajudar?`
    : `Olá${name ? `, ${name}` : ''}! 👋 Sou a **Clara IA** da VivaFrutaz.\n\nUse os atalhos do painel para consultas rápidas, exportações e análises — ou escreva livremente no chat.`,
  timestamp: new Date(),
});

export function VirtualAssistant() {
  const { user, company, isStaff, isClient } = useAuth();
  const [, navigate] = useLocation();
  const isLoggedIn = !!user || !!company;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'panel' | 'chat'>('panel');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const name = user?.name?.split(' ')[0] || (company as any)?.companyName?.split(' ')[0] || '';

  const { data: intelligenceData } = useQuery<any>({
    queryKey: ['/api/admin/intelligence'],
    enabled: isStaff && isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });

  const { data: historyData } = useQuery<any[]>({
    queryKey: ['/api/assistant/history'],
    enabled: isLoggedIn && showHistory,
    staleTime: 60 * 1000,
  });

  const criticalCount = isStaff
    ? (intelligenceData?.summary?.critical ?? 0) + (intelligenceData?.summary?.high ?? 0)
    : 0;

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim() || isTyping) return;

    setMode('chat');
    const userMsg: Message = {
      id: nextId(),
      from: 'user',
      text: messageText.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSearchQuery('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: messageText.trim(), sessionContext }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionContext(data.sessionContext || null);

      const downloadUrl = data.sessionContext?.action === 'export_ready'
        ? data.sessionContext?.data?.downloadUrl
        : undefined;

      setMessages(prev => [...prev, {
        id: nextId(),
        from: 'bot',
        text: data.response || 'Desculpe, não consegui processar sua mensagem.',
        timestamp: new Date(),
        downloadUrl,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: nextId(),
        from: 'bot',
        text: '⚠️ Erro de conexão. Verifique sua sessão e tente novamente.',
        timestamp: new Date(),
        isError: true,
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [sessionContext, isTyping]);

  useEffect(() => {
    if (isLoggedIn && !initialized) {
      setMessages([INITIAL_BOT_MESSAGE(!!isClient, name)]);
      setInitialized(true);
    }
  }, [isLoggedIn, initialized, isClient, name]);

  // Listen for external "Ask Clara" events (from training mode, contextual tips, etc.)
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const msg = e.detail?.message;
      if (msg) {
        setOpen(true);
        setMode('chat');
        setTimeout(() => sendMessage(msg), 150);
      }
    };
    window.addEventListener('Clara:ask', handler as EventListener);
    return () => window.removeEventListener('Clara:ask', handler as EventListener);
  }, [sendMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (open && mode === 'chat') setTimeout(() => inputRef.current?.focus(), 100);
    if (open && mode === 'panel') setTimeout(() => searchRef.current?.focus(), 100);
  }, [open, mode]);

  const handleDirectDownload = (exportParams: string) => {
    window.open(`/api/Clara/export?${exportParams}`, '_blank');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) sendMessage(input);
    else if (searchQuery.trim()) sendMessage(searchQuery);
  };

  const resetChat = () => {
    setMessages([INITIAL_BOT_MESSAGE(!!isClient, name)]);
    setSessionContext(null);
    setShowHistory(false);
    setMode('panel');
  };

  const panelSections = isClient ? PANEL_SECTIONS_CLIENT : PANEL_SECTIONS_ADMIN;

  // Filter panel items by search query
  const filteredSections = searchQuery.trim()
    ? panelSections.map(s => ({
        ...s,
        items: s.items.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase())),
      })).filter(s => s.items.length > 0)
    : panelSections;

  if (!isLoggedIn) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        data-testid="button-virtual-assistant"
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-200"
      >
        {open ? <X className="w-6 h-6" /> : <Leaf className="w-6 h-6" />}
        {!open && criticalCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {criticalCount > 9 ? '9+' : criticalCount}
          </span>
        )}
      </button>

      {/* Panel / Chat Window */}
      {open && (
        <div
          data-testid="panel-virtual-assistant"
          className="fixed bottom-24 right-6 z-50 w-[360px] bg-card border border-border/50 rounded-3xl shadow-2xl shadow-black/20 flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 120px)' }}
        >
          {/* Header */}
          <div className="p-4 bg-primary text-primary-foreground flex items-center gap-3 flex-shrink-0">
            {mode === 'chat' && (
              <button
                onClick={() => setMode('panel')}
                className="w-8 h-8 rounded-xl bg-primary-foreground/10 hover:bg-primary-foreground/20 flex items-center justify-center transition-colors flex-shrink-0"
                title="Voltar ao painel"
                data-testid="button-back-to-panel"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-none">Clara IA</p>
              <p className="text-xs text-primary-foreground/70 mt-0.5">
                {mode === 'chat' ? 'Chat inteligente' : 'Painel de atalhos'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {mode === 'panel' && !isClient && (
                <button
                  onClick={() => { setMode('chat'); setShowHistory(true); }}
                  className="w-8 h-8 rounded-xl bg-primary-foreground/10 hover:bg-primary-foreground/20 flex items-center justify-center transition-colors"
                  title="Histórico"
                  data-testid="button-show-history"
                >
                  <Clock className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={resetChat}
                className="w-8 h-8 rounded-xl bg-primary-foreground/10 hover:bg-primary-foreground/20 flex items-center justify-center transition-colors"
                title="Reiniciar"
                data-testid="button-reset-chat"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── PANEL MODE ── */}
          {mode === 'panel' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Search bar */}
              <div className="px-3 pt-3 pb-1 flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-xl border border-border/40">
                  <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) sendMessage(searchQuery); }}
                    placeholder="Buscar atalho ou escrever pergunta..."
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    data-testid="input-panel-search"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Sections */}
              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-4 mt-2">
                {filteredSections.map(section => (
                  <div key={section.title}>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-0.5">{section.title}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {section.items.map(item => {
                        const Icon = item.icon;
                        const isExport = (item as any).isExport;
                        const exportParams = (item as any).exportParams;
                        return (
                          <button
                            key={item.label}
                            onClick={() => isExport ? handleDirectDownload(exportParams) : sendMessage(item.message)}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-medium transition-all hover:scale-[1.02] active:scale-95 ${
                              isExport
                                ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
                                : 'bg-muted hover:bg-primary/10 hover:text-primary'
                            }`}
                            data-testid={`panel-action-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                            <span className="leading-tight">{item.label}</span>
                            {isExport && <Download className="w-2.5 h-2.5 ml-auto flex-shrink-0 opacity-60" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {filteredSections.length === 0 && searchQuery && (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground">Nenhum atalho encontrado.</p>
                    <button
                      onClick={() => sendMessage(searchQuery)}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      Perguntar à Clara: "{searchQuery}"
                    </button>
                  </div>
                )}
              </div>

              {/* Open chat button */}
              <div className="px-3 pb-3 flex-shrink-0 border-t border-border/30 pt-3">
                <button
                  onClick={() => { setMode('chat'); setTimeout(() => inputRef.current?.focus(), 100); }}
                  data-testid="button-open-chat"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/5 hover:bg-primary/10 text-primary text-sm font-medium transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Chat com a Clara
                  <ChevronRight className="w-4 h-4 opacity-50" />
                </button>
              </div>
            </div>
          )}

          {/* ── CHAT MODE ── */}
          {mode === 'chat' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* History Panel */}
              {showHistory && (
                <div className="border-b border-border/50 bg-muted/30 overflow-y-auto max-h-40 flex-shrink-0">
                  <p className="text-xs font-bold text-muted-foreground px-4 pt-3 pb-1">Histórico de Interações</p>
                  {!historyData ? (
                    <p className="text-xs text-muted-foreground px-4 py-2">Carregando...</p>
                  ) : historyData.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-4 py-2">Nenhuma interação registrada.</p>
                  ) : (
                    historyData.slice(0, 10).map((h: any) => (
                      <div key={h.id} className="px-4 py-2 border-b border-border/20 last:border-0">
                        <p className="text-xs font-medium text-foreground truncate">{h.message}</p>
                        <p className="text-xs text-muted-foreground truncate">{h.response?.slice(0, 60)}...</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{new Date(h.createdAt).toLocaleString('pt-BR')}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                {messages.map(msg => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
                {isTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>

              {/* Quick export shortcuts in chat mode */}
              {!isClient && (
                <div className="px-3 py-2 border-t border-border/30 flex-shrink-0">
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    <button onClick={() => sendMessage('Exportar pedidos da semana')} className="px-2.5 py-1.5 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 text-green-800 dark:text-green-400 rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1 border border-green-200 dark:border-green-700 flex-shrink-0" data-testid="quick-export-week">
                      <FileSpreadsheet className="w-3 h-3" />📤 Semana
                    </button>
                    <button onClick={() => sendMessage('Exportar faturamento do mês')} className="px-2.5 py-1.5 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 text-green-800 dark:text-green-400 rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1 border border-green-200 dark:border-green-700 flex-shrink-0" data-testid="quick-export-month">
                      <FileSpreadsheet className="w-3 h-3" />💰 Mês
                    </button>
                    <button onClick={() => sendMessage('Pedidos pendentes')} className="px-2.5 py-1.5 bg-muted hover:bg-primary/10 hover:text-primary rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1 flex-shrink-0" data-testid="quick-pending">
                      ⏳ Pendentes
                    </button>
                    <button onClick={() => sendMessage('Clientes em risco')} className="px-2.5 py-1.5 bg-muted hover:bg-primary/10 hover:text-primary rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1 flex-shrink-0" data-testid="quick-risk">
                      ⚠️ Em risco
                    </button>
                    <button onClick={() => sendMessage('Estoque baixo')} className="px-2.5 py-1.5 bg-muted hover:bg-primary/10 hover:text-primary rounded-xl text-xs font-medium whitespace-nowrap flex items-center gap-1 flex-shrink-0" data-testid="quick-stock">
                      📦 Estoque
                    </button>
                  </div>
                </div>
              )}

              {/* Input */}
              <form onSubmit={handleSubmit} className="p-3 border-t border-border/50 flex gap-2 flex-shrink-0 bg-card">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={
                    sessionContext?.action === 'create_company' ? 'Responda à pergunta acima...' :
                    sessionContext?.action === 'create_task' ? 'Responda à pergunta acima...' :
                    'Digite sua pergunta à Clara...'
                  }
                  disabled={isTyping}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-background border border-border/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all"
                  data-testid="input-assistant-message"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 transition-all flex-shrink-0"
                  data-testid="button-assistant-send"
                >
                  {isTyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}

