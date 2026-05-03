import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Shield, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { handleAuthError } from "@/lib/authErrors";

type HealthStatus = "OK" | "DEGRADED" | "CRITICAL";
type ProtectiveLevel = "NORMAL" | "ELEVATED" | "LOCKDOWN";
type AlertItem = { id: number | string; type: string; severity: string; createdAt: string; message?: string | null };
type PolicyItem = { id: number; name: string; type: string; enabled: boolean; priority: number; tenantId?: string | null };
type SystemStateData = {
  risk: { auth: number; session: number; nfe: number; security: number; global: number };
  alerts: AlertItem[];
  policies: PolicyItem[];
  protectiveMode: ProtectiveLevel;
  health: HealthStatus;
  updatedAt: string;
  tenantScope: string;
  isMaster: boolean;
};
type ApiResponse = { success: boolean; data: SystemStateData };

function statusTone(value: string) {
  if (value === "OK" || value === "NORMAL") return "#22c55e";
  if (value === "DEGRADED" || value === "ELEVATED") return "#f59e0b";
  return "#ef4444";
}

function fmtAgo(ts: string, now: number) {
  const diff = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

function SectionTitle({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{children}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:bg-card">{children}</div>;
}

export default function ControlCenter() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const [tenantInput, setTenantInput] = useState("");
  const [activeTenantId, setActiveTenantId] = useState("");

  const isMaster = user?.role === "MASTER";
  const apiUrl = useMemo(() => {
    const base = "/api/admin/system-state";
    return isMaster && activeTenantId ? `${base}?tenantId=${encodeURIComponent(activeTenantId)}` : base;
  }, [activeTenantId, isMaster]);

  const { data, isLoading, isFetching } = useQuery<ApiResponse>({
    queryKey: ["/api/admin/system-state", activeTenantId],
    queryFn: async () => {
      const res = await fetch(apiUrl, { credentials: "include" });
      if (handleAuthError(res.status, () => window.location.assign("/login"))) throw new Error("Sessão expirada");
      if (!res.ok) throw new Error("Failed to load system state");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = data?.data;
  const updatedAgo = state?.updatedAt ? fmtAgo(state.updatedAt, now) : null;
  const liveAlerts = state?.alerts ?? [];
  const policies = state?.policies ?? [];

  if (isLoading || !state) {
    return (
      <Layout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Activity className="h-5 w-5 animate-spin" />
            Loading control center…
          </div>
        </div>
      </Layout>
    );
  }

  const healthTone = statusTone(state.health);
  const modeTone = statusTone(state.protectiveMode);
  const cards = [
    { label: "Global Risk", value: state.risk.global },
    { label: "System Health", value: state.health },
    { label: "Active Alerts", value: liveAlerts.filter((a) => !String(a.message ?? "").toLowerCase().includes("resolved")).length },
    { label: "Critical Issues", value: liveAlerts.filter((a) => a.severity === "CRITICAL").length },
  ];

  return (
    <Layout>
      <div className="min-h-screen bg-background px-6 py-6 text-foreground">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium" data-testid="text-tenant">
                {state.tenantScope === "global" ? "Global" : `Tenant ${state.tenantScope}`}
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium" data-testid="badge-health" style={{ color: healthTone }}>
                Health {state.health}
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium" data-testid="badge-protective-mode" style={{ color: modeTone }}>
                Protective Mode {state.protectiveMode}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Live
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isMaster ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setActiveTenantId(tenantInput.trim());
                  }}
                >
                  <input
                    value={tenantInput}
                    onChange={(e) => setTenantInput(e.target.value)}
                    placeholder="Tenant ID"
                    className="h-9 rounded-xl border border-border bg-background px-3 text-sm outline-none"
                    data-testid="input-tenant-id"
                  />
                  <button className="h-9 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground" type="submit" data-testid="button-scope-tenant">
                    Scope
                  </button>
                </form>
              ) : null}
              <button
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium"
                onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/system-state", activeTenantId] })}
                disabled={isFetching}
                data-testid="button-refresh"
              >
                <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Refresh
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.label}>
                <SectionTitle>{card.label}</SectionTitle>
                <div className="mt-3 text-3xl font-semibold" data-testid={`text-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {card.value}
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <SectionTitle>Risk Breakdown</SectionTitle>
                <div className="text-sm text-muted-foreground">Updated {updatedAgo}</div>
              </div>
              <div className="space-y-4">
                {["auth", "session", "nfe", "security"].map((key) => {
                  const score = state.risk[key as keyof typeof state.risk];
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize text-muted-foreground">{key}</span>
                        <span className="font-medium">{score}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full" style={{ width: `${Math.min(score, 100)}%`, background: statusTone(score >= 75 ? "CRITICAL" : score >= 40 ? "DEGRADED" : "OK") }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <SectionTitle>Policies</SectionTitle>
              <div className="mt-4 space-y-3">
                {policies.slice(0, 4).map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2" data-testid={`row-policy-${policy.id}`}>
                    <div>
                      <div className="font-medium">{policy.name}</div>
                      <div className="text-xs text-muted-foreground">Impact {policy.priority >= 80 ? "HIGH" : policy.priority >= 40 ? "MEDIUM" : "LOW"}</div>
                    </div>
                    <div className="rounded-full px-2 py-1 text-xs font-semibold" style={{ color: policy.enabled ? "#16a34a" : "#ef4444" }}>
                      {policy.enabled ? "Enabled" : "Disabled"}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <SectionTitle>Live Incidents</SectionTitle>
              <div className="mt-4 space-y-3">
                {liveAlerts.length ? liveAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start justify-between gap-4 rounded-xl border border-border px-3 py-3" data-testid={`row-alert-${alert.id}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: `${statusTone(alert.severity)}20`, color: statusTone(alert.severity) }}>
                          {alert.severity}
                        </span>
                        <span className="font-medium">{alert.type}</span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{alert.message ?? "Active incident"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtAgo(alert.createdAt, now)}</div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-border px-3 py-6 text-sm text-muted-foreground">No active incidents.</div>
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle>Topline</SectionTitle>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <div className="font-medium">System Health</div>
                    <div className="text-sm text-muted-foreground">{state.health}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  <div>
                    <div className="font-medium">Protective Mode</div>
                    <div className="text-sm text-muted-foreground">{state.protectiveMode}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                  <ShieldAlert className="h-5 w-5 text-amber-500" />
                  <div>
                    <div className="font-medium">Critical Issues</div>
                    <div className="text-sm text-muted-foreground">{liveAlerts.filter((a) => a.severity === "CRITICAL").length}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3">
                  <Sparkles className="h-5 w-5 text-violet-500" />
                  <div>
                    <div className="font-medium">Global Risk</div>
                    <div className="text-sm text-muted-foreground">{state.risk.global}</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
