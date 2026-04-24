import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Save } from "lucide-react";

interface Produto {
  nome: string;
  quantidade: number;
  preco: number;
  unidade: string;
}

export default function InsertNfManual() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [numeroNf, setNumeroNf] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [clienteFornecedor, setClienteFornecedor] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([{ nome: "", quantidade: 1, preco: 0, unidade: "UN" }]);
  const [impostos, setImpostos] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/nf-manual", data);
    },
    onSuccess: () => {
      toast({
        title: "Sucesso",
        description: "NF manual inserida com sucesso!",
      });
      // Reset form
      setNumeroNf("");
      setDataEmissao("");
      setClienteFornecedor("");
      setProdutos([{ nome: "", quantidade: 1, preco: 0, unidade: "UN" }]);
      setImpostos("");
      setObservacoes("");
      queryClient.invalidateQueries({ queryKey: ["/api/nf-manual"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Erro ao inserir NF manual",
        variant: "destructive",
      });
    },
  });

  const addProduto = () => {
    setProdutos([...produtos, { nome: "", quantidade: 1, preco: 0, unidade: "UN" }]);
  };

  const removeProduto = (index: number) => {
    setProdutos(produtos.filter((_, i) => i !== index));
  };

  const updateProduto = (index: number, field: keyof Produto, value: string | number) => {
    const newProdutos = [...produtos];
    newProdutos[index] = { ...newProdutos[index], [field]: value };
    setProdutos(newProdutos);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validações básicas
    if (!numeroNf.trim()) {
      toast({ title: "Erro", description: "Número da NF é obrigatório", variant: "destructive" });
      return;
    }
    if (!dataEmissao) {
      toast({ title: "Erro", description: "Data de emissão é obrigatória", variant: "destructive" });
      return;
    }
    if (!clienteFornecedor.trim()) {
      toast({ title: "Erro", description: "Cliente/Fornecedor é obrigatório", variant: "destructive" });
      return;
    }
    if (produtos.some(p => !p.nome.trim() || p.quantidade <= 0 || p.preco < 0)) {
      toast({ title: "Erro", description: "Produtos devem ter nome, quantidade > 0 e preço >= 0", variant: "destructive" });
      return;
    }

    mutation.mutate({
      numeroNf: numeroNf.trim(),
      dataEmissao,
      clienteFornecedor: clienteFornecedor.trim(),
      produtos,
      impostos: impostos ? JSON.parse(impostos) : null,
      observacoes: observacoes.trim() || null,
    });
  };

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Inserir Nota Fiscal Manual</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="numeroNf">Número NF *</Label>
                <Input
                  id="numeroNf"
                  value={numeroNf}
                  onChange={(e) => setNumeroNf(e.target.value)}
                  placeholder="Ex: 000123"
                  required
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="dataEmissao">Data de Emissão *</Label>
                <Input
                  id="dataEmissao"
                  type="date"
                  value={dataEmissao}
                  onChange={(e) => setDataEmissao(e.target.value)}
                  required
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="clienteFornecedor">Cliente/Fornecedor *</Label>
                <Input
                  id="clienteFornecedor"
                  value={clienteFornecedor}
                  onChange={(e) => setClienteFornecedor(e.target.value)}
                  placeholder="Nome do cliente ou fornecedor"
                  required
                  className="w-full"
                />
              </div>
            </div>

            <div>
              <Label>Produtos *</Label>
              <div className="space-y-2">
                {produtos.map((produto, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        placeholder="Nome do produto"
                        value={produto.nome}
                        onChange={(e) => updateProduto(index, "nome", e.target.value)}
                        required
                        className="w-full"
                      />
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <Input
                        type="number"
                        placeholder="Qtd"
                        value={produto.quantidade}
                        onChange={(e) => updateProduto(index, "quantidade", parseFloat(e.target.value) || 1)}
                        min="0.01"
                        step="0.01"
                        required
                        className="w-full sm:w-20"
                      />
                      <Input
                        type="number"
                        placeholder="Preço"
                        value={produto.preco}
                        onChange={(e) => updateProduto(index, "preco", parseFloat(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        required
                        className="w-full sm:w-24"
                      />
                      <Input
                        placeholder="Un"
                        value={produto.unidade}
                        onChange={(e) => updateProduto(index, "unidade", e.target.value)}
                        required
                        className="w-full sm:w-16"
                      />
                      {produtos.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeProduto(index)}
                          className="w-full sm:w-auto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addProduto}>
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Produto
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="impostos">Impostos (JSON opcional)</Label>
              <Textarea
                id="impostos"
                value={impostos}
                onChange={(e) => setImpostos(e.target.value)}
                placeholder='Ex: {"icms": 18, "ipi": 5}'
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações adicionais"
                rows={3}
              />
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
              <Save className="w-4 h-4 mr-2" />
              {mutation.isPending ? "Salvando..." : "Salvar NF Manual"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}