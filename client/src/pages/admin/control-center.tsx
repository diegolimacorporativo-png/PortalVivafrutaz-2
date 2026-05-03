import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  ShieldCheck, ShieldAlert, Shield, Activity, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Zap, Lock, Radio, TrendingUp,
} from "lucide-react";

type ProtectiveLevel = "NORMAL" | "ELEVATED" | "LOCKDOWN";
type HealthStatus = "OK" | "DEGRADED" | "CRITICAL";
type Recommendation = "MONITOR" | "INVESTIGATE" | "MITIGATE" | "BLOCK";

interface Alert {
  id: number;
  type: string;
  severity: string;
  message: string | null;
  resolved: boolean | null;
  createdAt: string;
}

interface Policy {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
}

interface Anomaly {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  affectedEntity?: string;
  evidenceEvents: string[];
}

interface SystemStateData {
  risk: { auth: number; session: number; nfe: number; security: number; global: number };
  anomalies: Anomaly[];
  alerts: Alert[];
  policies: Policy[];
  protectiveMode: ProtectiveLevel;
  health: HealthStatus;
  recommendation: Recommendation;
  updatedAt: string;
}

interface ApiResponse {
  success: boolean;
  data: SystemStateData;
}

const CC = {
  bg: "#0b0f19",
  card: "#111827",
  border: "#1f2937",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.55)",
  success: "#22c55e",
  warning: "#facc15",
  danger: "#ef4444",
  info: "#3b82f6",
  purple: "#a855f7",
} as const;

function ccCard(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: CC.card,
    border: `1px solid ${CC.border}`,
    borderRadius: 12,
    padding: 20,
    ...extra,
  };
}

function statusColor(val: HealthStatus | ProtectiveLevel | Recommendation | string): string {
  if (val === "OK" || val === "NORMAL" || val === "MONITOR") return CC.success;
  if (val === "DEGRADED" || val === "ELEVATED" || val === "INVESTIGATE") return CC.warning;
  if (val === "CRITICAL" || val === "LOCKDOWN" || val === "BLOCK" || val === "MITIGATE") return CC.danger;
  return CC.muted;
}

function sevColor(sev: string): string {
  if (sev === "CRITICAL") return CC.danger;
  if (sev === "HIGH") return CC.warning;
  if (sev === "MEDIUM") return CC.info;
  return CC.success;
}

function riskColor(score: number): string {
  if (score >= 75) return CC.danger;
  if (score >= 40) return CC.warning;
  return CC.success;
}

function CCBadge({
  text,
  color,
  size = "sm",
}: {
  text: string;
  color: string;
  size?: "sm" | "xs";
}) {
  return (
    <span
      style={{
        background: color + "22",
        border: `1px solid ${color}55`,
        color: color,
        padding: size === "sm" ? "4px 10px" : "2px 8px",
        borderRadius: 6,
        fontSize: size === "sm" ? 12 : 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function RiskBar({ score }: { score: number }) {
  const color = riskColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: CC.border,
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(score, 100)}%`,
            height: "100%",
            background: color,
            borderRadius: 99,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 14, minWidth: 28, textAlign: "right" }}>
        {score}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  Icon?: React.ElementType;
}) {
  return (
    <div style={ccCard()} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: CC.muted, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            {label}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: accent ?? CC.text, lineHeight: 1 }}>
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: CC.muted, marginTop: 6 }}>{sub}</div>
          )}
        </div>
        {Icon && (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: (accent ?? CC.info) + "22",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={18} color={accent ?? CC.info} />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: CC.muted,
      marginBottom: 12,
      marginTop: 32,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <div style={{ flex: 1, height: 1, background: CC.border }} />
      {children}
      <div style={{ flex: 1, height: 1, background: CC.border }} />
    </div>
  );
}

function HealthIcon({ h }: { h: HealthStatus }) {
  if (h === "OK") return <CheckCircle2 size={16} color={CC.success} />;
  if (h === "DEGRADED") return <AlertTriangle size={16} color={CC.warning} />;
  return <XCircle size={16} color={CC.danger} />;
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 3px ${color}44`,
          display: "inline-block",
          animation: "cc-pulse 2s ease infinite",
        }}
      />
    </span>
  );
}

