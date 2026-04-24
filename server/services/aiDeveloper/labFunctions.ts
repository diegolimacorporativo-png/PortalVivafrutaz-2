import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ─── Health Monitor ──────────────────────────────────────────────────────────
export function getHealthMetrics() {
  const cpuLoad = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePct = Math.round((usedMem / totalMem) * 100);
  const uptime = os.uptime();

  return {
    cpu: {
      load1m: Math.round(cpuLoad[0] * 100) / 100,
      load5m: Math.round(cpuLoad[1] * 100) / 100,
      load15m: Math.round(cpuLoad[2] * 100) / 100,
      cores: os.cpus().length,
    },
    memory: {
      totalMB: Math.round(totalMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
      usagePct: memUsagePct,
    },
    uptime: {
      seconds: Math.round(uptime),
      formatted: formatUptime(uptime),
    },
    platform: os.platform(),
    nodeVersion: process.version,
    generatedAt: new Date().toISOString(),
  };
}

function formatUptime(secs: number) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// ─── Route Tester ────────────────────────────────────────────────────────────
const TEST_ROUTES = [
  { method: 'GET', path: '/api/auth/me', description: 'Autenticação do usuário' },
  { method: 'GET', path: '/api/orders', description: 'Lista de pedidos' },
  { method: 'GET', path: '/api/companies', description: 'Lista de empresas' },
  { method: 'GET', path: '/api/products', description: 'Catálogo de produtos' },
  { method: 'GET', path: '/api/company-config', description: 'Configuração da empresa' },
  { method: 'GET', path: '/api/accounts-receivable', description: 'Contas a receber' },
  { method: 'GET', path: '/api/nfe', description: 'NF-e emitidas' },
  { method: 'GET', path: '/api/nfe/sefaz/status', description: 'Status SEFAZ' },
  { method: 'GET', path: '/api/system/logs', description: 'Logs do sistema' },
  { method: 'GET', path: '/api/ai-developer/index', description: 'Índice AI Developer' },
  { method: 'GET', path: '/api/ai-developer/bugs', description: 'Detector de bugs' },
  { method: 'GET', path: '/api/ai-developer/security', description: 'Auditoria segurança' },
  { method: 'GET', path: '/api/ai-developer/performance', description: 'Análise performance' },
  { method: 'GET', path: '/api/ai-developer/database', description: 'Análise banco' },
  { method: 'GET', path: '/api/settings/maintenance', description: 'Modo manutenção' },
];

export async function testRoutes(baseUrl: string, sessionCookie: string) {
  const results: any[] = [];
  for (const route of TEST_ROUTES) {
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { 'Cookie': sessionCookie, 'Content-Type': 'application/json' },
      });
      const elapsed = Date.now() - start;
      let status: 'OK' | 'WARN' | 'FAIL';
      if (res.status < 300) status = 'OK';
      else if (res.status === 401 || res.status === 403) status = 'WARN';
      else status = 'FAIL';
      results.push({
        ...route,
        httpStatus: res.status,
        responseTimeMs: elapsed,
        status,
        note: res.status === 401 ? 'Requer autenticação' : res.status === 403 ? 'Sem permissão' : undefined,
      });
    } catch (e: any) {
      results.push({
        ...route,
        httpStatus: 0,
        responseTimeMs: Date.now() - start,
        status: 'FAIL',
        note: e.message,
      });
    }
  }

  const ok = results.filter(r => r.status === 'OK').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const avgMs = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);

  return { results, summary: { total: results.length, ok, warn, fail, avgMs }, generatedAt: new Date().toISOString() };
}

// ─── API Documentation Generator ────────────────────────────────────────────
export function generateDocs() {
  const routesFile = path.join(process.cwd(), 'server', 'routes.ts');
  let content = '';
  try { content = fs.readFileSync(routesFile, 'utf-8'); } catch { content = ''; }

  const routePattern = /app\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g;
  const routes: { method: string; path: string }[] = [];
  let match;
  while ((match = routePattern.exec(content)) !== null) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }

  const grouped: Record<string, { method: string; path: string }[]> = {};
  for (const r of routes) {
    const segment = r.path.split('/')[2] || 'root';
    if (!grouped[segment]) grouped[segment] = [];
    grouped[segment].push(r);
  }

  const docs: any[] = Object.entries(grouped).map(([group, endpoints]) => ({
    group: group.toUpperCase(),
    endpoints: endpoints.map(e => ({
      method: e.method,
      path: e.path,
      description: describeRoute(e.method, e.path),
    })),
  }));

  const markdown = generateMarkdown(docs, routes.length);

  return {
    docs,
    totalEndpoints: routes.length,
    groups: Object.keys(grouped).length,
    markdown,
    generatedAt: new Date().toISOString(),
  };
}

function describeRoute(method: string, path: string): string {
  const last = path.split('/').filter(Boolean).pop() || '';
  const resource = path.split('/')[2] || '';
  if (method === 'GET' && !path.includes(':')) return `Listar ${resource}`;
  if (method === 'GET' && path.includes(':id')) return `Buscar ${resource} por ID`;
  if (method === 'POST') return `Criar ${last}`;
  if (method === 'PUT' || method === 'PATCH') return `Atualizar ${last}`;
  if (method === 'DELETE') return `Remover ${last}`;
  return `${method} ${path}`;
}

