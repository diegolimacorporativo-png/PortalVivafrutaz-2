import cron from "node-cron";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { db } from "./database/db";
import { logSecurity } from "./core/security/securityLogger";
import { registerJob, startJobRun, finishJobRun } from "./core/jobs/job-registry";
import { incJobFailures } from "./core/observability/metrics";

const BACKUP_JOB = "backup-daily";
registerJob(BACKUP_JOB);
import {
  users, companies, priceGroups, categories, products, productPrices,
  orderWindows, orderExceptions, orders, orderItems, systemSettings,
  specialOrderRequests, tasks, clientIncidents, internalIncidents,
  logisticsDrivers, logisticsVehicles, logisticsRoutes, logisticsMaintenance,
  companyQuotations,
} from "@shared/schema";

const BACKUP_DIR = path.join(process.cwd(), "backups");
const MAX_BACKUPS = 30;

export function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ─── H1-FIX: Sensitive field scrubber ─────────────────────────
// Strips password hashes (and other secrets) from backup rows before they are
// written to disk. The scrubbed field is replaced with a sentinel string so the
// row shape is preserved and the backup file remains structurally valid, but no
// credential can be extracted from the file even if it leaks.
const SCRUBBED_FIELDS = new Set(["password"]);
function scrubRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(row => {
    const clean = { ...row } as Record<string, unknown>;
    for (const field of SCRUBBED_FIELDS) {
      if (field in clean) {
        clean[field] = "[REDACTED]";
      }
    }
    return clean as T;
  });
}

// ─── SQL value serializer ──────────────────────────────────────
function toSqlValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function tableToInserts(tableName: string, rows: any[]): string {
  if (!rows.length) return `-- ${tableName}: sem registros\n\n`;
  const cols = Object.keys(rows[0]);
  const header = `-- Tabela: ${tableName} (${rows.length} registro(s))\n`;
  const inserts = rows
    .map(row => {
      const values = cols.map(c => toSqlValue(row[c])).join(", ");
      return `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${values}) ON CONFLICT DO NOTHING;`;
    })
    .join("\n");
  return header + inserts + "\n\n";
}

async function fetchAllData() {
  const [
    usersData, companiesData, priceGroupsData, categoriesData,
    productsData, productPricesData, orderWindowsData, orderExceptionsData,
    ordersData, orderItemsData, settingsData, specialOrdersData,
    tasksData, clientIncidentsData, internalIncidentsData,
    driversData, vehiclesData, routesData, maintenancesData, quotationsData,
  ] = await Promise.all([
    db.select().from(users),
    db.select().from(companies),
    db.select().from(priceGroups),
    db.select().from(categories),
    db.select().from(products),
    db.select().from(productPrices),
    db.select().from(orderWindows),
    db.select().from(orderExceptions),
    db.select().from(orders),
    db.select().from(orderItems),
    db.select().from(systemSettings),
    db.select().from(specialOrderRequests),
    db.select().from(tasks),
    db.select().from(clientIncidents),
    db.select().from(internalIncidents),
    db.select().from(logisticsDrivers),
    db.select().from(logisticsVehicles),
    db.select().from(logisticsRoutes),
    db.select().from(logisticsMaintenance),
    db.select().from(companyQuotations),
  ]);
  return {
    usersData, companiesData, priceGroupsData, categoriesData,
    productsData, productPricesData, orderWindowsData, orderExceptionsData,
    ordersData, orderItemsData, settingsData, specialOrdersData,
    tasksData, clientIncidentsData, internalIncidentsData,
    driversData, vehiclesData, routesData, maintenancesData, quotationsData,
  };
}

