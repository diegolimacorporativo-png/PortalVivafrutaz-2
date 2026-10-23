// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BACKUP PERSISTENTE — Supabase Storage
// Upload, verificação e metadata de backups.
// Degrada graciosamente quando SUPABASE_SERVICE_ROLE_KEY não está
// configurado — log [BACKUP_STORAGE_UNAVAILABLE], backup local mantido.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createHash } from "node:crypto";
import fs from "fs";
import { inArray } from "drizzle-orm";
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
export async function ensureStorageBucket(clientOverride?: any): Promise<boolean> {
  const client = clientOverride ?? getStorageClient();
  if (!client) return false;
  try {
    const { data: buckets, error: listErr } = await client.storage.listBuckets();
    if (listErr) {
      console.warn("[BACKUP_STORAGE] Não foi possível listar buckets:", listErr.message);
      return false;
    }
    const bucket = (buckets ?? []).find((b: any) => b.name === BUCKET);
    if (!bucket) {
      const { error: createErr } = await client.storage.createBucket(BUCKET, {
        public: false,
        allowedMimeTypes: ["application/json", "application/sql", "text/plain"],
        fileSizeLimit: 104857600,
      });
      if (createErr) {
        console.warn(`[BACKUP_STORAGE] Falha ao criar bucket '${BUCKET}':`, createErr.message);
        return false;
      }
      const { data: createdBuckets, error: verifyErr } = await client.storage.listBuckets();
      if (verifyErr) {
        console.warn("[BACKUP_STORAGE] Não foi possível confirmar a privacidade do bucket criado:", verifyErr.message);
        return false;
      }
      const createdBucket = (createdBuckets ?? []).find((b: any) => b.name === BUCKET);
      if (!createdBucket || createdBucket.public !== false) {
        console.error(`[BACKUP_STORAGE_BUCKET_UNSAFE] bucket=${BUCKET} private=false-or-unknown-after-create`);
        return false;
      }
      console.info(`[BACKUP_STORAGE_BUCKET_CREATED] bucket=${BUCKET} public=false`);
      return true;
    }
    if (bucket.public !== false) {
      console.error(`[BACKUP_STORAGE_BUCKET_UNSAFE] bucket=${BUCKET} private=false-or-unknown`);
      return false;
    } else {
      console.info(`[BACKUP_STORAGE] Bucket '${BUCKET}' já existe.`);
      return true;
    }
  } catch (e: any) {
    console.warn("[BACKUP_STORAGE] ensureStorageBucket error:", e?.message);
    return false;
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

export interface BackupRotationCandidate {
  filename: string;
  filepath: string;
}

interface BackupRotationMetadata {
  filename: string;
  storageProvider: string;
  storagePath: string | null;
  uploadStatus: string;
  verifyStatus: string;
  retentionUntil: Date | string | null;
  sha256: string;
}

export interface BackupRotationDependencies {
  lookupHistory: (filenames: string[]) => Promise<BackupRotationMetadata[]>;
  hashFile: (filepath: string) => string;
  verifyRemote: (storagePath: string, expectedSha256: string) => Promise<{ ok: boolean; error?: string }>;
}

const defaultRotationDependencies: BackupRotationDependencies = {
  lookupHistory: async filenames => db.select({
    filename: backupHistory.filename,
    storageProvider: backupHistory.storageProvider,
    storagePath: backupHistory.storagePath,
    uploadStatus: backupHistory.uploadStatus,
    verifyStatus: backupHistory.verifyStatus,
    retentionUntil: backupHistory.retentionUntil,
    sha256: backupHistory.sha256,
  }).from(backupHistory).where(inArray(backupHistory.filename, filenames)),
  hashFile: computeSha256,
  verifyRemote: verifyUploadedFile,
};

/** Confirms current remote existence/content before local rotation. Hash checks
 * establish byte integrity only; they do not demonstrate that a backup restores.
 */
export async function getExternallyVerifiedBackupFilenames(
  candidates: BackupRotationCandidate[],
  dependencies: BackupRotationDependencies = defaultRotationDependencies,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  try {
    const rows = await dependencies.lookupHistory(candidates.map(candidate => candidate.filename));
    const byFilename = new Map(candidates.map(candidate => [candidate.filename, candidate]));
    const now = Date.now();
    const verified = new Set<string>();
    for (const row of rows) {
      const candidate = byFilename.get(row.filename);
      if (!candidate
        || row.storageProvider !== "supabase"
        || !row.storagePath
        || row.uploadStatus !== "ok"
        || row.verifyStatus !== "ok"
        || !row.retentionUntil
        || new Date(row.retentionUntil).getTime() <= now
        || !row.sha256) continue;
      try {
        if (dependencies.hashFile(candidate.filepath) !== row.sha256) continue;
        const remote = await dependencies.verifyRemote(row.storagePath, row.sha256);
        if (remote.ok) verified.add(row.filename);
      } catch (e: any) {
        console.warn("[BACKUP_ROTATION_REMOTE_VERIFY_FAIL]", { filename: row.filename, error: e?.message ?? "verification-failed" });
      }
    }
    return verified;
  } catch (e: any) {
    console.error("[BACKUP_HISTORY_ROTATION_LOOKUP_FAIL]", e?.message);
    return new Set();
  }
}

// ─── Pipeline completo: hash → upload → verify → metadata ─────
export interface BackupStoragePipelineResult {
  sha256: string;
  sizeBytes: number;
  localStatus: "ok" | "failed";
  uploadStatus: "ok" | "failed" | "skipped";
  verifyStatus: "ok" | "failed" | "skipped";
  externalStatus: "verified" | "failed" | "not-configured";
  storagePath: string | null;
  storageProvider: string;
}

export interface BackupStoragePipelineDependencies {
  isStorageAvailable: () => boolean;
  ensureBucket: () => Promise<boolean>;
  hashFile: (filepath: string) => string;
  upload: (filepath: string, storagePath: string) => Promise<{ ok: boolean; error?: string }>;
  verify: (storagePath: string, expectedSha256: string) => Promise<{ ok: boolean; error?: string }>;
  recordHistory: typeof recordBackupHistory;
  stat: typeof fs.statSync;
}

const defaultPipelineDependencies: BackupStoragePipelineDependencies = {
  isStorageAvailable: storageAvailable,
  ensureBucket: ensureStorageBucket,
  hashFile: computeSha256,
  upload: uploadFile,
  verify: verifyUploadedFile,
  recordHistory: recordBackupHistory,
  stat: fs.statSync,
};

export async function runBackupStoragePipeline(
  filepath: string,
  filename: string,
  createdBy = "system",
  dependencies: BackupStoragePipelineDependencies = defaultPipelineDependencies,
): Promise<BackupStoragePipelineResult> {
  let sizeBytes = 0;
  try {
    sizeBytes = dependencies.stat(filepath).size;
  } catch (e: any) {
    console.error("[BACKUP_LOCAL_FAILED]", { filename, error: e?.message ?? "stat-failed" });
    return {
      sha256: "error", sizeBytes, localStatus: "failed", uploadStatus: "skipped",
      verifyStatus: "skipped", externalStatus: "failed", storagePath: null, storageProvider: "local",
    };
  }

  console.info("[BACKUP_START]", { filename, sizeBytes, createdBy, ts: new Date().toISOString() });

  let sha256: string;
  try {
    sha256 = dependencies.hashFile(filepath);
    console.info("[BACKUP_INTEGRITY_LOCAL_OK]", { filename, ts: new Date().toISOString() });
  } catch (e: any) {
    console.error("[BACKUP_FAILED]", { step: "hash", filename, error: e?.message });
    await dependencies.recordHistory({
      filename, sizeBytes, sha256: "error", storageProvider: "local",
      storagePath: null, uploadStatus: "skipped", verifyStatus: "skipped", createdBy,
      notes: `Hash error: ${e?.message}`,
    });
    return { sha256: "error", sizeBytes, localStatus: "ok", uploadStatus: "skipped", verifyStatus: "skipped", externalStatus: "failed", storagePath: null, storageProvider: "local" };
  }

  console.info("[BACKUP_LOCAL_GENERATION_OK]", { filename, sizeBytes, ts: new Date().toISOString() });

  if (!dependencies.isStorageAvailable()) {
    console.warn("[BACKUP_STORAGE_UNAVAILABLE]", {
      reason: "SUPABASE_SERVICE_ROLE_KEY não configurado",
      action: "Backup local mantido — configure SUPABASE_SERVICE_ROLE_KEY para ativar upload persistente",
      filename,
      ts: new Date().toISOString(),
    });
    await dependencies.recordHistory({
      filename, sizeBytes, sha256, storageProvider: "local",
      storagePath: null, uploadStatus: "skipped", verifyStatus: "skipped", createdBy,
      notes: "Storage não configurado — apenas local",
    });
    return { sha256, sizeBytes, localStatus: "ok", uploadStatus: "skipped", verifyStatus: "skipped", externalStatus: "not-configured", storagePath: null, storageProvider: "local" };
  }

  if (!await dependencies.ensureBucket()) {
    await dependencies.recordHistory({
      filename, sizeBytes, sha256, storageProvider: "local",
      storagePath: null, uploadStatus: "failed", verifyStatus: "skipped", createdBy,
      notes: "Bucket ausente, inacessível ou não confirmado como privado",
    });
    return { sha256, sizeBytes, localStatus: "ok", uploadStatus: "failed", verifyStatus: "skipped", externalStatus: "failed", storagePath: null, storageProvider: "local" };
  }

  const dateFolder = new Date().toISOString().slice(0, 10);
  const storagePath = `${dateFolder}/${filename}`;

  let uploadStatus: BackupStoragePipelineResult["uploadStatus"] = "failed";
  let verifyStatus: BackupStoragePipelineResult["verifyStatus"] = "skipped";

  let uploadResult: { ok: boolean; error?: string };
  try {
    uploadResult = await dependencies.upload(filepath, storagePath);
  } catch (e: any) {
    uploadResult = { ok: false, error: e?.message ?? "upload-threw" };
  }
  if (!uploadResult.ok) {
    uploadStatus = "failed";
    verifyStatus = "skipped";
    console.error("[BACKUP_FAILED]", { step: "upload", filename, storagePath, error: uploadResult.error, ts: new Date().toISOString() });
    await dependencies.recordHistory({
      filename, sizeBytes, sha256, storageProvider: "supabase",
      storagePath, uploadStatus, verifyStatus, createdBy,
      notes: `Upload failed: ${uploadResult.error}`,
    });
    return { sha256, sizeBytes, localStatus: "ok", uploadStatus, verifyStatus, externalStatus: "failed", storagePath: null, storageProvider: "local" };
  }

  uploadStatus = "ok";
  console.info("[BACKUP_UPLOAD_OK]", { filename, storagePath, bucket: BUCKET, ts: new Date().toISOString() });

  let verifyResult: { ok: boolean; error?: string };
  try {
    verifyResult = await dependencies.verify(storagePath, sha256);
  } catch (e: any) {
    verifyResult = { ok: false, error: e?.message ?? "verify-threw" };
  }
  if (!verifyResult.ok) {
    verifyStatus = "failed";
    console.error("[BACKUP_FAILED]", { step: "verify", filename, storagePath, error: verifyResult.error, ts: new Date().toISOString() });
    await dependencies.recordHistory({
      filename, sizeBytes, sha256, storageProvider: "supabase",
      storagePath, uploadStatus, verifyStatus, createdBy,
      notes: `Verify failed: ${verifyResult.error}`,
    });
    return { sha256, sizeBytes, localStatus: "ok", uploadStatus, verifyStatus, externalStatus: "failed", storagePath, storageProvider: "supabase" };
  }

  verifyStatus = "ok";
  console.info("[BACKUP_INTEGRITY_EXTERNAL_OK]", { filename, storagePath, ts: new Date().toISOString(), restoreTested: false });

  await dependencies.recordHistory({
    filename, sizeBytes, sha256, storageProvider: "supabase",
    storagePath, uploadStatus, verifyStatus, createdBy,
    notes: undefined,
  });

  return { sha256, sizeBytes, localStatus: "ok", uploadStatus, verifyStatus, externalStatus: "verified", storagePath, storageProvider: "supabase" };
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
