import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Lock,
  TrendingUp,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Building2,
  CreditCard,
  Users,
  ChevronDown,
  Zap,
  BarChart3,
  FileText,
  Eye,
  Settings2,
  Crown,
  Gauge,
} from "lucide-react";

/* ─── Colour system ────────────────────────────────────────────── */
const CC = {
  bg:      "#0b0f19",
  surface: "#0f172a",
  card:    "#111827",
  cardHi:  "#1a2235",
  border:  "#1f2937",
  text:    "#ffffff",
  muted:   "rgba(255,255,255,0.55)",
  dim:     "rgba(255,255,255,0.35)",
  success: "#22c55e",
  warning: "#facc15",
  danger:  "#ef4444",
  info:    "#3b82f6",
  purple:  "#a855f7",
  indigo:  "#6366f1",
} as const;

/* ─── Types ────────────────────────────────────────────────────── */
type ProtectiveLevel = "NORMAL" | "ELEVATED" | "LOCKDOWN";
type HealthStatus    = "OK" | "DEGRADED" | "CRITICAL";
type Recommendation  = "MONITOR" | "INVESTIGATE" | "MITIGATE" | "BLOCK";
type Plan            = "FREE" | "PRO" | "ENTERPRISE";
type Permission      = "VIEW_ONLY" | "MANAGE_POLICIES" | "FULL_ACCESS";

type AlertItem = {
  id: number | string;
  type: string;
  severity: string;
  message?: string | null;
  resolved?: boolean | null;
  createdAt: string;
};

type PolicyItem = {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
};

type Anomaly = {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  affectedEntity?: string;
  evidenceEvents: string[];
};

type SystemStateData = {
  risk: { auth: number; session: number; nfe: number; security: number; global: number };
  anomalies: Anomaly[];
  alerts: AlertItem[];
  policies: PolicyItem[];
  protectiveMode: ProtectiveLevel;
  health: HealthStatus;
  recommendation: Recommendation;
  updatedAt: string;
  tenantScope: string;
  isMaster: boolean;
};

type ApiResponse = { success: boolean; data: SystemStateData };

/* ─── Plan derivation ──────────────────────────────────────────── */
function derivePlan(role?: string): Plan {
  if (role === "MASTER") return "ENTERPRISE";
  if (role === "ADMIN" || role === "DIRECTOR" || role === "DEVELOPER") return "PRO";
  return "FREE";
}

function derivePermission(role?: string): Permission {
  if (role === "MASTER" || role === "ADMIN" || role === "DEVELOPER" || role === "DIRECTOR") return "FULL_ACCESS";
  if (role === "FINANCEIRO" || role === "OPERATIONS_MANAGER") return "MANAGE_POLICIES";
  return "VIEW_ONLY";
}

const PLAN_CONFIG: Record<Plan, { label: string; color: string; icon: typeof Crown; events: number; limit: number }> = {
  FREE:       { label: "Free",       color: CC.muted,   icon: Shield,   events: 500,   limit: 1000 },
  PRO:        { label: "Pro",        color: CC.info,    icon: Zap,      events: 8400,  limit: 25000 },
  ENTERPRISE: { label: "Enterprise", color: CC.purple,  icon: Crown,    events: 94200, limit: -1 },
};

const PERM_CONFIG: Record<Permission, { label: string; color: string; abilities: string[] }> = {
  VIEW_ONLY:       { label: "View Only",       color: CC.muted,   abilities: ["View dashboard", "Read alerts"] },
  MANAGE_POLICIES: { label: "Manage Policies", color: CC.warning, abilities: ["View dashboard", "Read alerts", "Toggle policies"] },
  FULL_ACCESS:     { label: "Full Access",     color: CC.success, abilities: ["View dashboard", "Read & resolve alerts", "Manage policies", "Change protective mode"] },
};

/* ─── Utility helpers ──────────────────────────────────────────── */
function riskColor(score: number): string {
  if (score >= 75) return CC.danger;
  if (score >= 40) return CC.warning;
  return CC.success;
}