// ─── JSON Backup ───────────────────────────────────────────────
export async function runBackup(): Promise<string> {
  ensureBackupDir();
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "_");
  const timeStr = date.toISOString().replace(/[:.]/g, "-").slice(11, 19);
  const filename = `backup_vivafrutaz_${dateStr}_${timeStr}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  const data = await fetchAllData();

  const backup = {
    version: "2.0",
    format: "json",
    generatedAt: date.toISOString(),
    generatedBy: "VivaFrutaz Backup System",
    tables: {
      users: scrubRows(data.usersData),
      companies: scrubRows(data.companiesData),
      priceGroups: data.priceGroupsData,
      categories: data.categoriesData,
      products: data.productsData,
      productPrices: data.productPricesData,
      orderWindows: data.orderWindowsData,
      orderExceptions: data.orderExceptionsData,
      orders: data.ordersData,
      orderItems: data.orderItemsData,
      systemSettings: data.settingsData,
      specialOrderRequests: data.specialOrdersData,
      tasks: data.tasksData,
      clientIncidents: data.clientIncidentsData,
      internalIncidents: data.internalIncidentsData,
      logisticsDrivers: data.driversData,
      logisticsVehicles: data.vehiclesData,
      logisticsRoutes: data.routesData,
      logisticsMaintenance: data.maintenancesData,
      companyQuotations: data.quotationsData,
    },
    counts: {
      users: data.usersData.length,
      companies: data.companiesData.length,
      orders: data.ordersData.length,
      products: data.productsData.length,
      tasks: data.tasksData.length,
      incidents: data.clientIncidentsData.length,
    },
  };

  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), "utf-8");
  const sizeMb = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);
  rotateBackups();
  return filename;
}

// ─── SQL Backup ────────────────────────────────────────────────
export async function runBackupSQL(): Promise<string> {
  ensureBackupDir();
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "_");
  const timeStr = date.toISOString().replace(/[:.]/g, "-").slice(11, 19);
  const filename = `backup_vivafrutaz_${dateStr}_${timeStr}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const data = await fetchAllData();

  const sqlContent = [
    `-- VivaFrutaz Database Backup`,
    `-- Gerado em: ${date.toISOString()}`,
    `-- Sistema: VivaFrutaz B2B Ordering Platform`,
    `-- Formato: SQL INSERT statements`,
    `-- Tabelas incluídas: users, companies, price_groups, categories, products, product_prices,`,
    `--   order_windows, order_exceptions, orders, order_items, system_settings,`,
    `--   special_order_requests, tasks, client_incidents, internal_incidents,`,
    `--   logistics_drivers, logistics_vehicles, logistics_routes, logistics_maintenance, company_quotations`,
    ``,
    `BEGIN;`,
    ``,
    tableToInserts("users", scrubRows(data.usersData)),
    tableToInserts("companies", scrubRows(data.companiesData)),
    tableToInserts("price_groups", data.priceGroupsData),
    tableToInserts("categories", data.categoriesData),
    tableToInserts("products", data.productsData),
    tableToInserts("product_prices", data.productPricesData),
    tableToInserts("order_windows", data.orderWindowsData),
    tableToInserts("order_exceptions", data.orderExceptionsData),
    tableToInserts("orders", data.ordersData),
    tableToInserts("order_items", data.orderItemsData),
    tableToInserts("system_settings", data.settingsData),
    tableToInserts("special_order_requests", data.specialOrdersData),
    tableToInserts("tasks", data.tasksData),
    tableToInserts("client_incidents", data.clientIncidentsData),
    tableToInserts("internal_incidents", data.internalIncidentsData),
    tableToInserts("logistics_drivers", data.driversData),
    tableToInserts("logistics_vehicles", data.vehiclesData),
    tableToInserts("logistics_routes", data.routesData),
    tableToInserts("logistics_maintenance", data.maintenancesData),
    tableToInserts("company_quotations", data.quotationsData),
    `COMMIT;`,
    ``,
    `-- Fim do backup VivaFrutaz`,
  ].join("\n");

  fs.writeFileSync(filepath, sqlContent, "utf-8");
  const sizeMb = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);
  rotateBackups();
  return filename;
}

// ─── Rotate to keep MAX_BACKUPS ────────────────────────────────
function rotateBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup_") && (f.endsWith(".json") || f.endsWith(".sql")))
    .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > MAX_BACKUPS) {
    files.slice(MAX_BACKUPS).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    });
  }
}

// ─── List Backups ──────────────────────────────────────────────
export function listBackups(): { filename: string; size: number; createdAt: string; format: string }[] {
  ensureBackupDir();
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup_") && (f.endsWith(".json") || f.endsWith(".sql")))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      const format = f.endsWith(".sql") ? "sql" : "json";
      return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString(), format };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return files;
}

// ─── Get Backup Path ───────────────────────────────────────────
export function getBackupPath(filename: string): string | null {
  const safe = path.basename(filename);
  if (!safe.startsWith("backup_")) return null;
  if (!safe.endsWith(".json") && !safe.endsWith(".sql")) return null;
  const filepath = path.join(BACKUP_DIR, safe);
  return fs.existsSync(filepath) ? filepath : null;
}

// ─── Delete Backup ─────────────────────────────────────────────
export function deleteBackup(filename: string): boolean {
  const safe = path.basename(filename);
  if (!safe.startsWith("backup_")) return false;
  if (!safe.endsWith(".json") && !safe.endsWith(".sql")) return false;
  const filepath = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

// ─── Clean Old Backups ─────────────────────────────────────────
export function cleanOldBackups(olderThanDays = 30): number {
  ensureBackupDir();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("backup_") && (f.endsWith(".json") || f.endsWith(".sql")));
  let removed = 0;
  for (const f of files) {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      removed++;
    }
  }
  return removed;
}