function generateMarkdown(docs: any[], total: number): string {
  const lines: string[] = [
    `# API VivaFrutaz ERP — Documentação`,
    ``,
    `**Total de endpoints:** ${total}`,
    `**Gerado em:** ${new Date().toLocaleString('pt-BR')}`,
    ``,
    `---`,
    ``,
  ];
  for (const group of docs) {
    lines.push(`## ${group.group}`);
    lines.push('');
    lines.push('| Método | Rota | Descrição |');
    lines.push('|--------|------|-----------|');
    for (const ep of group.endpoints) {
      lines.push(`| \`${ep.method}\` | \`${ep.path}\` | ${ep.description} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Usage Simulator ─────────────────────────────────────────────────────────
export async function simulateUsage(baseUrl: string, sessionCookie: string) {
  const steps: any[] = [];
  async function step(label: string, fn: () => Promise<any>) {
    const start = Date.now();
    try {
      const result = await fn();
      steps.push({ label, status: 'OK', elapsed: Date.now() - start, detail: result });
    } catch (e: any) {
      steps.push({ label, status: 'FAIL', elapsed: Date.now() - start, detail: e.message });
    }
  }

  const headers = { 'Cookie': sessionCookie, 'Content-Type': 'application/json' };

  await step('Verificar sessão de usuário', async () => {
    const r = await fetch(`${baseUrl}/api/auth/me`, { headers });
    return { status: r.status, ok: r.status < 300 || r.status === 401 };
  });

  await step('Carregar lista de pedidos', async () => {
    const r = await fetch(`${baseUrl}/api/orders`, { headers });
    const d = await r.json();
    return { count: Array.isArray(d) ? d.length : 0 };
  });

  await step('Carregar lista de empresas', async () => {
    const r = await fetch(`${baseUrl}/api/companies`, { headers });
    const d = await r.json();
    return { count: Array.isArray(d) ? d.length : 0 };
  });

  await step('Carregar catálogo de produtos', async () => {
    const r = await fetch(`${baseUrl}/api/products`, { headers });
    const d = await r.json();
    return { count: Array.isArray(d) ? d.length : 0 };
  });

  await step('Verificar contas a receber', async () => {
    const r = await fetch(`${baseUrl}/api/accounts-receivable`, { headers });
    const d = await r.json();
    return { count: Array.isArray(d) ? d.length : 0 };
  });

  await step('Verificar NF-e emitidas', async () => {
    const r = await fetch(`${baseUrl}/api/nfe`, { headers });
    const d = await r.json();
    return { count: Array.isArray(d) ? d.length : 0 };
  });

  await step('Verificar configurações do sistema', async () => {
    const r = await fetch(`${baseUrl}/api/company-config`, { headers });
    return { status: r.status };
  });

  await step('Status SEFAZ', async () => {
    const r = await fetch(`${baseUrl}/api/nfe/sefaz/status`, { headers });
    const d = await r.json();
    return { online: d.online, uf: d.uf };
  });

  const ok = steps.filter(s => s.status === 'OK').length;
  const fail = steps.filter(s => s.status === 'FAIL').length;
  const totalMs = steps.reduce((s, x) => s + x.elapsed, 0);

  return {
    steps,
    summary: { total: steps.length, ok, fail, totalMs, avgMs: Math.round(totalMs / steps.length) },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Auto Fix ────────────────────────────────────────────────────────────────
export function autoFix() {
  const fixes: any[] = [];
  const backupDir = path.join(process.cwd(), 'backups', 'ai-fixes');
  if (!fs.existsSync(backupDir)) {
    try { fs.mkdirSync(backupDir, { recursive: true }); } catch {}
  }

  // Check for common issues in routes.ts
  const routesPath = path.join(process.cwd(), 'server', 'routes.ts');
  if (fs.existsSync(routesPath)) {
    const content = fs.readFileSync(routesPath, 'utf-8');

    // Check for console.log vs logger
    const consoleLogs = (content.match(/console\.log\(/g) || []).length;
    if (consoleLogs > 5) {
      fixes.push({
        type: 'LOG_QUALITY',
        severity: 'LOW',
        file: 'server/routes.ts',
        description: `${consoleLogs} chamadas console.log() encontradas`,
        suggestion: 'Substituir por console.error() para erros ou remover logs de debug',
        applied: false,
      });
    }

    // Check for missing try-catch
    const routeDefs = (content.match(/app\.(get|post|put|patch|delete)\(/g) || []).length;
    const tryCatches = (content.match(/try\s*\{/g) || []).length;
    if (tryCatches < routeDefs * 0.8) {
      fixes.push({
        type: 'ERROR_HANDLING',
        severity: 'MEDIUM',
        file: 'server/routes.ts',
        description: `${routeDefs} rotas encontradas mas apenas ${tryCatches} blocos try-catch`,
        suggestion: 'Adicionar tratamento de erros em todas as rotas para evitar crashes',
        applied: false,
      });
    }
  }

  // Check for hardcoded secrets
  const filesToCheck = [
    'server/routes.ts', 'server/index.ts', 'server/storage.ts',
  ];
  for (const file of filesToCheck) {
    const fp = path.join(process.cwd(), file);
    if (!fs.existsSync(fp)) continue;
    const c = fs.readFileSync(fp, 'utf-8');
    if (/password\s*[:=]\s*["'][^"']{6,}["']/.test(c) || /secret\s*[:=]\s*["'][^"']{6,}["']/.test(c)) {
      fixes.push({
        type: 'HARDCODED_SECRET',
        severity: 'HIGH',
        file,
        description: 'Possível credencial hardcoded detectada',
        suggestion: 'Mover para variáveis de ambiente (.env)',
        applied: false,
      });
    }
  }

  // Check for large files
  const checkLarge = ['server/routes.ts', 'server/storage.ts', 'server/index.ts'];
  for (const file of checkLarge) {
    const fp = path.join(process.cwd(), file);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf-8').split('\n').length;
    if (lines > 3000) {
      fixes.push({
        type: 'FILE_SIZE',
        severity: 'MEDIUM',
        file,
        description: `Arquivo muito grande: ${lines.toLocaleString()} linhas`,
        suggestion: 'Dividir em módulos menores para melhor manutenibilidade',
        applied: false,
      });
    }
  }

  // Check node_modules for known vulnerable patterns
  fixes.push({
    type: 'DEPENDENCY_CHECK',
    severity: 'LOW',
    file: 'package.json',
    description: 'Verifique regularmente dependências com npm audit',
    suggestion: 'Execute: npm audit fix',
    applied: false,
  });

  // Write AI dev log
  const logPath = path.join(process.cwd(), 'logs', 'ai-dev.log');
  try {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] AUTO-FIX: ${fixes.length} issues encontrados\n` +
      fixes.map(f => `  [${f.severity}] ${f.type}: ${f.description}`).join('\n') + '\n';
    fs.appendFileSync(logPath, entry);
  } catch {}

  return {
    fixes,
    summary: {
      total: fixes.length,
      critical: fixes.filter(f => f.severity === 'CRITICAL').length,
      high: fixes.filter(f => f.severity === 'HIGH').length,
      medium: fixes.filter(f => f.severity === 'MEDIUM').length,
      low: fixes.filter(f => f.severity === 'LOW').length,
    },
    backupDir,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Module Creator ───────────────────────────────────────────────────────────
export function createModule(moduleName: string) {
  const name = moduleName.toLowerCase().replace(/\s+/g, '-');
  const NamePascal = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const nameCamel = NamePascal.charAt(0).toLowerCase() + NamePascal.slice(1);

  const files = [
    {
      path: `server/routes/${name}.routes.ts`,
      description: 'Rotas Express do módulo',
      content: `import { Express } from 'express';
import { storage } from '../storage';

export function register${NamePascal}Routes(app: Express) {
  // GET /api/${name}
  app.get('/api/${name}', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      // TODO: Implement
      res.json([]);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/${name}
  app.post('/api/${name}', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      // TODO: Implement
      res.status(201).json({});
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PUT /api/${name}/:id
  app.put('/api/${name}/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      // TODO: Implement
      res.json({});
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/${name}/:id
  app.delete('/api/${name}/:id', async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: 'Não autenticado' });
    try {
      // TODO: Implement
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
`,
    },
    {
      path: `shared/schema/${name}.schema.ts`,
      description: 'Schema Drizzle + tipos',
      content: `import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

export const ${nameCamel} = pgTable('${name.replace(/-/g, '_')}', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const insert${NamePascal}Schema = createInsertSchema(${nameCamel}).omit({ id: true, createdAt: true, updatedAt: true });
export type Insert${NamePascal} = z.infer<typeof insert${NamePascal}Schema>;
export type ${NamePascal} = typeof ${nameCamel}.$inferSelect;
`,
    },
    {
      path: `client/src/pages/admin/${name}.tsx`,
      description: 'Página frontend React',
      content: `import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Plus } from 'lucide-react';

export default function ${NamePascal}Page() {
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/${name}'],
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">${NamePascal}</h1>
        <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Novo ${NamePascal}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Nenhum item encontrado</p>
          ) : (
            <div className="divide-y">
              {items.map((item: any) => (
                <div key={item.id} className="py-3 px-2 flex items-center gap-3">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-sm text-gray-500">{item.description}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
`,
    },
  ];

  // Write AI log
  try {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'ai-dev.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] CREATE-MODULE: Módulo "${name}" gerado com ${files.length} arquivos\n`);
  } catch {}

  return {
    moduleName: name,
    pascalName: NamePascal,
    files,
    instructions: [
      `1. Revise os arquivos gerados abaixo`,
      `2. Copie o conteúdo de cada arquivo para o caminho indicado`,
      `3. Importe as rotas em server/routes.ts: register${NamePascal}Routes(app)`,
      `4. Adicione o link no sidebar em client/src/components/Layout.tsx`,
      `5. Execute npm run db:push para criar as tabelas`,
    ],
    generatedAt: new Date().toISOString(),
  };
}
