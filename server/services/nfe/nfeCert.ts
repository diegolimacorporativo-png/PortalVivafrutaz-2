/**
 * FASE 3 — Loader do Certificado A1 (PFX) a partir de variáveis de ambiente.
 *
 * Estratégia de leitura (em ordem de precedência):
 *   1. NFE_CERT_PATH      — caminho de arquivo .pfx no disco (ex.: /certs/cert.pfx)
 *   2. NFE_CERT_BASE64    — conteúdo do .pfx codificado em base64 (útil em
 *                            ambientes serverless / Replit Secrets onde não há
 *                            volume montado).
 *   3. CERT_PATH          — alias legado (compat com .env.example anterior).
 *
 * A senha vem de NFE_CERT_PASSWORD (ou CERT_PASSWORD como fallback).
 *
 * Retorna o PFX bruto + senha (para HTTPS mTLS via Node `https.Agent`) e
 * também o par PEM (cert público + chave privada) já convertido — usado tanto
 * pelo `https.Agent` quanto pela assinatura do XML em `nfeSignature.ts`.
 *
 * Não chama SEFAZ. Não altera contratos. Apenas materializa o certificado.
 */

import fs from 'fs';
import * as forge from 'node-forge';

export interface CertificadoBundle {
  /** PFX bruto (Buffer). Pode ser passado direto a `https.Agent({ pfx, passphrase })`. */
  pfx: Buffer;
  /** Senha do PFX. */
  passphrase: string;
  /** Certificado público em formato PEM (X.509). */
  certPem: string;
  /** Chave privada em formato PEM (PKCS#8). */
  keyPem: string;
  /** Origem da configuração — útil para logs sem vazar segredo. */
  source: 'NFE_CERT_PATH' | 'NFE_CERT_BASE64' | 'CERT_PATH';
}

/**
 * Lê o PFX de uma das variáveis de ambiente suportadas e converte para PEM.
 * Lança erro descritivo (sem expor a senha) se a configuração for inválida.
 */
export function getCertificado(): CertificadoBundle {
  const passphrase =
    process.env.NFE_CERT_PASSWORD ?? process.env.CERT_PASSWORD ?? '';
  if (!passphrase) {
    throw new Error(
      'NFE_CERT_PASSWORD não configurada (defina nas Secrets do Replit antes de NFE_SEFAZ_MODE=production).',
    );
  }

  const nfePath = process.env.NFE_CERT_PATH;
  const nfeBase64 = process.env.NFE_CERT_BASE64;
  const legacyPath = process.env.CERT_PATH;

  let pfx: Buffer;
  let source: CertificadoBundle['source'];
  if (nfePath && fs.existsSync(nfePath)) {
    pfx = fs.readFileSync(nfePath);
    source = 'NFE_CERT_PATH';
  } else if (nfeBase64) {
    pfx = Buffer.from(nfeBase64, 'base64');
    source = 'NFE_CERT_BASE64';
  } else if (legacyPath && fs.existsSync(legacyPath)) {
    pfx = fs.readFileSync(legacyPath);
    source = 'CERT_PATH';
  } else {
    throw new Error(
      'Certificado A1 não encontrado. Defina NFE_CERT_PATH (arquivo .pfx) ou NFE_CERT_BASE64 (conteúdo em base64).',
    );
  }

  const { certPem, keyPem } = pfxParaPem(pfx, passphrase);
  return { pfx, passphrase, certPem, keyPem, source };
}

/**
 * Converte um PFX (PKCS#12) em par PEM (cert + chave privada) usando node-forge.
 * Mesma lógica do `loadPfx` interno do `nfeSignature.ts`, isolada aqui para
 * permitir uso direto pelo loader de transmissão (HTTPS mTLS) sem acoplar à
 * camada de assinatura.
 */
function pfxParaPem(pfx: Buffer, passphrase: string): { certPem: string; keyPem: string } {
  const pfxDer = forge.util.decode64(pfx.toString('base64'));
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, passphrase);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? [];

  const cert = certBags[0]?.cert;
  const privateKey = keyBags[0]?.key;
  if (!cert || !privateKey) {
    throw new Error('PFX inválido ou senha incorreta — não foi possível extrair certificado/chave.');
  }

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(privateKey),
  };
}

/**
 * Verifica se o ambiente está configurado para produção SEFAZ real.
 * Usado pelo sender para decidir se carrega o cert do env automaticamente.
 */
export function certConfiguradoNoEnv(): boolean {
  const path = process.env.NFE_CERT_PATH ?? process.env.CERT_PATH;
  const b64 = process.env.NFE_CERT_BASE64;
  const senha = process.env.NFE_CERT_PASSWORD ?? process.env.CERT_PASSWORD;
  if (!senha) return false;
  if (path && fs.existsSync(path)) return true;
  if (b64 && b64.length > 0) return true;
  return false;
}
