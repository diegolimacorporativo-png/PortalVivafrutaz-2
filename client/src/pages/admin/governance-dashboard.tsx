import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, Activity, TrendingUp, AlertTriangle, Gauge } from "lucide-react";

type SummaryData = {
  productionScore?: number;
  securityScore?: number;
  consistencyScore?: number;
  stabilityScore?: number;
  architectureScore?: number;
  observabilityScore?: number;
  trustScore?: number;
  chaosScore?: number;
  driftLevel?: string;
  verdict?: string;
};

type GovernanceResponse = {
  summary: SummaryData;
  security: unknown;
  drift: unknown;
  chaos: unknown;
  governance: unknown;
  productionGate: unknown;
  autoHealing: unknown;
  patchSandbox: unknown;
};

function ScoreCard({ title, value, icon: Icon, testId }: { title: string; value: number | string; icon: any; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1" data-testid={`${testId}-value`}>{value}</p>
        </div>
        <Icon className="h-8 w-8 text-primary" />
      </CardContent>
    </Card>
  );
}

export default function GovernanceDashboardPage() {
  const { data, isLoading, isError } = useQuery<GovernanceResponse>({
    queryKey: ["/api/admin/governance/summary"],
    staleTime: 30_000,
  });

  const summary = data?.summary ?? {};

  return (
    <Layout>
      <div className="space-y-6" data-testid="page-governance-dashboard">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-governance-title">Governance Dashboard</h1>
          <p className="text-muted-foreground">Visualização read-only do ecossistema de governança.</p>
        </div>

        {isLoading && <Card><CardContent className="p-6">Carregando dados...</CardContent></Card>}
        {isError && <Card><CardContent className="p-6 text-destructive">Falha ao carregar governança.</CardContent></Card>}

        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <ScoreCard title="Production Score" value={summary.productionScore ?? "—"} icon={Shield} testId="card-production-score" />
              <ScoreCard title="Chaos Score" value={summary.chaosScore ?? "—"} icon={Gauge} testId="card-chaos-score" />
              <ScoreCard title="Drift Score" value={summary.trustScore ?? summary.consistencyScore ?? "—"} icon={Activity} testId="card-drift-score" />
              <ScoreCard title="Security Score" value={summary.securityScore ?? "—"} icon={TrendingUp} testId="card-security-score" />
            </div>

            <Card data-testid="card-decision-banner">
              <CardContent className="p-5 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">{summary.verdict ?? "UNKNOWN"}</p>
                  <p className="text-sm text-muted-foreground">Painel somente leitura para ADMIN.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Scores detalhados</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Métrica</TableHead>
                      <TableHead>Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["Production", summary.productionScore],
                      ["Security", summary.securityScore],
                      ["Consistency", summary.consistencyScore],
                      ["Stability", summary.stabilityScore],
                      ["Architecture", summary.architectureScore],
                      ["Observability", summary.observabilityScore],
                    ].map(([label, value]) => (
                      <TableRow key={label as string} data-testid={`row-score-${label}`}>
                        <TableCell>{label}</TableCell>
                        <TableCell data-testid={`text-score-${label}`}>{String(value ?? "—")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Top issues</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground" data-testid="text-top-issues">
                  Dados agregados dos engines já existentes.
                </p>
                <Badge variant="secondary" className="mt-3" data-testid="badge-readonly">
                  READ-ONLY
                </Badge>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}