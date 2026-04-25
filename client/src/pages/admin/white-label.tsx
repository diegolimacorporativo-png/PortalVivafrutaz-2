import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { normalizeList } from "@/lib/normalizeResponse";
import { useToast } from "@/hooks/use-toast";
import { Layout } from "@/components/Layout";
import {
  Palette, Upload, Globe, Type, Zap, Eye, Save, Loader2,
  Building2, Image, CheckCircle2, RefreshCw, X
} from "lucide-react";

interface EmpresaConfig {
  id?: number;
  empresaId: number;
  logoEmpresa?: string | null;
  logoType?: string;
  corPrimaria?: string;
  corSecundaria?: string;
  dominioPersonalizado?: string | null;
  nomePersonalizado?: string | null;
  sloganPersonalizado?: string | null;
  ativo?: boolean;
}

interface Company {
  id: number;
  companyName: string;
  email: string;
}

const DEFAULT_CONFIG: Partial<EmpresaConfig> = {
  corPrimaria: "#22c55e",
  corSecundaria: "#16a34a",
  ativo: true,
};

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-semibold text-foreground min-w-32">{label}</label>
      <div className="flex items-center gap-2 border-2 border-border rounded-xl px-3 py-2 hover:border-primary/50 transition-colors">
        <input
          type="color"
          value={value || "#22c55e"}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
        />
        <span className="font-mono text-sm text-muted-foreground">{value || "#22c55e"}</span>
      </div>
    </div>
  );
}

function LogoUploader({ logo, logoType, onUpload, onRemove }: {
  logo?: string | null;
  logoType?: string;
  onUpload: (base64: string, type: string) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Selecione uma imagem (PNG, JPG, SVG)", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 2MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      onUpload(base64, file.type);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {logo ? (
        <div className="flex items-center gap-4">
          <div className="w-24 h-16 rounded-xl border-2 border-border overflow-hidden bg-muted flex items-center justify-center">
            <img src={`data:${logoType || "image/png"};base64,${logo}`} alt="Logo" className="max-w-full max-h-full object-contain" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold hover:border-primary/50 transition-colors">
              <Upload className="w-4 h-4" /> Trocar
            </button>
            <button type="button" onClick={onRemove}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors">
              <X className="w-4 h-4" /> Remover
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()}
          data-testid="button-upload-logo"
          className="flex items-center gap-3 px-5 py-3 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all">
          <Upload className="w-5 h-5 text-muted-foreground" />
          <div className="text-left">
            <p className="text-sm font-semibold text-foreground">Clique para fazer upload</p>
            <p className="text-xs text-muted-foreground">PNG, JPG ou SVG — máx. 2MB</p>
          </div>
        </button>
      )}
    </div>
  );
}

