/**
 * FASE 1.8 — Validação XSD LOCAL NF-e 4.00
 *
 * Valida o XML assinado contra os XSD oficiais da SEFAZ ANTES da transmissão.
 * Detecta erros de schema localmente, evitando usar o SEFAZ como validador.
 *
 * Biblioteca: libxmljs2 (Node.js binding para libxml2)
 * XSDs: server/services/nfe/xsd/ (baixados do sped-nfe oficial)
 *   - leiauteNFe_v4.00.xsd  (328KB — schema principal NF-e)
 *   - tiposBasico_v4.00.xsd (22KB  — tipos básicos)
 *   - enviNFe_v4.00.xsd     (600B  — envelope enviNFe)
 *   - xmldsig-core-schema_v1.01.xsd (3.7KB — assinatura digital)
 *
 * Estratégia de imports:
 *   libxml2 requer que schemaLocation referências sejam absolutas para
 *   resolução correta de xs:include/xs:import. Na inicialização, copia
 *   os XSD para /tmp/nfe-xsd-patched/ com paths absolutos file://.
 *
 * Artifacts de debug: /tmp/nfe-debug/
 *   signed-nfe.xml, xsd-errors.json, soap-request.xml, soap-response.xml
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// ESM-compatible __dirname and require
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const XSD_DIR = path.resolve(__dirname, 'xsd');
const PATCHED_DIR = '/tmp/nfe-xsd-patched';
const DEBUG_DIR = '/tmp/nfe-debug';

const XSD_FILES = [
  'tiposBasico_v4.00.xsd',
  'xmldsig-core-schema_v1.01.xsd',
  'leiauteNFe_v4.00.xsd',
  'enviNFe_v4.00.xsd',
];

export interface XsdError {
  message: string;
  line?: number;
  column?: number;
  level?: string;
  domain?: string;
}

export interface XsdValidationResult {
  valid: boolean;
  errors: XsdError[];
  durationMs?: number;
}

// Cache do documento XSD — inicializado uma vez
let _xsdDocCache: any = null;
let _xsdInitError: string | null = null;

/** Returns true once warmupXsdCache() has run successfully. */
export function isXsdReady(): boolean {
  return _xsdDocCache !== null && _xsdInitError === null;
}

/**
 * Copia os XSD para /tmp com schemaLocation em paths absolutos (file://).
 * libxml2 não consegue resolver imports relativos sem o url base funcionar;
 * a solução é gravar cópias com referências absolutas e carregar de lá.
 */
function initPatchedXsds(): boolean {
  try {
    fs.mkdirSync(PATCHED_DIR, { recursive: true });

    for (const fname of XSD_FILES) {
      const src = path.join(XSD_DIR, fname);
      const dst = path.join(PATCHED_DIR, fname);
      if (!fs.existsSync(src)) {
        console.warn(`[NFE_XSD_MISSING_FILE] ${src}`);
        continue;
      }
      let content = fs.readFileSync(src, 'utf-8');
      // Substituir referências relativas *.xsd por caminhos absolutos file://
      content = content.replace(/schemaLocation="([^"]+\.xsd)"/g, (_match, rel) => {
        const base = path.basename(rel);
        return `schemaLocation="file://${PATCHED_DIR}/${base}"`;
      });
      fs.writeFileSync(dst, content, 'utf-8');
    }

    console.info('[NFE_XSD_PATCHED]', { dir: PATCHED_DIR, files: XSD_FILES });
    return true;
  } catch (err: any) {
    console.error('[NFE_XSD_PATCH_FAIL]', err?.message);
    return false;
  }
}

function loadXsdDoc(): any {
  if (_xsdDocCache) return _xsdDocCache;
  if (_xsdInitError) throw new Error(_xsdInitError);

  const patchedEnviPath = path.join(PATCHED_DIR, 'enviNFe_v4.00.xsd');

  // Reparchar se o diretório não existe ou o arquivo foi removido
  if (!fs.existsSync(patchedEnviPath)) {
    const ok = initPatchedXsds();
    if (!ok || !fs.existsSync(patchedEnviPath)) {
      _xsdInitError = 'NFE_XSD_INIT_FAILED: arquivos XSD não encontrados em ' + PATCHED_DIR;
      throw new Error(_xsdInitError);
    }
  }

  const libxml = require('libxmljs2');
  const xsdContent = fs.readFileSync(patchedEnviPath, 'utf-8');
  _xsdDocCache = libxml.parseXml(xsdContent);

  console.info('[NFE_XSD_LOADED]', {
    schema: 'enviNFe_v4.00.xsd',
    root: _xsdDocCache.root()?.name(),
    path: patchedEnviPath,
  });

  return _xsdDocCache;
}

/**
 * Constrói o XML <enviNFe> para validação — o SEFAZ valida este envelope,
 * não o <NFe> isolado. Remove a declaração XML do nfeXml antes de embedar.
 */
