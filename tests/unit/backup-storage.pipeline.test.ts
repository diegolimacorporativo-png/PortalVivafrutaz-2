import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
process.env.NODE_ENV = "development";
process.env.ISOLATED_PREVIEW_MODE = "1";
process.env.ISOLATED_PREVIEW_DATABASE_URL = "postgresql://preview@127.0.0.1:55439/vivafrutaz_preview";

const {
  runBackupStoragePipeline,
  ensureStorageBucket,
  getExternallyVerifiedBackupFilenames,
} = await import("../../server/backup-storage.service");
type BackupStoragePipelineDependencies = import("../../server/backup-storage.service").BackupStoragePipelineDependencies;
type BackupRotationDependencies = import("../../server/backup-storage.service").BackupRotationDependencies;

const tempDirectories: string[] = [];

function setup(dependencies: Partial<BackupStoragePipelineDependencies> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "vivafrutaz-backup-pipeline-"));
  tempDirectories.push(directory);
  const filepath = path.join(directory, "backup.json");
  writeFileSync(filepath, '{"synthetic":true}', "utf8");
  const history: unknown[] = [];
  const defaults: BackupStoragePipelineDependencies = {
    isStorageAvailable: () => true,
    ensureBucket: async () => true,
    hashFile: file => createHash("sha256").update(readFileSync(file)).digest("hex"),
    upload: async () => ({ ok: true }),
    verify: async () => ({ ok: true }),
    recordHistory: async record => { history.push(record); },
    stat: statSync,
  };
  return { filepath, history, dependencies: { ...defaults, ...dependencies } };
}

after(() => {
  for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});

test("awaits successful upload and integrity check before reporting external copy", async () => {
  const calls: string[] = [];
  const { filepath, history, dependencies } = setup({
    upload: async () => { await new Promise(resolve => setTimeout(resolve, 5)); calls.push("upload"); return { ok: true }; },
    verify: async () => { calls.push("verify"); return { ok: true }; },
  });

  const result = await runBackupStoragePipeline(filepath, "backup.json", "unit-test", dependencies);

  assert.deepEqual(calls, ["upload", "verify"]);
  assert.equal(result.localStatus, "ok");
  assert.equal(result.uploadStatus, "ok");
  assert.equal(result.verifyStatus, "ok");
  assert.equal(result.externalStatus, "verified");
  assert.equal(history.length, 1);
});

test("retains local backup and does not claim external copy when upload fails", async () => {
  let verificationCalled = false;
  const { filepath, dependencies } = setup({
    upload: async () => ({ ok: false, error: "synthetic failure" }),
    verify: async () => { verificationCalled = true; return { ok: true }; },
  });

  const result = await runBackupStoragePipeline(filepath, "backup.json", "unit-test", dependencies);

  assert.equal(result.localStatus, "ok");
  assert.equal(result.uploadStatus, "failed");
  assert.equal(result.verifyStatus, "skipped");
  assert.equal(result.externalStatus, "failed");
  assert.equal(verificationCalled, false);
});

test("records upload separately from a failed integrity check", async () => {
  const { filepath, history, dependencies } = setup({
    upload: async () => ({ ok: true }),
    verify: async () => ({ ok: false, error: "synthetic mismatch" }),
  });

  const result = await runBackupStoragePipeline(filepath, "backup.json", "unit-test", dependencies);

  assert.equal(result.localStatus, "ok");
  assert.equal(result.uploadStatus, "ok");
  assert.equal(result.verifyStatus, "failed");
  assert.equal(result.externalStatus, "failed");
  assert.equal(history.length, 1);
});

test("does not claim an external copy when storage is not configured", async () => {
  let uploadCalled = false;
  const { filepath, dependencies } = setup({
    isStorageAvailable: () => false,
    upload: async () => { uploadCalled = true; return { ok: true }; },
  });

  const result = await runBackupStoragePipeline(filepath, "backup.json", "unit-test", dependencies);

  assert.equal(result.localStatus, "ok");
  assert.equal(result.uploadStatus, "skipped");
  assert.equal(result.externalStatus, "not-configured");
  assert.equal(result.storagePath, null);
  assert.equal(uploadCalled, false);
});

