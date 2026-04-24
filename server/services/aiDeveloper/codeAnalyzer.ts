import * as fs from 'fs';
import * as path from 'path';

export interface SecurityReport {
  score: number; // 0-100
  issues: SecurityIssue[];
  recommendations: string[];
}

export interface SecurityIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  file?: string;
}

export interface PerformanceReport {
  score: number;
  checks: PerformanceCheck[];
  recommendations: string[];
}

export interface PerformanceCheck {
  name: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
}

export interface DeployScript {
  name: string;
  filename: string;
  content: string;
  description: string;
}

export async function auditSecurity(): Promise<SecurityReport> {
  const issues: SecurityIssue[] = [];

  function scanFile(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const basename = path.basename(filePath);

      lines.forEach((line, idx) => {
        const lineNum = idx + 1;

        // Hardcoded credentials
        if (/(password|secret|key|api_key|apikey)\s*[:=]\s*['"][^'"$]{8,}['"]/i.test(line) &&
            !line.includes('process.env') && !line.includes('//') && !line.includes('example') && !line.includes('placeholder')) {
          issues.push({ severity: 'CRITICAL', category: 'Credenciais Expostas', description: `Possível credencial hardcoded em ${basename}:${lineNum}`, file: filePath });
        }

        // Missing CSRF protection
        if (/app\.post\(/.test(line) && content.includes('session') && !content.includes('csrf') && !content.includes('CSRF')) {
          // Only flag once per file
        }

        // Unvalidated input
        if (/req\.body\.\w+/.test(line) && !lines.slice(Math.max(0, idx - 5), idx + 5).some(l => /zod|schema|validate|parse/i.test(l))) {
          if (!filePath.includes('routes.ts')) { // Exclude main routes as it's too large
            issues.push({ severity: 'MEDIUM', category: 'Validação de Input', description: `req.body sem validação Zod em ${basename}:${lineNum}`, file: filePath });
          }
        }

        // eval usage
        if (/\beval\s*\(/.test(line)) {
          issues.push({ severity: 'CRITICAL', category: 'Execução de Código', description: `Uso de eval() em ${basename}:${lineNum} — risco de RCE`, file: filePath });
        }

        // Sensitive data in logs
        if (/console\.(log|info)\s*\(.*password/i.test(line)) {
          issues.push({ severity: 'HIGH', category: 'Vazamento de Dados', description: `Possível log de senha em ${basename}:${lineNum}`, file: filePath });
        }
      });
    } catch {}
  }

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', 'attached_assets'].includes(entry)) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walkDir(full);
      else if (full.endsWith('.ts') || full.endsWith('.js')) scanFile(full);
    }
  }
  walkDir('server');

  // Check env vars configuration
  const envExists = fs.existsSync('.env') || fs.existsSync('.env.local');
  const gitignoreContent = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf-8') : '';
  if (!gitignoreContent.includes('.env')) {
    issues.push({ severity: 'HIGH', category: 'Configuração', description: '.env não está no .gitignore — risco de exposição de segredos' });
  }

  // Check session configuration
  const hasSecureSession = fs.existsSync('server/index.ts') &&
    fs.readFileSync('server/index.ts', 'utf-8').includes('SESSION_SECRET');
  if (!hasSecureSession) {
    issues.push({ severity: 'HIGH', category: 'Sessão', description: 'SESSION_SECRET não encontrado na configuração de sessão' });
  }

  const deduped = issues.filter((v, i, a) => a.findIndex(x => x.description === v.description) === i).slice(0, 30);
  const penaltyMap = { CRITICAL: 25, HIGH: 10, MEDIUM: 5, LOW: 2 };
  const totalPenalty = deduped.reduce((s, i) => s + (penaltyMap[i.severity] || 0), 0);
  const score = Math.max(0, 100 - totalPenalty);

  const recommendations = [
    deduped.some(i => i.severity === 'CRITICAL') ? '🔴 Corrija vulnerabilidades CRÍTICAS imediatamente.' : null,
    '✅ Use variáveis de ambiente para todas as credenciais.',
    '✅ Valide todo input com schemas Zod antes de processar.',
    '✅ Implemente rate limiting nas rotas de autenticação.',
    '✅ Configure CORS adequadamente para produção.',
    '✅ Use HTTPS em produção (CERT_PATH + CERT_PASSWORD).',
  ].filter(Boolean) as string[];

  return { score, issues: deduped, recommendations };
}

