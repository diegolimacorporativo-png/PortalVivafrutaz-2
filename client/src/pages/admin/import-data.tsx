import { useState, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, FileSpreadsheet, AlertCircle, CheckCircle2,
  Loader2, X, Eye, Download, Package, Users, RefreshCw, FileCode2,
  ChevronRight, Info,
} from "lucide-react";

type PreviewRow = Record<string, any>;
type ImportMode = "auto" | "products" | "clients";
type ImportStatus = "idle" | "previewing" | "ready" | "importing" | "done" | "error";

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  produto: { label: "Produto", color: "bg-green-100 text-green-700" },
  cliente: { label: "Cliente", color: "bg-blue-100 text-blue-700" },
  pedido:  { label: "Pedido",  color: "bg-orange-100 text-orange-700" },
};

function FileDropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const accept = ".xlsx,.xls,.csv,.xml";

  return (
    <div
      className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer
        ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}
        ${disabled ? "opacity-50 pointer-events-none" : ""}
      `}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      data-testid="dropzone-import"
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        data-testid="input-import-file"
      />
      <Upload className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
      <p className="font-semibold text-foreground mb-1">Arraste e solte ou clique para selecionar</p>
      <p className="text-sm text-muted-foreground">Suportado: <strong>.xlsx</strong>, <strong>.xls</strong>, <strong>.csv</strong>, <strong>.xml</strong> (NF-e)</p>
      <p className="text-xs text-muted-foreground mt-2">Tamanho máximo: 20 MB</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ImportStatus }) {
  if (status === "previewing") return <span className="flex items-center gap-1.5 text-blue-600 text-sm font-medium"><Loader2 className="w-4 h-4 animate-spin" /> Lendo arquivo...</span>;
  if (status === "importing") return <span className="flex items-center gap-1.5 text-orange-600 text-sm font-medium"><Loader2 className="w-4 h-4 animate-spin" /> Importando...</span>;
  if (status === "done") return <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium"><CheckCircle2 className="w-4 h-4" /> Concluído</span>;
  if (status === "error") return <span className="flex items-center gap-1.5 text-red-600 text-sm font-medium"><AlertCircle className="w-4 h-4" /> Erro</span>;
  return null;
}

function PreviewTable({ rows, selectedRows, onToggle, onToggleAll }: {
  rows: PreviewRow[];
  selectedRows: Set<number>;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
}) {
  const allCols = Array.from(new Set(rows.flatMap(r => Object.keys(r)))).slice(0, 10);
  const visible = allCols.filter(c => !["isOrderBridge"].includes(c));
  const allSelected = rows.length > 0 && rows.every((_, i) => selectedRows.has(i));

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="rounded"
                  data-testid="checkbox-select-all"
                />
              </th>
              {visible.map(col => (
                <th key={col} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const typeInfo = TYPE_LABELS[row.tipo] || TYPE_LABELS.produto;
              return (
                <tr
                  key={i}
                  className={`border-t border-border/50 transition-colors ${selectedRows.has(i) ? "bg-primary/5" : "hover:bg-muted/20"}`}
                  data-testid={`row-preview-${i}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(i)}
                      onChange={() => onToggle(i)}
                      className="rounded"
                      data-testid={`checkbox-row-${i}`}
                    />
                  </td>
                  {visible.map(col => (
                    <td key={col} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[180px] truncate">
                      {col === "tipo" ? (
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      ) : String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplateDownload() {
  const downloadCSV = () => {
    const csv = "codigo,nome,preco,quantidade,unidade,categoria\n001,Banana Nanica,2.30,50,KG,Frutas In Natura\n002,Maçã Gala,4.50,30,KG,Frutas In Natura\n003,Laranja Lima,3.00,40,KG,Frutas In Natura";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modelo_importacao_produtos.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={downloadCSV}
      className="flex items-center gap-2 text-sm text-primary hover:underline"
      data-testid="button-download-template"
    >
      <Download className="w-4 h-4" />
      Baixar modelo CSV de exemplo
    </button>
  );
}

export default function ImportData() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<ImportMode>("auto");
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[]; message: string } | null>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setStatus("previewing");
    setRows([]);
    setResult(null);

    const formData = new FormData();
    formData.append("file", f);

    try {
      const res = await fetchWithAuth("/api/import/preview", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro ao processar arquivo");
      const data = await res.json();
      setRows(data.rows || []);
      setSelectedRows(new Set((data.rows || []).map((_: any, i: number) => i)));
      setStatus("ready");
      toast({ title: `${data.total} linha(s) detectada(s)`, description: `Arquivo: ${data.filename}` });
    } catch (e: any) {
      setStatus("error");
      toast({ title: "Erro ao ler arquivo", description: e.message, variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (selectedRows.size === 0) {
      toast({ title: "Selecione ao menos uma linha", variant: "destructive" });
      return;
    }
    setStatus("importing");
    const rowsToImport = rows.filter((_, i) => selectedRows.has(i));
    try {
      const res = await fetchWithAuth("/api/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToImport, mode }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Erro na importação");
      const data = await res.json();
      setResult(data);
      setStatus("done");
      toast({ title: "Importação concluída!", description: data.message });
    } catch (e: any) {
      setStatus("error");
      toast({ title: "Erro na importação", description: e.message, variant: "destructive" });
    }
  };

  const handleReset = () => {
    setFile(null);
    setStatus("idle");
    setRows([]);
    setSelectedRows(new Set());
    setResult(null);
  };

  const toggleRow = (i: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (rows.every((_, i) => selectedRows.has(i))) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((_, i) => i)));
    }
  };

  const productos = rows.filter(r => r.tipo === "produto").length;
  const clientes = rows.filter(r => r.tipo === "cliente").length;
  const outros = rows.length - productos - clientes;

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Importar Dados
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Importe produtos, clientes e pedidos via Excel, CSV ou XML (NF-e 4.0)
            </p>
          </div>
          {status !== "idle" && (
            <Button type="button" variant="ghost" size="sm" onClick={handleReset} className="gap-1.5">
              <RefreshCw className="w-4 h-4" /> Nova importação
            </Button>
          )}
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-medium">Como funciona:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>Faça upload do arquivo — o sistema detecta automaticamente os dados</li>
              <li>Revise o preview e desmarque linhas que não deseja importar</li>
              <li>Produtos/clientes duplicados são ignorados automaticamente</li>
              <li>XML de NF-e importa produtos + destinatário como cliente</li>
            </ul>
          </div>
        </div>

        {/* Step 1: Upload */}
        {status === "idle" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">1</span>
              Selecionar arquivo
            </div>
            <FileDropzone onFile={handleFile} />
            <div className="flex items-center justify-between">
              <TemplateDownload />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileSpreadsheet className="w-3.5 h-3.5" /> .xlsx / .xls / .csv
                <FileCode2 className="w-3.5 h-3.5 ml-2" /> .xml (NF-e)
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {status === "previewing" && (
          <div className="text-center py-16">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary/40 mb-4" />
            <p className="font-medium text-foreground">Lendo arquivo...</p>
            <p className="text-sm text-muted-foreground mt-1">{file?.name}</p>
          </div>
        )}

        {/* Preview + import options */}
        {(status === "ready" || status === "importing" || status === "done") && rows.length > 0 && (
          <div className="space-y-5">
            {/* File info */}
            <div className="flex items-center gap-3 bg-card border border-border rounded-xl p-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{file?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {rows.length} linha(s) detectada(s)
                  {productos > 0 && <> · <span className="text-green-600">{productos} produto(s)</span></>}
                  {clientes > 0 && <> · <span className="text-blue-600">{clientes} cliente(s)</span></>}
                  {outros > 0 && <> · {outros} outro(s)</>}
                </p>
              </div>
              <StatusBadge status={status} />
            </div>

            {/* Mode selector */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                Tipo de importação
              </label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "auto", label: "Automático", icon: Eye },
                  { value: "products", label: "Forçar Produtos", icon: Package },
                  { value: "clients", label: "Forçar Clientes", icon: Users },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value as ImportMode)}
                    data-testid={`button-mode-${opt.value}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all
                      ${mode === opt.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary/50"}`}
                  >
                    <opt.icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">2</span>
                  Revisar preview ({selectedRows.size} de {rows.length} selecionado(s))
                </div>
              </div>
              <PreviewTable
                rows={rows}
                selectedRows={selectedRows}
                onToggle={toggleRow}
                onToggleAll={toggleAll}
              />
            </div>

            {/* Step 3: Import button */}
            {status !== "done" && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">3</span>
                  Importar dados
                </div>
                <Button
                  type="button"
                  onClick={handleImport}
                  disabled={status === "importing" || selectedRows.size === 0}
                  className="gap-2 ml-auto"
                  data-testid="button-execute-import"
                >
                  {status === "importing"
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando...</>
                    : <><ChevronRight className="w-4 h-4" /> Importar {selectedRows.size} linha(s)</>
                  }
                </Button>
              </div>
            )}

            {/* Result */}
            {status === "done" && result && (
              <div className={`rounded-xl border p-5 space-y-3 ${result.errors.length > 0 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="font-semibold text-green-800">{result.message}</p>
                </div>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-700 font-medium">✅ {result.created} criado(s)</span>
                  <span className="text-muted-foreground">⏭ {result.skipped} ignorado(s) (já existia)</span>
                  {result.errors.length > 0 && <span className="text-red-700">⚠ {result.errors.length} erro(s)</span>}
                </div>
                {result.errors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <p key={i} className="text-xs text-red-700 font-mono">{e}</p>
                    ))}
                    {result.errors.length > 5 && <p className="text-xs text-red-500">... e mais {result.errors.length - 5} erros</p>}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={handleReset} className="gap-2">
                  <RefreshCw className="w-4 h-4" /> Nova importação
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {status === "error" && rows.length === 0 && (
          <div className="text-center py-12 bg-red-50 border border-red-200 rounded-2xl">
            <AlertCircle className="w-10 h-10 mx-auto text-red-500 mb-3" />
            <p className="font-semibold text-red-700">Erro ao processar arquivo</p>
            <p className="text-sm text-muted-foreground mt-1">Verifique o formato e tente novamente</p>
            <Button type="button" variant="outline" size="sm" onClick={handleReset} className="mt-4">
              Tentar novamente
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
