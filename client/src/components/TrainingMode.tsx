import {
  createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode
} from 'react';
import {
  X, ChevronRight, ChevronLeft, Zap, BookOpen, Bot, GraduationCap
} from 'lucide-react';

interface TourStep {
  id: string;
  title: string;
  description: string;
  selector: string | null;
  position?: 'center' | 'right' | 'left' | 'below' | 'above' | 'auto';
  ClaraQuestion?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: '👋 Bem-vindo ao treinamento!',
    description: 'Este tour rápido vai mostrar as principais áreas do VivaFrutaz. Leva apenas 2 minutos. Use os botões abaixo para navegar.',
    selector: null,
    position: 'center',
  },
  {
    id: 'dashboard',
    title: '📊 Painel Principal',
    description: 'Esta é a visão geral do sistema. Aqui você vê pedidos do dia, alertas críticos, métricas de faturamento e movimentação em tempo real.',
    selector: '[href="/admin"]',
    ClaraQuestion: 'O que mostra o painel principal do sistema?',
  },
  {
    id: 'orders',
    title: '📦 Pedidos',
    description: 'Central de pedidos dos clientes. Aqui você visualiza, aprova, fatura, gera DANFEs e exporta para o Bling ERP.',
    selector: '[href="/admin/orders"]',
    ClaraQuestion: 'Como funciona o módulo de pedidos?',
  },
  {
    id: 'contracts',
    title: '📋 Gestão de Contratos',
    description: 'Configure escopos contratuais para clientes fixos. Defina produtos, quantidades e dias de entrega — os pedidos são gerados automaticamente toda semana.',
    selector: '[href="/admin/contracts"]',
    ClaraQuestion: 'Como funciona o escopo contratual?',
  },
  {
    id: 'purchase_planning',
    title: '🛒 Planejamento de Compras',
    description: 'Pedidos do escopo contratual aparecem aqui consolidados por produto. Planeje e registre suas compras semanais com controle de fornecedores.',
    selector: '[href="/admin/purchase-planning"]',
    ClaraQuestion: 'Como funciona o planejamento de compras?',
  },
  {
    id: 'products',
    title: '🍎 Produtos',
    description: 'Catálogo completo de produtos. Configure preços base, ID de produto, disponibilidade por categoria de cliente e alertas de variação de custo.',
    selector: '[href="/admin/products"]',
    ClaraQuestion: 'Como cadastrar um novo produto no sistema?',
  },
  {
    id: 'fiscal',
    title: '🧾 Gestão de Notas Fiscais',
    description: 'Central de faturamento. Emita DANFEs, exporte para o Bling, importe notas de entrada via OCR e acompanhe o cálculo automático de custo médio.',
    selector: '[href="/admin/fiscal"]',
    ClaraQuestion: 'Como funciona a gestão de notas fiscais e a exportação para o Bling?',
  },
  {
    id: 'inventory',
    title: '📦 Estoque / Inventário',
    description: 'Acompanhe os níveis de estoque em tempo real. Visualize custo médio por produto, alertas de estoque baixo e histórico de entradas e saídas.',
    selector: '[href="/admin/inventory"]',
    ClaraQuestion: 'Como funciona o controle de estoque e custo médio?',
  },
  {
    id: 'companies',
    title: '🏢 Empresas / Clientes',
    description: 'Cadastro completo de clientes. Configure portal de acesso, grupos de preço, tipo de contrato (avulso, mensal ou contratual) e escopo de produtos.',
    selector: '[href="/admin/companies"]',
    ClaraQuestion: 'Como cadastrar e configurar uma nova empresa cliente?',
  },
  {
    id: 'Clara',
    title: '🌿 Clara IA — sua assistente',
    description: 'A Clara está sempre disponível no canto da tela. Use-a para consultas instantâneas, exportações em Excel, análises de risco e tirar dúvidas sobre qualquer funcionalidade.',
    selector: '[data-testid="button-virtual-assistant"]',
    ClaraQuestion: 'O que você pode fazer para me ajudar no dia a dia?',
  },
  {
    id: 'complete',
    title: '🎉 Treinamento Concluído!',
    description: 'Parabéns! Você conheceu as principais áreas do VivaFrutaz. Lembre-se: a Clara IA está sempre disponível para tirar dúvidas — basta clicar no botão verde.',
    selector: null,
    position: 'center',
  },
];

const STORAGE_KEY = 'vf_training_completed_v1';

interface TrainingContextValue {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startTraining: () => void;
  stopTraining: () => void;
  isCompleted: boolean;
}

const TrainingContext = createContext<TrainingContextValue>({
  isActive: false,
  currentStep: 0,
  totalSteps: TOUR_STEPS.length,
  startTraining: () => {},
  stopTraining: () => {},
  isCompleted: false,
});

export const useTraining = () => useContext(TrainingContext);

interface TooltipProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onAskClara: (q: string) => void;
}

