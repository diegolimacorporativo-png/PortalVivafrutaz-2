import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Building2, Pencil, Save, Image, Eye, X, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

const EDIT_ROLES = ['ADMIN', 'DIRECTOR', 'DEVELOPER'];

export default function AdminAboutUs() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canEdit = EDIT_ROLES.includes(user?.role || '');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['/api/about-us'],
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);

  const startEdit = () => {
    setForm({
      title: data?.title || 'Quem Somos Nós',
      content: data?.content || '',
      foundingYear: data?.foundingYear || '',
      mission: data?.mission || '',
      vision: data?.vision || '',
      values: data?.values || '',
      imageBase64: data?.imageBase64 || null,
      imageType: data?.imageType || null,
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: any) => apiRequest('PUT', '/api/about-us', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/about-us'] });
      setEditing(false);
      toast({ title: "Informações institucionais salvas com sucesso!" });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao salvar", variant: "destructive" }),
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagem muito grande. Máximo 5MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string)?.split(',')[1];
      setForm((f: any) => ({ ...f, imageBase64: base64, imageType: file.type }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!form?.title?.trim()) {
      toast({ title: "O título não pode estar vazio.", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  const display = editing ? form : data;
  const imgSrc = display?.imageBase64
    ? `data:${display.imageType || 'image/png'};base64,${display.imageBase64}`
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Quem Somos Nós</h1>
            <p className="text-sm text-muted-foreground">Informações institucionais da empresa</p>
          </div>
        </div>
        {!editing ? (
          canEdit && (
            <button
              onClick={startEdit}
              data-testid="button-edit-about-us"
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Editar Informações
            </button>
          )
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-about-us"
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'Salvando...' : 'Salvar Informações'}
            </button>
          </div>
        )}
      </div>

      {/* Card */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        {/* Image banner */}
        <div className="relative h-48 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center overflow-hidden">
          {imgSrc ? (
            <img src={imgSrc} alt="Imagem institucional" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Image className="w-10 h-10 opacity-40" />
              <span className="text-sm">Sem imagem cadastrada</span>
            </div>
          )}
          {editing && (
            <button
              onClick={() => fileRef.current?.click()}
              data-testid="button-upload-image"
              className="absolute bottom-3 right-3 flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur text-foreground rounded-lg shadow font-medium text-xs hover:bg-white transition-colors border border-border"
            >
              <Upload className="w-3.5 h-3.5" />
              {imgSrc ? 'Trocar imagem' : 'Enviar imagem'}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>

        <div className="p-8 space-y-8">
          {/* Title */}
          <div>
            {editing ? (
              <input
                value={form?.title || ''}
                onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))}
                data-testid="input-about-title"
                className="w-full text-3xl font-bold bg-transparent border-b-2 border-primary/30 focus:border-primary outline-none pb-1 text-foreground"
                placeholder="Título da seção"
              />
            ) : (
              <h2 className="text-3xl font-bold text-foreground">{display?.title || 'Quem Somos Nós'}</h2>
            )}
          </div>

          {/* Founding Year */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
              <p className="text-xs font-bold text-primary/70 uppercase tracking-wider mb-1">Ano de Fundação</p>
              {editing ? (
                <input
                  value={form?.foundingYear || ''}
                  onChange={e => setForm((f: any) => ({ ...f, foundingYear: e.target.value }))}
                  data-testid="input-about-founding-year"
                  className="w-full text-2xl font-bold bg-transparent outline-none text-primary"
                  placeholder="ex: 2010"
                />
              ) : (
                <p className="text-2xl font-bold text-primary">{display?.foundingYear || '—'}</p>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Texto Institucional</p>
            {editing ? (
              <textarea
                value={form?.content || ''}
                onChange={e => setForm((f: any) => ({ ...f, content: e.target.value }))}
                data-testid="input-about-content"
                rows={5}
                className="w-full px-4 py-3 border-2 border-border rounded-xl text-sm focus:border-primary outline-none resize-none bg-background"
                placeholder="Descreva a história e propósito da empresa..."
              />
            ) : (
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {display?.content || 'Nenhum texto cadastrado.'}
              </p>
            )}
          </div>

          {/* Mission / Vision / Values */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { key: 'mission', label: 'Missão', icon: '🎯', testId: 'input-about-mission' },
              { key: 'vision', label: 'Visão', icon: '🔭', testId: 'input-about-vision' },
              { key: 'values', label: 'Valores', icon: '💎', testId: 'input-about-values' },
            ].map(({ key, label, icon, testId }) => (
              <div key={key} className="bg-muted/30 rounded-xl p-5 border border-border/50 space-y-2">
                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>{icon}</span>{label}
                </p>
                {editing ? (
                  <textarea
                    value={form?.[key] || ''}
                    onChange={e => setForm((f: any) => ({ ...f, [key]: e.target.value }))}
                    data-testid={testId}
                    rows={4}
                    className="w-full px-3 py-2 border-2 border-border rounded-lg text-sm focus:border-primary outline-none resize-none bg-background"
                    placeholder={`Descreva a ${label.toLowerCase()} da empresa...`}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {display?.[key] || 'Não cadastrado.'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setEditing(false)}
            className="px-6 py-2.5 border border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Salvando...' : 'Salvar Informações'}
          </button>
        </div>
      )}
    </div>
  );
}
