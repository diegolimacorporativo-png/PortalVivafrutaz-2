import { useState, useRef, useEffect, useCallback } from "react";
import { normalizeBIResponse } from "@/lib/biNormalizer";
import { apiRequest } from "@/lib/queryClient";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Terminal, Bug, ShieldCheck, Zap, Database, Rocket, FileCode,
  Send, RefreshCw, CheckCircle2, AlertCircle, AlertTriangle, Info,
  Copy, Download, ChevronRight, Files, GitBranch, Server, Package,
  TrendingUp, Lock, Activity, BarChart3, Layers, FlaskConical,
  Cpu, MemoryStick, Clock, Globe, Wrench, BookOpen, Play, Plus,
  HardDrive, Wifi, WifiOff, CheckCheck, XCircle, Building2, List, LogIn
} from "lucide-react";

type SeverityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OK" | "WARN" | "FAIL";

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  LOW: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  OK: "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300",
  WARN: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300",
  FAIL: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300",
};

const SEVERITY_ICONS: Record<SeverityLevel, any> = {
  CRITICAL: AlertCircle, HIGH: AlertTriangle, MEDIUM: AlertTriangle,
  LOW: Info, OK: CheckCircle2, WARN: AlertTriangle, FAIL: AlertCircle,
};

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "text-green-500" : score >= 60 ? "text-yellow-500" : "text-red-500";
  const bg = score >= 80 ? "#22c55e" : score >= 60 ? "#eab308" : "#ef4444";
  const circumference = 2 * Math.PI * 36;
  const dash = (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="#e5e7eb" strokeWidth="7" />
          <circle cx="40" cy="40" r="36" fill="none" stroke={bg} strokeWidth="7"
            strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-2xl font-bold ${color}`}>{score}</span>
        </div>
      </div>
      <span className="text-xs text-gray-500 font-medium">{label}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity as SeverityLevel;
  const Icon = SEVERITY_ICONS[s] || Info;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_COLORS[s] || "bg-gray-100 text-gray-600"}`}>
      <Icon className="w-3 h-3" />
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status as SeverityLevel;
  const Icon = SEVERITY_ICONS[s] || CheckCircle2;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_COLORS[s] || "bg-gray-100 text-gray-600"}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

function CodeBlock({ content, filename }: { content: string; filename: string }) {
  const { toast } = useToast();
  function copy() {
    navigator.clipboard.writeText(content);
    toast({ title: "Copiado!" });
  }
  function download() {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-2">
        <span className="text-xs text-gray-300 font-mono">{filename}</span>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="text-gray-400 hover:text-white transition-colors">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={download} className="text-gray-400 hover:text-white transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <pre className="bg-gray-900 text-gray-100 text-xs p-3 overflow-auto max-h-64 whitespace-pre-wrap">{content}</pre>
    </div>
  );
}

interface ChatMessage {
  role: "user" | "system";
  content: string;
  action?: string;
  timestamp: Date;
}

const QUICK_COMMANDS = [
  { icon: Layers, label: "Analisar Sistema", cmd: "analisar sistema", tab: "index" },
  { icon: Bug, label: "Detectar Bugs", cmd: "detectar bugs", tab: "bugs" },
  { icon: ShieldCheck, label: "Auditoria de Segurança", cmd: "auditoria de segurança", tab: "security" },
  { icon: Database, label: "Analisar Banco", cmd: "analisar banco de dados", tab: "database" },
  { icon: FlaskConical, label: "AI LAB", cmd: "abrir ai lab", tab: "ailab" },
];

