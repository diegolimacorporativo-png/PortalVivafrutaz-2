import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldAlert, Activity, Calendar, AlertTriangle } from "lucide-react";

interface SecurityAuditData {
  total: number;
  byOrder: Record<string, number>;
  byUser: Record<string, number>;
  byPath: Record<string, number>;
  topUsers: Array<[string, number]>;
  topPaths: Array<[string, number]>;
  suspiciousUsers: Array<{ email: string; count: number }>;
  windowDays: number;
}

interface ApiResponse {
  success: boolean;
  data: SecurityAuditData;
}

export default function SecurityAuditPage() {
  const { data: response, isLoading, isError } = useQuery<ApiResponse>({
    queryKey: ["/api/admin/security/tenant-mismatch-events"],
    refetchInterval: 30_000,
  });

  const data = response?.data;
  const blockedSet = new Set(
    (data?.suspiciousUsers ?? []).map((u) => u.email),
  );

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-security-audit">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Auditoria de Segurança
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitoramento de tentativas de acesso indevido entre tenants
          </p>
        </div>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="p-6 text-muted-foreground" data-testid="status-loading">
            Carregando dados de auditoria…
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-6 text-destructive" data-testid="status-error">
            Não foi possível carregar os dados. Apenas usuários MASTER têm
            acesso a esta página.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card data-testid="card-summary-total">
              <CardContent className="p-4 flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Total de tentativas</p>
                  <p
                    className="text-2xl font-bold"
                    data-testid="text-total-attempts"
                  >
                    {data.total}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-summary-suspicious">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Usuários suspeitos</p>
                  <p
                    className="text-2xl font-bold"
                    data-testid="text-suspicious-count"
                  >
                    {data.suspiciousUsers.length}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-summary-window">
              <CardContent className="p-4 flex items-center gap-3">
                <Calendar className="h-8 w-8 text-emerald-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Janela (dias)</p>
                  <p
                    className="text-2xl font-bold"
                    data-testid="text-window-days"
                  >
                    {data.windowDays}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Users */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top usuários (por tentativas)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topUsers.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-no-users"
                >
                  Nenhuma tentativa registrada na janela.
                </p>
              ) : (
                <Table data-testid="table-top-users">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-32">Tentativas</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topUsers.map(([email, count]) => {
                      const blocked = blockedSet.has(email);
                      return (
                        <TableRow
                          key={email}
                          data-testid={`row-user-${email}`}
                        >
                          <TableCell
                            className="font-medium"
                            data-testid={`text-user-email-${email}`}
                          >
                            {email}
                          </TableCell>
                          <TableCell data-testid={`text-user-count-${email}`}>
                            {count}
                          </TableCell>
                          <TableCell>
                            {blocked ? (
                              <Badge
                                variant="destructive"
                                data-testid={`badge-blocked-${email}`}
                              >
                                BLOQUEADO
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                data-testid={`badge-ok-${email}`}
                              >
                                OK
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Endpoints */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Endpoints atacados</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(data.byPath).length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-no-paths"
                >
                  Nenhum endpoint registrado na janela.
                </p>
              ) : (
                <Table data-testid="table-paths">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Path</TableHead>
                      <TableHead className="w-32">Tentativas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(data.byPath)
                      .sort((a, b) => b[1] - a[1])
                      .map(([path, count]) => (
                        <TableRow
                          key={path}
                          data-testid={`row-path-${path}`}
                        >
                          <TableCell
                            className="font-mono text-sm"
                            data-testid={`text-path-${path}`}
                          >
                            {path}
                          </TableCell>
                          <TableCell data-testid={`text-path-count-${path}`}>
                            {count}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
