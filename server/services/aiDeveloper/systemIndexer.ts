import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  path: string;
  size: number;
  lines: number;
  exports: string[];
  imports: string[];
}

export interface SystemIndex {
  generatedAt: string;
  totalFiles: number;
  totalLines: number;
  totalSizeKB: number;
  files: FileInfo[];
  endpoints: EndpointInfo[];
  tables: string[];
  dependencies: Record<string, string>;
  summary: {
    backendFiles: number;
    frontendFiles: number;
    sharedFiles: number;
    serviceFiles: number;
    schemaFiles: number;
  };
}

export interface EndpointInfo {
  method: string;
  path: string;
  file: string;
  line: number;
  hasAuth: boolean;
}

const SCAN_DIRS = ['server', 'shared', 'client/src'];
const EXTENSIONS = ['.ts', '.tsx', '.js'];
const IGNORE_DIRS = ['node_modules', 'dist', '.git', '.local', 'attached_assets'];

function readFileLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return [];
  }
}

function extractExports(lines: string[]): string[] {
  const exports: string[] = [];
  for (const line of lines) {
    const m = line.match(/^export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/);
    if (m) exports.push(m[1]);
  }
  return exports;
}

function extractImports(lines: string[]): string[] {
  const imports: string[] = [];
  for (const line of lines) {
    const m = line.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
    if (m) imports.push(m[1]);
  }
  return [...new Set(imports)];
}

function scanDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (IGNORE_DIRS.includes(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scanDir(full, results);
      } else if (EXTENSIONS.includes(path.extname(full))) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

function extractEndpoints(filePath: string, lines: string[]): EndpointInfo[] {
  const eps: EndpointInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/app\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/i);
    if (m) {
      const prevLines = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
      const hasAuth = prevLines.includes('session') || prevLines.includes('auth') || prevLines.includes('userId');
      eps.push({ method: m[1].toUpperCase(), path: m[2], file: filePath, line: i + 1, hasAuth });
    }
  }
  return eps;
}

function extractTables(lines: string[]): string[] {
  const tables: string[] = [];
  for (const line of lines) {
    const m = line.match(/pgTable\s*\(\s*['"](\w+)['"]/);
    if (m) tables.push(m[1]);
  }
  return tables;
}

function getDependencies(): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

export async function buildSystemIndex(): Promise<SystemIndex> {
  const allFiles: string[] = [];
  for (const dir of SCAN_DIRS) {
    scanDir(dir, allFiles);
  }

  let totalLines = 0;
  let totalSize = 0;
  const fileInfos: FileInfo[] = [];
  const allEndpoints: EndpointInfo[] = [];
  const allTables: string[] = [];

  for (const filePath of allFiles) {
    try {
      const stat = fs.statSync(filePath);
      const lines = readFileLines(filePath);
      totalLines += lines.length;
      totalSize += stat.size;

      const info: FileInfo = {
        path: filePath,
        size: stat.size,
        lines: lines.length,
        exports: extractExports(lines),
        imports: extractImports(lines),
      };
      fileInfos.push(info);

      if (filePath.includes('routes')) {
        allEndpoints.push(...extractEndpoints(filePath, lines));
      }
      if (filePath.includes('schema')) {
        allTables.push(...extractTables(lines));
      }
    } catch {}
  }

  const backendFiles = fileInfos.filter(f => f.path.startsWith('server/')).length;
  const frontendFiles = fileInfos.filter(f => f.path.startsWith('client/')).length;
  const sharedFiles = fileInfos.filter(f => f.path.startsWith('shared/')).length;
  const serviceFiles = fileInfos.filter(f => f.path.includes('/services/')).length;
  const schemaFiles = fileInfos.filter(f => f.path.includes('schema')).length;

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: fileInfos.length,
    totalLines,
    totalSizeKB: Math.round(totalSize / 1024),
    files: fileInfos,
    endpoints: allEndpoints,
    tables: [...new Set(allTables)],
    dependencies: getDependencies(),
    summary: { backendFiles, frontendFiles, sharedFiles, serviceFiles, schemaFiles },
  };
}
