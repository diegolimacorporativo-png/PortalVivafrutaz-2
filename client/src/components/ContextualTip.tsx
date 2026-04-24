import { useState, useEffect } from 'react';
import { Lightbulb, X, ChevronRight } from 'lucide-react';

interface ContextualTipProps {
  tipId: string;
  title: string;
  message: string;
  learnMoreMessage?: string;
  variant?: 'info' | 'help' | 'new';
}

const STORAGE_PREFIX = 'vf_tip_dismissed_';

export function ContextualTip({
  tipId,
  title,
  message,
  learnMoreMessage,
  variant = 'help',
}: ContextualTipProps) {
  const askFlora = (msg: string) => {
    window.dispatchEvent(new CustomEvent('clara:ask', { detail: { message: msg } }));
  };
  const key = STORAGE_PREFIX + tipId;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(key);
    if (!dismissed) setVisible(true);
  }, [key]);

  const dismiss = () => {
    localStorage.setItem(key, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  const colors = {
    info: {
      bg: 'bg-blue-50 dark:bg-blue-900/10',
      border: 'border-blue-200 dark:border-blue-800',
      icon: 'bg-blue-500',
      text: 'text-blue-900 dark:text-blue-200',
      sub: 'text-blue-700 dark:text-blue-400',
      learn: 'text-blue-600 dark:text-blue-400',
    },
    help: {
      bg: 'bg-amber-50 dark:bg-amber-900/10',
      border: 'border-amber-200 dark:border-amber-800',
      icon: 'bg-amber-500',
      text: 'text-amber-900 dark:text-amber-200',
      sub: 'text-amber-700 dark:text-amber-400',
      learn: 'text-amber-600 dark:text-amber-400',
    },
    new: {
      bg: 'bg-primary/5 dark:bg-primary/10',
      border: 'border-primary/20',
      icon: 'bg-primary',
      text: 'text-foreground',
      sub: 'text-muted-foreground',
      learn: 'text-primary',
    },
  };

  const c = colors[variant];

  return (
    <div
      className={`rounded-2xl border ${c.bg} ${c.border} p-4 mb-4 flex items-start gap-3`}
      data-testid={`contextual-tip-${tipId}`}
    >
      <div className={`${c.icon} w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0`}>
        <Lightbulb className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-bold text-sm ${c.text}`}>{title}</p>
        <p className={`text-xs ${c.sub} mt-0.5 leading-relaxed`}>{message}</p>
        {learnMoreMessage && (
          <button
            type="button"
            onClick={() => { askFlora(learnMoreMessage); dismiss(); }}
            className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${c.learn} hover:underline`}
            data-testid={`tip-learn-more-${tipId}`}
          >
            Saiba mais com a Clara
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        data-testid={`tip-dismiss-${tipId}`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