function healthColor(h: HealthStatus): string {
  if (h === "OK")       return CC.success;
  if (h === "DEGRADED") return CC.warning;
  return CC.danger;
}

function statusBadgeType(val: string): "success" | "warning" | "danger" {
  if (val === "OK" || val === "NORMAL" || val === "MONITOR") return "success";
  if (val === "DEGRADED" || val === "ELEVATED" || val === "INVESTIGATE") return "warning";
  return "danger";
}

function sevColor(sev: string): string {
  if (sev === "CRITICAL") return CC.danger;
  if (sev === "HIGH")     return CC.warning;
  if (sev === "MEDIUM")   return CC.info;
  return CC.success;
}

function fmtAgo(ts: string, now: number): string {
  const diff = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

/* ─── Primitive UI atoms ───────────────────────────────────────── */
function Pill({ text, color, solid }: { text: string; color: string; solid?: boolean }) {
  return (
    <span
      style={{
        background: solid ? color : color + "20",
        border:     `1px solid ${color}50`,
        color:      solid ? "#000" : color,
        padding:    "3px 10px",
        borderRadius: 20,
        fontSize:   11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        display:    "inline-flex",
        alignItems: "center",
        gap:        4,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Badge({ type, text }: { type: "success" | "warning" | "danger"; text: string }) {
  const colors = { success: CC.success, warning: CC.warning, danger: CC.danger };
  return (
    <span
      style={{
        background: colors[type],
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        color: "#000",
      }}
    >
      {text}
    </span>
  );
}

function LiveIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: CC.success,
          boxShadow: `0 0 0 2px ${CC.success}40`,
          animation: "cc-pulse 1.5s infinite",
        }}
      />
      <span style={{ fontSize: 11, color: CC.muted, fontWeight: 500 }}>Live</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: CC.dim,
        marginBottom: 12,
        marginTop: 28,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, height: 1, background: CC.border }} />
      {children}
      <div style={{ flex: 1, height: 1, background: CC.border }} />
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: CC.card,
        border: `1px solid ${CC.border}`,
        borderRadius: 12,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function MotionCard({ children, style, delay = 0 }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay }}
      style={{
        background: CC.card,
        border: `1px solid ${CC.border}`,
        borderRadius: 12,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Risk bar ─────────────────────────────────────────────────── */
function RiskBar({ score }: { score: number }) {
  const color = riskColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          flex: 1,
          height: 5,
          background: CC.border,
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(score, 100)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{ height: "100%", background: color, borderRadius: 99 }}
        />
      </div>
      <span
        style={{
          color,
          fontWeight: 700,
          fontSize: 13,
          minWidth: 30,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score}
      </span>
    </div>
  );
}

/* ─── KPI Stat card ────────────────────────────────────────────── */
function StatCard({
  label,
  value,
  sub,
  accent,
  Icon,
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  Icon?: React.ElementType;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay }}
      style={{
        background: CC.card,
        border: `1px solid ${CC.border}`,
        borderRadius: 12,
        padding: "16px 18px",
      }}
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div
            style={{
              fontSize: 10,
              color: CC.muted,
              fontWeight: 600,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: accent ?? CC.text,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: CC.muted, marginTop: 6 }}>{sub}</div>
          )}
        </div>
        {Icon && (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: (accent ?? CC.info) + "18",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={16} color={accent ?? CC.info} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Billing usage bar ────────────────────────────────────────── */
function UsageBar({ used, limit, color }: { used: number; limit: number; color: string }) {
  const pct = limit < 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: CC.muted,
          marginBottom: 6,
        }}
      >
        <span>{used.toLocaleString()} events</span>
        <span>{limit < 0 ? "Unlimited" : limit.toLocaleString()}</span>
      </div>
      <div
        style={{
          height: 4,
          background: CC.border,
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: limit < 0 ? "40%" : `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          style={{ height: "100%", background: color, borderRadius: 99 }}
        />
      </div>
      {limit >= 0 && (
        <div style={{ fontSize: 10, color: CC.dim, marginTop: 4, textAlign: "right" }}>
          {pct}% used
        </div>
      )}
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────── */
export default function ControlCenter() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [now, setNow]                     = useState(Date.now());
  const [showPermissions, setShowPermissions] = useState(false);
  const [activeTenantId, setActiveTenantId]   = useState<string>("");
  const [tenantInput, setTenantInput]         = useState<string>("");

  const isMasterRole = user?.role === "MASTER";
  const plan       = derivePlan(user?.role);
  const permission = derivePermission(user?.role);
  const planCfg    = PLAN_CONFIG[plan];
  const permCfg    = PERM_CONFIG[permission];
  const PlanIcon   = planCfg.icon;

  /* Derive the URL to fetch: MASTER can pass ?tenantId=xxx, others rely on server-side scoping */
  const apiUrl = useMemo(() => {
    const base = "/api/admin/system-state";
    if (isMasterRole && activeTenantId) return `${base}?tenantId=${encodeURIComponent(activeTenantId)}`;
    return base;
  }, [isMasterRole, activeTenantId]);

  const { data: resp, isLoading, isFetching } = useQuery<ApiResponse>({
    queryKey: ["/api/admin/system-state", activeTenantId],
    queryFn: async () => {
      const res = await fetch(apiUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load system state");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime:       10_000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state      = resp?.data;
  const updatedAgo = useMemo(
    () => (state?.updatedAt ? fmtAgo(state.updatedAt, now) : null),
    [now, state?.updatedAt]
  );

  /* ── Loading skeleton ── */
  if (isLoading || !state) {
    return (
      <Layout>
        <div
          style={{
            background: CC.bg,
            minHeight: "100vh",
            color: CC.text,
            padding: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexDirection: "column",
          }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          >
            <Activity size={28} color={CC.info} />
          </motion.div>
          <div style={{ color: CC.muted, fontSize: 13 }}>Connecting to system state…</div>
        </div>
      </Layout>
    );
  }

  const hColor = healthColor(state.health);

  return (
    <Layout>
      <style>{`
        @keyframes cc-pulse { 0%,100%{opacity:1;box-shadow:0 0 0 2px ${CC.success}40} 50%{opacity:.6;box-shadow:0 0 0 5px ${CC.success}10} }
      `}</style>

      <div
        style={{ padding: "0 0 48px", background: CC.bg, minHeight: "100vh", color: CC.text }}
        data-testid="page-control-center"
      >

        {/* ═══════════════════════════════════════════════════════════
            TENANT / COMPANY TOP BAR
        ═══════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            background: CC.surface,
            borderBottom: `1px solid ${CC.border}`,
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {/* Tenant identity */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: CC.card,
              border: `1px solid ${CC.border}`,
              borderRadius: 8,
              padding: "6px 12px",
            }}
            data-testid="tenant-selector"
          >
            <Building2 size={14} color={CC.info} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {user?.name ?? "VivaFrutaz Operator"}
            </span>
            <Pill text={user?.role ?? "—"} color={CC.info} />
          </div>

          {/* Tenant scope badge — shows what data is being viewed */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: CC.card,
              border: `1px solid ${CC.border}`,
              borderRadius: 8,
              padding: "6px 10px",
            }}
            data-testid="tenant-scope-badge"
          >
            <Eye size={12} color={CC.muted} />
            <span style={{ fontSize: 11, color: CC.muted }}>Scope:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: (state.tenantScope === "global" ? CC.warning : CC.success) }}>
              {state.tenantScope === "global" ? "Global" : `Tenant ${state.tenantScope}`}
            </span>
          </div>

          {/* MASTER-only: tenant switcher */}
          {isMasterRole && (
            <form
              onSubmit={e => {
                e.preventDefault();
                setActiveTenantId(tenantInput.trim());
                qc.invalidateQueries({ queryKey: ["/api/admin/system-state", tenantInput.trim()] });
              }}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
              data-testid="tenant-switcher"
            >
              <input
                type="text"
                value={tenantInput}
                onChange={e => setTenantInput(e.target.value)}
                placeholder="Tenant ID (empresaId)…"
                style={{
                  background: CC.card,
                  border: `1px solid ${CC.border}`,
                  borderRadius: 6,
                  padding: "5px 10px",
                  color: CC.text,
                  fontSize: 12,
                  width: 180,
                  outline: "none",
                }}
                data-testid="input-tenant-id"
              />
              <button
                type="submit"
                style={{
                  background: CC.info + "20",
                  border: `1px solid ${CC.info}40`,
                  color: CC.info,
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                data-testid="button-switch-tenant"
              >
                Scope
              </button>
              {activeTenantId && (
                <button
                  type="button"
                  onClick={() => { setActiveTenantId(""); setTenantInput(""); }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: CC.muted,
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "5px 6px",
                  }}
                  data-testid="button-clear-tenant"
                >
                  × Global
                </button>
              )}
            </form>
          )}

          {/* Plan badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: planCfg.color + "15",
              border: `1px solid ${planCfg.color}40`,
              borderRadius: 8,
              padding: "6px 12px",
            }}
            data-testid="plan-badge"
          >
            <PlanIcon size={13} color={planCfg.color} />
            <span style={{ fontSize: 12, fontWeight: 700, color: planCfg.color }}>
              {planCfg.label}
            </span>
          </div>

          {/* Permission chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
            onClick={() => setShowPermissions(v => !v)}
            data-testid="permission-toggle"
          >
            <Pill text={permCfg.label} color={permCfg.color} />
            <ChevronDown
              size={12}
              color={CC.muted}
              style={{
                transform: showPermissions ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            />
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <LiveIndicator />
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/system-state", activeTenantId] })}
              disabled={isFetching}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 7,
                border: `1px solid ${CC.border}`,
                background: CC.card,
                color: isFetching ? CC.muted : CC.text,
                fontSize: 12,
                fontWeight: 500,
                cursor: isFetching ? "not-allowed" : "pointer",
              }}
              data-testid="button-refresh"
            >
              <RefreshCw
                size={12}
                style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }}
              />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* Permission dropdown */}
        <AnimatePresence>
          {showPermissions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden" }}
            >
              <div
                style={{
                  background: CC.cardHi,
                  borderBottom: `1px solid ${CC.border}`,
                  padding: "12px 24px",
                  display: "flex",
                  gap: 20,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: CC.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                    Access level
                  </div>
                  <Pill text={permCfg.label} color={permCfg.color} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: CC.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                    Capabilities
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {permCfg.abilities.map(a => (
                      <span
                        key={a}
                        style={{
                          fontSize: 11,
                          color: CC.muted,
                          background: CC.border,
                          borderRadius: 4,
                          padding: "2px 8px",
                        }}
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══════════════════════════════════════════════════════════
            MAIN CONTENT
        ═══════════════════════════════════════════════════════════ */}
        <div style={{ padding: "24px 24px 0" }}>

          {/* ── Page header ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Gauge size={17} color="white" />
                </div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
                  Control Center
                </h1>
              </div>
              <div style={{ fontSize: 12, color: CC.muted }}>
                Observability &amp; Governance · Platform view
                {updatedAgo && (
                  <span style={{ marginLeft: 10, opacity: 0.6 }}>· synced {updatedAgo}</span>
                )}
              </div>
            </div>

            {/* Health pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: hColor + "15",
                border: `1px solid ${hColor}40`,
                borderRadius: 10,
                padding: "8px 14px",
              }}
            >
              {state.health === "OK"
                ? <CheckCircle2 size={15} color={hColor} />
                : state.health === "DEGRADED"
                  ? <AlertTriangle size={15} color={hColor} />
                  : <XCircle size={15} color={hColor} />
              }
              <span style={{ fontSize: 13, fontWeight: 700, color: hColor }}>
                {state.health}
              </span>
            </div>
          </div>

          {/* ── Status strip ── */}
          <Card style={{ padding: "12px 18px", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Badge type={statusBadgeType(state.health)} text={`Health: ${state.health}`} />
              <Badge type={statusBadgeType(state.protectiveMode)} text={`Mode: ${state.protectiveMode}`} />
              <Badge
                type={state.risk.global >= 75 ? "danger" : state.risk.global >= 40 ? "warning" : "success"}
                text={`Risk: ${state.risk.global}`}
              />
              <Badge type={statusBadgeType(state.recommendation)} text={state.recommendation} />
              {state.anomalies.length > 0 && (
                <Pill text={`${state.anomalies.length} anomal${state.anomalies.length > 1 ? "ies" : "y"}`} color={CC.warning} />
              )}
            </div>
          </Card>

          {/* ═══════════════════════════════════════════════════════════
              BILLING MOCK PANEL
          ═══════════════════════════════════════════════════════════ */}
          <SectionLabel>Subscription</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {/* Plan card */}
            <MotionCard delay={0}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: CC.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Current Plan</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PlanIcon size={18} color={planCfg.color} />
                    <span style={{ fontSize: 22, fontWeight: 700, color: planCfg.color }}>{planCfg.label}</span>
                  </div>
                </div>
                <CreditCard size={16} color={CC.muted} />
              </div>
              <div style={{ fontSize: 11, color: CC.muted }}>
                {plan === "FREE" && "Up to 1,000 events/month · 1 workspace"}
                {plan === "PRO" && "Up to 25,000 events/month · Unlimited workspaces"}
                {plan === "ENTERPRISE" && "Unlimited events · Full platform access · Priority SLA"}
              </div>
            </MotionCard>

            {/* Usage card */}
            <MotionCard delay={0.05}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: CC.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  Event Usage · This Month
                </div>
                <BarChart3 size={16} color={CC.muted} />
              </div>
              <UsageBar used={planCfg.events} limit={planCfg.limit} color={planCfg.color} />
            </MotionCard>

            {/* Access rights card */}
            <MotionCard delay={0.1}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: CC.muted, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  User Access
                </div>
                <Users size={16} color={CC.muted} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pill text={permCfg.label} color={permCfg.color} />
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {permCfg.abilities.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: CC.muted }}>
                    <CheckCircle2 size={10} color={permCfg.color} />
                    {a}
                  </div>
                ))}
              </div>
            </MotionCard>
          </div>

          {/* ═══════════════════════════════════════════════════════════
              RISK KPIs — all 5 dimensions
          ═══════════════════════════════════════════════════════════ */}
          <SectionLabel>Risk Metrics</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            <StatCard label="Global Risk"   value={state.risk.global}   sub="composite"     accent={riskColor(state.risk.global)}    Icon={TrendingUp}  delay={0}    />
            <StatCard label="Auth Risk"     value={state.risk.auth}     sub="login events"  accent={riskColor(state.risk.auth)}      Icon={Lock}        delay={0.05} />
            <StatCard label="Session Risk"  value={state.risk.session}  sub="active tokens" accent={riskColor(state.risk.session)}   Icon={Activity}    delay={0.1}  />
            <StatCard label="NF-e Risk"     value={state.risk.nfe}      sub="fiscal ops"    accent={riskColor(state.risk.nfe)}       Icon={FileText}    delay={0.15} />
            <StatCard label="Security Risk" value={state.risk.security} sub="perimeter"     accent={riskColor(state.risk.security)}  Icon={ShieldAlert} delay={0.2}  />
          </div>

          {/* Risk breakdown bars */}
          <MotionCard style={{ marginTop: 12 }} delay={0.25}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: CC.muted,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                marginBottom: 16,
              }}
            >
              Risk Breakdown
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(["auth", "session", "nfe", "security", "global"] as const).map((k, i) => (
                <div
                  key={k}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: CC.muted,
                      textTransform: "capitalize",
                      fontWeight: k === "global" ? 700 : 400,
                    }}
                  >
                    {k}
                  </span>
                  <RiskBar score={state.risk[k]} />
                </div>
              ))}
            </div>
          </MotionCard>

          {/* ═══════════════════════════════════════════════════════════
              ANOMALIES
          ═══════════════════════════════════════════════════════════ */}
          {state.anomalies.length > 0 && (
            <>
              <SectionLabel>Anomalies ({state.anomalies.length})</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {state.anomalies.map((a, i) => (
                  <MotionCard
                    key={i}
                    delay={i * 0.04}
                    style={{
                      padding: "12px 16px",
                      borderLeft: `3px solid ${sevColor(a.severity)}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{a.type}</span>
                        {a.affectedEntity && (
                          <span style={{ fontSize: 11, color: CC.muted, marginLeft: 8 }}>→ {a.affectedEntity}</span>
                        )}
                        {a.evidenceEvents.length > 0 && (
                          <div style={{ fontSize: 11, color: CC.muted, marginTop: 4 }}>
                            Evidence: {a.evidenceEvents.slice(0, 3).join(", ")}
                            {a.evidenceEvents.length > 3 && ` +${a.evidenceEvents.length - 3}`}
                          </div>
                        )}
                      </div>
                      <Pill text={a.severity} color={sevColor(a.severity)} />
                    </div>
                  </MotionCard>
                ))}
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════
              ALERTS
          ═══════════════════════════════════════════════════════════ */}
          <SectionLabel>Alerts ({state.alerts.length})</SectionLabel>
          {state.alerts.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 36 }}>
              <ShieldCheck size={26} color={CC.success} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 13, color: CC.muted }}>No active alerts — system is clean</div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {state.alerts.map((a, i) => (
                <MotionCard key={a.id} delay={i * 0.03} style={{ padding: "13px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.type}</div>
                      {a.message && (
                        <div style={{ fontSize: 12, color: CC.muted, marginTop: 3, wordBreak: "break-word" }}>
                          {a.message}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: CC.dim, marginTop: 4 }}>
                        {fmtAgo(a.createdAt, now)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                      <Pill text={a.severity} color={sevColor(a.severity)} />
                      {a.resolved && <Pill text="resolved" color={CC.success} />}
                    </div>
                  </div>
                </MotionCard>
              ))}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              POLICIES
          ═══════════════════════════════════════════════════════════ */}
          <SectionLabel>Policies ({state.policies.length})</SectionLabel>
          {state.policies.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 36 }}>
              <Settings2 size={26} color={CC.muted} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 13, color: CC.muted }}>No policies configured</div>
            </Card>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
                gap: 10,
              }}
            >
              {state.policies
                .slice()
                .sort((a, b) => b.priority - a.priority)
                .map((p, i) => (
                  <MotionCard
                    key={p.id}
                    delay={i * 0.04}
                    style={{
                      padding: "13px 16px",
                      borderLeft: `3px solid ${p.enabled ? CC.success : CC.border}`,
                      opacity: p.enabled ? 1 : 0.55,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: CC.muted, marginTop: 2 }}>
                          {p.type} · priority {p.priority}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 700,
                          color: p.enabled ? CC.success : CC.muted,
                          flexShrink: 0,
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
                  </MotionCard>
                ))}
            </div>
          )}

          {/* ── Footer ── */}
          <div
            style={{
              marginTop: 40,
              paddingTop: 16,
              borderTop: `1px solid ${CC.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              color: CC.dim,
            }}
          >
            <span>VivafrutaZ ERP · FASE 27 · Observability Platform</span>
            <span>Auto-refresh every 30s</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}
