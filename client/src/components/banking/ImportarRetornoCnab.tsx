import { useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileCheck2, History } from "lucide-react";

/**
 * BANCO.4 — Upload de arquivo CNAB 240 de retorno (Itaú)
 *
 * Consome o endpoint EXISTENTE `POST /api/bank/retorno/itau` (BANCO.3).
 * Responsabilidade única: enviar o .ret e exibir o resumo do processamento.
 * NÃO faz parsing, NÃO duplica lógica de baixa, NÃO altera nada no backend.
 */

interface RetornoResult {
  success?: boolean;
  totalProcessados?: number;
  pagosIdentificados?: number;
  baixasRealizadas?: number;
  jaPagas?: number;
  naoEncontrados?: number;
  erros?: number;
  message?: string;
  duplicateOf?: { id: number; fileName: string; createdAt: string };
}

interface HistoricoItem {
  id: number;
  fileName: string;
  baixasRealizadas: number;
  erros: number;
  createdAt: string;
}

export function ImportarRetornoCnab() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RetornoResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // BANCO.5 — histórico de uploads (últimos 20)
  const { data: historico = [], isLoading: histLoading } = useQuery<HistoricoItem[]>({
    queryKey: ["/api/bank/retorno/historico"],
  });

  async function handleUpload() {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const res = await fetchWithAuth("/api/bank/retorno/itau", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.message || `Erro HTTP ${res.status}`);
      } else if (data?.success === false) {
        // BANCO.6 — duplicidade: backend devolve 200 + success:false
        const dup = data?.duplicateOf;
        const dupMsg = dup
          ? `${data.message} (arquivo "${dup.fileName}" — importado em ${new Date(dup.createdAt).toLocaleString("pt-BR")})`
          : data.message || "Arquivo já foi importado anteriormente";
        setErrorMsg(dupMsg);
      } else {
        setResult(data);
        queryClient.invalidateQueries({ queryKey: ["/api/bank/retorno/historico"] });
      }
    } catch (err: any) {
      console.error("[CNAB] erro upload", err);
      setErrorMsg(err?.message || "Falha ao enviar arquivo");
    } finally {
      setLoading(false);
    }
  }

  function fmtDate(s: string) {
    try {
      return new Date(s).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return s;
    }
  }

  return (
    <div
      className="rounded-2xl border bg-card p-4 mt-6"
      data-testid="card-importar-retorno-cnab"
    >
      <div className="flex items-center gap-2 mb-3">
        <Upload className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">
          Importar retorno bancário (Itaú)
        </h3>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Envie o arquivo <code className="font-mono">.ret</code> baixado do
        Itaú. As contas a receber correspondentes serão baixadas
        automaticamente.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="file"
          accept=".ret,.txt"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setErrorMsg(null);
          }}
          data-testid="input-file-retorno-cnab"
          className="text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-muted file:text-foreground file:cursor-pointer hover:file:bg-muted/70"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || loading}
          data-testid="button-processar-retorno-cnab"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Processando...
            </>
          ) : (
            <>
              <FileCheck2 className="w-3.5 h-3.5" />
              Processar retorno
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div
          className="mt-4 p-3 border rounded-md bg-red-50 dark:bg-red-900/20 border-red-200 text-sm text-red-700 dark:text-red-400"
          data-testid="text-retorno-cnab-error"
        >
          {errorMsg}
        </div>
      )}

      {result && (
        <div
          className="mt-4 p-4 border rounded-md bg-muted/40 text-sm"
          data-testid="card-retorno-cnab-result"
        >
          <p data-testid="text-retorno-total">
            Total processados: <strong>{result.totalProcessados ?? 0}</strong>
          </p>
          <p data-testid="text-retorno-pagos-identificados">
            Pagos identificados:{" "}
            <strong>{result.pagosIdentificados ?? 0}</strong>
          </p>
          <p data-testid="text-retorno-baixas">
            Baixas realizadas:{" "}
            <strong className="text-green-700 dark:text-green-400">
              {result.baixasRealizadas ?? 0}
            </strong>
          </p>
          <p data-testid="text-retorno-ja-pagas">
            Já estavam pagos: <strong>{result.jaPagas ?? 0}</strong>
          </p>
          <p data-testid="text-retorno-nao-encontrados">
            Não encontrados: <strong>{result.naoEncontrados ?? 0}</strong>
          </p>
          <p data-testid="text-retorno-erros">
            Erros:{" "}
            <strong
              className={
                (result.erros ?? 0) > 0
                  ? "text-red-700 dark:text-red-400"
                  : ""
              }
            >
              {result.erros ?? 0}
            </strong>
          </p>
        </div>
      )}

      {/* BANCO.5 — histórico de importações */}
      <div className="mt-6" data-testid="section-cnab-historico">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-muted-foreground">
            Importações recentes
          </h4>
        </div>
        {histLoading ? (
          <p className="text-xs text-muted-foreground">Carregando histórico...</p>
        ) : historico.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-cnab-historico-vazio"
          >
            Nenhuma importação registrada ainda.
          </p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">
                    Arquivo
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">
                    Data
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">
                    Baixas
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">
                    Erros
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {historico.map((h) => (
                  <tr
                    key={h.id}
                    className="hover:bg-muted/30"
                    data-testid={`row-cnab-historico-${h.id}`}
                  >
                    <td
                      className="px-3 py-2 font-mono truncate max-w-[260px]"
                      data-testid={`text-cnab-historico-filename-${h.id}`}
                    >
                      {h.fileName}
                    </td>
                    <td
                      className="px-3 py-2 text-muted-foreground"
                      data-testid={`text-cnab-historico-date-${h.id}`}
                    >
                      {fmtDate(h.createdAt)}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400"
                      data-testid={`text-cnab-historico-baixas-${h.id}`}
                    >
                      {h.baixasRealizadas}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        h.erros > 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-muted-foreground"
                      }`}
                      data-testid={`text-cnab-historico-erros-${h.id}`}
                    >
                      {h.erros}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
