// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BACKUP PERSISTENTE — Supabase Storage
// Upload, verificação e metadata de backups.
// Degrada graciosamente quando SUPABASE_SERVICE_ROLE_KEY não está
// configurado — log [BACKUP_STORAGE_UNAVAILABLE], backup local mantido.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createHash } from "node:crypto";
import fs from "fs";
import { db } from "./database/db";
import { backupHistory } from "@shared/schema";

const BUCKET = "erp-backups";
const RETENTION_DAYS = 90;

// ─── Derive Supabase project URL from DATABASE_URL ────────────
function resolveSupabaseUrl(): string | null {
  const explicit = process.env.SUPABASE_URL;
  if (explicit) return explicit;
  const dbUrl = process.env.SUPABASE_DATABASE_URL ?? "";
  const match = dbUrl.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]+):/i);
  if (match) return `https://${match[1]}.supabase.co`;
  return null;
}

// ─── Lazy Supabase Storage client ─────────────────────────────
let _storageClient: any = null;
let _storageClientUrl: string | null = null;
function getStorageClient() {
  const url = resolveSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Invalidate cached client if URL changed (test isolation)
  if (_storageClient && _storageClientUrl === url) return _storageClient;
  try {
    const { createClient } = require("@supabase/supabase-js");
    _storageClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    _storageClientUrl = url;
    return _storageClient;
  } catch (e: any) {
    console.warn("[BACKUP_STORAGE_CLIENT_FAIL]", e?.message);
    return null;
  }
}

