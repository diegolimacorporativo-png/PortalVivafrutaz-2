import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  Lock,
  Radio,
  TrendingUp,
} from "lucide-react";

type ProtectiveLevel = "NORMAL" | "ELEVATED" | "LOCKDOWN";
type HealthStatus = "OK" | "DEGRADED" | "CRITICAL";
type Recommendation = "MONITOR" | "INVESTIGATE" | "MITIGATE" | "BLOCK";

type AlertItem = {
  id: number;
  type: string;
  severity: string;
  message: string | null;
  resolved: boolean | null;
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
};

type ApiResponse = { success: boolean; data: SystemStateData };

const CC = {
  bg: "#0b0f19",
  card: "#111827",
  border: "#1f2937",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.6)",
  success: "#22c55e",
  warning: "#facc15",
  danger: "#ef4444",
} as const;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: CC.card, border: `1px solid ${CC.border}`, borderRadius: 12, padding: 16 }}>
      {children}
    </div>
  );
}

function MotionCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: CC.card, border: `1px solid ${CC.border}`, borderRadius: 12, padding: 16 }}
    >
      {children}
    </motion.div>
  );
}

function Badge({ type, text }: { type: "success" | "warning" | "danger"; text: string }) {
  const colors = { success: CC.success, warning: CC.warning, danger: CC.danger };
  return (
    <span
      style={{
        background: colors[type],
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color: "black",
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
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: CC.success,
          animation: "cc-pulse 1.5s infinite",
        }}
      />
      <span style={{ fontSize: 12, opacity: 0.7 }}>Live</span>
    </div>
  );
}

function statusColor(val: HealthStatus | ProtectiveLevel | Recommendation | string): "success" | "warning" | "danger" {
  if (val === "OK" || val === "NORMAL" || val === "MONITOR") return "success";
  if (val === "DEGRADED" || val === "ELEVATED" || val === "INVESTIGATE") return "warning";
  return "danger";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: CC.card, border: `1px solid ${CC.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

async function getSystemState() {
  const res = await fetch("/api/admin/system-state", { cache: "no-store", credentials: "include" });
  return res.json();
}

export default function ControlCenter() {
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const { data } = useQuery<ApiResponse>({
    queryKey: ["/api/admin/system-state"],
    queryFn: getSystemState,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state = data?.data;
  const updatedAgo = useMemo(() => {
    if (!state?.updatedAt) return null;
    const diff = Math.max(0, Math.round((now - new Date(state.updatedAt).getTime()) / 1000));
    if (diff < 60) return `${diff}s ago`;
    return `${Math.round(diff / 60)}m ago`;
  }, [now, state?.updatedAt]);

  if (!state) {
    return (
      <Layout>
        <div style={{ background: CC.bg, minHeight: "100vh", color: CC.text, padding: 24 }}>Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <style>{`@keyframes cc-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
      <div style={{ padding: 24, background: CC.bg, minHeight: "100vh", color: CC.text }} data-testid="page-control-center">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 20, alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Control Center</h1>
            <div style={{ color: CC.muted, marginTop: 6, fontSize: 13 }}>System state overview</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LiveIndicator />
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/system-state"] })}
              style={{ background: CC.card, border: `1px solid ${CC.border}`, color: CC.text, borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <Badge type={statusColor(state.health)} text={state.health} />
          <Badge type={statusColor(state.protectiveMode)} text={state.protectiveMode} />
          <Badge type={statusColor(state.risk.global >= 75 ? "CRITICAL" : state.risk.global >= 40 ? "INVESTIGATE" : "MONITOR")} text={`Risk ${state.risk.global}`} />
          {updatedAgo && <span style={{ fontSize: 12, color: CC.muted }}>Updated {updatedAgo}</span>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
          <Stat label="Global Risk" value={state.risk.global} />
          <Stat label="Auth Risk" value={state.risk.auth} />
          <Stat label="Session Risk" value={state.risk.session} />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 12, fontWeight: 600 }}>Alerts</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.alerts.map((a) => (
              <MotionCard key={a.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <b>{a.type}</b>
                    <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{new Date(a.createdAt).toLocaleString("pt-BR")}</div>
                  </div>
                  <Badge
                    type={a.severity === "CRITICAL" ? "danger" : a.severity === "HIGH" ? "warning" : "success"}
                    text={a.severity}
                  />
                </div>
              </MotionCard>
            ))}
          </div>
        </div>

        <div>
          <div style={{ marginBottom: 12, fontWeight: 600 }}>Policies</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {state.policies.map((p) => (
              <Card key={p.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <b>{p.name}</b>
                    <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{p.type}</div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{p.enabled ? "ON" : "OFF"}</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
