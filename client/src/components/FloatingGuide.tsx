import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  HelpCircle, X, Minus, GripVertical, Building2, CreditCard,
  CheckCircle2, Receipt, Truck, Bot, ChevronRight, ChevronDown,
  BookOpen, ExternalLink, Route, User, Search, RefreshCw, MapPin
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GuideStep {
  title: string;
  steps: string[];
  link: string;
  linkLabel: string;
}

const GUIDE_SECTIONS: { icon: any; label: string; color: string; guide: GuideStep }[] = [
  {
    icon: Building2, label: 'Criar Empresa', color: 'text-blue-600 bg-blue-50',
    guide: {
      title: 'Como Criar uma Empresa',
      steps: [
        '1. Acesse o menu "Empresas" na barra lateral',
        '2. Clique em "+ Nova Empresa"',
        '3. Preencha Nome, E-mail e Tipo de cliente',
        '4. Adicione endereço e configure dias de entrega',
        '5. Clique em "Salvar Empresa"',
      ],
      link: '/admin/companies',
      linkLabel: 'Ir para Empresas',
    }
  },
  {
    icon: CreditCard, label: 'Criar Plano', color: 'text-purple-600 bg-purple-50',
    guide: {
      title: 'Como Criar um Plano',
      steps: [
        '1. Acesse "Master Control" no menu',
        '2. Clique na aba "Planos"',
        '3. Clique em "+ Novo Plano"',
        '4. Defina nome, valor e ciclo de cobrança',
        '5. Configure os limites (usuários, empresas, etc.)',
        '6. Clique em "Salvar"',
      ],
      link: '/admin/master-control',
      linkLabel: 'Ir para Master Control',
    }
  },
  {
    icon: CheckCircle2, label: 'Ativar Assinatura', color: 'text-green-600 bg-green-50',
    guide: {
      title: 'Como Ativar uma Assinatura',
      steps: [
        '1. Acesse "Master Control" > aba "Assinaturas"',
        '2. Clique em "+ Nova Assinatura"',
        '3. Selecione a empresa e o plano',
        '4. Defina o status como "Ativa"',
        '5. Configure valor, vencimento e gateway',
        '6. Clique em "Salvar"',
      ],
      link: '/admin/master-control',
      linkLabel: 'Ir para Assinaturas',
    }
  },
  {
    icon: Receipt, label: 'Gerar Cobrança', color: 'text-orange-600 bg-orange-50',
    guide: {
      title: 'Como Gerar uma Cobrança',
      steps: [
        '1. Acesse "Master Control" > aba "Cobrança"',
        '2. Clique em "+ Novo Evento de Cobrança"',
        '3. Selecione a empresa e assinatura',
        '4. Escolha o tipo: pagamento, vencimento, etc.',
        '5. Informe o valor e o gateway de pagamento',
        '6. Clique em "Registrar"',
      ],
      link: '/admin/master-control',
      linkLabel: 'Ir para Cobrança',
    }
  },
  {
    icon: Truck, label: 'Usar Logística', color: 'text-teal-600 bg-teal-50',
    guide: {
      title: 'Como Usar a Logística',
      steps: [
        '1. Acesse "Logística Inteligente" no menu',
        '2. Na aba "Entregas": crie e gerencie entregas',
        '3. Na aba "Simulação": simule rotas por motorista',
        '4. Na aba "CEP/Geo": busque CEP e calcule distâncias',
        '5. Na aba "Visão Geral": acompanhe KPIs do dia',
      ],
      link: '/admin/logistics-intelligence',
      linkLabel: 'Ir para Logística',
    }
  },
  {
    icon: Route, label: 'Adicionar Rota', color: 'text-cyan-600 bg-cyan-50',
    guide: {
      title: 'Como Adicionar uma Rota de Entrega',
      steps: [
        '1. Acesse "Logística" no menu lateral',
        '2. Clique na aba "Rotas"',
        '3. Clique em "+ Nova Rota" para criar a rota',
        '4. Defina nome da rota, motorista e veículo',
        '5. Use "Gerenciar Paradas" para adicionar os CEPs de entrega',
        '6. Salve a rota — ela aparecerá no Painel do Motorista',
      ],
      link: '/admin/logistics',
      linkLabel: 'Ir para Logística (Rotas)',
    }
  },
  {
    icon: MapPin, label: 'GPS e Rastreamento', color: 'text-violet-600 bg-violet-50',
    guide: {
      title: 'Como Usar o GPS e Rastrear Entregas',
      steps: [
        '1. Acesse "Painel do Motorista" no menu lateral',
        '2. Clique em "Mapa GPS" para ver o mapa interativo',
        '3. Permita o acesso à localização no navegador',
        '4. Seu caminhão aparece no mapa em tempo real',
        '5. Use "NF-e da Rota" para ver notas fiscais do dia',
        '6. Confirme entregas pelo botão "Confirmar Entrega" em cada card',
      ],
      link: '/admin/driver-panel',
      linkLabel: 'Ir para Painel do Motorista',
    }
  },
  {
    icon: User, label: 'Cadastrar Motoristas', color: 'text-indigo-600 bg-indigo-50',
    guide: {
      title: 'Como Cadastrar Motoristas',
      steps: [
        '1. Acesse "Logística Inteligente" > aba "Visão Geral"',
        '2. Clique no botão "Motoristas" no painel',
        '3. Clique em "+ Novo Motorista"',
        '4. Informe nome, CNH, veículo e telefone',
        '5. Ative o motorista e salve',
        '6. O sistema usará o motorista nas sugestões automáticas',
      ],
      link: '/admin/logistics-intelligence',
      linkLabel: 'Ir para Motoristas',
    }
  },
  {
    icon: Search, label: 'Busca Inteligente', color: 'text-amber-600 bg-amber-50',
    guide: {
      title: 'Como Usar a Busca Inteligente por Empresa',
      steps: [
        '1. Acesse "Logística Inteligente" > aba "Pesquisa Inteligente"',
        '2. Digite o CNPJ ou CEP da empresa no campo de busca',
        '3. O sistema mostrará a empresa e suas janelas de entrega',
        '4. Veja o motorista recomendado e a rota sugerida',
        '5. Clique em "Encaixar na Rota" para inserir automaticamente',
        '6. Empresas próximas serão exibidas para atendimento conjunto',
      ],
      link: '/admin/logistics-intelligence',
      linkLabel: 'Ir para Pesquisa Inteligente',
    }
  },
  {
    icon: Bot, label: 'Usar a IA', color: 'text-rose-600 bg-rose-50',
    guide: {
      title: 'Como Usar o Módulo de IA',
      steps: [
        '1. Acesse "AI Developer" no menu',
        '2. Use os botões de comando rápido no painel',
        '3. "Analisar Sistema" — mapa completo do projeto',
        '4. "Detectar Bugs" — erros e problemas do código',
        '5. "Auto Corrigir" — aplica correções automáticas',
        '6. Digite comandos personalizados no terminal',
      ],
      link: '/admin/ai-developer',
      linkLabel: 'Ir para IA Developer',
    }
  },
  {
    icon: RefreshCw, label: 'Atualizações do Sistema', color: 'text-emerald-600 bg-emerald-50',
    guide: {
      title: 'Novidades e Atualizações do Sistema',
      steps: [
        '📦 Gestão de Assinaturas SaaS com PIX, cartão e boleto',
        '🧩 Controle de módulos por plano — menu dinâmico',
        '🔄 Plano free configurável com módulos selecionáveis',
        '📊 Dashboard SaaS com contratos, faturas e bancos',
        '🚀 Upgrade/downgrade automático de planos',
        '⚠️ Bloqueio automático por inadimplência',
        '📍 Entrega com GPS em tempo real e checklist',
        '🔧 Sistema de versões com histórico de atualizações',
      ],
      link: '/admin/system-updates',
      linkLabel: 'Ver Versões do Sistema',
    }
  },
];

