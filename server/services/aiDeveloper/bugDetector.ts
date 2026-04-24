import * as fs from 'fs';
import * as path from 'path';

export interface BugReport {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  file?: string;
  line?: number;
  suggestion: string;
  raw?: string;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp?: string;
  file?: string;
}

function parseLogLine(line: string): LogEntry | null {
  const errorPatterns = [
    /\[ERROR\]|error:|Error:|FATAL|TypeError|ReferenceError|SyntaxError/i,
    /500|unhandled|uncaught|ECONNREFUSED|ETIMEDOUT/i,
  ];
  if (errorPatterns.some(p => p.test(line))) {
    return { level: 'ERROR', message: line.trim() };
  }
  if (/warn|WARN/i.test(line)) return { level: 'WARN', message: line.trim() };
  return null;
}

function readLogFiles(): LogEntry[] {
  const logs: LogEntry[] = [];
  const logDir = '/tmp/logs';
  if (!fs.existsSync(logDir)) return logs;
  try {
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).slice(-5);
    for (const file of files) {
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
      for (const line of content.split('\n').slice(-500)) {
        const entry = parseLogLine(line);
        if (entry) logs.push(entry);
      }
    }
  } catch {}
  return logs;
}

function scanCodeForPatterns(serverDir: string): BugReport[] {
  const bugs: BugReport[] = [];
  if (!fs.existsSync(serverDir)) return bugs;

  function scanFile(filePath: string) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        const lineNum = idx + 1;

        // Check for missing error handling in async functions
        if (/async.*=>.+\{$/.test(line) && !lines.slice(idx, idx + 10).some(l => /try\s*\{|catch/.test(l))) {
          if (!filePath.includes('test')) {
            bugs.push({
              severity: 'MEDIUM',
              category: 'Tratamento de Erros',
              description: `Função async sem try/catch em ${path.basename(filePath)}:${lineNum}`,
              file: filePath,
              line: lineNum,
              suggestion: 'Adicione try/catch para capturar erros assíncronos e retornar resposta 500 ao cliente.',
              raw: line.trim(),
            });
          }
        }

        // Check for console.log left in production code
        if (/console\.log\(/.test(line) && !filePath.includes('test') && !filePath.includes('seed')) {
          bugs.push({
            severity: 'LOW',
            category: 'Qualidade de Código',
            description: `console.log() encontrado em ${path.basename(filePath)}:${lineNum}`,
            file: filePath,
            line: lineNum,
            suggestion: 'Substitua console.log por um logger estruturado ou remova em produção.',
            raw: line.trim(),
          });
        }

        // Check for hardcoded secrets
        if (/(password|secret|key|token)\s*=\s*['"][^'"]{6,}['"]/i.test(line) &&
            !line.includes('process.env') && !line.includes('req.') && !line.includes('//') &&
            !filePath.includes('schema')) {
          bugs.push({
            severity: 'CRITICAL',
            category: 'Segurança',
            description: `Possível credencial hardcoded em ${path.basename(filePath)}:${lineNum}`,
            file: filePath,
            line: lineNum,
            suggestion: 'Mova para variáveis de ambiente (.env). NUNCA versione credenciais.',
            raw: line.trim().replace(/(['"])([^'"]{3})[^'"]+(['"])/g, '$1$2...***$3'),
          });
        }

        // Check for SQL injection risk (string concatenation in queries)
        if (/sql`.*\$\{.*req\.(body|params|query)/.test(line)) {
          bugs.push({
            severity: 'HIGH',
            category: 'Segurança SQL',
            description: `Possível SQL injection via interpolação direta em ${path.basename(filePath)}:${lineNum}`,
            file: filePath,
            line: lineNum,
            suggestion: 'Use parâmetros preparados do Drizzle ORM em vez de interpolação direta de strings.',
            raw: line.trim(),
          });
        }

        // Missing auth check on sensitive routes
        if (/app\.(post|put|patch|delete)\s*\(['"`]\/api\/admin/.test(line)) {
          const nextLines = lines.slice(idx, idx + 5).join(' ');
          if (!nextLines.includes('session') && !nextLines.includes('auth') && !nextLines.includes('userId')) {
            bugs.push({
              severity: 'HIGH',
              category: 'Autenticação',
              description: `Rota admin sem verificação de sessão em ${path.basename(filePath)}:${lineNum}`,
              file: filePath,
              line: lineNum,
              suggestion: 'Adicione verificação de req.session.userId antes de processar a requisição.',
              raw: line.trim(),
            });
          }
        }
      });
    } catch {}
  }

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (['node_modules', 'dist', '.git'].includes(entry)) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walkDir(full);
      else if (full.endsWith('.ts') || full.endsWith('.js')) scanFile(full);
    }
  }

  walkDir(serverDir);
  return bugs;
}

export async function detectBugs(): Promise<{
  logErrors: BugReport[];
  codeIssues: BugReport[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
}> {
  const logEntries = readLogFiles();
  const logErrors: BugReport[] = [];

  // Aggregate log errors
  const errorCounts: Record<string, number> = {};
  for (const entry of logEntries) {
    const key = entry.message.slice(0, 80);
    errorCounts[key] = (errorCounts[key] || 0) + 1;
  }

  for (const [msg, count] of Object.entries(errorCounts).slice(0, 20)) {
    const isErrorBoundary = msg.includes('ErrorBoundary');
    const isFatal = msg.includes('FATAL') || msg.includes('500') || msg.includes('TypeError');
    logErrors.push({
      severity: isFatal ? 'HIGH' : isErrorBoundary ? 'MEDIUM' : 'LOW',
      category: 'Log de Erros',
      description: `"${msg.slice(0, 100)}..."`,
      suggestion: isFatal ? 'Verifique o stack trace completo e corrija a raiz do erro.' : 'Monitore a frequência e verifique se impacta usuários.',
      raw: count > 1 ? `Ocorreu ${count}x nos logs recentes` : undefined,
    });
  }

  const codeIssues = scanCodeForPatterns('server');

  // Deduplicate code issues (only show max 5 per category)
  const categoryCount: Record<string, number> = {};
  const deduped = codeIssues.filter(b => {
    categoryCount[b.category] = (categoryCount[b.category] || 0) + 1;
    return categoryCount[b.category] <= 5;
  });

  const all = [...logErrors, ...deduped];
  const summary = {
    total: all.length,
    critical: all.filter(b => b.severity === 'CRITICAL').length,
    high: all.filter(b => b.severity === 'HIGH').length,
    medium: all.filter(b => b.severity === 'MEDIUM').length,
    low: all.filter(b => b.severity === 'LOW').length,
  };

  return { logErrors, codeIssues: deduped, summary };
}