export default function ControlCenter() {
  const qc = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: resp, isLoading, isFetching, dataUpdatedAt } = useQuery<ApiResponse>({
    queryKey: ["/api/admin/system-state"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-state", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load system state");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const state = resp?.data;

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <Layout>
      <style>{`
        @keyframes cc-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 3px ${CC.success}44; }
          50% { opacity: 0.7; box-shadow: 0 0 0 6px ${CC.success}22; }
        }
        @keyframes cc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          minHeight: "100%",
          background: CC.bg,
          color: CC.text,
          fontFamily: "'Inter', system-ui, sans-serif",
          padding: "24px 28px 48px",
        }}
        data-testid="page-control-center"
      >
        {/* ── HEADER ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Activity size={18} color="white" />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
                Control Center
              </h1>
              {state && (
                <PulsingDot color={statusColor(state.health)} />
              )}
            </div>
            <p style={{ fontSize: 13, color: CC.muted, margin: 0 }}>
              Observability &amp; Governance — live system state
              {lastUpdate && (
                <span style={{ marginLeft: 10, fontSize: 11, opacity: 0.7 }}>
                  · updated {lastUpdate}
                </span>
              )}
            </p>
          </div>

          <button
            data-testid="button-refresh-state"
            onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/system-state"] })}
            disabled={isFetching}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: `1px solid ${CC.border}`,
              background: CC.card,
              color: isFetching ? CC.muted : CC.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: isFetching ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            <RefreshCw
              size={14}
              style={{ animation: isFetching ? "cc-spin 1s linear infinite" : "none" }}
            />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* ── LOADING ── */}
        {isLoading && (
          <div style={{ textAlign: "center", color: CC.muted, padding: "80px 0", fontSize: 14 }}>
            <Radio size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <div>Connecting to system state…</div>
          </div>
        )}

        {!isLoading && !state && (
          <div style={ccCard({ textAlign: "center", color: CC.danger, padding: 40 })}>
            <XCircle size={32} style={{ marginBottom: 10, opacity: 0.7 }} />
            <div style={{ fontSize: 14 }}>Failed to load system state. Check backend connectivity.</div>
          </div>
        )}

        {state && (
          <>
            {/* ── STATUS STRIP ── */}
            <div
              style={ccCard({
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "14px 20px",
                marginBottom: 24,
              })}
              data-testid="status-strip"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <HealthIcon h={state.health} />
                <span style={{ color: statusColor(state.health), fontWeight: 600 }}>
                  Health: {state.health}
                </span>
              </div>
              <div style={{ width: 1, height: 16, background: CC.border }} />
              <CCBadge
                text={`Protective: ${state.protectiveMode}`}
                color={statusColor(state.protectiveMode)}
              />
              <CCBadge
                text={`Action: ${state.recommendation}`}
                color={statusColor(state.recommendation)}
              />
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <Zap size={12} color={CC.muted} />
                <span style={{ fontSize: 11, color: CC.muted }}>
                  {state.anomalies.length} anomal{state.anomalies.length === 1 ? "y" : "ies"} active
                </span>
              </div>
            </div>

            {/* ── RISK KPIs ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
              }}
            >
              <StatCard
                label="Global Risk"
                value={state.risk.global}
                sub="composite score"
                accent={riskColor(state.risk.global)}
                Icon={TrendingUp}
              />
              <StatCard
                label="Auth Risk"
                value={state.risk.auth}
                sub="authentication events"
                accent={riskColor(state.risk.auth)}
                Icon={Lock}
              />
              <StatCard
                label="Session Risk"
                value={state.risk.session}
                sub="active sessions"
                accent={riskColor(state.risk.session)}
                Icon={Activity}
              />
              <StatCard
                label="NF-e Risk"
                value={state.risk.nfe}
                sub="fiscal operations"
                accent={riskColor(state.risk.nfe)}
                Icon={Shield}
              />
              <StatCard
                label="Security Risk"
                value={state.risk.security}
                sub="perimeter threats"
                accent={riskColor(state.risk.security)}
                Icon={ShieldAlert}
              />
            </div>

            {/* ── RISK BARS ── */}
            <div style={{ marginTop: 16, ...ccCard() }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: CC.muted, marginBottom: 16, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Risk Breakdown
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(["auth", "session", "nfe", "security", "global"] as const).map((k) => (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "80px 1fr", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: CC.muted, textTransform: "capitalize" }}>{k}</span>
                    <RiskBar score={state.risk[k]} />
                  </div>
                ))}
              </div>
            </div>

            {/* ── ANOMALIES ── */}
            {state.anomalies.length > 0 && (
              <>
                <SectionHeading>Anomalies ({state.anomalies.length})</SectionHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {state.anomalies.map((a, i) => (
                    <div
                      key={i}
                      style={ccCard({ padding: "12px 16px", borderLeft: `3px solid ${sevColor(a.severity)}` })}
                      data-testid={`anomaly-row-${i}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: CC.text }}>{a.type}</span>
                          {a.affectedEntity && (
                            <span style={{ fontSize: 11, color: CC.muted, marginLeft: 8 }}>
                              → {a.affectedEntity}
                            </span>
                          )}
                          {a.evidenceEvents.length > 0 && (
                            <div style={{ fontSize: 11, color: CC.muted, marginTop: 2 }}>
                              Evidence: {a.evidenceEvents.slice(0, 3).join(", ")}
                              {a.evidenceEvents.length > 3 && ` +${a.evidenceEvents.length - 3} more`}
                            </div>
                          )}
                        </div>
                        <CCBadge text={a.severity} color={sevColor(a.severity)} size="xs" />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── ALERTS ── */}
            <SectionHeading>Alerts ({state.alerts.length})</SectionHeading>
            {state.alerts.length === 0 ? (
              <div style={ccCard({ textAlign: "center", padding: 32, color: CC.muted })}>
                <ShieldCheck size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div style={{ fontSize: 13 }}>No active alerts — system is clean</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {state.alerts.map((a) => (
                  <div
                    key={a.id}
                    style={ccCard({ padding: "14px 16px" })}
                    data-testid={`alert-row-${a.id}`}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: CC.text }}>{a.type}</div>
                        {a.message && (
                          <div style={{ fontSize: 12, color: CC.muted, marginTop: 3, wordBreak: "break-word" }}>
                            {a.message}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: CC.muted, marginTop: 4, opacity: 0.7 }}>
                          {new Date(a.createdAt).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                        <CCBadge text={a.severity} color={sevColor(a.severity)} size="xs" />
                        {a.resolved && (
                          <CCBadge text="resolved" color={CC.success} size="xs" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── POLICIES ── */}
            <SectionHeading>Policies ({state.policies.length})</SectionHeading>
            {state.policies.length === 0 ? (
              <div style={ccCard({ textAlign: "center", padding: 32, color: CC.muted })}>
                <Lock size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div style={{ fontSize: 13 }}>No policies loaded</div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 10,
                }}
              >
                {state.policies
                  .slice()
                  .sort((a, b) => b.priority - a.priority)
                  .map((p) => (
                    <div
                      key={p.id}
                      style={ccCard({
                        padding: "14px 16px",
                        borderLeft: `3px solid ${p.enabled ? CC.success : CC.border}`,
                        opacity: p.enabled ? 1 : 0.55,
                      })}
                      data-testid={`policy-row-${p.id}`}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: CC.text, marginBottom: 2 }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 11, color: CC.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {p.type} · priority {p.priority}
                          </div>
                        </div>
                        <div
                          style={{
                            flexShrink: 0,
                            fontSize: 11,
                            fontWeight: 700,
                            color: p.enabled ? CC.success : CC.muted,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: p.enabled ? CC.success : CC.border,
                              display: "inline-block",
                            }}
                          />
                          {p.enabled ? "ON" : "OFF"}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* ── FOOTER ── */}
            <div
              style={{
                marginTop: 40,
                paddingTop: 16,
                borderTop: `1px solid ${CC.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: CC.muted,
                opacity: 0.6,
              }}
            >
              <span>VivafrutaZ ERP · FASE 27 · Observability Platform</span>
              <span>Auto-refresh every 30s</span>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
