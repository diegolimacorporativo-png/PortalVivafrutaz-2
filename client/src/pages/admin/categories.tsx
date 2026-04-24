import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Modal } from "@/components/Modal";
import { useToast } from "@/hooks/use-toast";
import { Plus, Tag, Edit2, Trash2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

type Category = { id: number; name: string; description: string | null; active: boolean };

function useCategories() {
  return useQuery({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const res = await fetch('/api/categories', { credentials: 'include' });
      return res.json() as Promise<Category[]>;
    }
  });
}

const DEFAULT_CATEGORIES = [
  "Frutas In Natura", "Frutas Higienizadas", "Frutas Cortadas",
  "Snacks Saudáveis", "Mix de Oleaginosas", "Industrializados"
];

const emptyForm = { name: "", description: "", active: true };

export default function CategoriesPage() {
  const { data: categories, isLoading } = useCategories();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['/api/categories'] });

  const create = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      const res = await fetch('/api/categories', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Erro ao criar categoria');
      }
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Categoria criada!" }); closeModal(); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof emptyForm> }) => {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Erro ao atualizar');
      }
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Categoria atualizada!" }); closeModal(); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/categories/${id}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => { invalidate(); toast({ title: "Categoria excluída.", variant: "destructive" }); setDeleteTarget(null); },
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setIsModalOpen(true); };
  const openEdit = (c: Category) => { setEditing(c); setForm({ name: c.name, description: c.description || "", active: c.active }); setIsModalOpen(true); };
  const closeModal = () => { setIsModalOpen(false); setEditing(null); };
  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = { name: form.name, description: form.description || undefined, active: form.active };
    if (editing) {
      update.mutate({ id: editing.id, data });
    } else {
      create.mutate(data as any);
    }
  };

  const seedDefaults = async () => {
    let created = 0;
    for (const name of DEFAULT_CATEGORIES) {
      const exists = categories?.some(c => c.name === name);
      if (!exists) {
        await fetch('/api/categories', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description: null, active: true }),
        });
        created++;
      }
    }
    invalidate();
    toast({ title: `${created} categorias padrão adicionadas!` });
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Categorias de Produtos</h1>
          <p className="text-muted-foreground mt-1">Organize os produtos por tipo: frutas, snacks, industrializados, etc.</p>
        </div>
        <div className="flex gap-2">
          {(!categories || categories.length === 0) && (
            <button onClick={seedDefaults}
              className="flex items-center gap-2 px-4 py-2.5 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary/5 transition-colors text-sm">
              Adicionar padrões
            </button>
          )}
          <button
            data-testid="button-add-category"
            onClick={openCreate}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-all"
          >
            <Plus className="w-5 h-5" /> Nova Categoria
          </button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground text-xs uppercase tracking-wider">
              <th className="px-6 py-4 font-semibold">Categoria</th>
              <th className="px-6 py-4 font-semibold">Descrição</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Carregando...</td></tr>
            ) : !categories?.length ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                <p className="font-medium mb-2">Nenhuma categoria cadastrada.</p>
                <button onClick={seedDefaults} className="text-primary font-bold hover:underline text-sm">
                  Clique aqui para adicionar as categorias padrão
                </button>
              </td></tr>
            ) : (
              categories.map(cat => (
                <tr key={cat.id} className="hover:bg-muted/10 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Tag className="w-5 h-5 text-primary" />
                      </div>
                      <p className="font-bold text-foreground">{cat.name}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground text-sm">{cat.description || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${cat.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {cat.active ? <><CheckCircle className="w-3 h-3" /> Ativa</> : <><XCircle className="w-3 h-3" /> Inativa</>}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(cat)} className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(cat)} className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal} title={editing ? `Editar: ${editing.name}` : "Nova Categoria"} maxWidth="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Nome *</label>
            <input required value={form.name} onChange={e => set("name", e.target.value)}
              placeholder="ex: Frutas In Natura"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Descrição</label>
            <input value={form.description} onChange={e => set("description", e.target.value)}
              placeholder="ex: Frutas frescas sem processamento"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Status</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => set("active", true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${form.active ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground'}`}>
                <CheckCircle className="w-4 h-4" /> Ativa
              </button>
              <button type="button" onClick={() => set("active", false)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${!form.active ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground'}`}>
                <XCircle className="w-4 h-4" /> Inativa
              </button>
            </div>
          </div>
          <button type="submit" disabled={isPending}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50">
            {isPending ? "Salvando..." : editing ? "Salvar Alterações" : "Criar Categoria"}
          </button>
        </form>
      </Modal>

      {/* Delete Confirm */}
      {deleteTarget && (
        <Modal isOpen onClose={() => setDeleteTarget(null)} title="Excluir Categoria" maxWidth="max-w-sm">
          <div className="space-y-4">
            <div className="p-4 bg-red-50 rounded-xl border border-red-200 text-center">
              <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-2" />
              <p className="font-bold text-red-800">Excluir "{deleteTarget.name}"?</p>
              <p className="text-sm text-red-600 mt-1">Esta ação não pode ser desfeita.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border-2 border-border rounded-xl font-bold text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
              <button onClick={() => remove.mutate(deleteTarget.id)} disabled={remove.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50">
                {remove.isPending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