function wrapInEnviNFe(nfeXml: string): string {
  const nfeBody = nfeXml.replace(/^<\?xml[^?]*\?>\s*/i, '');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">' +
    '<idLote>1</idLote>' +
    '<indSinc>1</indSinc>' +
    nfeBody +
    '</enviNFe>'
  );
}

/**
 * Valida o XML NF-e assinado contra o schema oficial NF-e 4.00 (enviNFe).
 *
 * @param xmlAssinado  XML assinado (com <?xml...?> e <NFe>)
 * @returns { valid, errors[] } — errors com message, line, column
 */
export function validateNFeSchema(xmlAssinado: string): XsdValidationResult {
  const t0 = Date.now();

  try {
    const libxml = require('libxmljs2');
    const xsdDoc = loadXsdDoc();

    const xmlParaValidar = wrapInEnviNFe(xmlAssinado);

    let xmlDoc: any;
    try {
      xmlDoc = libxml.parseXml(xmlParaValidar);
    } catch (parseErr: any) {
      return {
        valid: false,
        durationMs: Date.now() - t0,
        errors: [
          {
            message: `PARSE_ERROR: ${parseErr?.message ?? String(parseErr)}`,
            line: parseErr?.line,
            column: parseErr?.column,
          },
        ],
      };
    }

    const isValid: boolean = xmlDoc.validate(xsdDoc);
    const rawErrors: any[] = xmlDoc.validationErrors ?? [];

    const errors: XsdError[] = rawErrors.map((e: any) => ({
      message: typeof e.message === 'string' ? e.message.trim() : String(e),
      line: typeof e.line === 'number' ? e.line : undefined,
      column: typeof e.column === 'number' ? e.column : undefined,
      level: e.level,
      domain: e.domain,
    }));

    return { valid: isValid, errors, durationMs: Date.now() - t0 };
  } catch (err: any) {
    return {
      valid: false,
      durationMs: Date.now() - t0,
      errors: [
        {
          message: `VALIDATOR_ERROR: ${err?.message ?? String(err)}`,
        },
      ],
    };
  }
}

/**
 * Salva artifacts de debug em /tmp/nfe-debug/.
 * Nunca lança exceção — falha silenciosa (best-effort).
 * IMPORTANTE: nunca salvar senha do certificado.
 */
export async function saveNFeDebugArtifacts(artifacts: {
  signedXml?: string;
  soapRequest?: string;
  soapResponse?: string;
  xsdResult?: XsdValidationResult;
}): Promise<void> {
  try {
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });

    const writes: Promise<void>[] = [];

    if (artifacts.signedXml) {
      writes.push(
        fs.promises
          .writeFile(path.join(DEBUG_DIR, 'signed-nfe.xml'), artifacts.signedXml, 'utf-8')
          .catch(() => {}),
      );
    }
    if (artifacts.soapRequest) {
      writes.push(
        fs.promises
          .writeFile(path.join(DEBUG_DIR, 'soap-request.xml'), artifacts.soapRequest, 'utf-8')
          .catch(() => {}),
      );
    }
    if (artifacts.soapResponse) {
      const raw =
        typeof artifacts.soapResponse === 'string'
          ? artifacts.soapResponse
          : JSON.stringify(artifacts.soapResponse);
      writes.push(
        fs.promises
          .writeFile(path.join(DEBUG_DIR, 'soap-response.xml'), raw, 'utf-8')
          .catch(() => {}),
      );
    }
    if (artifacts.xsdResult) {
      writes.push(
        fs.promises
          .writeFile(
            path.join(DEBUG_DIR, 'xsd-errors.json'),
            JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                valid: artifacts.xsdResult.valid,
                errorCount: artifacts.xsdResult.errors.length,
                durationMs: artifacts.xsdResult.durationMs,
                errors: artifacts.xsdResult.errors,
              },
              null,
              2,
            ),
            'utf-8',
          )
          .catch(() => {}),
      );
    }

    await Promise.all(writes);
  } catch {
    // Silencioso — nunca bloquear o fluxo fiscal por falha de artifact
  }
}

/**
 * Extrai trecho do XML nas linhas próximas ao erro XSD reportado.
 */
export function extractXmlSnippet(
  xml: string,
  line: number | undefined,
  contextLines = 3,
): string | undefined {
  if (!line || line < 1) return undefined;
  const lines = xml.split('\n');
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines
    .slice(start, end)
    .map((l, i) => `${start + i + 1}: ${l}`)
    .join('\n');
}

/**
 * Pré-aquece o cache do XSD na inicialização.
 * Chamado no boot do servidor para evitar latência na primeira emissão.
 */
export function warmupXsdCache(): void {
  try {
    initPatchedXsds();
    loadXsdDoc();
    console.info('[NFE_XSD_WARMUP_OK]');
  } catch (err: any) {
    console.warn('[NFE_XSD_WARMUP_FAIL]', err?.message);
  }
}
