import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Bot, Save, X, Sparkles } from 'lucide-react';

interface ClaraTraining {
  id: number;
  question: string;
  answer: string;
  userId: number;
  userName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TrainingForm {
  question: string;
  answer: string;
}

export default function AdminClaraTraining() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TrainingForm>({ question: '', answer: '' });
  const [search, setSearch] = useState('');

  const { data: trainings = [], isLoading } = useQuery<ClaraTraining[]>({
    queryKey: ['/api/clara-training'],
  });

  const createMutation = useMutation({
    mutationFn: (data: TrainingForm) => apiRequest('POST', '/api/clara-training', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clara-training'] });
      setShowForm(false);
      setForm({ question: '', answer: '' });
      toast({ title: 'Par de treinamento criado com sucesso!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ClaraTraining> }) =>
      apiRequest('PUT', `/api/clara-training/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clara-training'] });
      setEditingId(null);
      setForm({ question: '', answer: '' });
      toast({ title: 'Atualizado com sucesso!' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/clara-training/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clara-training'] });
      toast({ title: 'Par removido.' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!form.question.trim() || !form.answer.trim()) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const startEdit = (t: ClaraTraining) => {
    setEditingId(t.id);
    setForm({ question: t.question, answer: t.answer });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ question: '', answer: '' });
  };

  const toggleActive = (t: ClaraTraining) => {
    updateMutation.mutate({ id: t.id, data: { active: !t.active } });
  };

  const filtered = trainings.filter(
    t =>
      t.question.toLowerCase().includes(search.toLowerCase()) ||
      t.answer.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Treinar Clara</h1>
            <p className="text-sm text-muted-foreground">Ensine respostas personalizadas para a Clara IA</p>
          </div>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} data-testid="button-add-training" className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Par
          </Button>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3 items-start">
        <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm text-foreground/80">
          <strong>Como funciona:</strong> Quando alguém pergunta algo à Clara, ela verifica primeiro estes pares de treinamento. Se a pergunta for parecida, a Clara responde com a resposta cadastrada aqui — antes de usar as respostas padrão.
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">{editingId ? 'Editar par' : 'Novo par de treinamento'}</h2>
            <button onClick={cancelForm} className="text-muted-foreground hover:text-foreground" data-testid="button-cancel-form">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Pergunta / Gatilho</label>
              <Input
                data-testid="input-training-question"
                placeholder="Ex: qual o horário de funcionamento?"
                value={form.question}
                onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">A Clara usa as palavras-chave desta pergunta para detectar a intenção.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Resposta da Clara</label>
              <Textarea
                data-testid="input-training-answer"
                placeholder="Ex: Nosso horário de atendimento é de segunda a sexta, das 7h às 18h."
                value={form.answer}
                onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">Suporta **negrito** com asteriscos duplos.</p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-training"
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              {editingId ? 'Salvar Alterações' : 'Criar Par'}
            </Button>
            <Button variant="outline" onClick={cancelForm} data-testid="button-cancel-training">
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      {trainings.length > 0 && (
        <Input
          data-testid="input-search-training"
          placeholder="Buscar por pergunta ou resposta..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando treinamentos...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Bot className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">
            {trainings.length === 0 ? 'Nenhum treinamento cadastrado ainda.' : 'Nenhum resultado para a busca.'}
          </p>
          {trainings.length === 0 && (
            <p className="text-sm text-muted-foreground/70">Clique em "Novo Par" para ensinar algo à Clara.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{filtered.length} par(es) de treinamento</p>
          {filtered.map(t => (
            <div
              key={t.id}
              data-testid={`card-training-${t.id}`}
              className={`bg-card border rounded-2xl p-4 space-y-3 transition-opacity ${!t.active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-primary uppercase tracking-wide">Pergunta</span>
                    <p className="text-sm font-medium text-foreground mt-0.5 leading-snug">{t.question}</p>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resposta</span>
                    <p className="text-sm text-foreground/80 mt-0.5 leading-relaxed whitespace-pre-wrap">{t.answer}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <Badge variant={t.active ? 'default' : 'secondary'} className="text-xs">
                    {t.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Por {t.userName}</span>
                  <span>·</span>
                  <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t.active ? 'Ativo' : 'Inativo'}</span>
                    <Switch
                      checked={t.active}
                      onCheckedChange={() => toggleActive(t)}
                      data-testid={`switch-active-${t.id}`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEdit(t)}
                    data-testid={`button-edit-training-${t.id}`}
                    className="h-8 w-8"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm('Remover este par de treinamento?')) deleteMutation.mutate(t.id);
                    }}
                    data-testid={`button-delete-training-${t.id}`}
                    className="h-8 w-8 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