const STORAGE_KEY = 'floatingGuide_pos';
const STORAGE_OPEN = 'floatingGuide_open';

export default function FloatingGuide() {
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_OPEN) === 'true'; } catch { return false; }
  });
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const safeW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        if (parsed.x < 270 || parsed.x > safeW - 100) {
          return { x: Math.max(270, safeW - 380), y: 80 };
        }
        return parsed;
      }
    } catch {}
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return { x: Math.max(270, w - 380), y: 80 };
  });

  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const savePos = useCallback((p: { x: number; y: number }) => {
    setPos(p);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const nx = Math.max(270, Math.min(window.innerWidth - 360, e.clientX - offset.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y));
      savePos({ x: nx, y: ny });
    }
    function onUp() { dragging.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [savePos]);

  function toggleOpen() {
    const next = !isOpen;
    setIsOpen(next);
    try { localStorage.setItem(STORAGE_OPEN, String(next)); } catch {}
    if (!next) setActiveSection(null);
  }

  function handleNavigate(link: string) {
    navigate(link);
    setActiveSection(null);
  }

  // Floating trigger button (always visible)
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={toggleOpen}
        data-testid="button-floating-guide"
        className="fixed z-[9999] flex items-center gap-2 bg-primary text-primary-foreground shadow-lg hover:shadow-xl rounded-full px-4 py-2.5 text-sm font-semibold transition-all hover:scale-105 active:scale-95"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={onMouseDown}
      >
        <BookOpen className="w-4 h-4" />
        Guia Rápido
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: 340, maxHeight: isMinimized ? 48 : 520 }}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-primary text-primary-foreground cursor-move select-none"
        onMouseDown={onMouseDown}
      >
        <GripVertical className="w-3.5 h-3.5 opacity-60" />
        <BookOpen className="w-4 h-4" />
        <span className="flex-1 text-sm font-semibold">Guia Rápido</span>
        <button
          type="button"
          onClick={() => setIsMinimized(!isMinimized)}
          className="p-0.5 rounded hover:bg-white/20 transition-colors"
          data-testid="button-guide-minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleOpen}
          className="p-0.5 rounded hover:bg-white/20 transition-colors"
          data-testid="button-guide-close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!isMinimized && (
        <div className="overflow-y-auto" style={{ maxHeight: 472 }}>
          {/* Section picker */}
          {activeSection === null ? (
            <div className="p-3 space-y-1.5">
              <p className="text-xs text-muted-foreground px-1 mb-2">Selecione um tópico para ver o passo a passo:</p>
              {GUIDE_SECTIONS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveSection(i)}
                    data-testid={`guide-section-${i}`}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground">{s.label}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                );
              })}
              <p className="text-[10px] text-muted-foreground text-center pt-2 pb-1">
                💡 Você pode mover este guia arrastando pelo cabeçalho
              </p>
            </div>
          ) : (
            <div className="p-4">
              {/* Back button */}
              <button
                type="button"
                onClick={() => setActiveSection(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors"
              >
                <ChevronDown className="w-3 h-3 rotate-90" />
                Voltar ao menu
              </button>

              {(() => {
                const s = GUIDE_SECTIONS[activeSection];
                const Icon = s.icon;
                return (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className="text-sm font-bold text-foreground">{s.guide.title}</h3>
                    </div>
                    <div className="space-y-2 mb-4">
                      {s.guide.steps.map((step, j) => (
                        <div key={j} className="flex gap-2 text-xs text-foreground/80">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                            {j + 1}
                          </span>
                          <span className="pt-0.5">{step.replace(/^\d+\.\s/, '')}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => handleNavigate(s.guide.link)}
                      data-testid={`guide-link-${activeSection}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      {s.guide.linkLabel}
                    </Button>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
