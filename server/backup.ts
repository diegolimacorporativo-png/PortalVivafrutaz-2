import cron from "node-cron";
import fs from "fs";
import path from "path";
import { db } from "./database/db";
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
  } catch (e) {
    console.error("[BACKUP] Erro ao enviar email de backup:", e);
    return false;
  }
}

// ─── Schedule Daily Backup ─────────────────────────────────────
export function scheduleBackups() {
  ensureBackupDir();
  cron.schedule("0 17 * * *", async () => {
    try {
      console.log("[BACKUP] Iniciando backup automático diário (17:00)...");
      const filename = await runBackup();
      console.log(`[BACKUP] Backup concluído: ${filename}`);
      sendBackupEmail(filename).catch(e => console.error("[BACKUP] Erro no email:", e));
    } catch (err) {
      console.error("[BACKUP] Erro no backup automático:", err);
    }
  });
  console.log("[BACKUP] Backup automático agendado para 17:00 diariamente.");
}