export default function WhiteLabelPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<EmpresaConfig>>({ ...DEFAULT_CONFIG });
  const [preview, setPreview] = useState(false);

  const { data: companies = [], isLoading: loadingCompanies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    select: normalizeList,
  });

  const { data: config, isLoading: loadingConfig } = useQuery<EmpresaConfig | null>({
    queryKey: ["/api/empresa-config", selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return null;
      const r = await fetch(`/api/empresa-config/${selectedCompanyId}`);
      if (r.status === 404) return null;
      const data = await r.json();
      setForm(data ? { ...DEFAULT_CONFIG, ...data } : { ...DEFAULT_CONFIG, empresaId: selectedCompanyId! });
      return data;
    },
    enabled: !!selectedCompanyId,
  });

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/empresa-config/${selectedCompanyId}`, { ...form, empresaId: selectedCompanyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/empresa-config", selectedCompanyId] });
      toast({ title: "Configurações salvas", description: "White Label atualizado com sucesso!" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  function set(key: keyof EmpresaConfig, value: any) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Palette className="w-7 h-7 text-primary" />
              White Label por Empresa
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Personalize logo, cores e identidade visual para cada empresa cliente
            </p>
          </div>
          {selectedCompanyId && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setPreview(!preview)}
                data-testid="button-toggle-preview"
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${preview ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                <Eye className="w-4 h-4" /> {preview ? "Esconder" : "Visualizar"}
              </button>
              <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                data-testid="button-save-white-label"
                className="flex items-center gap-2 px-5 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          )}
        </div>

        {/* Company Selector */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <label className="block text-sm font-bold mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Selecionar Empresa
          </label>
          {loadingCompanies ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando empresas...
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {companies.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setSelectedCompanyId(c.id); setForm({ ...DEFAULT_CONFIG }); }}
                  data-testid={`button-company-${c.id}`}
                  className={`text-left px-3 py-2.5 rounded-xl border-2 text-sm transition-all ${
                    selectedCompanyId === c.id
                      ? "border-primary bg-primary/5 text-primary font-semibold"
                      : "border-border hover:border-primary/40 text-foreground"
                  }`}
                >
                  <div className="font-semibold truncate">{c.companyName}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedCompanyId && (
          <>
            {loadingConfig ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Logo */}
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <h2 className="font-bold text-base flex items-center gap-2">
                    <Image className="w-5 h-5 text-primary" /> Logo da Empresa
                  </h2>
                  <LogoUploader
                    logo={form.logoEmpresa}
                    logoType={form.logoType}
                    onUpload={(base64, type) => { set("logoEmpresa", base64); set("logoType", type); }}
                    onRemove={() => { set("logoEmpresa", null); }}
                  />
                  <p className="text-xs text-muted-foreground">
                    A logo será exibida nos documentos, DANFE, e no portal da empresa
                  </p>
                </div>

                {/* Colors */}
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <h2 className="font-bold text-base flex items-center gap-2">
                    <Palette className="w-5 h-5 text-primary" /> Cores da Marca
                  </h2>
                  <ColorPicker label="Cor Primária" value={form.corPrimaria || "#22c55e"} onChange={v => set("corPrimaria", v)} />
                  <ColorPicker label="Cor Secundária" value={form.corSecundaria || "#16a34a"} onChange={v => set("corSecundaria", v)} />
                  <div className="flex gap-2 pt-2">
                    <div className="flex-1 h-8 rounded-lg" style={{ backgroundColor: form.corPrimaria || "#22c55e" }} />
                    <div className="flex-1 h-8 rounded-lg" style={{ backgroundColor: form.corSecundaria || "#16a34a" }} />
                  </div>
                </div>

                {/* Identity */}
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4 md:col-span-2">
                  <h2 className="font-bold text-base flex items-center gap-2">
                    <Type className="w-5 h-5 text-primary" /> Identidade Personalizada
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Nome Personalizado</label>
                      <input
                        type="text"
                        value={form.nomePersonalizado || ""}
                        onChange={e => set("nomePersonalizado", e.target.value)}
                        placeholder={selectedCompany?.companyName || "Nome da empresa..."}
                        data-testid="input-nome-personalizado"
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Slogan</label>
                      <input
                        type="text"
                        value={form.sloganPersonalizado || ""}
                        onChange={e => set("sloganPersonalizado", e.target.value)}
                        placeholder="Seu slogan aqui..."
                        data-testid="input-slogan"
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-primary" /> Domínio Personalizado
                      </label>
                      <input
                        type="text"
                        value={form.dominioPersonalizado || ""}
                        onChange={e => set("dominioPersonalizado", e.target.value)}
                        placeholder="empresa.vivafrutaz.com.br"
                        data-testid="input-dominio"
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm font-mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Configure o DNS apontando para este servidor para ativar o domínio personalizado
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => set("ativo", !form.ativo)}
                      data-testid="toggle-ativo"
                      className={`relative w-12 h-6 rounded-full transition-colors ${form.ativo ? "bg-primary" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.ativo ? "translate-x-7" : "translate-x-1"}`} />
                    </button>
                    <span className="text-sm font-semibold">White Label Ativo</span>
                    {form.ativo && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3 inline mr-1" />Ativo
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Preview */}
            {preview && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h2 className="font-bold text-base mb-4 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-primary" /> Pré-visualização
                </h2>
                <div className="border-2 border-border rounded-xl overflow-hidden">
                  {/* Mock header */}
                  <div className="px-6 py-4 flex items-center gap-4" style={{ backgroundColor: form.corPrimaria || "#22c55e" }}>
                    {form.logoEmpresa ? (
                      <img src={`data:${form.logoType || "image/png"};base64,${form.logoEmpresa}`} alt="Logo" className="h-10 w-auto object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                        <Zap className="w-6 h-6 text-white" />
                      </div>
                    )}
                    <div>
                      <div className="text-white font-bold text-lg">{form.nomePersonalizado || selectedCompany?.companyName || "Empresa"}</div>
                      {form.sloganPersonalizado && (
                        <div className="text-white/80 text-xs">{form.sloganPersonalizado}</div>
                      )}
                    </div>
                  </div>
                  {/* Mock nav */}
                  <div className="px-6 py-3 flex gap-4 text-sm border-b border-border" style={{ borderTop: `2px solid ${form.corSecundaria || "#16a34a"}` }}>
                    {["Dashboard", "Pedidos", "Financeiro", "Relatórios"].map(item => (
                      <span key={item} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors">{item}</span>
                    ))}
                  </div>
                  <div className="px-6 py-4 bg-muted/30 text-center text-sm text-muted-foreground">
                    Portal personalizado — {form.dominioPersonalizado || `${selectedCompany?.companyName?.toLowerCase().replace(/\s+/g, '-')}.vivafrutaz.com.br`}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!selectedCompanyId && !loadingCompanies && (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl">
            <Palette className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
            <h3 className="font-bold text-lg text-foreground mb-2">Selecione uma Empresa</h3>
            <p className="text-sm text-muted-foreground">
              Escolha uma empresa acima para configurar seu White Label
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