export default function AiDeveloperPage() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [, setLocation] = useLocation();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [activeTab, setActiveTab] = useState("terminal");
  const [inputCmd, setInputCmd] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      content: "🤖 AI Developer inicializado.\n\nDiagnóstico: assistente técnico assistivo, sem execução automática.\nImpacto: ajuda a analisar, explicar e gerar código seguro.\nSolução sugerida: usar as abas abaixo para mapeamento, bugs, segurança e banco.\nCódigo: disponível quando fizer sentido.\nRisco: baixo.\n\nSugestão rápida: quer que eu gere o código com base no diagnóstico?",
      timestamp: new Date(),
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [indexData, setIndexData] = useState<any>(null);
  const [bugsData, setBugsData] = useState<any>(null);
  const [securityData, setSecurityData] = useState<any>(null);
  const [perfData, setPerfData] = useState<any>(null);
  const [dbData, setDbData] = useState<any>(null);
  const [deployData, setDeployData] = useState<any[]>([]);
  const [selectedScript, setSelectedScript] = useState<any>(null);
  const [loadingTool, setLoadingTool] = useState<string | null>(null);
  // ETAPA 5 — rastreia erros por ferramenta para exibir fallback visual
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});

  // AI LAB state
  const [labHealth, setLabHealth] = useState<any>(null);
  const [labTestData, setLabTestData] = useState<any>(null);
  const [labDocsData, setLabDocsData] = useState<any>(null);
  const [labSimulateData, setLabSimulateData] = useState<any>(null);
  const [labAutoFixData, setLabAutoFixData] = useState<any>(null);
  const [labModuleData, setLabModuleData] = useState<any>(null);
  const [labModuleName, setLabModuleName] = useState("");
  const [labActiveSection, setLabActiveSection] = useState<string>("overview");
  const [labSelectedModuleFile, setLabSelectedModuleFile] = useState<any>(null);
  const [labTestCompanyData, setLabTestCompanyData] = useState<any>(null);
  const [labAiLogsData, setLabAiLogsData] = useState<any[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addMsg(role: ChatMessage["role"], content: string, action?: string) {
    setMessages(m => [...m, { role, content, action, timestamp: new Date() }]);
  }

  async function runTool(toolName: string, label: string, tabSwitch?: string) {
    if (!isAuthenticated || sessionExpired) { setSessionExpired(true); return; }
    setLoadingTool(toolName);
    setToolErrors(prev => { const n = { ...prev }; delete n[toolName]; return n; });
    addMsg("user", `> ${label}`);
    if (tabSwitch) setActiveTab(tabSwitch);
    console.warn("[AI_DEV_LOAD]", { toolName, isLoading: true, error: null, data: null });
    try {
      const res = await fetchWithAuth(`/api/ai-developer/${toolName}`);
      if (res.status === 401 || res.status === 403) { setLoadingTool(null); return; }

      // ETAPA 1 + ETAPA 4 — log da resposta completa com JSON protegido
      let json: any;
      try {
        json = await res.json();
      } catch (err: any) {
        console.error("[JSON_PARSE_ERROR]", { url: `/api/ai-developer/${toolName}`, status: res.status, err: err.message });
        throw new Error("Resposta inválida do servidor");
      }
      console.warn("[AI_DEV_FULL_RESPONSE]", { status: res.status, ok: res.ok, json });

      // ETAPA 2 — erro no backend
      if (!res.ok) {
        console.error("[AI_DEV_BACKEND_ERROR]", json);
        throw new Error(json.message || "Erro");
      }

      // ETAPA 3 — data vazia
      if (!json || Object.keys(json).length === 0) {
        console.warn("[AI_DEV_EMPTY]", { toolName });
      }

      const norm = normalizeBIResponse(json);

      // ETAPA 4 — antes do setState
      console.warn("[AI_DEV_BEFORE_SET]", json);

      switch (toolName) {
        case "index":
          setIndexData(json);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "indexData", keys: Object.keys(json) });
          addMsg("system", `✅ Sistema indexado:\n• ${json.totalFiles} arquivos analisados\n• ${json.totalLines?.toLocaleString?.() ?? 0} linhas de código\n• ${json.totalSizeKB} KB total\n• ${norm.endpoints.length} endpoints de API\n• ${norm.tables.length} tabelas no banco\n• Backend: ${norm.summary.backendFiles} | Frontend: ${norm.summary.frontendFiles} | Services: ${norm.summary.serviceFiles}`);
          break;
        case "bugs":
          setBugsData(json);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "bugsData", keys: Object.keys(json) });
          addMsg("system", `🔍 Análise de bugs concluída:\n• ${norm.summary.total} issues encontrados\n• 🔴 ${norm.summary.critical} Críticos\n• 🟠 ${norm.summary.high} Altos\n• 🟡 ${norm.summary.medium} Médios\n• 🔵 ${norm.summary.low} Baixos\n\n${norm.summary.critical > 0 ? "⚠️ ATENÇÃO: Existem problemas críticos que precisam de correção imediata!" : "✅ Nenhum problema crítico detectado."}`);
          break;
        case "security":
          setSecurityData(json);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "securityData", keys: Object.keys(json) });
          addMsg("system", `🔐 Auditoria de segurança:\n• Score: ${json.score}/100\n• ${norm.issues.length} issues encontrados\n• ${norm.issues.filter((i: any) => i.severity === 'CRITICAL').length} críticos\n• ${norm.recommendations.length} recomendações geradas`);
          break;
        case "performance":
          setPerfData(json);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "perfData", keys: Object.keys(json) });
          addMsg("system", `⚡ Análise de performance:\n• Score: ${json.score}/100\n• ${norm.checks.filter((c: any) => c.status === 'OK').length}/${norm.checks.length} checks passaram\n• ${norm.checks.filter((c: any) => c.status === 'WARN').length} avisos\n• ${norm.checks.filter((c: any) => c.status === 'FAIL').length} falhas`);
          break;
        case "database":
          setDbData(json);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "dbData", keys: Object.keys(json) });
          addMsg("system", `🗄️ Análise do banco concluída:\n• ${norm.tables.length} tabelas mapeadas\n• ${norm.indexes.length} índices existentes\n• Tamanho do banco: ${norm.database?.db_size || 'N/A'}\n\nMainTables: ${Object.entries(norm.rowCounts).map(([t, c]) => `${t}(${c})`).join(', ')}`);
          break;
        case "deploy":
          setDeployData(json);
          setSelectedScript(json[0]);
          console.warn("[AI_DEV_AFTER_SET]", { toolName, state: "deployData", length: Array.isArray(json) ? json.length : 0 });
          addMsg("system", `⚠️ Este painel mostra apenas exemplos e heurísticas, não um pipeline de deploy real.`);
          break;
      }
    } catch (e: any) {
      // ETAPA 5 — log completo com stack para rastreio total
      console.error("[REQUEST_ERROR_FULL]", { message: e.message, stack: e.stack });
      console.warn("[AI_DEV_LOAD]", { toolName, isLoading: false, error: e.message, data: null });
      setToolErrors(prev => ({ ...prev, [toolName]: e.message || "Erro desconhecido" }));
      addMsg("system", `❌ Erro ao executar ${label}: ${e.message}`);
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setLoadingTool(null);
    }
  }

  async function runLabTool(toolPath: string, label: string, method: 'GET' | 'POST' = 'GET', body?: any) {
    if (!isAuthenticated || sessionExpired) { setSessionExpired(true); return null; }
    setLoadingTool(`lab-${toolPath}`);
    addMsg("user", `> [AI LAB] ${label}`);
    try {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetchWithAuth(`/api/ai-developer/lab/${toolPath}`, opts);
      if (res.status === 401 || res.status === 403) { setLoadingTool(null); return null; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erro');
      return data;
    } catch (e: any) {
      addMsg("system", `❌ Erro: ${e.message}`);
      toast({ title: e.message, variant: "destructive" });
      return null;
    } finally {
      setLoadingTool(null);
    }
  }

  async function handleLabHealth() {
    const data = await runLabTool('health', 'Health Monitor');
    if (data) {
      setLabHealth(data);
      setLabActiveSection('health');
      addMsg("system", `💻 Health Monitor:\n• CPU: ${data.cpu.load1m} (1m avg) | ${data.cpu.cores} cores\n• RAM: ${data.memory.usedMB}MB / ${data.memory.totalMB}MB (${data.memory.usagePct}%)\n• Uptime: ${data.uptime.formatted}\n• Node: ${data.nodeVersion}`);
    }
  }

  async function handleLabTestRoutes() {
    const data = await runLabTool('test-routes', 'Executar Testes de Rotas');
    if (data) {
      setLabTestData(data);
      setLabActiveSection('test-routes');
      addMsg("system", `🧪 Testes concluídos:\n• ${data.summary.ok} OK\n• ${data.summary.warn} Avisos\n• ${data.summary.fail} Falhas\n• Tempo médio: ${data.summary.avgMs}ms`);
    }
  }

  async function handleLabDocs() {
    const data = await runLabTool('docs', 'Gerar Documentação');
    if (data) {
      setLabDocsData(data);
      setLabActiveSection('docs');
      addMsg("system", `📚 Documentação gerada:\n• ${data.totalEndpoints} endpoints documentados\n• ${data.groups} grupos de rotas`);
    }
  }

  async function handleLabSimulate() {
    const data = await runLabTool('simulate', 'Simular Uso do Sistema', 'POST');
    if (data) {
      setLabSimulateData(data);
      setLabActiveSection('simulate');
      addMsg("system", `🤖 Simulação concluída:\n• ${data.summary.ok}/${data.summary.total} passos OK\n• ${data.summary.fail} falhas\n• Tempo total: ${data.summary.totalMs}ms`);
    }
  }

  async function handleLabAutoFix() {
    const data = await runLabTool('auto-fix', 'Auto Corrigir Sistema');
    if (data) {
      setLabAutoFixData(data);
      setLabActiveSection('auto-fix');
      addMsg("system", `🔧 Auto-fix concluído:\n• ${data.summary.total} issues encontrados\n• ${data.summary.high} alto\n• ${data.summary.medium} médio\n• ${data.summary.low} baixo`);
    }
  }

  async function handleLabCreateTestCompany() {
    const data = await runLabTool('create-test-company', 'Criar Empresa Teste', 'POST');
    if (data) {
      setLabTestCompanyData(data);
      setLabActiveSection('test-company');
      const summary = data.results?.map((r: any) => `• ${r.step}: ${r.status}`).join('\n') || '';
      addMsg("system", `🏢 Empresa teste criada!\n${summary}\n\n✅ ${data.message}`);
      toast({ title: 'Empresa teste criada com sucesso!' });
    }
  }

  async function handleLabLoadAiLogs() {
    const data = await runLabTool('ai-logs', 'Carregar Logs da IA');
    if (data) {
      setLabAiLogsData(Array.isArray(data) ? data : []);
      setLabActiveSection('ai-logs');
      addMsg("system", `📋 Logs da IA carregados: ${Array.isArray(data) ? data.length : 0} registro(s)`);
    }
  }

  async function handleLabCreateModule() {
    if (!labModuleName.trim()) { toast({ title: "Digite o nome do módulo", variant: "destructive" }); return; }
    const data = await runLabTool('create-module', `Criar Módulo: ${labModuleName}`, 'POST', { name: labModuleName });
    if (data) {
      setLabModuleData(data);
      setLabSelectedModuleFile(data.files[0] || null);
      setLabActiveSection('create-module');
      addMsg("system", `✨ Módulo "${data.moduleName}" gerado!\n• ${data.files.length} arquivos criados\n• Siga as instruções na aba para integrar ao sistema.`);
    }
  }

  async function handleCommand() {
    if (!inputCmd.trim()) return;
    if (!isAuthenticated || sessionExpired) { setSessionExpired(true); return; }
    const cmd = inputCmd.trim();
    setInputCmd("");

    const res = await fetchWithAuth("/api/ai-developer/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });
    if (res.status === 401 || res.status === 403) return;
    const data = await res.json();

    const toolMap: Record<string, [string, string]> = {
      index: ["index", "Analisar Sistema"],
      bugs: ["bugs", "Detectar Bugs"],
      security: ["security", "Auditoria de Segurança"],
      performance: ["performance", "Analisar Performance"],
      database: ["database", "Analisar Banco de Dados"],
      deploy: ["deploy", "Gerar Deploy"],
      help: ["help", "Ajuda"],
    };

    if (data.action === "help") {
      addMsg("user", `> ${cmd}`);
      addMsg("system", "📚 Comandos disponíveis:\n• analisar sistema\n• detectar bugs\n• auditoria de segurança\n• analisar banco de dados\n• abrir ai lab");
    } else if (data.action in toolMap) {
      const [tool, label] = toolMap[data.action];
      await runTool(tool, label, tool === "index" ? "index" : tool);
    } else {
      addMsg("user", `> ${cmd}`);
      addMsg("system", data.message || "Comando não reconhecido.");
    }
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col p-4 gap-3">
      {/* Session expired banner */}
      {sessionExpired && (
        <div
          data-testid="banner-session-expired"
          className="flex-shrink-0 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">Sessão expirada</span>
            <span className="text-xs text-red-500 dark:text-red-400 hidden sm:inline">— faça login novamente para continuar.</span>
          </div>
          <Button
            data-testid="button-login-novamente"
            size="sm"
            variant="destructive"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setLocation("/login")}
          >
            <LogIn className="w-3.5 h-3.5" />
            Login novamente
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="p-2 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl shadow">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">AI Developer</h1>
          <p className="text-xs text-gray-500">Análise inteligente do ERP VivaFrutaz</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {sessionExpired ? (
            <>
              <div className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-xs text-red-500 font-medium">Sessão expirada</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-gray-400">Sistema Online</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        {/* Left — Terminal + Quick Commands */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-3">
          {/* Quick Commands */}
          <Card className="flex-shrink-0">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Comandos Rápidos</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {QUICK_COMMANDS.map(({ icon: Icon, label, cmd, tab }) => (
                <button
                  key={cmd}
                  type="button"
                  data-testid={`cmd-${tab}`}
                  onClick={() => runTool(tab, label, tab)}
                  disabled={loadingTool !== null || sessionExpired || !isAuthenticated}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors group disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loadingTool === tab ? (
                    <RefreshCw className="w-4 h-4 text-violet-500 animate-spin flex-shrink-0" />
                  ) : (
                    <Icon className="w-4 h-4 text-violet-500 flex-shrink-0" />
                  )}
                  <span className="flex-1 text-gray-700 dark:text-gray-300">{label}</span>
                  <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-violet-400 transition-colors" />
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Terminal / Chat */}
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-2 pt-3 flex-shrink-0">
              <CardTitle className="text-xs font-semibold flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-green-500" />
                Terminal
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-2 min-h-0">
              <ScrollArea className="flex-1 mb-2">
                <div className="space-y-2 pr-2">
                  {messages.map((msg, i) => (
                    <div key={i} className={`text-xs rounded-lg p-2 ${msg.role === "user" ? "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-mono" : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 whitespace-pre-wrap"}`}>
                      {msg.content}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              <div className="flex gap-1">
                <Input
                  data-testid="input-ai-command"
                  value={inputCmd}
                  onChange={e => setInputCmd(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCommand()}
                  placeholder={sessionExpired ? "Sessão expirada..." : "Digite um comando..."}
                  disabled={sessionExpired || !isAuthenticated}
                  className="h-7 text-xs flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 bg-violet-600 hover:bg-violet-700"
                  onClick={handleCommand}
                  data-testid="button-send-cmd"
                  disabled={sessionExpired || !isAuthenticated}
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right — Results Panel */}
        <Card className="flex-1 flex flex-col min-h-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <CardHeader className="pb-0 pt-3 flex-shrink-0">
              <TabsList className="flex-wrap h-auto gap-1 justify-start bg-gray-100 dark:bg-gray-800 p-1">
                <TabsTrigger value="terminal" className="text-xs h-7 data-[state=active]:bg-white">
                  <Terminal className="w-3.5 h-3.5 mr-1" />Visão Geral
                </TabsTrigger>
                <TabsTrigger value="index" className="text-xs h-7 data-[state=active]:bg-white" data-testid="tab-index">
                  <Files className="w-3.5 h-3.5 mr-1" />Sistema
                </TabsTrigger>
                <TabsTrigger value="bugs" className="text-xs h-7 data-[state=active]:bg-white" data-testid="tab-bugs">
                  <Bug className="w-3.5 h-3.5 mr-1" />Bugs
                  {bugsData?.summary?.critical > 0 && <span className="ml-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">{bugsData.summary.critical}</span>}
                </TabsTrigger>
                <TabsTrigger value="security" className="text-xs h-7 data-[state=active]:bg-white" data-testid="tab-security">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" />Segurança
                </TabsTrigger>
                <TabsTrigger value="database" className="text-xs h-7 data-[state=active]:bg-white" data-testid="tab-db">
                  <Database className="w-3.5 h-3.5 mr-1" />Banco
                </TabsTrigger>
                <TabsTrigger value="deploy" className="text-xs h-7 data-[state=active]:bg-white" data-testid="tab-deploy">
                  <Rocket className="w-3.5 h-3.5 mr-1" />Scripts
                </TabsTrigger>
                <TabsTrigger value="ailab" className="text-xs h-7 data-[state=active]:bg-white bg-gradient-to-r data-[state=active]:from-violet-50 data-[state=active]:to-indigo-50 border border-violet-200 data-[state=active]:border-violet-400" data-testid="tab-ailab">
                  <FlaskConical className="w-3.5 h-3.5 mr-1 text-violet-600" />
                  <span className="text-violet-700 font-semibold">AI LAB</span>
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto pt-3">

              {/* Início Tab */}
              <TabsContent value="terminal" className="m-0">
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg">
                    <Bot className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white">AI Developer — VivaFrutaz ERP</h2>
                    <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                      Assistente técnico para análise, explicação e geração de código seguro.
                      Sem ações automáticas no sistema.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
                    {QUICK_COMMANDS.map(({ icon: Icon, label, cmd, tab }) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => runTool(tab, label, tab)}
                        disabled={loadingTool !== null}
                        className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded-xl border border-gray-200 dark:border-gray-700 transition-colors text-left group"
                      >
                        <Icon className="w-5 h-5 text-violet-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* Sistema Tab */}
              <TabsContent value="index" className="m-0">
                {!indexData ? (
                  <div className="text-center py-12 text-gray-400">
                    {toolErrors["index"] ? (
                      <>
                        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400 opacity-70" />
                        <p className="text-sm font-medium text-red-500">Erro ao carregar análise — verifique logs</p>
                        <p className="text-xs text-gray-400 mt-1">{toolErrors["index"]}</p>
                        <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => runTool("index", "Analisar Sistema", "index")} disabled={loadingTool !== null}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <Files className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Execute "Analisar Sistema" para indexar o projeto.</p>
                        <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("index", "Analisar Sistema", "index")} disabled={loadingTool !== null}>
                          {loadingTool === "index" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Layers className="w-4 h-4 mr-2" />}
                          Analisar Sistema
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">Gerado em {new Date(indexData.generatedAt).toLocaleString("pt-BR")}</p>
                      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => runTool("index", "Analisar Sistema", "index")}>
                        <RefreshCw className="w-3 h-3 mr-1" />Atualizar
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Arquivos", value: indexData.totalFiles, icon: Files, color: "text-violet-600" },
                        { label: "Linhas", value: indexData.totalLines.toLocaleString(), icon: FileCode, color: "text-blue-600" },
                        { label: "Tamanho", value: `${indexData.totalSizeKB}KB`, icon: Server, color: "text-green-600" },
                        { label: "Endpoints", value: indexData.endpoints.length, icon: GitBranch, color: "text-orange-600" },
                      ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex items-center gap-3">
                          <Icon className={`w-5 h-5 ${color}`} />
                          <div>
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className="font-bold text-gray-900 dark:text-white">{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Backend", value: indexData.summary.backendFiles },
                        { label: "Frontend", value: indexData.summary.frontendFiles },
                        { label: "Services", value: indexData.summary.serviceFiles },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                          <p className="text-xl font-bold text-gray-800 dark:text-white">{value}</p>
                          <p className="text-xs text-gray-500">{label}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tabelas do Banco ({indexData.tables.length})</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {indexData.tables.map((t: string) => (
                          <span key={t} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs rounded-md font-mono">{t}</span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Endpoints Sem Auth ({indexData.endpoints.filter((e: any) => !e.hasAuth).length})</h3>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {indexData.endpoints.filter((e: any) => !e.hasAuth).slice(0, 20).map((ep: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded font-mono text-xs ${ep.method === 'GET' ? 'bg-green-100 text-green-700' : ep.method === 'POST' ? 'bg-blue-100 text-blue-700' : ep.method === 'DELETE' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{ep.method}</span>
                            <span className="font-mono text-gray-600 dark:text-gray-400">{ep.path}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Bugs Tab */}
              <TabsContent value="bugs" className="m-0">
                {!bugsData ? (
                  <div className="text-center py-12 text-gray-400">
                    {toolErrors["bugs"] ? (
                      <>
                        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400 opacity-70" />
                        <p className="text-sm font-medium text-red-500">Erro ao carregar análise — verifique logs</p>
                        <p className="text-xs text-gray-400 mt-1">{toolErrors["bugs"]}</p>
                        <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => runTool("bugs", "Detectar Bugs", "bugs")} disabled={loadingTool !== null}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <Bug className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Execute "Detectar Bugs" para analisar logs e código.</p>
                        <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("bugs", "Detectar Bugs", "bugs")} disabled={loadingTool !== null}>
                          {loadingTool === "bugs" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Bug className="w-4 h-4 mr-2" />}
                          Detectar Bugs
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Críticos", value: bugsData.summary.critical, color: "bg-red-50 dark:bg-red-900/20 text-red-700" },
                        { label: "Altos", value: bugsData.summary.high, color: "bg-orange-50 dark:bg-orange-900/20 text-orange-700" },
                        { label: "Médios", value: bugsData.summary.medium, color: "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700" },
                        { label: "Baixos", value: bugsData.summary.low, color: "bg-blue-50 dark:bg-blue-900/20 text-blue-700" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className={`rounded-lg p-3 text-center ${color}`}>
                          <p className="text-2xl font-bold">{value}</p>
                          <p className="text-xs">{label}</p>
                        </div>
                      ))}
                    </div>

                    {bugsData.logErrors.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Erros em Logs do Sistema</h3>
                        <div className="space-y-2">
                          {bugsData.logErrors.map((b: any, i: number) => (
                            <div key={i} data-testid={`bug-log-${i}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                              <div className="flex items-start gap-2">
                                <SeverityBadge severity={b.severity} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{b.description}</p>
                                  {b.raw && <p className="text-xs text-gray-400 mt-0.5">{b.raw}</p>}
                                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">💡 {b.suggestion}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {bugsData.codeIssues.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Issues no Código</h3>
                        <div className="space-y-2">
                          {bugsData.codeIssues.map((b: any, i: number) => (
                            <div key={i} data-testid={`bug-code-${i}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                              <div className="flex items-start gap-2">
                                <SeverityBadge severity={b.severity} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{b.description}</p>
                                  {b.raw && <code className="block text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 mt-1 font-mono truncate">{b.raw}</code>}
                                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">💡 {b.suggestion}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Segurança Tab */}
              <TabsContent value="security" className="m-0">
                {!securityData ? (
                  <div className="text-center py-12 text-gray-400">
                    {toolErrors["security"] ? (
                      <>
                        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400 opacity-70" />
                        <p className="text-sm font-medium text-red-500">Erro ao carregar análise — verifique logs</p>
                        <p className="text-xs text-gray-400 mt-1">{toolErrors["security"]}</p>
                        <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => runTool("security", "Auditoria de Segurança", "security")} disabled={loadingTool !== null}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Execute "Auditoria de Segurança" para verificar vulnerabilidades.</p>
                        <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("security", "Auditoria de Segurança", "security")} disabled={loadingTool !== null}>
                          {loadingTool === "security" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                          Auditar Segurança
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6">
                      <ScoreRing score={securityData.score} label="Security Score" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-2">Recomendações</h3>
                        <ul className="space-y-1">
                          {securityData.recommendations.map((r: string, i: number) => (
                            <li key={i} className="text-xs text-gray-600 dark:text-gray-400">{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {securityData.issues.map((issue: any, i: number) => (
                        <div key={i} data-testid={`security-issue-${i}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <SeverityBadge severity={issue.severity} />
                            <div>
                              <span className="text-xs font-medium text-gray-500 mr-2">[{issue.category}]</span>
                              <span className="text-xs text-gray-700 dark:text-gray-300">{issue.description}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {securityData.issues.length === 0 && (
                        <div className="text-center py-6 text-green-600">
                          <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-sm font-medium">Nenhum issue de segurança detectado!</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Performance Tab */}
              <TabsContent value="performance" className="m-0">
                {!perfData ? (
                  <div className="text-center py-12 text-gray-400">
                    {toolErrors["performance"] ? (
                      <>
                        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400 opacity-70" />
                        <p className="text-sm font-medium text-red-500">Erro ao carregar análise — verifique logs</p>
                        <p className="text-xs text-gray-400 mt-1">{toolErrors["performance"]}</p>
                        <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => runTool("performance", "Analisar Performance", "performance")} disabled={loadingTool !== null}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <Zap className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Execute "Analisar Performance" para verificar gargalos.</p>
                        <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("performance", "Analisar Performance", "performance")} disabled={loadingTool !== null}>
                          {loadingTool === "performance" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                          Analisar Performance
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6">
                      <ScoreRing score={perfData.score} label="Perf Score" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-2">Otimizações Sugeridas</h3>
                        <ul className="space-y-1">
                          {perfData.recommendations.map((r: string, i: number) => (
                            <li key={i} className="text-xs text-gray-600 dark:text-gray-400">{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {perfData.checks.map((check: any, i: number) => (
                        <div key={i} data-testid={`perf-check-${i}`} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-start gap-3">
                          <StatusBadge status={check.status} />
                          <div>
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{check.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Banco Tab */}
              <TabsContent value="database" className="m-0">
                {!dbData ? (
                  <div className="text-center py-12 text-gray-400">
                    {toolErrors["database"] ? (
                      <>
                        <AlertCircle className="w-10 h-10 mx-auto mb-2 text-red-400 opacity-70" />
                        <p className="text-sm font-medium text-red-500">Erro ao carregar análise — verifique logs</p>
                        <p className="text-xs text-gray-400 mt-1">{toolErrors["database"]}</p>
                        <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => runTool("database", "Analisar Banco de Dados", "database")} disabled={loadingTool !== null}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <Database className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Execute "Analisar Banco de Dados" para inspecionar o PostgreSQL.</p>
                        <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("database", "Analisar Banco de Dados", "database")} disabled={loadingTool !== null}>
                          {loadingTool === "database" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
                          Analisar Banco
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700">{dbData.tables.length}</p>
                        <p className="text-xs text-gray-500">Tabelas</p>
                      </div>
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-green-700">{dbData.indexes.length}</p>
                        <p className="text-xs text-gray-500">Índices</p>
                      </div>
                      <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 text-center">
                        <p className="text-xl font-bold text-violet-700">{(dbData.database as any)?.db_size || "N/A"}</p>
                        <p className="text-xs text-gray-500">Tamanho</p>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tabelas por Tamanho</h3>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {dbData.tables.slice(0, 15).map((t: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                            <Database className="w-3 h-3 text-gray-400" />
                            <span className="font-mono flex-1 text-gray-700 dark:text-gray-300">{t.tablename}</span>
                            <span className="text-gray-400">{t.column_count} cols</span>
                            <span className="font-medium text-gray-600">{t.total_size}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contagem de Registros</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(dbData.rowCounts).filter(([, v]) => (v as number) > 0).map(([table, count]) => (
                          <div key={table} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
                            <p className="text-base font-bold text-gray-800 dark:text-white">{(count as number).toLocaleString()}</p>
                            <p className="text-xs text-gray-400 truncate">{table.replace(/_/g, ' ')}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recomendações</h3>
                      <ul className="space-y-1">
                        {dbData.recommendations.map((r: string, i: number) => (
                          <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
                            <span className="text-blue-500 mt-0.5 flex-shrink-0">→</span>{r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* AI LAB Tab */}
              <TabsContent value="ailab" className="m-0 h-full">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-full">
                  {/* Left: Controls */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <FlaskConical className="w-4 h-4 text-violet-600" />
                      <span className="text-xs font-bold text-violet-700 uppercase tracking-wider">AI LAB — Centro de Controle</span>
                    </div>

                    {[
                      { icon: Cpu, label: "Health Monitor", color: "text-green-600", bg: "hover:bg-green-50 dark:hover:bg-green-900/20", key: "health", action: handleLabHealth },
                      { icon: Play, label: "Executar Testes", color: "text-blue-600", bg: "hover:bg-blue-50 dark:hover:bg-blue-900/20", key: "test-routes", action: handleLabTestRoutes },
                      { icon: Wrench, label: "AUTO CORRIGIR SISTEMA", color: "text-orange-600", bg: "hover:bg-orange-50 dark:hover:bg-orange-900/20 border-orange-300", key: "auto-fix", action: handleLabAutoFix },
                      { icon: Globe, label: "Simular Uso", color: "text-cyan-600", bg: "hover:bg-cyan-50 dark:hover:bg-cyan-900/20", key: "simulate", action: handleLabSimulate },
                      { icon: BookOpen, label: "Gerar Documentação", color: "text-indigo-600", bg: "hover:bg-indigo-50 dark:hover:bg-indigo-900/20", key: "docs", action: handleLabDocs },
                      { icon: Building2, label: "Criar Empresa Teste", color: "text-emerald-600", bg: "hover:bg-emerald-50 dark:hover:bg-emerald-900/20", key: "test-company", action: handleLabCreateTestCompany },
                      { icon: HardDrive, label: "Logs da IA", color: "text-violet-600", bg: "hover:bg-violet-50 dark:hover:bg-violet-900/20", key: "ai-logs", action: handleLabLoadAiLogs },
                    ].map(({ icon: Icon, label, color, bg, key, action }) => (
                      <button
                        key={key}
                        type="button"
                        data-testid={`lab-btn-${key}`}
                        onClick={() => action()}
                        disabled={loadingTool !== null}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${bg} transition-colors group disabled:opacity-50 ${labActiveSection === key ? 'ring-2 ring-violet-400' : ''}`}
                      >
                        {loadingTool === `lab-${key}` ? (
                          <RefreshCw className={`w-4 h-4 ${color} animate-spin flex-shrink-0`} />
                        ) : (
                          <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                        )}
                        <span className="flex-1 text-gray-700 dark:text-gray-300 font-medium">{label}</span>
                        {loadingTool === `lab-${key}` && <span className="text-xs text-gray-400">Executando...</span>}
                      </button>
                    ))}

                    {/* Create Module */}
                    <div className={`border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-900 space-y-2 ${labActiveSection === 'create-module' ? 'ring-2 ring-violet-400' : ''}`}>
                      <div className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-violet-600" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Criar Módulo</span>
                      </div>
                      <Input
                        data-testid="input-module-name"
                        value={labModuleName}
                        onChange={e => setLabModuleName(e.target.value)}
                        placeholder="Ex: estoque, fornecedores..."
                        className="h-8 text-xs"
                        onKeyDown={e => e.key === 'Enter' && handleLabCreateModule()}
                      />
                      <Button
                        type="button"
                        data-testid="lab-btn-create-module"
                        size="sm"
                        onClick={handleLabCreateModule}
                        disabled={loadingTool !== null || !labModuleName.trim()}
                        className="w-full bg-violet-600 hover:bg-violet-700 text-white h-7 text-xs"
                      >
                        {loadingTool === 'lab-create-module' ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                        Gerar Scaffold
                      </Button>
                    </div>
                  </div>

                  {/* Right: Results */}
                  <div className="lg:col-span-2 overflow-auto">

                    {/* Overview */}
                    {labActiveSection === 'overview' && (
                      <div className="text-center py-8 space-y-4">
                        <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg">
                          <FlaskConical className="w-8 h-8 text-white" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-gray-800 dark:text-white">AI LAB — Agente Autônomo</h2>
                          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Selecione uma ação à esquerda para iniciar. O AI LAB analisa, testa, corrige e gera código automaticamente.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-w-sm mx-auto text-xs text-gray-500">
                          {[
                            "Testa todas as rotas da API",
                            "Monitora CPU e memória",
                            "Detecta e sugere correções",
                            "Simula uso real do sistema",
                            "Gera documentação completa",
                            "Cria módulos com scaffold",
                          ].map((f, i) => (
                            <div key={i} className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                              <CheckCircle2 className="w-3 h-3 text-violet-500 flex-shrink-0" />
                              <span>{f}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Health Monitor */}
                    {labActiveSection === 'health' && labHealth && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Cpu className="w-4 h-4 text-green-500" />Health Monitor
                          </h3>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleLabHealth} disabled={loadingTool !== null}>
                            <RefreshCw className="w-3 h-3 mr-1" />Atualizar
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-4 border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                              <Cpu className="w-4 h-4 text-green-600" />
                              <span className="text-xs font-bold text-green-700 uppercase">CPU</span>
                            </div>
                            <p className="text-2xl font-bold text-green-700">{labHealth.cpu.load1m}</p>
                            <p className="text-xs text-green-600">Carga 1 min (avg)</p>
                            <p className="text-xs text-gray-400 mt-1">{labHealth.cpu.cores} cores • 5m: {labHealth.cpu.load5m} • 15m: {labHealth.cpu.load15m}</p>
                          </div>
                          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 border border-blue-200">
                            <div className="flex items-center gap-2 mb-2">
                              <MemoryStick className="w-4 h-4 text-blue-600" />
                              <span className="text-xs font-bold text-blue-700 uppercase">RAM</span>
                            </div>
                            <p className="text-2xl font-bold text-blue-700">{labHealth.memory.usagePct}%</p>
                            <p className="text-xs text-blue-600">{labHealth.memory.usedMB}MB usados de {labHealth.memory.totalMB}MB</p>
                            <div className="mt-2 bg-blue-200 rounded-full h-1.5">
                              <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${labHealth.memory.usagePct}%` }} />
                            </div>
                          </div>
                          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-xl p-4 border border-violet-200">
                            <div className="flex items-center gap-2 mb-2">
                              <Clock className="w-4 h-4 text-violet-600" />
                              <span className="text-xs font-bold text-violet-700 uppercase">Uptime</span>
                            </div>
                            <p className="text-2xl font-bold text-violet-700">{labHealth.uptime.formatted}</p>
                            <p className="text-xs text-violet-600">{labHealth.uptime.seconds.toLocaleString()}s total</p>
                          </div>
                          <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800 dark:to-slate-800 rounded-xl p-4 border border-gray-200">
                            <div className="flex items-center gap-2 mb-2">
                              <Server className="w-4 h-4 text-gray-600" />
                              <span className="text-xs font-bold text-gray-600 uppercase">Sistema</span>
                            </div>
                            <p className="text-sm font-bold text-gray-700">{labHealth.nodeVersion}</p>
                            <p className="text-xs text-gray-500 mt-1">Platform: {labHealth.platform}</p>
                            <p className="text-xs text-gray-400">Free RAM: {labHealth.memory.freeMB}MB</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Test Routes */}
                    {labActiveSection === 'test-routes' && labTestData && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Play className="w-4 h-4 text-blue-500" />Testes de Rotas
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{labTestData.summary.ok} OK</span>
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold">{labTestData.summary.warn} Aviso</span>
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">{labTestData.summary.fail} Falha</span>
                            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleLabTestRoutes} disabled={loadingTool !== null}>
                              <RefreshCw className="w-3 h-3 mr-1" />Retestar
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          {[
                            { label: "Total Rotas", value: labTestData.summary.total, color: "text-gray-700" },
                            { label: "Tempo Médio", value: `${labTestData.summary.avgMs}ms`, color: "text-blue-600" },
                            { label: "Taxa OK", value: `${Math.round((labTestData.summary.ok / labTestData.summary.total) * 100)}%`, color: "text-green-600" },
                          ].map(m => (
                            <div key={m.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
                              <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                              <p className="text-xs text-gray-400">{m.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-1 max-h-72 overflow-y-auto">
                          {labTestData.results.map((r: any, i: number) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${r.status === 'OK' ? 'bg-green-50 border-green-200 dark:bg-green-900/10' : r.status === 'WARN' ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10' : 'bg-red-50 border-red-200 dark:bg-red-900/10'}`}>
                              {r.status === 'OK' ? <CheckCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" /> : r.status === 'WARN' ? <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                              <span className={`w-10 font-bold text-center font-mono ${r.status === 'OK' ? 'text-green-700' : r.status === 'WARN' ? 'text-yellow-700' : 'text-red-700'}`}>{r.httpStatus || '—'}</span>
                              <span className="font-mono text-gray-600 dark:text-gray-400 flex-1 truncate">{r.method} {r.path}</span>
                              <span className="text-gray-400 shrink-0">{r.responseTimeMs}ms</span>
                              {r.note && <span className="text-gray-400 text-[10px] shrink-0">{r.note}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Auto Fix */}
                    {labActiveSection === 'auto-fix' && labAutoFixData && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Wrench className="w-4 h-4 text-orange-500" />Auto Corrigir Sistema
                          </h3>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleLabAutoFix} disabled={loadingTool !== null}>
                            <RefreshCw className="w-3 h-3 mr-1" />Re-analisar
                          </Button>
                        </div>
                        {labAutoFixData.fixes.length === 0 ? (
                          <div className="text-center py-8">
                            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500 opacity-70" />
                            <p className="text-sm font-medium text-gray-600">Nenhum issue crítico encontrado!</p>
                            <p className="text-xs text-gray-400 mt-1">O sistema está bem configurado.</p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-80 overflow-y-auto">
                            {labAutoFixData.fixes.map((fix: any, i: number) => {
                              const sevColor: Record<string, string> = {
                                CRITICAL: 'border-red-300 bg-red-50', HIGH: 'border-orange-300 bg-orange-50',
                                MEDIUM: 'border-yellow-300 bg-yellow-50', LOW: 'border-blue-200 bg-blue-50',
                              };
                              const sevText: Record<string, string> = {
                                CRITICAL: 'text-red-700', HIGH: 'text-orange-700',
                                MEDIUM: 'text-yellow-700', LOW: 'text-blue-700',
                              };
                              return (
                                <div key={i} className={`border rounded-xl p-3 ${sevColor[fix.severity] || 'border-gray-200 bg-gray-50'}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${sevText[fix.severity]}`}>{fix.severity}</span>
                                        <span className="text-xs font-mono text-gray-500">{fix.type}</span>
                                      </div>
                                      <p className="text-xs font-medium text-gray-700">{fix.description}</p>
                                      <p className="text-xs text-gray-500 mt-0.5">📁 {fix.file}</p>
                                      <p className="text-xs text-blue-600 mt-1">💡 {fix.suggestion}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-xs text-gray-400">Log: <code>logs/ai-dev.log</code> • Backups: <code>backups/ai-fixes/</code></p>
                      </div>
                    )}

                    {/* Simulate */}
                    {labActiveSection === 'simulate' && labSimulateData && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Globe className="w-4 h-4 text-cyan-500" />Simulação de Uso
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">{labSimulateData.summary.ok}/{labSimulateData.summary.total} OK</span>
                            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleLabSimulate} disabled={loadingTool !== null}>
                              <RefreshCw className="w-3 h-3 mr-1" />Re-simular
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5 max-h-80 overflow-y-auto">
                          {labSimulateData.steps.map((step: any, i: number) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${step.status === 'OK' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                              {step.status === 'OK' ? <CheckCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                              <span className="flex-1 text-gray-700 font-medium">{step.label}</span>
                              <span className="text-gray-400 shrink-0">{step.elapsed}ms</span>
                              {step.detail && typeof step.detail === 'object' && step.detail.count !== undefined && (
                                <span className="text-gray-400 text-[10px]">{step.detail.count} registros</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Passos OK", value: labSimulateData.summary.ok, color: "text-green-600" },
                            { label: "Falhas", value: labSimulateData.summary.fail, color: "text-red-600" },
                            { label: "Tempo total", value: `${labSimulateData.summary.totalMs}ms`, color: "text-blue-600" },
                          ].map(m => (
                            <div key={m.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center">
                              <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                              <p className="text-xs text-gray-400">{m.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Docs */}
                    {labActiveSection === 'docs' && labDocsData && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-indigo-500" />Documentação da API
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{labDocsData.totalEndpoints} endpoints • {labDocsData.groups} grupos</span>
                            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                              const blob = new Blob([labDocsData.markdown], { type: 'text/markdown' });
                              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'API-docs.md'; a.click();
                            }}>
                              <Download className="w-3 h-3 mr-1" />Baixar MD
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="h-80 border rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                          <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{labDocsData.markdown}</pre>
                        </ScrollArea>
                      </div>
                    )}

                    {/* Empresa Teste */}
                    {labActiveSection === 'test-company' && labTestCompanyData && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-emerald-600" />
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Empresa Teste Criada</h3>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Sucesso</span>
                        </div>
                        <div className="space-y-2">
                          {(labTestCompanyData.results || []).map((r: any, i: number) => (
                            <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border text-xs ${r.status === 'created' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                              <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${r.status === 'created' ? 'text-green-600' : 'text-blue-600'}`} />
                              <div>
                                <p className="font-semibold text-gray-700 capitalize">{r.step}</p>
                                <p className="text-gray-500">ID: {r.id} • Status: {r.status} {r.name ? `• ${r.name}` : ''} {r.valor ? `• R$ ${r.valor}` : ''}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <Button type="button" size="sm" variant="outline" className="w-full text-xs" onClick={handleLabCreateTestCompany} disabled={loadingTool !== null}>
                          <Building2 className="w-3 h-3 mr-1" />Criar Outra Empresa Teste
                        </Button>
                      </div>
                    )}

                    {/* AI Logs */}
                    {labActiveSection === 'ai-logs' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <HardDrive className="w-4 h-4 text-violet-600" />
                            <h3 className="text-sm font-bold text-gray-800 dark:text-white">Logs da IA</h3>
                            <span className="text-xs text-gray-400">{labAiLogsData.length} registro(s)</span>
                          </div>
                          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={handleLabLoadAiLogs} disabled={loadingTool !== null}>
                            <RefreshCw className="w-3 h-3 mr-1" />Atualizar
                          </Button>
                        </div>
                        {labAiLogsData.length === 0 ? (
                          <div className="text-center py-8 text-gray-400">
                            <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">Nenhum log registrado ainda</p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-80 overflow-y-auto">
                            {labAiLogsData.map((log: any, i: number) => (
                              <div key={log.id || i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${log.status === 'ok' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${log.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-700 font-mono">{log.acao}</p>
                                  {log.arquivoAfetado && <p className="text-gray-400 truncate">📁 {log.arquivoAfetado}</p>}
                                  {log.detalhes && <p className="text-gray-500 truncate">{log.detalhes}</p>}
                                </div>
                                <span className="text-gray-300 text-[10px] shrink-0">{new Date(log.createdAt).toLocaleTimeString('pt-BR')}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Create Module */}
                    {labActiveSection === 'create-module' && labModuleData && (
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                            <Plus className="w-4 h-4 text-violet-500" />Módulo Gerado: <code className="text-violet-600">{labModuleData.moduleName}</code>
                          </h3>
                          <div className="mt-2 space-y-1">
                            {labModuleData.instructions.map((inst: string, i: number) => (
                              <p key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                                <span className="text-violet-500 font-bold shrink-0">{i + 1}.</span>{inst}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {labModuleData.files.map((f: any) => (
                            <button
                              key={f.path}
                              type="button"
                              onClick={() => setLabSelectedModuleFile(f)}
                              className={`px-2 py-1 text-xs rounded-lg border font-mono transition-colors ${labSelectedModuleFile?.path === f.path ? 'bg-violet-600 text-white border-violet-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-violet-400'}`}
                            >
                              {f.path.split('/').pop()}
                            </button>
                          ))}
                        </div>
                        {labSelectedModuleFile && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">{labSelectedModuleFile.description} — <code className="text-violet-600">{labSelectedModuleFile.path}</code></p>
                            <CodeBlock content={labSelectedModuleFile.content} filename={labSelectedModuleFile.path.split('/').pop()} />
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              </TabsContent>

              {/* Deploy Tab */}
              <TabsContent value="deploy" className="m-0">
                {deployData.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Rocket className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Gere scripts de deploy para Docker, VPS, Render, Railway, etc.</p>
                    <Button type="button" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => runTool("deploy", "Gerar Deploy", "deploy")} disabled={loadingTool !== null}>
                      {loadingTool === "deploy" ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
                      Gerar Scripts
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2 flex-wrap">
                      {deployData.map(script => (
                        <button
                          key={script.filename}
                          type="button"
                          data-testid={`deploy-script-${script.filename}`}
                          onClick={() => setSelectedScript(script)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${selectedScript?.filename === script.filename ? "bg-violet-600 text-white border-violet-600" : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-violet-400"}`}
                        >
                          {script.filename}
                        </button>
                      ))}
                    </div>
                    {selectedScript && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">{selectedScript.description}</p>
                        <CodeBlock content={selectedScript.content} filename={selectedScript.filename} />
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
