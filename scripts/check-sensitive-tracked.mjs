import { execFileSync } from "node:child_process";

const eventPath = process.env.GITHUB_EVENT_PATH;
let baseSha = "";
if (eventPath) {
  try {
    const event = JSON.parse((await import("node:fs")).readFileSync(eventPath, "utf8"));
    baseSha = event.pull_request?.base?.sha ?? event.before ?? "";
  } catch {
    // Fall back to the parent commit for manually triggered local/CI runs.
  }
}
if (!baseSha || /^0+$/.test(baseSha)) {
  try { baseSha = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim(); }
  catch { console.error("Sensitive-file check needs a Git base commit."); process.exit(2); }
}

const pathsFromGit = args => execFileSync("git", args, { encoding: "buffer" })
  .toString("utf8").split("\0").filter(Boolean);
const changed = new Set([
  ...pathsFromGit(["diff", "--name-only", "-z", `${baseSha}...HEAD`]),
  ...pathsFromGit(["diff", "--name-only", "-z", "HEAD"]),
  ...pathsFromGit(["ls-files", "--others", "--exclude-standard", "-z"]),
]);
const sensitive = /(^|\/)(?:backups?\/.*\.(?:json|sql)|uploads\/(?!products\/).*|tests?\/(?:videos?|test-results|playwright-report|reports)\/.*|(?:\.env(?:\.[^/]+)?|id_(?:rsa|ed25519).*|[^/]+\.(?:pfx|p12|p7b|jks|keystore|key|pem|p8|trace(?:\.zip)?|webm|secrets?(?:\.[^/]+)?|local(?:\.[^/]+)?)))$/i;
const isExampleConfig = path => /(^|\/)\.env(?:\.[^/]+)?\.example$/i.test(path);
const isSyntheticFixture = path => /^tests\/fixtures\//i.test(path);
const findings = [...changed].filter(path => !isExampleConfig(path) && !isSyntheticFixture(path) && sensitive.test(path));

if (findings.length) {
  console.error(`Blocked ${findings.length} changed path(s) matching sensitive or generated-file rules:`);
  for (const path of findings) console.error(` - ${path}`);
  process.exit(1);
}
console.log("No newly changed paths match the sensitive/generated-file rules.");