// ─── Send Backup Email ─────────────────────────────────────────
export async function sendBackupEmail(filename: string): Promise<boolean> {
  try {
    const mailer = await import("./services/mailer");
    if (!mailer.isMailerConfigured()) {
      console.log("[BACKUP] Email de backup não enviado: SMTP não configurado.");
      return false;
    }
    const filepath = getBackupPath(filename);
    if (!filepath) return false;

    const toEmail = process.env.SMTP_USER || "";
    if (!toEmail) return false;

    const date = new Date();
    const dateStr = date.toLocaleString("pt-BR");
    const sizeMb = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);
    const format = filename.endsWith(".sql") ? "SQL" : "JSON";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <div style="color:#16a34a;font-size:22px;font-weight:bold;margin-bottom:24px">🍎 VivaFrutaz</div>
        <h2 style="margin:0 0 12px;font-size:20px">Backup Automático Gerado</h2>
        <p style="color:#374151;line-height:1.6">O backup automático diário foi gerado com sucesso e está anexado a este e-mail.</p>
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;font-size:14px"><strong>Arquivo:</strong> ${filename}</p>
          <p style="margin:4px 0 0;font-size:14px"><strong>Formato:</strong> ${format}</p>
          <p style="margin:4px 0 0;font-size:14px"><strong>Tamanho:</strong> ${sizeMb} MB</p>
          <p style="margin:4px 0 0;font-size:14px"><strong>Data/Hora:</strong> ${dateStr}</p>
        </div>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;text-align:center">VivaFrutaz • Sistema B2B de Pedidos de Frutas</p>
      </div>
    `;

    const result = await mailer.sendMailWithAttachment(
      toEmail,
      `Backup automático VivaFrutaz — ${date.toLocaleDateString("pt-BR")}`,
      html,
      {
        filename,
        filepath,
        contentType: filename.endsWith(".sql") ? "application/sql" : "application/json",
      }
    );
    if (result.sent) {
      console.log(`[BACKUP] Email de backup enviado para ${toEmail}`);
    } else {
      console.log(`[BACKUP] Falha ao enviar email: ${result.reason}`);
    }
    return result.sent;
  } catch (e: any) {
    logSecurity(`[BACKUP_FAILED] step=send_email | filename=${filename} | error=${e?.message ?? "unknown"}`);
    console.error("[BACKUP] Erro ao enviar email de backup:", e);
    return false;
  }
}

// ─── Backup Stats ──────────────────────────────────────────────
export interface BackupStats {
  totalBackups: number;
  jsonCount: number;
  sqlCount: number;
  totalSizeBytes: number;
  lastBackup: { filename: string; size: number; createdAt: string; format: string } | null;
  oldestBackup: { filename: string; createdAt: string } | null;
}

export function getBackupStats(): BackupStats {
  ensureBackupDir();
  const files = listBackups();
  const jsonFiles = files.filter(f => f.format === "json");
  const sqlFiles = files.filter(f => f.format === "sql");
  const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
  const sorted = [...files].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const oldest = [...files].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  return {
    totalBackups: files.length,
    jsonCount: jsonFiles.length,
    sqlCount: sqlFiles.length,
    totalSizeBytes,
    lastBackup: sorted[0] ?? null,
    oldestBackup: oldest[0] ? { filename: oldest[0].filename, createdAt: oldest[0].createdAt } : null,
  };
}

// ─── Validate Backup ───────────────────────────────────────────
export interface BackupValidationResult {
  valid: boolean;
  format: "json" | "sql" | "unknown";
  filename: string;
  sizeBytes: number;
  generatedAt: string | null;
  tableCounts: Record<string, number>;
  totalRecords: number;
  issues: string[];
  warnings: string[];
  summary: string;
}

const CRITICAL_TABLES_JSON = ["users", "companies", "orders", "products"];
const CRITICAL_TABLES_SQL = ["users", "companies", "orders", "order_items"];

export function validateBackup(filename: string): BackupValidationResult {
  const filepath = getBackupPath(filename);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!filepath) {
    return {
      valid: false, format: "unknown", filename, sizeBytes: 0,
      generatedAt: null, tableCounts: {}, totalRecords: 0,
      issues: ["Arquivo não encontrado ou nome inválido."],
      warnings: [],
      summary: "FALHOU — arquivo não encontrado",
    };
  }

  const stat = fs.statSync(filepath);
  const sizeBytes = stat.size;

  if (sizeBytes === 0) {
    return {
      valid: false, format: "unknown", filename, sizeBytes: 0,
      generatedAt: null, tableCounts: {}, totalRecords: 0,
      issues: ["Arquivo está vazio (0 bytes)."],
      warnings: [],
      summary: "FALHOU — arquivo vazio",
    };
  }

  // ── JSON Backup ──────────────────────────────────────────────
  if (filename.endsWith(".json")) {
    try {
      const raw = fs.readFileSync(filepath, "utf-8");
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          valid: false, format: "json", filename, sizeBytes,
          generatedAt: null, tableCounts: {}, totalRecords: 0,
          issues: ["JSON inválido — arquivo corrompido ou truncado."],
          warnings: [],
          summary: "FALHOU — JSON corrompido",
        };
      }

      const generatedAt: string | null = parsed.generatedAt ?? null;

      if (!parsed.tables || typeof parsed.tables !== "object") {
        issues.push("Campo 'tables' ausente ou inválido.");
      }
      if (!parsed.version) warnings.push("Campo 'version' ausente.");
      if (!parsed.generatedBy) warnings.push("Campo 'generatedBy' ausente.");

      const tableCounts: Record<string, number> = {};
      let totalRecords = 0;

      if (parsed.tables && typeof parsed.tables === "object") {
        for (const [tbl, rows] of Object.entries(parsed.tables)) {
          const count = Array.isArray(rows) ? rows.length : 0;
          tableCounts[tbl] = count;
          totalRecords += count;
        }
      }

      for (const crit of CRITICAL_TABLES_JSON) {
        if (!(crit in tableCounts)) {
          issues.push(`Tabela crítica ausente: '${crit}'.`);
        } else if (tableCounts[crit] === 0) {
          warnings.push(`Tabela crítica vazia: '${crit}'.`);
        }
      }

      if (totalRecords === 0) {
        issues.push("Backup não contém registros (todas as tabelas estão vazias).");
      }

      const valid = issues.length === 0;
      const summary = valid
        ? `OK — ${Object.keys(tableCounts).length} tabelas, ${totalRecords.toLocaleString()} registros`
        : `FALHOU — ${issues.length} problema(s) encontrado(s)`;

      return { valid, format: "json", filename, sizeBytes, generatedAt, tableCounts, totalRecords, issues, warnings, summary };
    } catch (e: any) {
      return {
        valid: false, format: "json", filename, sizeBytes,
        generatedAt: null, tableCounts: {}, totalRecords: 0,
        issues: [`Erro ao validar JSON: ${e?.message ?? "desconhecido"}`],
        warnings: [],
        summary: "FALHOU — erro de leitura",
      };
    }
  }

  // ── SQL Backup ───────────────────────────────────────────────
  if (filename.endsWith(".sql")) {
    try {
      const raw = fs.readFileSync(filepath, "utf-8");
      const lines = raw.split("\n");
      const tableCounts: Record<string, number> = {};
      let totalRecords = 0;
      let hasBegin = false;
      let hasCommit = false;
      let generatedAt: string | null = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-- Gerado em:")) {
          generatedAt = trimmed.replace("-- Gerado em:", "").trim();
        }
        if (trimmed === "BEGIN;") hasBegin = true;
        if (trimmed === "COMMIT;") hasCommit = true;
        if (trimmed.startsWith("INSERT INTO ")) {
          const match = trimmed.match(/^INSERT INTO (\w+)/);
          if (match) {
            const tbl = match[1];
            tableCounts[tbl] = (tableCounts[tbl] ?? 0) + 1;
            totalRecords++;
          }
        }
      }

      if (!hasBegin) issues.push("Instrução BEGIN ausente — SQL pode não ser atômico.");
      if (!hasCommit) issues.push("Instrução COMMIT ausente — transação incompleta.");

      for (const crit of CRITICAL_TABLES_SQL) {
        if (!(crit in tableCounts)) {
          warnings.push(`Tabela '${crit}' não tem INSERTs — pode estar vazia.`);
        }
      }

      if (totalRecords === 0) {
        issues.push("Nenhum INSERT encontrado — backup não contém dados.");
      }

      const valid = issues.length === 0;
      const summary = valid
        ? `OK — ${Object.keys(tableCounts).length} tabelas, ${totalRecords.toLocaleString()} INSERTs`
        : `FALHOU — ${issues.length} problema(s) encontrado(s)`;

      return { valid, format: "sql", filename, sizeBytes, generatedAt, tableCounts, totalRecords, issues, warnings, summary };
    } catch (e: any) {
      return {
        valid: false, format: "sql", filename, sizeBytes,
        generatedAt: null, tableCounts: {}, totalRecords: 0,
        issues: [`Erro ao validar SQL: ${e?.message ?? "desconhecido"}`],
        warnings: [],
        summary: "FALHOU — erro de leitura",
      };
    }
  }

  return {
    valid: false, format: "unknown", filename, sizeBytes,
    generatedAt: null, tableCounts: {}, totalRecords: 0,
    issues: ["Formato de arquivo não reconhecido (esperado .json ou .sql)."],
    warnings: [],
    summary: "FALHOU — formato desconhecido",
  };
}

// ─── Schedule Daily Backup ─────────────────────────────────────
let backupScheduled = false; // FASE 3.1 — prevent double-scheduling

export function scheduleBackups() {
  if (backupScheduled) return; // FASE 3.1 — idempotent guard
  backupScheduled = true;

  ensureBackupDir();
  cron.schedule("0 17 * * *", async () => {
    if (!startJobRun(BACKUP_JOB)) {
      console.warn("[BACKUP] Tick skipped — previous backup still in progress");
      return;
    }
    try {
      console.log("[BACKUP] Iniciando backup automático diário (17:00)...");
      const filename = await runBackup();
      console.log(`[BACKUP] Backup concluído: ${filename}`);
      sendBackupEmail(filename).catch(e => console.error("[BACKUP] Erro no email:", e));
      finishJobRun(BACKUP_JOB, true);
    } catch (err: any) {
      logSecurity(`[BACKUP_FAILED] step=scheduled_run | error=${err?.message ?? "unknown"}`);
      console.error("[BACKUP] Erro no backup automático:", err);
      finishJobRun(BACKUP_JOB, false, err?.message);
      incJobFailures();
    }
  });
  console.log("[BACKUP] Backup automático agendado para 17:00 diariamente.");
}

// ═══════════════════════════════════════════════════════════════
// FASE 3.5 — RESTORE SAFE MODE + DISASTER RECOVERY HARDENING
// ═══════════════════════════════════════════════════════════════

const RESTORE_DRY_RUN_JOB = "restore-dry-run";
const RESTORE_SANDBOX_JOB  = "restore-sandbox";
const RESTORE_PLANNER_JOB  = "restore-planner";
registerJob(RESTORE_DRY_RUN_JOB);
registerJob(RESTORE_SANDBOX_JOB);
registerJob(RESTORE_PLANNER_JOB);

// ─── T504: Restore Lock ────────────────────────────────────────
// Global in-memory lock: only one restore-related op at a time.
let _restoreLockHolder: string | null = null;
let _restoreLockAcquiredAt: number | null = null;

export function acquireRestoreLock(correlationId: string): boolean {
  if (_restoreLockHolder !== null) return false;
  _restoreLockHolder    = correlationId;
  _restoreLockAcquiredAt = Date.now();
  logSecurity(`[RESTORE_LOCK] acquired | correlationId=${correlationId}`);
  return true;
}

export function releaseRestoreLock(correlationId: string): void {
  if (_restoreLockHolder === correlationId) {
    logSecurity(`[RESTORE_LOCK] released | correlationId=${correlationId}`);
    _restoreLockHolder    = null;
    _restoreLockAcquiredAt = null;
  }
}

export function isRestoreLocked(): boolean { return _restoreLockHolder !== null; }

export function getRestoreLockState(): { locked: boolean; holder: string | null; acquiredAt: string | null } {
  return {
    locked:     _restoreLockHolder !== null,
    holder:     _restoreLockHolder,
    acquiredAt: _restoreLockAcquiredAt ? new Date(_restoreLockAcquiredAt).toISOString() : null,
  };
}

// ─── Shared: parse JSON backup ─────────────────────────────────
function parseJsonBackup(filepath: string): { ok: true; data: any } | { ok: false; error: string } {
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    const data = JSON.parse(raw);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "parse error" };
  }
}

// ─── FK map: table → list of { field, refsTable } ─────────────
const FK_MAP: Record<string, Array<{ field: string; refsTable: string; refsField: string }>> = {
  orders:               [{ field: "companyId",  refsTable: "companies",        refsField: "id" }],
  orderItems:           [{ field: "orderId",    refsTable: "orders",           refsField: "id" },
                         { field: "productId",  refsTable: "products",         refsField: "id" }],
  productPrices:        [{ field: "productId",  refsTable: "products",         refsField: "id" }],
  companyQuotations:    [{ field: "companyId",  refsTable: "companies",        refsField: "id" }],
  specialOrderRequests: [{ field: "companyId",  refsTable: "companies",        refsField: "id" }],
  tasks:                [{ field: "companyId",  refsTable: "companies",        refsField: "id" }],
  clientIncidents:      [{ field: "companyId",  refsTable: "companies",        refsField: "id" }],
  logisticsRoutes:      [{ field: "driverId",   refsTable: "logisticsDrivers", refsField: "id" },
                         { field: "vehicleId",  refsTable: "logisticsVehicles",refsField: "id" }],
  logisticsMaintenance: [{ field: "vehicleId",  refsTable: "logisticsVehicles",refsField: "id" }],
};

// Topological restore order (FK-safe)
const RESTORE_ORDER = [
  "users", "companies", "priceGroups", "categories", "products",
  "productPrices", "orderWindows", "orderExceptions", "orders", "orderItems",
  "systemSettings", "specialOrderRequests", "tasks", "clientIncidents",
  "internalIncidents", "logisticsDrivers", "logisticsVehicles",
  "logisticsRoutes", "logisticsMaintenance", "companyQuotations",
];

// ─── T502: Restore Sandbox ─────────────────────────────────────
export interface RestoreSandboxResult {
  correlationId: string;
  filename: string;
  ranAt: string;
  format: "json" | "sql" | "unknown";
  tableCounts: Record<string, number>;
  totalRecords: number;
  fkIssues: string[];
  fkWarnings: string[];
  duplicateIdIssues: string[];
  tenants: Array<{ id: number; name: string }>;
  restoreOrder: string[];
  safeToSimulate: boolean;
  summary: string;
}

export function restoreSandbox(filename: string): RestoreSandboxResult {
  const correlationId = randomUUID();
  const ranAt = new Date().toISOString();
  const filepath = getBackupPath(filename);

  const base: RestoreSandboxResult = {
    correlationId, filename, ranAt, format: "unknown",
    tableCounts: {}, totalRecords: 0,
    fkIssues: [], fkWarnings: [], duplicateIdIssues: [],
    tenants: [], restoreOrder: RESTORE_ORDER,
    safeToSimulate: false, summary: "",
  };

  if (!filepath) {
    base.fkIssues.push("Arquivo não encontrado.");
    base.summary = "FALHOU — arquivo não encontrado";
    return base;
  }

  if (!filename.endsWith(".json")) {
    base.format = filename.endsWith(".sql") ? "sql" : "unknown";
    base.fkWarnings.push("Análise FK interna disponível apenas para backups JSON. SQL não tem estrutura relacional parseável offline.");
    base.safeToSimulate = true;
    base.summary = "AVISO — análise FK não disponível para formato SQL";
    return base;
  }

  const parsed = parseJsonBackup(filepath);
  if (!parsed.ok) {
    base.format = "json";
    base.fkIssues.push(`JSON inválido: ${parsed.error}`);
    base.summary = "FALHOU — JSON corrompido";
    return base;
  }

  base.format = "json";
  const tables = parsed.data?.tables ?? {};

  // Build table counts and index sets for FK lookup
  const indexSets: Record<string, Set<number>> = {};
  for (const [tbl, rows] of Object.entries(tables)) {
    const arr = Array.isArray(rows) ? rows as any[] : [];
    base.tableCounts[tbl] = arr.length;
    base.totalRecords += arr.length;
    indexSets[tbl] = new Set(arr.map((r: any) => r.id).filter((id: any) => id != null));
  }

  // Duplicate IDs per table
  for (const [tbl, rows] of Object.entries(tables)) {
    const arr = Array.isArray(rows) ? rows as any[] : [];
    const seen = new Set<number>();
    const dups: number[] = [];
    for (const row of arr) {
      if (row.id != null) {
        if (seen.has(row.id)) dups.push(row.id);
        seen.add(row.id);
      }
    }
    if (dups.length > 0) {
      base.duplicateIdIssues.push(`Tabela '${tbl}': IDs duplicados [${dups.slice(0, 5).join(", ")}${dups.length > 5 ? ` +${dups.length - 5} mais` : ""}]`);
    }
  }

  // FK integrity within backup
  for (const [tbl, fks] of Object.entries(FK_MAP)) {
    const rows: any[] = Array.isArray(tables[tbl]) ? tables[tbl] : [];
    if (rows.length === 0) continue;
    for (const { field, refsTable, refsField: _rf } of fks) {
      const refSet = indexSets[refsTable];
      if (!refSet) {
        base.fkWarnings.push(`FK ${tbl}.${field} → ${refsTable}: tabela referenciada não encontrada no backup.`);
        continue;
      }
      const broken: any[] = [];
      for (const row of rows) {
        const val = row[field];
        if (val != null && !refSet.has(val)) broken.push(val);
      }
      if (broken.length > 0) {
        const sample = [...new Set(broken)].slice(0, 5).join(", ");
        base.fkIssues.push(`FK ${tbl}.${field} → ${refsTable}: ${broken.length} referência(s) quebrada(s) [${sample}${broken.length > 5 ? "..." : ""}]`);
      }
    }
  }

  // Tenants
  const companiesArr: any[] = Array.isArray(tables.companies) ? tables.companies : [];
  base.tenants = companiesArr.map((c: any) => ({ id: c.id, name: c.name ?? c.tradeName ?? `ID ${c.id}` }));

  base.safeToSimulate = base.fkIssues.length === 0 && base.duplicateIdIssues.length === 0;
  const problems = base.fkIssues.length + base.duplicateIdIssues.length;
  base.summary = base.safeToSimulate
    ? `OK — ${Object.keys(base.tableCounts).length} tabelas, ${base.totalRecords.toLocaleString()} registros, ${base.tenants.length} tenant(s), integridade FK íntegra`
    : `PROBLEMAS — ${problems} problema(s) de integridade FK encontrado(s)`;

  return base;
}

// ─── T501: Restore Dry-Run ─────────────────────────────────────
// Reads backup + queries live DB (READ ONLY). ZERO writes.
export interface RestoreDryRunResult {
  correlationId: string;
  filename: string;
  format: "json" | "sql" | "unknown";
  ranAt: string;
  // Structural
  structuralValid: boolean;
  structuralIssues: string[];
  // Sandbox (in-memory FK)
  fkIssues: string[];
  fkWarnings: string[];
  duplicateIdIssues: string[];
  // Live DB conflict (read-only queries)
  tenantCollisions: Array<{ id: number; name: string }>;
  idConflicts: Record<string, { backupCount: number; conflicts: number[] }>;
  sequenceMaxes: Record<string, number>;
  backupMaxes: Record<string, number>;
  // Tenant summary
  tenantsInBackup: number;
  tenantNames: string[];
  // Table summary
  tableCounts: Record<string, number>;
  totalRecords: number;
  // Risk
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskReasons: string[];
  safeToRestore: boolean;
  // Output
  summary: string;
  recommendations: string[];
}

export async function restoreDryRun(filename: string): Promise<RestoreDryRunResult> {
  const correlationId = randomUUID();
  const ranAt = new Date().toISOString();
  const filepath = getBackupPath(filename);

  const base: RestoreDryRunResult = {
    correlationId, filename, ranAt, format: "unknown",
    structuralValid: false, structuralIssues: [],
    fkIssues: [], fkWarnings: [], duplicateIdIssues: [],
    tenantCollisions: [], idConflicts: {},
    sequenceMaxes: {}, backupMaxes: {},
    tenantsInBackup: 0, tenantNames: [],
    tableCounts: {}, totalRecords: 0,
    riskLevel: "CRITICAL", riskReasons: [],
    safeToRestore: false, summary: "", recommendations: [],
  };

  if (!filepath) {
    base.structuralIssues.push("Arquivo não encontrado ou nome inválido.");
    base.riskReasons.push("Arquivo de backup inacessível.");
    base.summary = "FALHOU — arquivo não encontrado";
    base.recommendations.push("Verifique se o arquivo de backup existe e o nome está correto.");
    return base;
  }

  // ── 1. Run sandbox (structural + FK, no DB) ──────────────────
  const sandbox = restoreSandbox(filename);
  base.format         = sandbox.format as any;
  base.tableCounts    = sandbox.tableCounts;
  base.totalRecords   = sandbox.totalRecords;
  base.fkIssues       = sandbox.fkIssues;
  base.fkWarnings     = sandbox.fkWarnings;
  base.duplicateIdIssues = sandbox.duplicateIdIssues;
  base.tenantsInBackup   = sandbox.tenants.length;
  base.tenantNames       = sandbox.tenants.map(t => t.name);

  // ── 2. Structural validation ─────────────────────────────────
  const validation = validateBackup(filename);
  base.structuralValid  = validation.valid;
  base.structuralIssues = validation.issues;

  // ── 3. Live DB conflict analysis (READ ONLY) ──────────────────
  try {
    const [liveCompanies, liveUsers, liveOrders, liveProducts] = await Promise.all([
      db.select({ id: companies.id, name: companies.name }).from(companies),
      db.select({ id: users.id }).from(users),
      db.select({ id: orders.id }).from(orders),
      db.select({ id: products.id }).from(products),
    ]);

    const liveCompanyIds = new Set(liveCompanies.map(c => c.id));
    const liveUserIds    = new Set(liveUsers.map(u => u.id));
    const liveOrderIds   = new Set(liveOrders.map(o => o.id));
    const liveProductIds = new Set(liveProducts.map(p => p.id));

    // Sequence maxes from live DB
    base.sequenceMaxes = {
      companies: liveCompanies.length > 0 ? Math.max(...liveCompanies.map(c => c.id)) : 0,
      users:     liveUsers.length > 0     ? Math.max(...liveUsers.map(u => u.id))     : 0,
      orders:    liveOrders.length > 0    ? Math.max(...liveOrders.map(o => o.id))    : 0,
      products:  liveProducts.length > 0  ? Math.max(...liveProducts.map(p => p.id))  : 0,
    };

    // Backup max IDs
    if (base.format === "json" && filepath) {
      const parsed = parseJsonBackup(filepath);
      if (parsed.ok) {
        const t = parsed.data?.tables ?? {};
        const maxId = (arr: any[]) => arr.length > 0 ? Math.max(...arr.map((r: any) => r.id ?? 0).filter((id: any) => typeof id === "number")) : 0;
        base.backupMaxes = {
          companies: maxId(Array.isArray(t.companies) ? t.companies : []),
          users:     maxId(Array.isArray(t.users)     ? t.users     : []),
          orders:    maxId(Array.isArray(t.orders)    ? t.orders    : []),
          products:  maxId(Array.isArray(t.products)  ? t.products  : []),
        };

        // Tenant collisions
        const backupCompanies: any[] = Array.isArray(t.companies) ? t.companies : [];
        for (const bc of backupCompanies) {
          if (liveCompanyIds.has(bc.id)) {
            base.tenantCollisions.push({ id: bc.id, name: bc.name ?? bc.tradeName ?? `ID ${bc.id}` });
          }
        }

        // ID conflicts per critical table
        const checkConflicts = (tblName: string, backupArr: any[], liveSet: Set<number>) => {
          const conflicts = backupArr.map((r: any) => r.id).filter((id: any) => typeof id === "number" && liveSet.has(id));
          if (conflicts.length > 0 || backupArr.length > 0) {
            base.idConflicts[tblName] = { backupCount: backupArr.length, conflicts: conflicts.slice(0, 20) };
          }
        };
        checkConflicts("companies", backupCompanies, liveCompanyIds);
        checkConflicts("users",    Array.isArray(t.users)    ? t.users    : [], liveUserIds);
        checkConflicts("orders",   Array.isArray(t.orders)   ? t.orders   : [], liveOrderIds);
        checkConflicts("products", Array.isArray(t.products) ? t.products : [], liveProductIds);
      }
    }
  } catch (e: any) {
    base.structuralIssues.push(`Erro ao consultar banco de dados: ${e?.message ?? "desconhecido"}`);
    base.recommendations.push("Verificar conectividade com o banco de dados antes de prosseguir.");
  }

  // ── 4. Risk assessment ────────────────────────────────────────
  const riskFactors: string[] = [];

  if (!base.structuralValid) riskFactors.push("Backup estruturalmente inválido.");
  if (base.tenantCollisions.length > 0) riskFactors.push(`${base.tenantCollisions.length} tenant(s) já existe(m) no banco — colisão de dados.`);
  if (base.fkIssues.length > 0) riskFactors.push(`${base.fkIssues.length} FK quebrada(s) no backup.`);
  if (base.duplicateIdIssues.length > 0) riskFactors.push(`IDs duplicados encontrados no backup.`);

  const totalConflicts = Object.values(base.idConflicts).reduce((s, v) => s + v.conflicts.length, 0);
  if (totalConflicts > 0) riskFactors.push(`${totalConflicts} conflito(s) de ID com banco de produção.`);

  base.riskReasons = riskFactors;

  if (riskFactors.length === 0) {
    base.riskLevel = "LOW";
  } else if (base.tenantCollisions.length > 0 || !base.structuralValid) {
    base.riskLevel = "CRITICAL";
  } else if (totalConflicts > 0 || base.fkIssues.length > 0) {
    base.riskLevel = "HIGH";
  } else {
    base.riskLevel = "MEDIUM";
  }

  base.safeToRestore = base.riskLevel === "LOW";

  // ── 5. Recommendations ───────────────────────────────────────
  const recs: string[] = [];
  if (base.tenantCollisions.length > 0) recs.push("NÃO restaurar em produção — tenant collision detectada. Limpe os tenants conflitantes antes.");
  if (!base.structuralValid) recs.push("Corrija os erros estruturais no backup antes de prosseguir.");
  if (base.fkIssues.length > 0) recs.push("Corrija as integridades referenciais no backup antes de restaurar.");
  if (totalConflicts > 0) recs.push("IDs em conflito exigem truncate das tabelas afetadas ou uso de ON CONFLICT DO NOTHING (já presente no SQL).");
  if (recs.length === 0) recs.push("Backup parece seguro para restore em ambiente vazio. Sempre valide em sandbox primeiro.");
  recs.push("NUNCA execute um restore diretamente em produção sem dry-run e sandbox prévios.");
  base.recommendations = recs;

  const riskLabel = { LOW: "BAIXO", MEDIUM: "MÉDIO", HIGH: "ALTO", CRITICAL: "CRÍTICO" }[base.riskLevel];
  base.summary = `Risco ${riskLabel} — ${base.tenantsInBackup} tenant(s), ${base.totalRecords.toLocaleString()} registros, ${base.tenantCollisions.length} colisão(ões) de tenant, ${totalConflicts} conflito(s) de ID`;

  return base;
}

// ─── T503: Restore Planner ─────────────────────────────────────
export interface RestoreStep {
  order: number;
  table: string;
  records: number;
  dependsOn: string[];
  riskNote: string;
  estimatedSeconds: number;
}

export interface RestorePlan {
  correlationId: string;
  filename: string;
  generatedAt: string;
  format: "json" | "sql" | "unknown";
  // Overview
  totalTenants: number;
  tenantNames: string[];
  totalTables: number;
  totalRecords: number;
  backupSizeBytes: number;
  backupGeneratedAt: string | null;
  // Conflict summary
  tenantCollisions: number;
  idConflicts: number;
  fkIssues: number;
  // Steps
  steps: RestoreStep[];
  estimatedDurationSeconds: number;
  // Risk
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  operationalRisk: string;
  // Checklist
  preRestoreChecklist: string[];
  postRestoreChecklist: string[];
  // Block verdict
  blockers: string[];
  canProceed: boolean;
}

export async function restorePlanner(filename: string): Promise<RestorePlan> {
  const correlationId = randomUUID();
  const generatedAt = new Date().toISOString();
  const filepath = getBackupPath(filename);

  const base: RestorePlan = {
    correlationId, filename, generatedAt, format: "unknown",
    totalTenants: 0, tenantNames: [], totalTables: 0, totalRecords: 0,
    backupSizeBytes: 0, backupGeneratedAt: null,
    tenantCollisions: 0, idConflicts: 0, fkIssues: 0,
    steps: [], estimatedDurationSeconds: 0,
    riskLevel: "CRITICAL", operationalRisk: "Arquivo não encontrado.",
    preRestoreChecklist: [], postRestoreChecklist: [],
    blockers: [], canProceed: false,
  };

  if (!filepath) {
    base.blockers.push("Arquivo de backup não encontrado.");
    return base;
  }

  const stat = fs.statSync(filepath);
  base.backupSizeBytes = stat.size;
  base.format = filename.endsWith(".json") ? "json" : filename.endsWith(".sql") ? "sql" : "unknown";

  // Run dry-run for full analysis (read-only)
  const dryRun = await restoreDryRun(filename);
  base.totalTenants       = dryRun.tenantsInBackup;
  base.tenantNames        = dryRun.tenantNames;
  base.totalTables        = Object.keys(dryRun.tableCounts).length;
  base.totalRecords       = dryRun.totalRecords;
  base.tenantCollisions   = dryRun.tenantCollisions.length;
  base.idConflicts        = Object.values(dryRun.idConflicts).reduce((s, v) => s + v.conflicts.length, 0);
  base.fkIssues           = dryRun.fkIssues.length;
  base.riskLevel          = dryRun.riskLevel;
  base.backupGeneratedAt  = filename.endsWith(".json") && filepath ? (() => {
    try {
      const p = parseJsonBackup(filepath);
      return p.ok ? (p.data?.generatedAt ?? null) : null;
    } catch { return null; }
  })() : null;

  // Build restore steps
  const tableCounts = dryRun.tableCounts;
  const depMap: Record<string, string[]> = {
    orders:               ["companies"],
    orderItems:           ["orders", "products"],
    productPrices:        ["products", "priceGroups"],
    orderWindows:         ["companies"],
    orderExceptions:      ["companies", "products"],
    companyQuotations:    ["companies"],
    specialOrderRequests: ["companies"],
    tasks:                ["companies"],
    clientIncidents:      ["companies"],
    logisticsRoutes:      ["logisticsDrivers", "logisticsVehicles"],
    logisticsMaintenance: ["logisticsVehicles"],
  };

  const steps: RestoreStep[] = [];
  for (const [idx, tbl] of RESTORE_ORDER.entries()) {
    const records = tableCounts[tbl] ?? 0;
    const deps = depMap[tbl] ?? [];
    const est = Math.max(1, Math.ceil(records / 500)); // ~500 rows/sec estimate
    let riskNote = "Sem dependências externas — seguro para restaurar primeiro.";
    if (deps.length > 0) riskNote = `Depende de: ${deps.join(", ")}. Restaurar apenas após estas tabelas.`;
    if (tbl === "users") riskNote = "Contém credenciais — verificar collisions de e-mail antes do restore.";
    if (tbl === "companies") riskNote = "Âncora multi-tenant — colisões aqui bloqueiam toda a restauração.";
    steps.push({ order: idx + 1, table: tbl, records, dependsOn: deps, riskNote, estimatedSeconds: est });
  }
  base.steps = steps;
  base.estimatedDurationSeconds = steps.reduce((s, st) => s + st.estimatedSeconds, 0) + 30; // +30s overhead

  // Risk description
  const riskDesc = {
    LOW:      "Backup íntegro, sem conflitos. Restore seguro em ambiente vazio.",
    MEDIUM:   "Alguns avisos encontrados. Revisar warnings antes de prosseguir.",
    HIGH:     "Conflitos de ID ou FK quebradas. Restore requer intervenção manual.",
    CRITICAL: "Colisão de tenants ou backup inválido. NÃO restaurar sem correção.",
  };
  base.operationalRisk = riskDesc[base.riskLevel];

  // Blockers
  if (!dryRun.structuralValid) base.blockers.push("Backup estruturalmente inválido.");
  if (base.tenantCollisions > 0) base.blockers.push(`${base.tenantCollisions} tenant(s) já existe(m) no banco de produção.`);
  if (base.fkIssues > 0) base.blockers.push(`${base.fkIssues} integridade(s) FK quebrada(s) dentro do backup.`);
  base.canProceed = base.blockers.length === 0;

  // Checklists
  base.preRestoreChecklist = [
    "[ ] Confirmar que o ambiente de destino está em modo de manutenção.",
    "[ ] Pausar todos os workers: outbox, auto-dispatch, billing, faturamento, alertas.",
    "[ ] Fazer backup do banco atual ANTES do restore.",
    "[ ] Verificar que nenhum outro restore está em andamento (restore lock).",
    "[ ] Confirmar dry-run sem blockers (tenantCollisions=0, fkIssues=0).",
    "[ ] Checar disponibilidade de espaço em disco para o restore.",
    "[ ] Notificar equipe de operações com antecedência.",
    base.format === "sql"
      ? "[ ] Executar o SQL em uma transação explícita (BEGIN/COMMIT já incluídos)."
      : "[ ] Usar script de restore JSON com replay em ordem de dependência FK.",
  ];
  base.postRestoreChecklist = [
    "[ ] Verificar integridade referencial (SELECT COUNT das tabelas críticas).",
    "[ ] Resetar sequences do PostgreSQL para max(id)+1 em cada tabela restaurada.",
    "[ ] Desativar modo de manutenção.",
    "[ ] Retomar workers: outbox, auto-dispatch, billing, faturamento, alertas.",
    "[ ] Testar login de cada tenant restaurado.",
    "[ ] Verificar que pedidos recentes foram preservados.",
    "[ ] Criar novo backup imediatamente após o restore bem-sucedido.",
    "[ ] Registrar o restore no log de auditoria com correlationId.",
  ];

  return base;
}
