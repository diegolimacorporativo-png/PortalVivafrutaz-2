import { useState, useEffect } from 'react';
import {
  X, Sparkles, FileText, Package, Link2, Tag, TrendingUp, BookOpen,
  ChevronRight, Check, ArrowRight
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

const CURRENT_VERSION = 'v2.5.0';
const STORAGE_KEY = `vf_whats_new_seen_${CURRENT_VERSION}`;

interface Feature {
  icon: React.ReactNode;
  color: string;
  title: string;
  description: string;
  tutorialMessage?: string;
}

const NEW_FEATURES: Feature[] = [
  {
    icon: <Link2 className="w-4 h-4" />,
    color: 'bg-blue-500',
    title: 'Escopo Contratual',
    description: 'Configure produtos, quantidades e dias de entrega fixos para clientes contratuais. Gere pedidos automáticos diretamente do escopo.',
    tutorialMessage: 'Como funciona o escopo contratual?',
  },
  {
    icon: <FileText className="w-4 h-4" />,
    color: 'bg-purple-500',
    title: 'Gestão de Notas Fiscais',
    description: 'Importe DANFEs em PDF por OCR, registre entradas no inventário automaticamente e exporte para o Bling com um clique.',
    tutorialMessage: 'Como funciona a gestão de notas fiscais?',
  },
  {
    icon: <TrendingUp className="w-4 h-4" />,
    color: 'bg-orange-500',
    title: 'Cálculo de Custo Médio',
    description: 'O sistema recalcula o custo médio ponderado de cada produto automaticamente ao importar notas fiscais de entrada.',
    tutorialMessage: 'Como funciona o cálculo de custo médio?',
  },
  {
    icon: <Package className="w-4 h-4" />,
    color: 'bg-green-500',
    title: 'ID de Produto Base',
    description: 'Cadastre produtos com um código identificador único. Produtos derivados com o mesmo código (ex: Manga In Natura e Manga Higienizada) são agrupados automaticamente.',
    tutorialMessage: 'Como funciona o ID de produto base?',
  },
  {
    icon: <Tag className="w-4 h-4" />,
    color: 'bg-teal-500',
    title: 'Disponibilidade por Categoria',
    description: 'Restrinja a disponibilidade de produtos apenas para categorias de clientes específicas — ideal para produtos industrializados ou premium.',
    tutorialMessage: 'Como configurar disponibilidade de categorias?',
  },
  {
    icon: <Sparkles className="w-4 h-4" />,
    color: 'bg-primary',
    title: 'Simulação Comercial',
    description: 'Simule escopos e margens antes de formalizar um contrato. Converta uma simulação em cliente contratual com um clique.',
    tutorialMessage: 'Como funciona a simulação de escopo comercial?',
  },
];

export function WhatsNewModal() {
  const askFlora = (msg: string) => {
    window.dispatchEvent(new CustomEvent('clara:ask', { detail: { message: msg } }));
  };
  const { isStaff } = useAuth();
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isStaff) return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isStaff]);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  };

  const handleTutorial = (feature: Feature) => {
    if (feature.tutorialMessage) {
      askFlora(feature.tutorialMessage);
    }
    handleClose();
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      data-testid="modal-whats-new"
    >
      <div className="w-full max-w-2xl bg-card rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground relative">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-primary-foreground/10 hover:bg-primary-foreground/20 flex items-center justify-center transition-colors"
            data-testid="button-close-whats-new"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary-foreground/20 rounded-2xl flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold">Novas funcionalidades disponíveis</h2>
              <p className="text-sm text-primary-foreground/70">Versão {CURRENT_VERSION} — VivaFrutaz</p>
            </div>
          </div>
          <p className="text-sm text-primary-foreground/80 mt-1">
            Seu sistema foi atualizado com as funcionalidades abaixo. Explore cada uma delas!
          </p>
        </div>

        {/* Features list */}
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
          {NEW_FEATURES.map((feature, i) => (
            <div
              key={i}
              className={`rounded-2xl border transition-all cursor-pointer ${
                activeIndex === i
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/50 bg-muted/30 hover:border-primary/20 hover:bg-muted/60'
              }`}
              onClick={() => setActiveIndex(activeIndex === i ? null : i)}
              data-testid={`feature-item-${i}`}
            >
              <div className="p-3.5 flex items-start gap-3">
                <div className={`${feature.color} w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-white`}>
                  {feature.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 justify-between">
                    <h3 className="font-bold text-sm text-foreground">{feature.title}</h3>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${activeIndex === i ? 'rotate-90' : ''}`} />
                  </div>
                  {activeIndex === i && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                      {feature.tutorialMessage && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleTutorial(feature); }}
                          className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
                          data-testid={`button-tutorial-${i}`}
                        >
                          <BookOpen className="w-3 h-3" />
                          Ver tutorial rápido
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex gap-2 border-t border-border/30 pt-4">
          <button
            type="button"
            onClick={handleClose}
            data-testid="button-confirm-whats-new"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:bg-primary/90 transition-colors"
          >
            <Check className="w-4 h-4" />
            Entendi, obrigado!
          </button>
        </div>
      </div>
    </div>
  );
}
