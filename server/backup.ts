import cron from "node-cron";
import fs from "fs";
import path from "path";
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
      users: data.usersData,
      companies: data.companiesData,
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
    tableToInserts("users", data.usersData),
    tableToInserts("companies", data.companiesData),
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
