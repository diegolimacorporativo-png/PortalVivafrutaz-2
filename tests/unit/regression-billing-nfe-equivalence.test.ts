/**
 * This database-writing regression is intentionally excluded from the default
 * unit suite. It loads only in the explicitly started local disposable mode;
 * the regression module then proves the SQL server identity before writes.
 */
import test from "node:test";

if (
  process.env.ISOLATED_PREVIEW_MODE === "1" &&
  process.env.NODE_ENV === "development"
) {
  await import("../regression/billing-nfe-equivalence.test");
} else {
  test("billing/NF-e database regression is skipped outside isolated local preview", {
    skip: "This regression writes synthetic fixtures; use the marked disposable local PostgreSQL only.",
  }, () => {});
}