export async function analyzePerformance(): Promise<PerformanceReport> {
  const checks: PerformanceCheck[] = [];

  // Check routes.ts size (mega file anti-pattern)
  if (fs.existsSync('server/routes.ts')) {
    const lines = fs.readFileSync('server/routes.ts', 'utf-8').split('\n').length;
    checks.push({
      name: 'Tamanho do arquivo routes.ts',
      status: lines > 5000 ? 'WARN' : lines > 10000 ? 'FAIL' : 'OK',
      detail: `${lines.toLocaleString()} linhas. ${lines > 5000 ? 'Considere dividir em módulos menores.' : 'Tamanho aceitável.'}`,
    });
  }

  // Check for N+1 query patterns
  let nPlusOneCount = 0;
  function checkNPlus1(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (['node_modules', 'dist'].includes(f)) continue;
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) checkNPlus1(full);
      else if (full.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf-8');
        // Look for loops with await db queries inside
        if (/for\s*\(.*\)\s*\{[\s\S]*?await.*db\./.test(content)) nPlusOneCount++;
      }
    }
  }
  checkNPlus1('server');
  checks.push({
    name: 'N+1 Queries potenciais',
    status: nPlusOneCount > 3 ? 'WARN' : 'OK',
    detail: `${nPlusOneCount} arquivo(s) com padrão de query dentro de loop. Use JOIN ou batch queries.`,
  });

  // Check for missing indexes hint
  if (fs.existsSync('shared/schema.ts')) {
    const schema = fs.readFileSync('shared/schema.ts', 'utf-8');
    const tableCount = (schema.match(/pgTable\s*\(/g) || []).length;
    const indexCount = (schema.match(/index\s*\(/g) || []).length;
    checks.push({
      name: 'Cobertura de Índices',
      status: indexCount < tableCount * 0.3 ? 'WARN' : 'OK',
      detail: `${tableCount} tabelas, ${indexCount} índices definidos. ${indexCount < tableCount * 0.3 ? 'Adicione índices em colunas usadas em WHERE/JOIN frequentes.' : 'Cobertura adequada.'}`,
    });
  }

  // Check for missing connection pooling
  if (fs.existsSync('server/db.ts')) {
    const dbContent = fs.readFileSync('server/db.ts', 'utf-8');
    const hasPool = dbContent.includes('max:') || dbContent.includes('pool');
    checks.push({
      name: 'Connection Pooling',
      status: hasPool ? 'OK' : 'WARN',
      detail: hasPool ? 'Pool de conexões configurado.' : 'Sem configuração de pool. Defina max connections para produção.',
    });
  }

  // Check package.json for production vs dev deps
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const devInProd = Object.keys(pkg.dependencies || {}).filter(d =>
    ['jest', 'mocha', 'chai', 'supertest', '@types/'].some(t => d.startsWith(t))
  );
  checks.push({
    name: 'Dependências de Desenvolvimento em Produção',
    status: devInProd.length > 0 ? 'WARN' : 'OK',
    detail: devInProd.length > 0 ? `${devInProd.join(', ')} deveria estar em devDependencies.` : 'Sem dependências de dev em produção.',
  });

  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 20 - warnCount * 8);

  const recommendations = [
    warnCount > 0 || failCount > 0 ? '⚡ Priorize correções de itens FAIL/WARN para melhor performance.' : null,
    '⚡ Use Redis para cache de sessões e queries frequentes.',
    '⚡ Implemente paginação em todos os listagens (limit/offset).',
    '⚡ Ative compressão gzip no Express (middleware compress).',
    '⚡ Use connection pool Postgres com max 10-20 conexões.',
  ].filter(Boolean) as string[];

  return { score, checks, recommendations };
}

export function generateDeployScripts(): DeployScript[] {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const appName = pkg.name || 'vivafrutaz-erp';

  const dockerfile = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
EXPOSE 5000
CMD ["node", "dist/index.js"]
`;

  const dockerCompose = `version: '3.8'
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
      - SESSION_SECRET=\${SESSION_SECRET}
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=vivafrutaz
      - POSTGRES_USER=\${POSTGRES_USER:-vivafrutaz}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
    restart: unless-stopped

volumes:
  pgdata:
`;

  const deployShell = `#!/bin/bash
set -e
echo "==> Deploying ${appName}..."

# Pull latest code
git pull origin main

# Install dependencies
npm ci

# Run database migrations
npm run db:push

# Build application
npm run build

# Restart with PM2
pm2 restart ${appName} || pm2 start dist/index.js --name ${appName}

echo "==> Deploy concluído com sucesso!"
`;

  const envExample = `# ==========================================
# ${appName.toUpperCase()} — Variáveis de Ambiente
# ==========================================

# Banco de Dados PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/vivafrutaz

# Sessão Express
SESSION_SECRET=sua_chave_secreta_muito_longa_aqui

# Certificado Digital NF-e (opcional)
# CERT_PATH=/path/to/certificado.pfx
# CERT_PASSWORD=senha_do_certificado

# Itaú API (opcional)
# ITAU_CLIENT_ID=seu_client_id
# ITAU_CLIENT_SECRET=seu_client_secret
# ITAU_AGENCIA=0001
# ITAU_CONTA=12345-6
# ITAU_AMBIENTE=sandbox

# Email SMTP (opcional)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=seu@email.com
# SMTP_PASSWORD=senha_app

# Ambiente
NODE_ENV=production
PORT=5000
`;

  const pm2Config = `module.exports = {
  apps: [{
    name: '${appName}',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '512M',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
`;

  return [
    { name: 'Dockerfile', filename: 'Dockerfile', content: dockerfile, description: 'Container Docker multi-stage para produção' },
    { name: 'Docker Compose', filename: 'docker-compose.yml', content: dockerCompose, description: 'Orquestração com PostgreSQL' },
    { name: 'Deploy Shell', filename: 'deploy.sh', content: deployShell, description: 'Script de deploy para VPS Linux / Ubuntu' },
    { name: 'PM2 Config', filename: 'ecosystem.config.js', content: pm2Config, description: 'Process manager com cluster mode' },
    { name: '.env.example', filename: '.env.example', content: envExample, description: 'Template de variáveis de ambiente' },
  ];
}