function TooltipBalloon({ step, stepIndex, totalSteps, targetRect, onNext, onPrev, onSkip, onAskClara }: TooltipProps) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isCentered = step.position === 'center' || !targetRect;

  const MARGIN = 12;
  const TOOLTIP_W = Math.min(320, window.innerWidth - MARGIN * 2);
  const TOOLTIP_H = 300;
  const GAP = 16;
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const maxH = VH * 0.8;

  let style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10001,
    maxHeight: maxH,
    width: TOOLTIP_W,
  };

  if (isCentered) {
    style.top = '50%';
    style.left = '50%';
    style.transform = 'translate(-50%, -50%)';
  } else if (targetRect) {
    const rightSpace = VW - (targetRect.right + GAP);
    const leftSpace = targetRect.left - GAP - TOOLTIP_W;
    const belowSpace = VH - (targetRect.bottom + GAP);
    const aboveSpace = targetRect.top - GAP - TOOLTIP_H;

    let top: number;
    let left: number;
    let placed = false;

    if (rightSpace >= TOOLTIP_W) {
      left = targetRect.right + GAP;
      top = Math.min(Math.max(targetRect.top, MARGIN), VH - TOOLTIP_H - MARGIN);
      placed = true;
    } else if (leftSpace >= 0) {
      left = targetRect.left - TOOLTIP_W - GAP;
      top = Math.min(Math.max(targetRect.top, MARGIN), VH - TOOLTIP_H - MARGIN);
      placed = true;
    } else if (belowSpace >= TOOLTIP_H) {
      top = targetRect.bottom + GAP;
      left = Math.min(Math.max(targetRect.left, MARGIN), VW - TOOLTIP_W - MARGIN);
      placed = true;
    } else if (aboveSpace >= 0) {
      top = Math.max(targetRect.top - TOOLTIP_H - GAP, MARGIN);
      left = Math.min(Math.max(targetRect.left, MARGIN), VW - TOOLTIP_W - MARGIN);
      placed = true;
    } else {
      top = 0;
      left = 0;
    }

    if (!placed) {
      style.top = '50%';
      style.left = '50%';
      style.transform = 'translate(-50%, -50%)';
    } else {
      top = Math.max(MARGIN, Math.min(top!, VH - TOOLTIP_H - MARGIN));
      left = Math.max(MARGIN, Math.min(left!, VW - TOOLTIP_W - MARGIN));
      style.top = top;
      style.left = left;
    }
  }

  return (
    <div
      style={style}
      className="bg-card border-2 border-primary/30 rounded-3xl shadow-2xl shadow-black/40 flex flex-col overflow-hidden"
      data-testid="training-tooltip"
    >
      <div className="bg-primary p-4 text-primary-foreground flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-primary-foreground/60 uppercase tracking-wider mb-0.5">
              Passo {stepIndex + 1} de {totalSteps}
            </p>
            <h3 className="font-display font-bold text-base leading-tight">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={onSkip}
            data-testid="button-training-skip"
            className="w-7 h-7 rounded-xl bg-primary-foreground/10 hover:bg-primary-foreground/20 flex items-center justify-center flex-shrink-0 transition-colors"
            title="Pular treinamento"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-3 h-1.5 bg-primary-foreground/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-foreground rounded-full transition-all duration-500"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="p-4 overflow-y-auto flex-1 min-h-0">
        <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>

        {step.ClaraQuestion && (
          <button
            type="button"
            onClick={() => onAskClara(step.ClaraQuestion!)}
            data-testid="button-training-ask-Clara"
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 bg-primary/5 hover:bg-primary/10 text-primary rounded-xl text-xs font-semibold transition-colors"
          >
            <Bot className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-left leading-tight">Perguntar à Clara sobre isto</span>
          </button>
        )}
      </div>

      <div className="px-4 pb-4 flex items-center gap-2 flex-shrink-0">
        {!isFirst && (
          <button
            type="button"
            onClick={onPrev}
            data-testid="button-training-prev"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground text-xs font-semibold transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          data-testid="button-training-next"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition-colors hover:bg-primary/90"
        >
          {isLast ? (
            <><Zap className="w-3.5 h-3.5" /> Finalizar treinamento</>
          ) : (
            <>Próximo <ChevronRight className="w-3.5 h-3.5" /></>
          )}
        </button>
      </div>
    </div>
  );
}

interface ProviderProps {
  children: ReactNode;
  onAskClara?: (message: string) => void;
}

export function TrainingModeProvider({ children, onAskClara }: ProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isCompleted, setIsCompleted] = useState(() => !!localStorage.getItem(STORAGE_KEY));
  const prevElementRef = useRef<HTMLElement | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const measureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getTargetElement = useCallback((selector: string | null): HTMLElement | null => {
    if (!selector) return null;
    return document.querySelector<HTMLElement>(selector);
  }, []);

  const cleanupScrollListeners = useCallback(() => {
    if (scrollCleanupRef.current) {
      scrollCleanupRef.current();
      scrollCleanupRef.current = null;
    }
  }, []);

  const setupScrollListeners = useCallback((el: HTMLElement) => {
    cleanupScrollListeners();

    const updateRect = () => {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    };

    let scrollParent: HTMLElement | Window = window;
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollParent = node;
        break;
      }
      node = node.parentElement;
    }

    scrollParent.addEventListener('scroll', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });

    scrollCleanupRef.current = () => {
      scrollParent.removeEventListener('scroll', updateRect);
      window.removeEventListener('resize', updateRect);
    };
  }, [cleanupScrollListeners]);

  const applySpotlight = useCallback((el: HTMLElement | null) => {
    if (prevElementRef.current) {
      prevElementRef.current.style.removeProperty('border-radius');
      prevElementRef.current.style.removeProperty('outline');
      prevElementRef.current.style.removeProperty('outline-offset');
      prevElementRef.current = null;
    }

    cleanupScrollListeners();
    if (measureTimeoutRef.current) {
      clearTimeout(measureTimeoutRef.current);
      measureTimeoutRef.current = null;
    }

    if (!el) {
      setTargetRect(null);
      return;
    }

    el.style.setProperty('border-radius', '10px');
    el.style.setProperty('outline', '3px solid hsl(var(--primary))');
    el.style.setProperty('outline-offset', '4px');
    prevElementRef.current = el;

    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    measureTimeoutRef.current = setTimeout(() => {
      measureTimeoutRef.current = null;
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      setupScrollListeners(el);
    }, 500);
  }, [cleanupScrollListeners, setupScrollListeners]);

  const goToStep = useCallback((idx: number) => {
    const step = TOUR_STEPS[idx];
    const el = getTargetElement(step.selector);
    applySpotlight(el);
    setCurrentStep(idx);
    if (!step.selector) setTargetRect(null);
  }, [getTargetElement, applySpotlight]);

  const cleanupSpotlight = useCallback(() => {
    if (prevElementRef.current) {
      prevElementRef.current.style.removeProperty('border-radius');
      prevElementRef.current.style.removeProperty('outline');
      prevElementRef.current.style.removeProperty('outline-offset');
      prevElementRef.current = null;
    }
    cleanupScrollListeners();
  }, [cleanupScrollListeners]);

  const startTraining = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
    const step = TOUR_STEPS[0];
    const el = getTargetElement(step.selector);
    applySpotlight(el);
  }, [getTargetElement, applySpotlight]);

  const stopTraining = useCallback(() => {
    cleanupSpotlight();
    setIsActive(false);
    setTargetRect(null);
  }, [cleanupSpotlight]);

  const finishTraining = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsCompleted(true);
    cleanupSpotlight();
    setIsActive(false);
    setTargetRect(null);
  }, [cleanupSpotlight]);

  const handleNext = useCallback(() => {
    const nextIdx = currentStep + 1;
    if (nextIdx >= TOUR_STEPS.length) {
      finishTraining();
    } else {
      goToStep(nextIdx);
    }
  }, [currentStep, goToStep, finishTraining]);

  const handlePrev = useCallback(() => {
    const prevIdx = currentStep - 1;
    if (prevIdx >= 0) goToStep(prevIdx);
  }, [currentStep, goToStep]);

  const handleAskClara = useCallback((question: string) => {
    stopTraining();
    if (onAskClara) onAskClara(question);
  }, [stopTraining, onAskClara]);

  useEffect(() => {
    return () => {
      cleanupSpotlight();
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
        measureTimeoutRef.current = null;
      }
    };
  }, [cleanupSpotlight]);

  const step = TOUR_STEPS[currentStep];

  return (
    <TrainingContext.Provider value={{ isActive, currentStep, totalSteps: TOUR_STEPS.length, startTraining, stopTraining, isCompleted }}>
      {children}

      {isActive && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9997, pointerEvents: 'none' }}
            className="bg-black/65"
            data-testid="training-overlay"
          />

          {targetRect && (
            <div
              style={{
                position: 'fixed',
                top: targetRect.top - 10,
                left: targetRect.left - 10,
                width: targetRect.width + 20,
                height: targetRect.height + 20,
                zIndex: 9998,
                pointerEvents: 'none',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.05)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0)',
              }}
            />
          )}

          <TooltipBalloon
            step={step}
            stepIndex={currentStep}
            totalSteps={TOUR_STEPS.length}
            targetRect={targetRect}
            onNext={handleNext}
            onPrev={handlePrev}
            onSkip={stopTraining}
            onAskClara={handleAskClara}
          />
        </>
      )}
    </TrainingContext.Provider>
  );
}

export function TrainingModeButton() {
  const { isActive, startTraining, stopTraining, isCompleted } = useTraining();

  return (
    <button
      type="button"
      onClick={isActive ? stopTraining : startTraining}
      data-testid="button-training-mode"
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
        isActive
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
          : 'bg-primary/5 hover:bg-primary/10 text-primary'
      }`}
    >
      <GraduationCap className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-left">
        {isActive ? 'Parar treinamento' : 'Modo Treinamento'}
      </span>
      {!isActive && isCompleted && (
        <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded-full font-bold">
          ✓
        </span>
      )}
      {!isActive && !isCompleted && (
        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
          Novo
        </span>
      )}
    </button>
  );
}

