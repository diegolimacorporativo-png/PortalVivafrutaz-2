/**
 * FASE 6.2 — Middleware de auth estrutural (anti-esquecimento).
 *
 * Centraliza o padrão repetido em todo o backend:
 *
 *   if (!req.session?.userId && !req.session?.companyId) {
 *     return res.status(401).json({ message: 'Não autenticado' });
 *   }
 *
 * Uso em rotas isoladas:
 *
 *   app.get('/api/rota', requireSessionOrCompany, async (req, res) => { ... });
 *
 * NÃO foi aplicado globalmente pois o sistema possui rotas públicas
 * (portal de empresa, webhooks, health-check) que não requerem sessão.
 *
 * Compatível com sessões de usuário admin (userId) e sessões de empresa
 * (companyId) — ambas são consideradas autenticadas.
 */
export function requireSessionOrCompany(req: any, res: any, next: any): void {
  if (!req.session?.userId && !req.session?.companyId) {
    res.status(401).json({ message: 'Não autenticado' });
    return;
  }
  next();
}