export function storageAvailable(): boolean {
  return !!(resolveSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ─── SHA-256 Hash ──────────────────────────────────────────────
export function computeSha256(filepath: string): string {
  const content = fs.readFileSync(filepath);
  return createHash("sha256").update(content).digest("hex");
}

// ─── Ensure bucket exists (private, no public access) ─────────
export async function ensureStorageBucket(): Promise<void> {
  const client = getStorageClient();
  if (!client) return;
  try {
    const { data: buckets, error: listErr } = await client.storage.listBuckets();
    if (listErr) {
      console.warn("[BACKUP_STORAGE] Não foi possível listar buckets:", listErr.message);
      return;
    }
    const exists = (buckets ?? []).some((b: any) => b.name === BUCKET);
    if (!exists) {
      const { error: createErr } = await client.storage.createBucket(BUCKET, {
        public: false,
        allowedMimeTypes: ["application/json", "application/sql", "text/plain"],
        fileSizeLimit: 104857600,
      });
      if (createErr) {
        console.warn(`[BACKUP_STORAGE] Falha ao criar bucket '${BUCKET}':`, createErr.message);
      } else {
        console.info(`[BACKUP_STORAGE_BUCKET_CREATED] bucket=${BUCKET} public=false`);
      }
    } else {
      console.info(`[BACKUP_STORAGE] Bucket '${BUCKET}' já existe.`);
    }
  } catch (e: any) {
    console.warn("[BACKUP_STORAGE] ensureStorageBucket error:", e?.message);
  }
}

// ─── Upload ───────────────────────────────────────────────────
async function uploadFile(filepath: string, storagePath: string): Promise<{ ok: boolean; error?: string }> {
  const client = getStorageClient();
  if (!client) return { ok: false, error: "no-client" };

  const content = fs.readFileSync(filepath);
  const contentType = filepath.endsWith(".sql") ? "application/sql" : "application/json";

  const { error } = await client.storage.from(BUCKET).upload(storagePath, content, {
    contentType,
    upsert: false,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ─── Verify upload by re-downloading and checking hash ────────
async function verifyUploadedFile(storagePath: string, expectedSha256: string): Promise<{ ok: boolean; error?: string }> {
  const client = getStorageClient();
  if (!client) return { ok: false, error: "no-client" };

  const { data, error } = await client.storage.from(BUCKET).download(storagePath);
  if (error || !data) return { ok: false, error: error?.message ?? "download-failed" };

  const buf = Buffer.from(await data.arrayBuffer());
  const actualHash = createHash("sha256").update(buf).digest("hex");
  if (actualHash !== expectedSha256) {
    return { ok: false, error: `hash-mismatch: expected=${expectedSha256.slice(0, 16)}… got=${actualHash.slice(0, 16)}…` };
  }
  return { ok: true };
}

// ─── Insert metadata into backup_history ──────────────────────
export async function recordBackupHistory(data: {
  filename: string;
  sizeBytes: number;
  sha256: string;
  storageProvider: string;
  storagePath: string | null;
  uploadStatus: string;
  verifyStatus: string;
  createdBy: string;
  notes?: string;
}): Promise<void> {
  try {
    const retentionUntil = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(backupHistory).values({
      filename: data.filename,
      sizeBytes: data.sizeBytes,
      sha256: data.sha256,
      storageProvider: data.storageProvider,
      storagePath: data.storagePath,
      uploadStatus: data.uploadStatus,
      verifyStatus: data.verifyStatus,
      retentionUntil,
      createdBy: data.createdBy,
      environment: process.env.NODE_ENV ?? "development",
      restoreTested: false,
      notes: data.notes ?? null,
    });
  } catch (e: any) {
    console.error("[BACKUP_HISTORY_RECORD_FAIL]", e?.message);
  }
}

// ─── Listar histórico de backups ──────────────────────────────
export async function listBackupHistory(limit = 50) {
  try {
    const rows = await db
      .select()
      .from(backupHistory)
      .orderBy(backupHistory.createdAt)
      .limit(limit);
    return rows.reverse();
  } catch (e: any) {
    console.error("[BACKUP_HISTORY_LIST_FAIL]", e?.message);
    return [];
  }
}

// ─── Buscar registro por filename ─────────────────────────────
export async function getBackupHistoryByFilename(filename: string) {
  try {
    const rows = await db
      .select()
      .from(backupHistory)
      .limit(1);
    return rows.find(r => r.filename === filename) ?? null;
  } catch {
    return null;
  }
}

// ─── Pipeline completo: hash → upload → verify → metadata ─────
export async function runBackupStoragePipeline(
  filepath: string,
  filename: string,
  createdBy = "system",
): Promise<{
  sha256: string;
  sizeBytes: number;
  uploadStatus: string;
  verifyStatus: string;
  storagePath: string | null;
  storageProvider: string;
}> {
  const sizeBytes = fs.statSync(filepath).size;

  console.info("[BACKUP_START]", { filename, sizeBytes, createdBy, ts: new Date().toISOString() });

  let sha256: string;
  try {
    sha256 = computeSha256(filepath);
    console.info("[BACKUP_HASH_OK]", { filename, sha256: sha256.slice(0, 16) + "…", ts: new Date().toISOString() });
  } catch (e: any) {
    console.error("[BACKUP_FAILED]", { step: "hash", filename, error: e?.message });
    await recordBackupHistory({
      filename, sizeBytes, sha256: "error", storageProvider: "local",
      storagePath: null, uploadStatus: "skipped", verifyStatus: "skipped", createdBy,
      notes: `Hash error: ${e?.message}`,
    });
    return { sha256: "error", sizeBytes, uploadStatus: "skipped", verifyStatus: "skipped", storagePath: null, storageProvider: "local" };
  }

  console.info("[BACKUP_LOCAL_OK]", { filename, sizeBytes, sha256: sha256.slice(0, 16) + "…", ts: new Date().toISOString() });

  if (!storageAvailable()) {
    console.warn("[BACKUP_STORAGE_UNAVAILABLE]", {
      reason: "SUPABASE_SERVICE_ROLE_KEY não configurado",
      action: "Backup local mantido — configure SUPABASE_SERVICE_ROLE_KEY para ativar upload persistente",
      filename,
      ts: new Date().toISOString(),
    });
    await recordBackupHistory({
      filename, sizeBytes, sha256, storageProvider: "local",
      storagePath: null, uploadStatus: "skipped", verifyStatus: "skipped", createdBy,
      notes: "Storage não configurado — apenas local",
    });
    return { sha256, sizeBytes, uploadStatus: "skipped", verifyStatus: "skipped", storagePath: null, storageProvider: "local" };
  }

  const dateFolder = new Date().toISOString().slice(0, 10);
  const storagePath = `${dateFolder}/${filename}`;

  let uploadStatus = "pending";
  let verifyStatus = "pending";

  const uploadResult = await uploadFile(filepath, storagePath);
  if (!uploadResult.ok) {
    uploadStatus = "failed";
    verifyStatus = "skipped";
    console.error("[BACKUP_FAILED]", { step: "upload", filename, storagePath, error: uploadResult.error, ts: new Date().toISOString() });
    await recordBackupHistory({
      filename, sizeBytes, sha256, storageProvider: "supabase",
      storagePath, uploadStatus, verifyStatus, createdBy,
      notes: `Upload failed: ${uploadResult.error}`,
    });
    return { sha256, sizeBytes, uploadStatus, verifyStatus, storagePath, storageProvider: "supabase" };
  }

  uploadStatus = "ok";
  console.info("[BACKUP_UPLOAD_OK]", { filename, storagePath, bucket: BUCKET, ts: new Date().toISOString() });

  const verifyResult = await verifyUploadedFile(storagePath, sha256);
  if (!verifyResult.ok) {
    verifyStatus = "failed";
    console.error("[BACKUP_FAILED]", { step: "verify", filename, storagePath, error: verifyResult.error, ts: new Date().toISOString() });
    await recordBackupHistory({
      filename, sizeBytes, sha256, storageProvider: "supabase",
      storagePath, uploadStatus, verifyStatus, createdBy,
      notes: `Verify failed: ${verifyResult.error}`,
    });
    return { sha256, sizeBytes, uploadStatus, verifyStatus, storagePath, storageProvider: "supabase" };
  }

  verifyStatus = "ok";
  console.info("[BACKUP_VERIFY_OK]", { filename, storagePath, sha256: sha256.slice(0, 16) + "…", ts: new Date().toISOString() });

  await recordBackupHistory({
    filename, sizeBytes, sha256, storageProvider: "supabase",
    storagePath, uploadStatus, verifyStatus, createdBy,
    notes: undefined,
  });

  console.info("[BACKUP_CLEANUP]", { filename, action: "local-rotation-safe", uploadVerified: true, ts: new Date().toISOString() });

  return { sha256, sizeBytes, uploadStatus, verifyStatus, storagePath, storageProvider: "supabase" };
}

// ─── Monitor: estado do backup ────────────────────────────────
export async function backupMonitorStatus() {
  try {
    const rows = await db
      .select()
      .from(backupHistory)
      .orderBy(backupHistory.createdAt)
      .limit(10);
    const sorted = rows.reverse();
    const last = sorted[0] ?? null;
    const failedConsecutive = (() => {
      let count = 0;
      for (const r of sorted) {
        if (r.uploadStatus === "failed" || r.verifyStatus === "failed") count++;
        else break;
      }
      return count;
    })();
    const hoursSinceLast = last
      ? (Date.now() - new Date(last.createdAt).getTime()) / 3_600_000
      : null;

    const status = {
      lastBackup: last?.filename ?? null,
      lastBackupAt: last?.createdAt ?? null,
      hoursSinceLast: hoursSinceLast !== null ? Math.round(hoursSinceLast * 10) / 10 : null,
      lastUploadStatus: last?.uploadStatus ?? null,
      lastVerifyStatus: last?.verifyStatus ?? null,
      failedConsecutive,
      storageConfigured: storageAvailable(),
      pendingUpload: sorted.some(r => r.uploadStatus === "pending"),
    };

    const alertThreshold = 26;
    if (hoursSinceLast !== null && hoursSinceLast > alertThreshold) {
      console.warn("[BACKUP_ALERT]", { reason: `Último backup há ${hoursSinceLast.toFixed(1)}h (threshold: ${alertThreshold}h)`, ...status });
    }
    if (failedConsecutive >= 2) {
      console.warn("[BACKUP_ALERT]", { reason: `${failedConsecutive} falhas de upload consecutivas`, ...status });
    }

    console.info("[BACKUP_MONITOR]", { ...status, ts: new Date().toISOString() });
    return status;
  } catch (e: any) {
    console.error("[BACKUP_MONITOR_FAIL]", e?.message);
    return null;
  }
}