test("does not upload when a newly created bucket cannot be confirmed private", async () => {
  let listCount = 0;
  let createCount = 0;
  const client = { storage: {
    listBuckets: async () => {
      listCount++;
      return { data: listCount === 1 ? [] : [{ name: "erp-backups", public: true }], error: null };
    },
    createBucket: async () => { createCount++; return { error: null }; },
  } };
  const bucketIsSafe = await ensureStorageBucket(client);
  assert.equal(bucketIsSafe, false);
  assert.equal(listCount, 2);
  assert.equal(createCount, 1);

  let uploadCalled = false;
  const { filepath, dependencies } = setup({
    ensureBucket: async () => bucketIsSafe,
    upload: async () => { uploadCalled = true; return { ok: true }; },
  });
  const result = await runBackupStoragePipeline(filepath, "backup.json", "unit-test", dependencies);
  assert.equal(result.uploadStatus, "failed");
  assert.equal(result.externalStatus, "failed");
  assert.equal(uploadCalled, false);
});

function rotationFixture(filepath: string, overrides: Partial<BackupRotationDependencies> = {}) {
  const sha256 = createHash("sha256").update(readFileSync(filepath)).digest("hex");
  const dependencies: BackupRotationDependencies = {
    lookupHistory: async filenames => filenames.map(filename => ({
      filename,
      storageProvider: "supabase",
      storagePath: `synthetic/${filename}`,
      uploadStatus: "ok",
      verifyStatus: "ok",
      retentionUntil: new Date(Date.now() + 60_000),
      sha256,
    })),
    hashFile: file => createHash("sha256").update(readFileSync(file)).digest("hex"),
    verifyRemote: async () => ({ ok: true }),
    ...overrides,
  };
  return { sha256, dependencies };
}

test("rotation confirms remote existence and matching content before approving deletion", async () => {
  const { filepath } = setup();
  const { dependencies } = rotationFixture(filepath);
  const verified = await getExternallyVerifiedBackupFilenames(
    [{ filename: "backup.json", filepath }], dependencies,
  );
  assert.deepEqual([...verified], ["backup.json"]);
});

test("rotation preserves local copy when the remote object is absent", async () => {
  const { filepath } = setup();
  const { dependencies } = rotationFixture(filepath, { verifyRemote: async () => ({ ok: false, error: "not found" }) });
  const verified = await getExternallyVerifiedBackupFilenames(
    [{ filename: "backup.json", filepath }], dependencies,
  );
  assert.equal(verified.has("backup.json"), false);
});

test("rotation preserves local copy when remote lookup or verification fails", async () => {
  const { filepath } = setup();
  const lookupFailure = rotationFixture(filepath, { lookupHistory: async () => { throw new Error("query failed"); } });
  const lookupResult = await getExternallyVerifiedBackupFilenames(
    [{ filename: "backup.json", filepath }], lookupFailure.dependencies,
  );
  assert.equal(lookupResult.has("backup.json"), false);

  const verifyFailure = rotationFixture(filepath, { verifyRemote: async () => { throw new Error("download failed"); } });
  const verifyResult = await getExternallyVerifiedBackupFilenames(
    [{ filename: "backup.json", filepath }], verifyFailure.dependencies,
  );
  assert.equal(verifyResult.has("backup.json"), false);
});

test("concurrent backup requests are serialized and filenames remain unique in the same second", async () => {
  const { runBackupExclusively, createBackupFilename } = await import("../../server/backup");
  const sameTime = new Date("2026-10-23T12:34:56.000Z");
  assert.notEqual(createBackupFilename(sameTime, "json"), createBackupFilename(sameTime, "json"));

  let active = 0;
  let maximumActive = 0;
  await Promise.all([1, 2].map(() => runBackupExclusively(async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
  })));
  assert.equal(maximumActive, 1);
});

test("backup lock is released after a failed operation", async () => {
  const { runBackupExclusively } = await import("../../server/backup");
  await assert.rejects(runBackupExclusively(async () => { throw new Error("synthetic failure"); }));
  let ranAfterFailure = false;
  await runBackupExclusively(async () => { ranAfterFailure = true; });
  assert.equal(ranAfterFailure, true);
});
