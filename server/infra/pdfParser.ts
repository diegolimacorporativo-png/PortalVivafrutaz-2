import { createRequire } from "module";

// In the production CJS bundle, `require` exists natively. In dev (tsx/ESM)
// it does not, so we fall back to createRequire anchored at package.json.
// We deliberately avoid `import.meta.url` here because esbuild emits it as
// `undefined` in the CJS output, which crashes `fileURLToPath` at startup.
const _require: NodeRequire = (typeof (globalThis as any).require !== "undefined")
  ? (globalThis as any).require
  : createRequire(process.cwd() + "/package.json");

const pdfParse = _require("pdf-parse");

export async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages: number; info: any }> {
  return pdfParse(buffer);
}
