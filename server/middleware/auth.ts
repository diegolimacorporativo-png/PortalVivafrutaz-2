import { Request, Response, NextFunction } from 'express';

// Middleware para autenticação de empresa (clientes)
export function requireCompanyAuth(req: any, res: any, next: NextFunction) {
  if (!req.session?.companyId) {
    return res.status(401).json({
      message: 'Autenticação de empresa necessária',
      error: 'COMPANY_AUTH_REQUIRED'
    });
  }
  req.empresaId = req.session.companyId;
  next();
}

// Middleware para autenticação de administrador
export function requireAdminAuth(req: any, res: any, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({
      message: 'Autenticação de administrador necessária',
      error: 'ADMIN_AUTH_REQUIRED'
    });
  }
  next();
}

// Middleware para autenticação de usuário (qualquer tipo)
export function requireAuth(req: any, res: any, next: NextFunction) {
  if (!req.session?.userId && !req.session?.companyId) {
    return res.status(401).json({
      message: 'Autenticação necessária',
      error: 'AUTH_REQUIRED'
    });
  }

  // Define empresaId baseado no tipo de usuário
  if (req.session.companyId) {
    req.empresaId = req.session.companyId;
  } else if (req.session.userId) {
    // Para usuários admin, empresaId pode ser passado via query/param ou ser null para acesso global
    req.empresaId = req.query.empresaId ? parseInt(req.query.empresaId as string) : null;
  }

  next();
}

// Middleware para isolamento de tenant - injeta empresaId automaticamente
export function tenantIsolation(req: any, res: any, next: NextFunction) {
  // Se já temos empresaId definido (por auth middleware), usamos ele
  if (req.empresaId) {
    req.tenantFilter = { empresaId: req.empresaId };
  } else {
    // Para admins sem empresaId específico, não aplicamos filtro (acesso global)
    req.tenantFilter = {};
  }

  next();
}

// Middleware combinado: auth + tenant isolation
export function requireCompanyAccess(req: any, res: any, next: NextFunction) {
  requireCompanyAuth(req, res, (err?: any) => {
    if (err || res.headersSent) return;
    tenantIsolation(req, res, next);
  });
}

export function requireAdminAccess(req: any, res: any, next: NextFunction) {
  requireAdminAuth(req, res, (err?: any) => {
    if (err || res.headersSent) return;
    tenantIsolation(req, res, next);
  });
}

// Middleware para validar propriedade de recursos
export function validateResourceOwnership(resourceTable: string) {
  return async (req: any, res: any, next: NextFunction) => {
    const resourceId = req.params.id || req.body.id;
    if (!resourceId) return next();

    try {
      // Aqui seria implementada a validação se o recurso pertence à empresa
      // Por exemplo: verificar se order.companyId === req.empresaId
      // Isso seria feito no nível do storage service

      next();
    } catch (error) {
      return res.status(403).json({
        message: 'Acesso negado: recurso não pertence à sua empresa',
        error: 'RESOURCE_ACCESS_DENIED'
      });
    }
  };
}