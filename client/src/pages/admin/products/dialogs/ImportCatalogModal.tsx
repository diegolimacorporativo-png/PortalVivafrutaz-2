import { useState } from "react";
import { FileSpreadsheet, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/hooks/use-toast";

type Preview = { sourceSheets: string[]; sourceRows: number; categories: string[]; products: number; subCategories: number; variants: Array<{ name: string; unit: string; measure: string; category: string; prices: Array<{ category: string; price: number }> }> };
interface Props { isOpen: boolean; onClose: () => void; onImported: () => void; }
export function ImportCatalogModal({ isOpen, onClose, onImported }: Props) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const reset = () => { setFile(null); setPreview(null); setResult(null); };
  const close = () => { reset(); onClose(); };
  const send = async (mode: "preview" | "commit") => {
    if (!file) return;
    mode === "preview" ? setLoading(true) : setCommitting(true);
    try {
      const body = new FormData(); body.append("file", file); body.append("mode", mode);
      const response = await fetchWithAuth("/api/admin/products/import-order-catalog", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Falha ao importar");
      if (mode === "preview") setPreview(data); else { setResult(data); onImported(); }
    } catch (e: any) { toast({ title: "Importação não concluída", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); setCommitting(false); }
  };
  return <Modal isOpen={isOpen} onClose={close} title="Importar tabela de pedidos" maxWidth="max-w-3xl">
    <div className="space-y-5">
      <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 text-center">
        <FileSpreadsheet className="mx-auto h-10 w-10 text-primary mb-2" />
        <p className="font-semibold">Selecione um arquivo .xls ou .xlsx</p>
        <p className="text-xs text-muted-foreground mt-1">O importador lê os blocos de categorias, unidade/embalagem e preço unitário.</p>
        <input className="mt-4 block w-full text-sm" type="file" accept=".xls,.xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }} />
      </div>
      {file && !preview && !result && <button onClick={() => send("preview")} disabled={loading} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" /> : <Upload className="h-4 w-4" />} Ler e mostrar prévia</button>}
      {preview && !result && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="rounded-xl bg-muted p-3"><b className="text-xl">{preview.sourceRows}</b><p className="text-xs">linhas lidas</p></div>
          <div className="rounded-xl bg-muted p-3"><b className="text-xl">{preview.categories.length}</b><p className="text-xs">categorias</p></div>
          <div className="rounded-xl bg-muted p-3"><b className="text-xl">{preview.products}</b><p className="text-xs">produtos/variações</p></div>
          <div className="rounded-xl bg-muted p-3"><b className="text-xl">{preview.subCategories}</b><p className="text-xs">preços por categoria</p></div>
        </div>
        <div className="rounded-xl border p-3 max-h-44 overflow-auto"><p className="text-xs font-bold mb-2">Categorias identificadas</p><div className="flex flex-wrap gap-1.5">{preview.categories.map(c => <span key={c} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{c}</span>)}</div></div>
        <div className="flex gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 flex-shrink-0" />Produtos existentes com o mesmo nome e unidade serão atualizados; categorias/preços serão reaproveitados sem duplicação.</div>
        <button onClick={() => send("commit")} disabled={committing} className="w-full py-3 rounded-xl bg-green-600 text-white font-bold flex items-center justify-center gap-2">{committing ? <Loader2 className="animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar criação/atualização</button>
      </>}
      {result && <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 space-y-1"><p className="font-bold">Importação concluída</p><p className="text-sm">Categorias criadas: <b>{result.categoriesCreated}</b></p><p className="text-sm">Produtos criados: <b>{result.productsCreated}</b></p><p className="text-sm">Produtos atualizados: <b>{result.productsUpdated}</b></p><p className="text-sm">Preços por categoria criados: <b>{result.subCategoriesCreated}</b></p></div>}
    </div>
  </Modal>;
}
