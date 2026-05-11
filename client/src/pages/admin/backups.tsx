import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  HardDrive, Plus, Download, RefreshCw, CheckCircle, WifiOff,
  Trash2, Send, AlertTriangle, Mail, X, Database, FileCode2, Loader2,
  ShieldCheck, Clock, BarChart3, CheckCircle2, XCircle, Info,
  FlaskConical, ClipboardList, Shield, Lock, AlertCircle,
  ChevronDown, ChevronUp, ListChecks,
} from "lucide-react";

// ─── Formatters ────────────────────────────────────────────────
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diffMs / 3600000);
  const d = Math.floor(diffMs / 86400000);
  if (d >= 1) return `há ${d} dia${d !== 1 ? "s" : ""}`;
  if (h >= 1) return `há ${h}h`;
  return "há menos de 1h";
}
function fmtSecs(s: number) {
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60);
  return `~${m}min`;
}

// ─── Types ─────────────────────────────────────────────────────
type Backup = { filename: string; size: number; createdAt: string; format: string };
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface BackupStats {
  totalBackups: number; jsonCount: number; sqlCount: number;
  totalSizeBytes: number;
  lastBackup: { filename: string; size: number; createdAt: string; format: string } | null;
  oldestBackup: { filename: string; createdAt: string } | null;
}
interface ValidationResult {
  valid: boolean; format: "json" | "sql" | "unknown"; filename: string;
  sizeBytes: number; generatedAt: string | null;
  tableCounts: Record<string, number>; totalRecords: number;
  issues: string[]; warnings: string[]; summary: string;
}
interface SandboxResult {
  correlationId: string; filename: string; ranAt: string; format: string;
  tableCounts: Record<string, number>; totalRecords: number;
  fkIssues: string[]; fkWarnings: string[]; duplicateIdIssues: string[];
  tenants: Array<{ id: number; name: string }>;
  restoreOrder: string[]; safeToSimulate: boolean; summary: string;
}
interface DryRunResult {
  correlationId: string; filename: string; format: string; ranAt: string;
  structuralValid: boolean; structuralIssues: string[];
  fkIssues: string[]; fkWarnings: string[]; duplicateIdIssues: string[];
  tenantCollisions: Array<{ id: number; name: string }>;
  idConflicts: Record<string, { backupCount: number; conflicts: number[] }>;
  sequenceMaxes: Record<string, number>; backupMaxes: Record<string, number>;
  tenantsInBackup: number; tenantNames: string[];
  tableCounts: Record<string, number>; totalRecords: number;
  riskLevel: RiskLevel; riskReasons: string[];
  safeToRestore: boolean; summary: string; recommendations: string[];
}
interface RestoreStep {
  order: number; table: string; records: number;
  dependsOn: string[]; riskNote: string; estimatedSeconds: number;
}
interface RestorePlan {
  correlationId: string; filename: string; generatedAt: string; format: string;
  totalTenants: number; tenantNames: string[];
  totalTables: number; totalRecords: number; backupSizeBytes: number; backupGeneratedAt: string | null;
  tenantCollisions: number; idConflicts: number; fkIssues: number;
  steps: RestoreStep[]; estimatedDurationSeconds: number;
  riskLevel: RiskLevel; operationalRisk: string;
  preRestoreChecklist: string[]; postRestoreChecklist: string[];
  blockers: string[]; canProceed: boolean;
}

