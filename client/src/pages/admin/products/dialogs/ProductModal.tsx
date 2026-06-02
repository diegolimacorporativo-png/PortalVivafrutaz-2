import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/Modal";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-catalog";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Package, DollarSign, CheckCircle, XCircle,
  Factory, Snowflake, AlignLeft, CalendarDays, AlertTriangle,
  Leaf, Loader2, Hash, Tags
} from "lucide-react";
import type { Product } from "@shared/schema";
import { useCategories } from "../hooks/useCategories";
import { ProductCategorySelector } from "./ProductCategorySelector";
import { emptyForm, productToForm, UNITS, DAYS } from "../constants";

interface ProductModalProps {
  isOpen: boolean;
  editingProduct: Product | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProductModal({ isOpen, editingProduct, onClose, onSaved }: ProductModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const { data: categories = [] } = useCategories();

  const [formData, setFormData] = useState(emptyForm);
  const [priceError, setPriceError] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [imageMode, setImageMode] = useState<"url" | "upload">("url");
  const [uploadingImage, setUploadingImage] = useState(false);

  // Reset form when modal opens/closes or editing product changes
  useEffect(() => {
    if (isOpen) {
      setFormData(editingProduct ? productToForm(editingProduct) : emptyForm);
      setPriceError(false);
      setCodeError(null);
      setDuplicateError(null);
    }
  }, [isOpen, editingProduct?.id]);

  // Load sub-categories when editing
  const { data: editingSubCats = [] } = useQuery<any[]>({
    queryKey: ['/api/products', editingProduct?.id, 'sub-categories'],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/products/${editingProduct?.id}/sub-categories`);
      return r.json();
    },
    enabled: !!editingProduct && isOpen,
  });

  useEffect(() => {
    if (editingProduct && editingSubCats.length > 0) {
      setFormData(prev => ({
        ...prev,
        categorySelections: editingSubCats.map((sc: any) => ({
          categoryName: sc.categoryName,
          price: String(sc.price),
        })),
      }));
    }
  }, [editingProduct?.id, editingSubCats]);

  // Clear unused pricing fields when switching mode
  useEffect(() => {
    if (formData.pricingMode === "category") {
      if (formData.basePrice !== "") {
        setFormData(prev => ({ ...prev, basePrice: "" }));
        setPriceError(false);
      }
    } else if (formData.pricingMode === "base") {
      if (formData.categorySelections.length > 0) {
        setFormData(prev => ({ ...prev, categorySelections: [] }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.pricingMode]);

  // Detect image mode from stored URL
  useEffect(() => {
    if (formData.imageUrl?.startsWith("/uploads")) {
      setImageMode("upload");
    } else if (formData.imageUrl) {
      setImageMode("url");
    }
  }, [formData.imageUrl]);

  function handleChangeImageMode(mode: "url" | "upload") {
    setImageMode(mode);
    setFormData(prev => ({ ...prev, imageUrl: null }));
  }

  async function handleUploadImage(file: File) {
    try {
      setUploadingImage(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth("/api/admin/products/upload-image", { method: "POST", body: fd });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as any)?.message || "Falha ao enviar a imagem");
      }
      const json = await res.json() as { imageUrl: string };
      setFormData(prev => ({ ...prev, imageUrl: json.imageUrl }));
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setUploadingImage(false);
    }
  }

  const set = (field: string, value: any) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const toggleDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter(d => d !== day)
        : [...prev.availableDays, day],
    }));
  };

  const checkCodeUniqueness = async (code: string) => {
    if (!code.trim()) { setCodeError(null); return; }
    try {
      const excludeId = editingProduct?.id;
      const url = `/api/products/check-code?code=${encodeURIComponent(code.trim())}${excludeId ? `&excludeId=${excludeId}` : ''}`;
      const res = await fetchWithAuth(url);
      const data = await res.json();
      if (data.exists) {
        setCodeError(`ID já cadastrado (produto: "${data.product?.name}"). Utilize outro ID ou edite o produto existente.`);
      } else {
        setCodeError(null);
      }
    } catch { setCodeError(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPriceError(false);
    setCodeError(null);
    setDuplicateError(null);

    let priceNum = 0;
    if (formData.pricingMode === "category") {
      if (formData.categorySelections.length === 0) {
        toast({ title: 'Selecione ao menos uma categoria', description: 'Escolha pelo menos uma categoria e informe o preço.', variant: 'destructive' });
        return;
      }
      const missingPrice = formData.categorySelections.find(s => !s.price || Number(s.price) <= 0);
      if (missingPrice) {
        toast({ title: `Preço ausente em "${missingPrice.categoryName}"`, description: 'Informe o preço para todas as categorias selecionadas.', variant: 'destructive' });
        return;
      }
    } else {
      priceNum = Number(formData.basePrice);
      if (!formData.basePrice || isNaN(priceNum) || priceNum <= 0) {
        setPriceError(true);
        toast({ title: 'Preço base obrigatório', description: 'Informe um preço base válido (maior que zero) antes de salvar.', variant: 'destructive' });
        return;
      }
    }

    if (imageMode === "url" && formData.imageUrl) {
      const trimmed = formData.imageUrl.trim();
      if (!/^https?:\/\//i.test(trimmed)) {
        toast({ title: "URL inválida", description: "A URL da imagem deve começar com http:// ou https://", variant: "destructive" });
        return;
      }
    }

    if (formData.productCode.trim()) {
      const excludeId = editingProduct?.id;
      const codeUrl = `/api/products/check-code?code=${encodeURIComponent(formData.productCode.trim())}${excludeId ? `&excludeId=${excludeId}` : ''}`;
      const codeRes = await fetchWithAuth(codeUrl);
      const codeData = await codeRes.json();
      if (codeData.exists) {
        const msg = `ID já cadastrado (produto: "${codeData.product?.name}"). Utilize outro ID ou edite o produto existente.`;
        setCodeError(msg);
        toast({ title: 'ID já cadastrado', description: msg, variant: 'destructive' });
        return;
      }
    }

    const dupUrl = `/api/products/check-duplicate?name=${encodeURIComponent(formData.name.trim())}&code=${encodeURIComponent(formData.productCode.trim())}${editingProduct ? `&excludeId=${editingProduct.id}` : ''}`;
    const dupRes = await fetchWithAuth(dupUrl);
    const dupData = await dupRes.json();
    if (dupData.exists) {
      const msg = `Produto já cadastrado com esse ID (produto existente: "${dupData.product?.name}").`;
      setDuplicateError(msg);
      toast({ title: 'Produto duplicado', description: msg, variant: 'destructive' });
      return;
    }

    const primaryCategory = formData.categorySelections[0]?.categoryName ?? "Geral";
    const payload: any = {
      name: formData.name,
      category: primaryCategory,
      unit: formData.unit,
      active: formData.active,
      basePrice: formData.pricingMode === "base" ? priceNum : null,
      isIndustrialized: formData.isIndustrialized,
      isSeasonal: formData.isSeasonal,
      outOfSeason: formData.outOfSeason,
      observation: formData.observation || null,
      curiosity: formData.curiosity || null,
      availableDays: formData.availableDays.length > 0 ? formData.availableDays : null,
      ncm: formData.ncm || null,
      cfop: formData.cfop || null,
      cst: formData.cst || null,
      commercialUnit: formData.commercialUnit || null,
      productCode: formData.productCode || null,
      importado: formData.importado === true,
      categoryAvailability: 'all',
      allowedCategories: null,
      pricingMode: formData.pricingMode,
      imageUrl: formData.imageUrl || null,
    };

    try {
      setSubmitting(true);
      let savedProductId: number;
      if (editingProduct) {
        await updateProduct.mutateAsync({ id: editingProduct.id, data: payload });
        savedProductId = editingProduct.id;
        await apiRequest('DELETE', `/api/products/${savedProductId}/sub-categories`, {});
      } else {
        const created = await createProduct.mutateAsync(payload);
        savedProductId = (created as any).id;
      }
      for (const sel of formData.categorySelections) {
        await apiRequest('POST', `/api/products/${savedProductId}/sub-categories`, {
          categoryName: sel.categoryName,
          price: String(Number(sel.price)),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/products', savedProductId, 'sub-categories'] });
      onSaved();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar produto', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingProduct ? `Editar: ${editingProduct.name}` : "Novo Produto"} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ID do Produto */}
        <div className={`p-4 rounded-xl border-2 ${codeError ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/30'}`}>
          <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
            <Hash className="w-4 h-4" /> ID do Produto Base
          </label>
          <div className="flex gap-2">
            <input
              value={formData.productCode}
              onChange={e => { set("productCode", e.target.value); setCodeError(null); }}
              onBlur={e => checkCodeUniqueness(e.target.value)}
              className={`flex-1 px-4 py-2.5 rounded-xl border-2 outline-none font-mono text-sm ${codeError ? 'border-red-400 focus:border-red-500 bg-white' : 'border-border focus:border-primary'}`}
              placeholder="ex: 001"
              data-testid="input-product-code"
            />
            <button type="button" data-testid="button-auto-generate-code"
              onClick={async () => {
                try {
                  const res = await fetchWithAuth('/api/products/next-code');
                  const data = await res.json();
                  set("productCode", data.nextCode);
                } catch { /* ignore */ }
              }}
              className="px-3 py-2.5 rounded-xl border-2 border-primary/30 text-primary hover:bg-primary/10 transition-colors text-xs font-bold whitespace-nowrap">
              Gerar Auto
            </button>
          </div>
          {codeError ? (
            <p className="flex items-start gap-1 text-xs text-red-700 font-semibold mt-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {codeError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5">Identifica o produto base. Produtos com mesmo ID são agrupados para análise de custo.</p>
          )}
        </div>

        {/* Nome */}
        <div>
          <label className="block text-sm font-semibold mb-1">Nome do Produto *</label>
          <input required value={formData.name} onChange={e => set("name", e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
            placeholder="ex: Banana Nanica" />
        </div>

        {/* Unidade */}
        <div>
          <label className="block text-sm font-semibold mb-1">Unidade *</label>
          <select value={formData.unit} onChange={e => set("unit", e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none">
            {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        {/* Observação */}
        <div>
          <label className="flex items-center gap-1 text-sm font-semibold mb-1">
            <AlignLeft className="w-4 h-4" /> Observação
          </label>
          <input value={formData.observation} onChange={e => set("observation", e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none"
            placeholder="ex: Display com 12 unidades, Bandeja com 6 potes..." />
          <p className="text-xs text-muted-foreground mt-1">Aparece no catálogo do cliente e nos relatórios.</p>
        </div>

        {/* Curiosidade */}
        <div className="p-4 rounded-xl border-2 border-amber-200 bg-amber-50">
          <label className="flex items-center gap-1 text-sm font-bold text-amber-800 mb-2">
            🍊 Curiosidade do Produto
          </label>
          <textarea value={formData.curiosity} onChange={e => set("curiosity", e.target.value)} rows={3}
            className="w-full px-3 py-2.5 rounded-xl border-2 border-amber-200 focus:border-amber-400 outline-none text-sm bg-white resize-none"
            placeholder="ex: A maçã contém antioxidantes naturais que ajudam a proteger o coração..." />
          <p className="text-xs text-amber-700 mt-1">Conteúdo educativo exibido no assistente virtual e no quadro de curiosidades.</p>
        </div>

        {/* Flags industrializado / sazonal */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border-2 border-orange-200 bg-orange-50">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={`w-10 h-6 rounded-full transition-colors ${formData.isIndustrialized ? 'bg-orange-500' : 'bg-muted'} relative flex-shrink-0`}
                onClick={() => set("isIndustrialized", !formData.isIndustrialized)}>
                <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.isIndustrialized ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className="font-bold text-sm text-orange-800 flex items-center gap-1"><Factory className="w-4 h-4" /> Industrializado</p>
                <p className="text-xs text-orange-600">Registrado no controle de industrializados</p>
              </div>
            </label>
          </div>
          <div className="p-4 rounded-xl border-2 border-blue-200 bg-blue-50">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={`w-10 h-6 rounded-full transition-colors ${formData.isSeasonal ? 'bg-blue-500' : 'bg-muted'} relative flex-shrink-0`}
                onClick={() => set("isSeasonal", !formData.isSeasonal)}>
                <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.isSeasonal ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className="font-bold text-sm text-blue-800 flex items-center gap-1"><Snowflake className="w-4 h-4" /> Sazonal</p>
                <p className="text-xs text-blue-600">Produto disponível sazonalmente</p>
              </div>
            </label>
          </div>
        </div>

        {/* Out of Season */}
        <div className={`p-4 rounded-xl border-2 transition-colors ${formData.outOfSeason ? 'border-red-300 bg-red-50' : 'border-border bg-muted/20'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <div className={`w-10 h-6 rounded-full transition-colors ${formData.outOfSeason ? 'bg-red-500' : 'bg-muted'} relative flex-shrink-0`}
              onClick={() => set("outOfSeason", !formData.outOfSeason)}
              data-testid="toggle-out-of-season">
              <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all ${formData.outOfSeason ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className={`font-bold text-sm flex items-center gap-1 ${formData.outOfSeason ? 'text-red-800' : 'text-foreground'}`}>
                <Leaf className="w-4 h-4" /> Safra Encerrada / Produto Indisponível
              </p>
              <p className={`text-xs ${formData.outOfSeason ? 'text-red-600' : 'text-muted-foreground'}`}>
                {formData.outOfSeason
                  ? 'Alerta ativo — sistema verificará pedidos existentes com este produto'
                  : 'Ativar quando o produto estiver temporariamente indisponível por safra'}
              </p>
            </div>
          </label>
        </div>

        {/* Dados Fiscais */}
        <div className="p-4 rounded-xl border-2 border-violet-200 bg-violet-50">
          <label className="flex items-center gap-1 text-sm font-bold text-violet-800 mb-3">
            <span className="text-xs bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Dados Fiscais</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-violet-700 mb-1">NCM</label>
              <input value={formData.ncm} onChange={e => set("ncm", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                placeholder="ex: 0803.10.00" />
              <p className="text-xs text-muted-foreground mt-0.5">Nomenclatura Comum do Mercosul</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-violet-700 mb-1">CFOP</label>
              <input value={formData.cfop} onChange={e => set("cfop", e.target.value)}
                data-testid="input-product-cfop"
                className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                placeholder="ex: 5102" />
              <p className="text-xs text-muted-foreground mt-0.5">Código Fiscal de Operações</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-violet-700 mb-1">CST (ICMS)</label>
              <select value={formData.cst} onChange={e => set("cst", e.target.value)}
                data-testid="select-product-cst"
                className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm bg-white">
                <option value="">Padrão (00)</option>
                <option value="00">00 — Tributada integralmente</option>
                <option value="20">20 — Com redução de BC</option>
                <option value="40">40 — Isenta</option>
                <option value="60">60 — ICMS cobrado anteriormente por ST</option>
              </select>
              <p className="text-xs text-muted-foreground mt-0.5">Lucro Presumido/Real. Ignorado no Simples Nacional.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-violet-700 mb-1">Unid. Comercial</label>
              <input value={formData.commercialUnit} onChange={e => set("commercialUnit", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border-2 border-violet-200 focus:border-violet-400 outline-none text-sm"
                placeholder="ex: KG, UN, CX" />
              <p className="text-xs text-muted-foreground mt-0.5">Para NF-e</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-violet-200">
            <label className="flex items-start gap-2 cursor-pointer" data-testid="label-product-importado">
              <input type="checkbox" checked={formData.importado}
                onChange={(e) => set("importado", e.target.checked)}
                data-testid="checkbox-product-importado"
                className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-violet-800">Produto importado (ICMS 4%)</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Marque apenas se o produto for importado ou possuir conteúdo de importação relevante. Aplica alíquota de 4% independentemente do estado de destino.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Dias de Venda */}
        <div>
          <label className="flex items-center gap-1 text-sm font-semibold mb-2">
            <CalendarDays className="w-4 h-4" /> Dias de Venda Disponíveis
          </label>
          <p className="text-xs text-muted-foreground mb-2">Deixe em branco para disponível todos os dias.</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(day => (
              <button key={day} type="button" onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition-all ${formData.availableDays.includes(day) ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}>
                {day.split('-')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Modo de Precificação */}
        <div className="rounded-2xl border-2 border-border bg-muted/20 p-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Modo de Precificação</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className={`flex-1 cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${formData.pricingMode === 'category' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-border bg-background hover:border-indigo-300'}`}
              data-testid="radio-pricing-mode-category">
              <input type="radio" name="pricingMode" value="category"
                checked={formData.pricingMode === 'category'} onChange={() => set('pricingMode', 'category')}
                className="w-4 h-4 accent-indigo-600" />
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground flex items-center gap-1.5"><Tags className="w-4 h-4 text-indigo-600" /> Preço por categoria</p>
                <p className="text-xs text-muted-foreground">Um preço por sub-categoria do produto.</p>
              </div>
            </label>
            <label className={`flex-1 cursor-pointer flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${formData.pricingMode === 'base' ? 'border-primary bg-primary/10' : 'border-border bg-background hover:border-primary/50'}`}
              data-testid="radio-pricing-mode-base">
              <input type="radio" name="pricingMode" value="base"
                checked={formData.pricingMode === 'base'} onChange={() => set('pricingMode', 'base')}
                className="w-4 h-4 accent-primary" />
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-primary" /> Preço base único</p>
                <p className="text-xs text-muted-foreground">Um único preço aplicado ao produto.</p>
              </div>
            </label>
          </div>
        </div>

        {/* Categorias + Preços */}
        {formData.pricingMode === 'category' && (
          <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/20 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-indigo-600 text-white">
              <Tags className="w-4 h-4" />
              <span className="text-sm font-bold">Categorias + Preços <span className="text-indigo-300">*</span></span>
              <span className="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded-full">
                {formData.categorySelections.length} selecionada{formData.categorySelections.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="p-4">
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mb-3">
                Selecione as categorias aplicáveis ao produto e informe o preço de cada uma. Categorias são gerenciadas na aba <strong>Categorias</strong>.
              </p>
              <ProductCategorySelector
                dbCategories={categories}
                selections={formData.categorySelections}
                onChange={(sel) => set('categorySelections', sel)}
              />
              {formData.categorySelections.length === 0 && (
                <p className="text-xs text-orange-600 mt-3 flex items-center gap-1 font-semibold">
                  <AlertTriangle className="w-3 h-3" /> Selecione ao menos uma categoria com preço
                </p>
              )}
            </div>
          </div>
        )}

        {/* Base Price */}
        {formData.pricingMode === 'base' && (
          <div className={`p-4 rounded-xl border-2 ${priceError ? 'border-red-400 bg-red-50' : 'border-primary/20 bg-primary/5'}`}>
            <label className={`flex items-center gap-2 text-sm font-bold mb-2 ${priceError ? 'text-red-600' : 'text-primary'}`}>
              <DollarSign className="w-4 h-4" /> Preço Base Interno (R$) <span className="text-red-500">*</span>
            </label>
            <input type="number" step="0.01" min="0"
              value={formData.basePrice}
              onChange={e => { set("basePrice", e.target.value); if (priceError) setPriceError(false); }}
              placeholder="Ex: 5,90"
              data-testid="input-product-price"
              className={`w-full px-4 py-2.5 rounded-xl border-2 focus:outline-none text-lg font-bold ${priceError ? 'border-red-400 focus:border-red-500 bg-white' : 'border-border focus:border-primary'}`}
            />
            {priceError ? (
              <p className="flex items-center gap-1.5 text-xs text-red-600 font-semibold mt-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Preço obrigatório. Informe um valor maior que zero.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">Preço base interno. Preço final ao cliente = base × (1 + taxa admin / 100).</p>
            )}
          </div>
        )}

        {/* Imagem do Produto */}
        <div className="rounded-2xl border-2 border-border bg-muted/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Package className="w-4 h-4" /> Imagem do produto
              <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </label>
            {formData.imageUrl && (
              <button type="button" onClick={() => setFormData(prev => ({ ...prev, imageUrl: null }))}
                className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline"
                data-testid="button-remove-image">
                Remover imagem
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => handleChangeImageMode("url")}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${imageMode === "url" ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
              data-testid="button-image-mode-url">
              Usar URL
            </button>
            <button type="button" onClick={() => handleChangeImageMode("upload")}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${imageMode === "upload" ? 'bg-primary text-white border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
              data-testid="button-image-mode-upload">
              Enviar arquivo
            </button>
          </div>
          {imageMode === "url" && (
            <input type="url" placeholder="https://exemplo.com/imagem.jpg"
              value={formData.imageUrl ?? ""}
              onChange={e => set("imageUrl", e.target.value || null)}
              data-testid="input-image-url"
              className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary focus:outline-none text-sm"
            />
          )}
          {imageMode === "upload" && (
            <div className="space-y-2">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadImage(f); e.target.value = ""; }}
                disabled={uploadingImage}
                data-testid="input-image-file"
                className="block w-full text-xs text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-white file:font-bold file:cursor-pointer hover:file:bg-primary/90 disabled:opacity-50"
              />
              {uploadingImage && <p className="text-xs text-muted-foreground">Enviando arquivo…</p>}
              <p className="text-xs text-muted-foreground">Formatos: JPG, PNG, WEBP ou GIF · Máx. 5MB.</p>
            </div>
          )}
          {formData.imageUrl && (
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <img src={formData.imageUrl} alt="Pré-visualização do produto"
                onError={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.title = "Imagem indisponível"; }}
                className="w-20 h-20 object-cover rounded-lg border-2 border-border bg-white"
                data-testid="img-product-preview"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground">Pré-visualização</p>
                <p className="text-xs text-muted-foreground truncate" title={formData.imageUrl}>
                  {formData.imageUrl.startsWith("/uploads") ? "Arquivo enviado" : formData.imageUrl}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-semibold mb-2">Status</label>
          <div className="flex gap-3">
            <button type="button" onClick={() => set("active", true)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${formData.active ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground hover:border-green-400'}`}>
              <CheckCircle className="w-4 h-4" /> Ativo
            </button>
            <button type="button" onClick={() => set("active", false)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all ${!formData.active ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground hover:border-red-400'}`}>
              <XCircle className="w-4 h-4" /> Inativo
            </button>
          </div>
        </div>

        {/* Validation errors */}
        {(codeError || duplicateError) && (
          <div className="p-3 rounded-xl border-2 border-red-300 bg-red-50 space-y-1">
            {codeError && (
              <p className="flex items-start gap-1.5 text-xs text-red-700 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {codeError}
              </p>
            )}
            {duplicateError && (
              <p className="flex items-start gap-1.5 text-xs text-red-700 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {duplicateError}
              </p>
            )}
          </div>
        )}

        <button type="submit" disabled={submitting}
          data-testid="button-submit-product"
          className="w-full py-3 bg-primary text-white font-bold rounded-xl shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? "Salvando..." : editingProduct ? "Salvar Alterações" : "Adicionar Produto"}
        </button>
      </form>
    </Modal>
  );
}
