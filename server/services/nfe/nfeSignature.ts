import * as forge from 'node-forge';
import * as SignedXml from 'xml-crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CertificadoInfo {
  cnpj: string;
  razaoSocial: string;
  validadeInicio: Date;
  validadeFim: Date;
}

export interface AssinaturaResult {
  xmlAssinado: string;
  certInfo: CertificadoInfo;
}

function loadPfx(pfxPath: string, senha: string): { pem: string; certPem: string; info: CertificadoInfo } {
  const pfxBuffer = fs.existsSync(pfxPath)
    ? fs.readFileSync(pfxPath)
    : Buffer.from(pfxPath, 'base64');

  const pfxDer = forge.util.decode64(pfxBuffer.toString('base64'));
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha);

  const bags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const certBags = bags[forge.pki.oids.certBag] || [];
  const keyBags = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0];

  if (!certBags.length || !keyBag) throw new Error('Certificado PFX inválido ou senha incorreta');

  const cert = certBags[0].cert!;
  const privateKey = keyBag.key!;

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(privateKey);

  // Extract CNPJ from Subject Alternative Name or Subject
  const cn = cert.subject.getField('CN')?.value || '';
  const cnpjMatch = cn.match(/\d{14}/);
  const cnpj = cnpjMatch ? cnpjMatch[0] : '';
  const razaoSocial = cn.split(':')[0]?.trim() || cn;

  return {
    pem: keyPem,
    certPem,
    info: {
      cnpj,
      razaoSocial,
      validadeInicio: cert.validity.notBefore,
      validadeFim: cert.validity.notAfter,
    },
  };
}

export async function assinarXML(xml: string, pfxPathOrBase64: string, senha: string): Promise<AssinaturaResult> {
  const { pem, certPem, info } = loadPfx(pfxPathOrBase64, senha);

  // Remove PEM headers for xml-crypto
  const certDer = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\n/g, '');

  const sig = new (SignedXml as any).SignedXml({
    privateKey: pem,
    publicCert: certPem,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });

  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certDer}</X509Certificate></X509Data>`,
    getKey: () => Buffer.from(pem),
  };

  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infNFe']", action: 'append' } });
  const xmlAssinado = sig.getSignedXml();

  return { xmlAssinado, certInfo: info };
}

export function validarCertificado(pfxPathOrBase64: string, senha: string): { valido: boolean; info?: CertificadoInfo; erro?: string } {
  try {
    const { info } = loadPfx(pfxPathOrBase64, senha);
    const agora = new Date();
    if (agora > info.validadeFim) return { valido: false, info, erro: 'Certificado vencido' };
    if (agora < info.validadeInicio) return { valido: false, info, erro: 'Certificado ainda não válido' };
    return { valido: true, info };
  } catch (e: any) {
    return { valido: false, erro: e.message };
  }
}

export function getCertPathFromEnv(): { path?: string; senha?: string } {
  return {
    path: process.env.CERT_PATH,
    senha: process.env.CERT_PASSWORD,
  };
}

/**
 * T1102/T1103 — Assina XML de evento SEFAZ (cancelamento ou CC-e).
 * Idêntico a assinarXML mas referencia `infEvento` em vez de `infNFe`.
 * O padrão de assinatura segue a NT 2011/004 do Manual de Integração NF-e 4.0.
 */
export async function assinarEvento(xml: string, pfxPathOrBase64: string, senha: string): Promise<AssinaturaResult> {
  const { pem, certPem, info } = loadPfx(pfxPathOrBase64, senha);

  const certDer = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\n/g, '');

  const sig = new (SignedXml as any).SignedXml({
    privateKey: pem,
    publicCert: certPem,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });

  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certDer}</X509Certificate></X509Data>`,
    getKey: () => Buffer.from(pem),
  };

  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infEvento']", action: 'append' } });
  const xmlAssinado = sig.getSignedXml();

  return { xmlAssinado, certInfo: info };
}