// ─── Risk Badge ────────────────────────────────────────────────
function RiskBadge({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, { label: string; cls: string }> = {
    LOW:      { label: "Baixo",    cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    MEDIUM:   { label: "Médio",    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    HIGH:     { label: "Alto",     cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
    CRITICAL: { label: "Crítico",  cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  };
  const { label, cls } = map[level] ?? map.CRITICAL;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

// ─── Issue List ────────────────────────────────────────────────
function IssueList({ items, variant }: { items: string[]; variant: "error" | "warn" | "info" }) {
  const cls = {
    error: "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
    warn:  "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
    info:  "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300",
  }[variant];
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className={`text-xs border rounded-lg px-3 py-1.5 ${cls}`}>{item}</li>
      ))}
    </ul>
  );
}

// ─── Sandbox Modal ─────────────────────────────────────────────
function SandboxModal({ result, onClose }: { result: SandboxResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-card rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className={`p-5 flex items-start gap-3 border-b ${result.safeToSimulate ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${result.safeToSimulate ? 'bg-teal-100 dark:bg-teal-900/40' : 'bg-orange-100 dark:bg-orange-900/40'}`}>
            <FlaskConical className={`w-5 h-5 ${result.safeToSimulate ? 'text-teal-600' : 'text-orange-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-foreground">Restore Sandbox — Análise FK Interna</h3>
            <p className="text-xs text-muted-foreground truncate">{result.filename}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className={`p-3 rounded-xl border text-sm font-medium ${result.safeToSimulate ? 'bg-teal-50 dark:bg-teal-900/10 border-teal-200 text-teal-800 dark:text-teal-300' : 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 text-orange-800 dark:text-orange-300'}`}>
            {result.summary}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">Registros</p>
              <p className="text-sm font-bold">{result.totalRecords.toLocaleString()}</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">Tabelas</p>
              <p className="text-sm font-bold">{Object.keys(result.tableCounts).length}</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">Tenants</p>
              <p className="text-sm font-bold">{result.tenants.length}</p>
            </div>
          </div>
          {result.tenants.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Tenants no backup</h4>
              <div className="flex flex-wrap gap-1.5">
                {result.tenants.map(t => (
                  <span key={t.id} className="text-xs bg-muted px-2 py-1 rounded-lg font-medium">{t.name} <span className="text-muted-foreground">#{t.id}</span></span>
                ))}
              </div>
            </div>
          )}
          {result.fkIssues.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> FK quebradas ({result.fkIssues.length})</h4>
              <IssueList items={result.fkIssues} variant="error" />
            </div>
          )}
          {result.duplicateIdIssues.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> IDs duplicados</h4>
              <IssueList items={result.duplicateIdIssues} variant="error" />
            </div>
          )}
          {result.fkWarnings.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Avisos FK</h4>
              <IssueList items={result.fkWarnings} variant="warn" />
            </div>
          )}
          {result.fkIssues.length === 0 && result.duplicateIdIssues.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Todas as FKs íntegras — nenhum ID duplicado encontrado
            </div>
          )}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-muted-foreground" /> Ordem de restauração</h4>
            <div className="flex flex-wrap gap-1">
              {result.restoreOrder.map((t, i) => (
                <span key={t} className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{i + 1}. {t}</span>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">correlationId: <span className="font-mono">{result.correlationId}</span></p>
        </div>
        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} data-testid="button-close-sandbox" className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:opacity-90">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Dry-Run Modal ─────────────────────────────────────────────
function DryRunModal({ result, onClose }: { result: DryRunResult; onClose: () => void }) {
  const [showConflicts, setShowConflicts] = useState(false);
  const totalConflicts = Object.values(result.idConflicts).reduce((s, v) => s + v.conflicts.length, 0);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-card rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className={`p-5 flex items-start gap-3 border-b ${result.safeToRestore ? 'bg-green-50 dark:bg-green-900/20 border-green-200' : result.riskLevel === 'CRITICAL' ? 'bg-red-50 dark:bg-red-900/20 border-red-200' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${result.safeToRestore ? 'bg-green-100' : result.riskLevel === 'CRITICAL' ? 'bg-red-100' : 'bg-orange-100'}`}>
            <Shield className={`w-5 h-5 ${result.safeToRestore ? 'text-green-600' : result.riskLevel === 'CRITICAL' ? 'text-red-600' : 'text-orange-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg text-foreground">Restore Dry-Run</h3>
              <RiskBadge level={result.riskLevel} />
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{result.filename}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Summary */}
          <div className={`p-3 rounded-xl border text-sm font-medium ${result.safeToRestore ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/10 dark:border-red-800 dark:text-red-300'}`}>
            {result.summary}
          </div>

          {/* Overview grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tenants", value: result.tenantsInBackup },
              { label: "Registros", value: result.totalRecords.toLocaleString() },
              { label: "Colisões tenant", value: result.tenantCollisions.length, alert: result.tenantCollisions.length > 0 },
              { label: "Conflitos ID", value: totalConflicts, alert: totalConflicts > 0 },
            ].map(({ label, value, alert }) => (
              <div key={label} className={`rounded-xl p-3 ${alert ? 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800' : 'bg-muted/50'}`}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold ${alert ? 'text-red-700 dark:text-red-400' : 'text-foreground'}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Tenant collisions */}
          {result.tenantCollisions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Colisão de Tenants ({result.tenantCollisions.length})</h4>
              <IssueList items={result.tenantCollisions.map(t => `Company ID ${t.id}: "${t.name}" já existe no banco de produção`)} variant="error" />
            </div>
          )}

          {/* Risk reasons */}
          {result.riskReasons.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> Fatores de risco</h4>
              <IssueList items={result.riskReasons} variant="error" />
            </div>
          )}

          {/* FK issues */}
          {result.fkIssues.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-orange-700 dark:text-orange-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> FK quebradas ({result.fkIssues.length})</h4>
              <IssueList items={result.fkIssues} variant="warn" />
            </div>
          )}

          {/* ID conflicts (collapsible) */}
          {totalConflicts > 0 && (
            <div>
              <button onClick={() => setShowConflicts(v => !v)} className="flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-400 mb-2">
                <AlertTriangle className="w-4 h-4" /> Conflitos de ID por tabela ({totalConflicts})
                {showConflicts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showConflicts && (
                <div className="space-y-1.5">
                  {Object.entries(result.idConflicts).filter(([, v]) => v.conflicts.length > 0).map(([tbl, v]) => (
                    <div key={tbl} className="text-xs bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-1.5 text-orange-800 dark:text-orange-300">
                      <span className="font-mono font-bold">{tbl}</span>: {v.conflicts.length} conflito(s) — IDs [{v.conflicts.slice(0, 8).join(", ")}{v.conflicts.length > 8 ? "..." : ""}]
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sequence comparison */}
          {(Object.keys(result.sequenceMaxes).length > 0 || Object.keys(result.backupMaxes).length > 0) && (
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Info className="w-4 h-4 text-muted-foreground" /> Máximos de sequência</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {Object.keys(result.sequenceMaxes).map(tbl => (
                  <div key={tbl} className="bg-muted/50 rounded-lg p-2">
                    <p className="text-xs font-mono text-muted-foreground">{tbl}</p>
                    <p className="text-xs text-foreground">Live: <strong>{result.sequenceMaxes[tbl]}</strong></p>
                    <p className="text-xs text-foreground">Backup: <strong>{result.backupMaxes[tbl] ?? "—"}</strong></p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-blue-500" /> Recomendações</h4>
            <IssueList items={result.recommendations} variant="info" />
          </div>

          <p className="text-xs text-muted-foreground">correlationId: <span className="font-mono">{result.correlationId}</span></p>
        </div>
        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} data-testid="button-close-dryrun" className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:opacity-90">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Plan Modal ────────────────────────────────────────────────
function PlanModal({ plan, onClose }: { plan: RestorePlan; onClose: () => void }) {
  const [tab, setTab] = useState<"steps" | "pre" | "post">("steps");
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-card rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
        <div className={`p-5 flex items-start gap-3 border-b ${plan.canProceed ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200' : 'bg-red-50 dark:bg-red-900/20 border-red-200'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${plan.canProceed ? 'bg-blue-100' : 'bg-red-100'}`}>
            <ClipboardList className={`w-5 h-5 ${plan.canProceed ? 'text-blue-600' : 'text-red-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg text-foreground">Plano de Restore</h3>
              <RiskBadge level={plan.riskLevel} />
              {!plan.canProceed && <span className="text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full font-bold">BLOQUEADO</span>}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{plan.filename}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Risk notice */}
          <div className={`p-3 rounded-xl border text-sm ${plan.canProceed ? 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/10 dark:border-blue-800 dark:text-blue-300' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/10 dark:border-red-800 dark:text-red-300'}`}>
            <strong>{plan.operationalRisk}</strong>
          </div>

          {/* Blockers */}
          {plan.blockers.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><Lock className="w-4 h-4" /> Bloqueadores ({plan.blockers.length})</h4>
              <IssueList items={plan.blockers} variant="error" />
            </div>
          )}

          {/* Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tenants", value: plan.totalTenants },
              { label: "Tabelas", value: plan.totalTables },
              { label: "Registros", value: plan.totalRecords.toLocaleString() },
              { label: "Duração estimada", value: fmtSecs(plan.estimatedDurationSeconds) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-bold text-foreground">{value}</p>
              </div>
            ))}
          </div>

          {/* Tenant names */}
          {plan.tenantNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {plan.tenantNames.map((n, i) => (
                <span key={i} className="text-xs bg-muted px-2 py-1 rounded-lg">{n}</span>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border/50">
            {(["steps", "pre", "post"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg -mb-px transition-colors ${tab === t ? 'border border-b-white dark:border-b-card border-border/50 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {t === "steps" ? "Passos" : t === "pre" ? "Pré-restore" : "Pós-restore"}
              </button>
            ))}
          </div>

          {tab === "steps" && (
            <div className="space-y-1.5">
              {plan.steps.map(step => (
                <div key={step.table} className="flex items-start gap-3 bg-muted/30 rounded-xl p-3">
                  <span className="text-xs font-mono font-bold bg-muted rounded-lg px-2 py-1 flex-shrink-0 mt-0.5">{String(step.order).padStart(2, "0")}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold font-mono text-foreground">{step.table}</span>
                      <span className="text-xs text-muted-foreground">{step.records.toLocaleString()} reg · {fmtSecs(step.estimatedSeconds)}</span>
                      {step.dependsOn.length > 0 && (
                        <span className="text-xs text-muted-foreground">→ deps: {step.dependsOn.join(", ")}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.riskNote}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "pre" && (
            <div className="space-y-1.5">
              {plan.preRestoreChecklist.map((item, i) => (
                <div key={i} className="text-sm bg-muted/30 rounded-xl p-3 font-mono text-foreground">{item}</div>
              ))}
            </div>
          )}

          {tab === "post" && (
            <div className="space-y-1.5">
              {plan.postRestoreChecklist.map((item, i) => (
                <div key={i} className="text-sm bg-muted/30 rounded-xl p-3 font-mono text-foreground">{item}</div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">correlationId: <span className="font-mono">{plan.correlationId}</span></p>
        </div>

        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} data-testid="button-close-plan" className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:opacity-90">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Validation Modal ──────────────────────────────────────────
function ValidationModal({ result, onClose }: { result: ValidationResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-card rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className={`p-5 flex items-start gap-3 ${result.valid ? 'bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800'}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${result.valid ? 'bg-green-100 dark:bg-green-900/40' : 'bg-red-100 dark:bg-red-900/40'}`}>
            {result.valid ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" /> : <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-foreground">Validação — {result.valid ? "Íntegro" : "Problemas encontrados"}</h3>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{result.filename}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className={`p-3 rounded-xl border text-sm font-medium ${result.valid ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'}`}>
            {result.summary}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-xl p-3"><p className="text-xs text-muted-foreground">Formato</p><p className="text-sm font-bold uppercase">{result.format}</p></div>
            <div className="bg-muted/50 rounded-xl p-3"><p className="text-xs text-muted-foreground">Tamanho</p><p className="text-sm font-bold">{formatBytes(result.sizeBytes)}</p></div>
            <div className="bg-muted/50 rounded-xl p-3"><p className="text-xs text-muted-foreground">Registros</p><p className="text-sm font-bold">{result.totalRecords.toLocaleString()}</p></div>
            {result.generatedAt && (
              <div className="bg-muted/50 rounded-xl p-3 col-span-2 sm:col-span-3"><p className="text-xs text-muted-foreground">Gerado em</p><p className="text-sm font-bold">{result.generatedAt}</p></div>
            )}
          </div>
          {result.issues.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> Problemas críticos ({result.issues.length})</h4>
              <IssueList items={result.issues} variant="error" />
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Avisos ({result.warnings.length})</h4>
              <IssueList items={result.warnings} variant="warn" />
            </div>
          )}
          {Object.keys(result.tableCounts).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5"><Info className="w-4 h-4 text-muted-foreground" /> Registros por tabela</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {Object.entries(result.tableCounts).sort((a, b) => b[1] - a[1]).map(([tbl, count]) => (
                  <div key={tbl} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-mono text-muted-foreground truncate">{tbl}</span>
                    <span className="font-bold text-foreground ml-2">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} data-testid="button-close-validation" className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:opacity-90">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function BackupsPage() {
  const { user } = useAuth();
  const isMaster = user?.role === "MASTER";

  const { data: backups, isLoading, refetch } = useQuery<Backup[]>({ queryKey: ['/api/admin/backups'] });
  const { data: statsData } = useQuery<{ success: boolean; data: BackupStats }>({
    queryKey: ['/api/admin/backups/stats'], refetchInterval: 30000,
  });
  const { data: mailerStatus } = useQuery<{ configured: boolean; smtp: string | null; from: string }>({
    queryKey: ['/api/admin/mailer-status'],
  });
  const { data: lockData, refetch: refetchLock } = useQuery<{ success: boolean; data: { locked: boolean; holder: string | null; acquiredAt: string | null } }>({
    queryKey: ['/api/admin/backups/restore-lock'],
    enabled: isMaster,
    refetchInterval: 5000,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stats = statsData?.data;
  const restoreLock = lockData?.data;

  // ─── Modal state ───────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm]         = useState<string | null>(null);
  const [showCleanConfirm, setShowCleanConfirm]   = useState(false);
  const [showSmtpTest, setShowSmtpTest]           = useState(false);
  const [smtpTestEmail, setSmtpTestEmail]         = useState("");
  const [downloadingFile, setDownloadingFile]     = useState<string | null>(null);
  const [validationResult, setValidationResult]   = useState<ValidationResult | null>(null);
  const [validatingFile, setValidatingFile]       = useState<string | null>(null);
  const [sandboxResult, setSandboxResult]         = useState<SandboxResult | null>(null);
  const [sandboxFile, setSandboxFile]             = useState<string | null>(null);
  const [dryRunResult, setDryRunResult]           = useState<DryRunResult | null>(null);
  const [dryRunFile, setDryRunFile]               = useState<string | null>(null);
  const [planResult, setPlanResult]               = useState<RestorePlan | null>(null);
  const [planFile, setPlanFile]                   = useState<string | null>(null);

  // ─── Mutations ────────────────────────────────────────────────
  const createJsonBackup = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth('/api/admin/backups', { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups/stats'] });
      toast({ title: `Backup JSON criado: ${data.filename}` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao criar backup JSON.", variant: "destructive" }),
  });

  const createSqlBackup = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth('/api/admin/backups/sql', { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups/stats'] });
      toast({ title: `Backup SQL criado: ${data.filename}` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao criar backup SQL.", variant: "destructive" }),
  });

  const deleteBackupMut = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups/stats'] });
      setDeleteConfirm(null);
      toast({ title: `Backup excluído com sucesso.` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao excluir backup.", variant: "destructive" }),
  });

  const cleanOldMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth('/api/admin/backups/clean-old', { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Erro'); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/backups/stats'] });
      setShowCleanConfirm(false);
      toast({ title: data.message || `${data.removed} backup(s) antigos removidos.` });
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao limpar backups antigos.", variant: "destructive" }),
  });

  const smtpTestMut = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetchWithAuth('/api/admin/smtp-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: email }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro');
      return d;
    },
    onSuccess: (data) => {
      toast({ title: data.message || 'E-mail de teste enviado!' });
      setShowSmtpTest(false); setSmtpTestEmail("");
    },
    onError: (e: any) => toast({ title: e.message || "Erro ao enviar e-mail de teste.", variant: "destructive" }),
  });

  // ─── Async ops (MASTER only) ───────────────────────────────────
  const downloadBackup = async (filename: string) => {
    if (downloadingFile) return;
    setDownloadingFile(filename);
    try {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}`, { method: 'GET' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || 'Arquivo não encontrado'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast({ title: `Download iniciado: ${filename}` });
    } catch (err: any) {
      toast({ title: err.message || 'Erro ao baixar backup', variant: 'destructive' });
    } finally { setDownloadingFile(null); }
  };

  const validateBackup = async (filename: string) => {
    if (validatingFile) return;
    setValidatingFile(filename);
    try {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}/validate`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro ao validar');
      setValidationResult(d.data);
    } catch (err: any) {
      toast({ title: err.message || 'Erro ao validar backup', variant: 'destructive' });
    } finally { setValidatingFile(null); }
  };

  const runSandbox = async (filename: string) => {
    if (sandboxFile) return;
    setSandboxFile(filename);
    try {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}/sandbox`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro no sandbox');
      setSandboxResult(d.data);
    } catch (err: any) {
      toast({ title: err.message || 'Erro no restore sandbox', variant: 'destructive' });
    } finally { setSandboxFile(null); refetchLock(); }
  };

  const runDryRun = async (filename: string) => {
    if (dryRunFile) return;
    setDryRunFile(filename);
    try {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}/dry-run`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro no dry-run');
      setDryRunResult(d.data);
    } catch (err: any) {
      toast({ title: err.message || 'Erro no restore dry-run', variant: 'destructive' });
    } finally { setDryRunFile(null); refetchLock(); }
  };

  const runPlan = async (filename: string) => {
    if (planFile) return;
    setPlanFile(filename);
    try {
      const res = await fetchWithAuth(`/api/admin/backups/${encodeURIComponent(filename)}/plan`, { method: 'GET' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Erro ao gerar plano');
      setPlanResult(d.data);
    } catch (err: any) {
      toast({ title: err.message || 'Erro ao gerar plano de restore', variant: 'destructive' });
    } finally { setPlanFile(null); refetchLock(); }
  };

  const isCreating = createJsonBackup.isPending || createSqlBackup.isPending;
  const anyMasterOpRunning = !!(sandboxFile || dryRunFile || planFile || validatingFile);

  return (
    <Layout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Backup do Sistema</h1>
          <p className="text-muted-foreground mt-1">
            Backups automáticos diários às 17h · Máximo de {backups?.length || 0}/30 backups mantidos
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['/api/admin/backups/stats'] }); }} title="Atualizar lista"
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-border rounded-xl text-sm font-bold hover:bg-muted transition-colors">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </button>
          <button data-testid="button-clean-old-backups" onClick={() => setShowCleanConfirm(true)}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-orange-200 text-orange-600 rounded-xl text-sm font-bold hover:bg-orange-50 transition-colors">
            <Trash2 className="w-4 h-4" /> Limpar Antigos (&gt;30d)
          </button>
          <button data-testid="button-create-sql-backup" onClick={() => createSqlBackup.mutate()} disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-blue-200 text-blue-700 rounded-xl text-sm font-bold hover:bg-blue-50 transition-colors disabled:opacity-50">
            <FileCode2 className="w-4 h-4" />
            {createSqlBackup.isPending ? "Gerando SQL..." : "Gerar SQL"}
          </button>
          <button data-testid="button-create-backup" onClick={() => createJsonBackup.mutate()} disabled={isCreating}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:-translate-y-0.5 transition-transform shadow-lg shadow-primary/20 disabled:opacity-50">
            <Plus className="w-4 h-4" />
            {createJsonBackup.isPending ? "Gerando JSON..." : "Gerar JSON"}
          </button>
        </div>
      </div>

      {/* ── Stats Cards ──────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border/50 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"><HardDrive className="w-5 h-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total de backups</p>
              <p className="text-2xl font-bold text-foreground" data-testid="stat-total-backups">{stats.totalBackups}</p>
              <p className="text-xs text-muted-foreground">{stats.jsonCount} JSON · {stats.sqlCount} SQL</p>
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0"><BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Tamanho total</p>
              <p className="text-xl font-bold text-foreground" data-testid="stat-total-size">{formatBytes(stats.totalSizeBytes)}</p>
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${stats.lastBackup ? 'bg-green-100 dark:bg-green-900/30' : 'bg-orange-100 dark:bg-orange-900/30'}`}>
              <Clock className={`w-5 h-5 ${stats.lastBackup ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Último backup</p>
              {stats.lastBackup ? (
                <>
                  <p className="text-sm font-bold text-foreground" data-testid="stat-last-backup">{timeAgo(stats.lastBackup.createdAt)}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(stats.lastBackup.size)}</p>
                </>
              ) : <p className="text-sm font-bold text-orange-600">Nenhum</p>}
            </div>
          </div>
          <div className={`border rounded-2xl p-4 flex items-center gap-3 ${stats.totalBackups > 0 ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${stats.totalBackups > 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-orange-100 dark:bg-orange-900/30'}`}>
              {stats.totalBackups > 0 ? <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" /> : <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className={`text-sm font-bold ${stats.totalBackups > 0 ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'}`} data-testid="stat-health">
                {stats.totalBackups > 0 ? "Operacional" : "Sem backups"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore Lock Status (MASTER) ──────────────────────────────── */}
      {isMaster && restoreLock && (
        <div className={`mb-4 p-4 rounded-2xl border-2 flex items-center gap-3 ${restoreLock.locked ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/10' : 'border-border bg-muted/20'}`}>
          <Lock className={`w-5 h-5 flex-shrink-0 ${restoreLock.locked ? 'text-orange-600' : 'text-muted-foreground'}`} />
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">
              {restoreLock.locked ? "Restore Lock ATIVO — operação em andamento" : "Restore Lock livre — nenhuma operação de restore ativa"}
            </p>
            {restoreLock.locked && restoreLock.holder && (
              <p className="text-xs text-muted-foreground font-mono">correlationId: {restoreLock.holder}</p>
            )}
          </div>
          {restoreLock.locked && (
            <span className="text-xs font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-1 rounded-full animate-pulse">EM USO</span>
          )}
        </div>
      )}

      {/* ── Email Status ──────────────────────────────────────────────── */}
      <div className={`mb-4 p-5 rounded-2xl border-2 flex items-center gap-4 ${mailerStatus?.configured ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
        {mailerStatus?.configured ? <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" /> : <WifiOff className="w-6 h-6 text-orange-500 flex-shrink-0" />}
        <div className="flex-1">
          <p className="font-bold text-sm text-foreground">
            {mailerStatus?.configured ? "E-mails automáticos ativos — backup é enviado por e-mail ao admin" : "E-mails automáticos não configurados"}
          </p>
          <p className="text-xs text-muted-foreground">
            {mailerStatus?.configured
              ? `Servidor: ${mailerStatus.smtp} · Remetente: ${mailerStatus.from}`
              : "Configure as variáveis SMTP_HOST, SMTP_USER e SMTP_PASS para ativar o envio de e-mails automáticos com backup em anexo."}
          </p>
        </div>
        {mailerStatus?.configured && (
          <button data-testid="button-smtp-test" onClick={() => setShowSmtpTest(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-green-300 text-green-700 text-sm font-bold hover:bg-green-100 transition-colors flex-shrink-0">
            <Send className="w-4 h-4" /> Testar SMTP
          </button>
        )}
      </div>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">JSON</span> Backup completo em JSON
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">SQL</span> Backup com INSERTs SQL
        </div>
        {isMaster && (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold text-xs">MASTER</span> Validar · Sandbox · Dry-run · Plano
            </div>
          </>
        )}
      </div>

      {/* ── Backups List ──────────────────────────────────────────────── */}
      <div className="bg-card rounded-2xl border border-border/50 premium-shadow overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-muted/20 flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">Histórico de Backups</h3>
          <span className="ml-auto text-sm text-muted-foreground font-medium">{backups?.length || 0} arquivo(s)</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando...</div>
        ) : !backups || backups.length === 0 ? (
          <div className="p-12 text-center">
            <HardDrive className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-bold text-foreground">Nenhum backup encontrado</p>
            <p className="text-muted-foreground text-sm mt-1">Clique em "Gerar JSON" ou "Gerar SQL" para criar o primeiro backup.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {backups.map((b) => {
              const isSQL = b.format === 'sql' || b.filename.endsWith('.sql');
              const isDownloading = downloadingFile === b.filename;
              const isValidating  = validatingFile  === b.filename;
              const isSandboxing  = sandboxFile     === b.filename;
              const isDryRunning  = dryRunFile      === b.filename;
              const isPlanning    = planFile        === b.filename;
              return (
                <li key={b.filename} data-testid={`row-backup-${b.filename}`}
                  className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isSQL ? 'bg-blue-100' : 'bg-primary/10'}`}>
                      {isSQL ? <FileCode2 className="w-5 h-5 text-blue-600" /> : <Database className="w-5 h-5 text-primary" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-foreground text-sm truncate">{b.filename}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${isSQL ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {isSQL ? 'SQL' : 'JSON'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(b.createdAt)} · {formatBytes(b.size)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* MASTER-only: Validate */}
                    {isMaster && (
                      <button data-testid={`button-validate-backup-${b.filename}`}
                        onClick={() => validateBackup(b.filename)}
                        disabled={isValidating || anyMasterOpRunning}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 border-purple-200 text-purple-700 text-xs font-bold hover:bg-purple-50 transition-colors disabled:opacity-50"
                        title="Validar integridade do backup">
                        {isValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        {isValidating ? 'Validando...' : 'Validar'}
                      </button>
                    )}
                    {/* MASTER-only: Sandbox */}
                    {isMaster && (
                      <button data-testid={`button-sandbox-backup-${b.filename}`}
                        onClick={() => runSandbox(b.filename)}
                        disabled={isSandboxing || anyMasterOpRunning}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 border-teal-200 text-teal-700 text-xs font-bold hover:bg-teal-50 transition-colors disabled:opacity-50"
                        title="Sandbox: análise FK interna (sem acesso ao banco)">
                        {isSandboxing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                        {isSandboxing ? 'Sandbox...' : 'Sandbox'}
                      </button>
                    )}
                    {/* MASTER-only: Dry-run */}
                    {isMaster && (
                      <button data-testid={`button-dryrun-backup-${b.filename}`}
                        onClick={() => runDryRun(b.filename)}
                        disabled={isDryRunning || anyMasterOpRunning}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 border-orange-200 text-orange-700 text-xs font-bold hover:bg-orange-50 transition-colors disabled:opacity-50"
                        title="Dry-run: análise com banco de produção (somente leitura)">
                        {isDryRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                        {isDryRunning ? 'Dry-run...' : 'Dry-run'}
                      </button>
                    )}
                    {/* MASTER-only: Plan */}
                    {isMaster && (
                      <button data-testid={`button-plan-backup-${b.filename}`}
                        onClick={() => runPlan(b.filename)}
                        disabled={isPlanning || anyMasterOpRunning}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50 transition-colors disabled:opacity-50"
                        title="Gerar plano de restore com checklist operacional">
                        {isPlanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
                        {isPlanning ? 'Planejando...' : 'Plano'}
                      </button>
                    )}
                    {/* Download */}
                    <button data-testid={`button-download-backup-${b.filename}`}
                      onClick={() => downloadBackup(b.filename)} disabled={isDownloading}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 border-border text-xs font-bold hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50">
                      {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      {isDownloading ? 'Baixando...' : 'Baixar'}
                    </button>
                    {/* Delete */}
                    {deleteConfirm === b.filename ? (
                      <div className="flex gap-1">
                        <button data-testid={`button-confirm-delete-backup-${b.filename}`}
                          onClick={() => deleteBackupMut.mutate(b.filename)} disabled={deleteBackupMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                          {deleteBackupMut.isPending ? '...' : 'Confirmar'}
                        </button>
                        <button onClick={() => setDeleteConfirm(null)} className="px-2.5 py-1.5 border-2 border-border rounded-xl text-xs font-bold hover:bg-muted transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button data-testid={`button-delete-backup-${b.filename}`}
                        onClick={() => setDeleteConfirm(b.filename)}
                        className="p-1.5 rounded-xl border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {validationResult && <ValidationModal result={validationResult} onClose={() => setValidationResult(null)} />}
      {sandboxResult    && <SandboxModal    result={sandboxResult}    onClose={() => setSandboxResult(null)}    />}
      {dryRunResult     && <DryRunModal     result={dryRunResult}     onClose={() => setDryRunResult(null)}     />}
      {planResult       && <PlanModal       plan={planResult}         onClose={() => setPlanResult(null)}       />}

      {/* ── Clean old modal ───────────────────────────────────────────── */}
      {showCleanConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-5 h-5 text-orange-600" /></div>
              <div>
                <h3 className="font-bold text-lg text-foreground">Limpar Backups Antigos</h3>
                <p className="text-sm text-muted-foreground mt-1">Todos os backups com mais de 30 dias serão excluídos permanentemente.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCleanConfirm(false)} className="px-4 py-2 border-2 border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">Cancelar</button>
              <button data-testid="button-confirm-clean-old" onClick={() => cleanOldMut.mutate()} disabled={cleanOldMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl font-bold text-sm hover:bg-orange-700 transition-colors disabled:opacity-50">
                {cleanOldMut.isPending ? 'Limpando...' : 'Confirmar limpeza'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SMTP Test modal ───────────────────────────────────────────── */}
      {showSmtpTest && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-card rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0"><Mail className="w-5 h-5 text-green-600" /></div>
              <div className="flex-1">
                <h3 className="font-bold text-lg text-foreground">Testar Envio SMTP</h3>
                <p className="text-sm text-muted-foreground mt-1">Um e-mail de teste será enviado para o endereço informado.</p>
              </div>
              <button onClick={() => setShowSmtpTest(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">E-mail de destino</label>
              <input type="email" data-testid="input-smtp-test-email" value={smtpTestEmail}
                onChange={e => setSmtpTestEmail(e.target.value)} placeholder="seu@email.com"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border focus:border-primary outline-none text-sm" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSmtpTest(false)} className="px-4 py-2 border-2 border-border rounded-xl font-bold text-sm hover:bg-muted transition-colors">Cancelar</button>
              <button data-testid="button-confirm-smtp-test" onClick={() => smtpTestMut.mutate(smtpTestEmail)}
                disabled={smtpTestMut.isPending || !smtpTestEmail}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors disabled:opacity-50">
                <Send className="w-4 h-4" />
                {smtpTestMut.isPending ? 'Enviando...' : 'Enviar Teste'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
