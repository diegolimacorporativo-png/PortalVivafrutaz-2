/**
 * HOMOLOGATION GUARD — Proteção centralizada contra produção fiscal acidental.
 *
 * Três camadas de proteção:
 *  1. assertFiscalBootSafe()      — chamado no boot, falha antes de iniciar
 *  2. validateFiscalHomologationLock() — chamado em cada transmissão/build
 *  3. startFiscalRuntimeMonitor() — verifica periodicamente em runtime
 *
 * REGRA ABSOLUTA:
 *  tpAmb=1, ambienteFiscal=producao ou NFE_SEFAZ_MODE=production
 *  → log crítico + throw fatal → ZERO transmissão real ao SEFAZ.
 */

const _pid = process.pid;
const _ts = () => new Date().toISOString();

// ─── 1. BOOT CHECK ────────────────────────────────────────────────────────────

export function assertFiscalBootSafe(): void {
  const mode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
  const env = process.env.NODE_ENV ?? 'development';

  if (mode === 'production') {
    console.error('[FISCAL_PRODUCTION_BLOCKED]', {
      reason: 'NFE_SEFAZ_MODE=production detectado no boot — sistema bloqueado',
      NFE_SEFAZ_MODE: mode,
      action: 'Defina NFE_SEFAZ_MODE=homologacao ou mock para iniciar',
      env,
      pid: _pid,
      ts: _ts(),
    });
    console.error('[BOOT_VALIDATION_FAIL]', {
      fails: ['NFE_SEFAZ_MODE=production é proibido neste ambiente'],
      env,
      pid: _pid,
      ts: _ts(),
    });
    process.exit(1);
  }

  console.log('[FISCAL_HOMOLOGATION_LOCK]', {
    NFE_SEFAZ_MODE: mode,
    status: 'HOMOLOGACAO_ATIVA',
    tpAmb: '2',
    env,
    pid: _pid,
    ts: _ts(),
  });

  console.log('[FISCAL_ENV_VALIDATED]', {
    mode,
    producaoFiscal: false,
    env,
    pid: _pid,
    ts: _ts(),
  });
}

// ─── 2. RUNTIME GUARD ─────────────────────────────────────────────────────────

export function validateFiscalHomologationLock(
  tpAmb: string | undefined,
  ambienteFiscal?: string | undefined,
  source?: string,
): void {
  const blocked =
    tpAmb === '1' ||
    ambienteFiscal === 'producao' ||
    (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase() === 'production';

  if (!blocked) {
    console.log('[FISCAL_ENV_VALIDATED]', {
      tpAmb,
      ambienteFiscal: ambienteFiscal ?? 'n/a',
      mode: process.env.NFE_SEFAZ_MODE ?? 'mock',
      source: source ?? 'unknown',
      ts: _ts(),
    });
    return;
  }

  const reason =
    tpAmb === '1'
      ? `tpAmb=1 (produção SEFAZ) bloqueado`
      : ambienteFiscal === 'producao'
        ? `ambienteFiscal=producao bloqueado`
        : `NFE_SEFAZ_MODE=production bloqueado`;

  console.error('[FISCAL_PRODUCTION_BLOCKED]', {
    reason,
    tpAmb,
    ambienteFiscal: ambienteFiscal ?? 'n/a',
    NFE_SEFAZ_MODE: process.env.NFE_SEFAZ_MODE ?? 'mock',
    source: source ?? 'unknown',
    pid: _pid,
    ts: _ts(),
  });

  throw new Error(
    `[FISCAL_PRODUCTION_BLOCKED] ${reason}. Toda NF-e deve permanecer em HOMOLOGAÇÃO (tpAmb=2). Fonte: ${source ?? 'unknown'}`,
  );
}

// ─── 3. RUNTIME MONITOR ───────────────────────────────────────────────────────

let _monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startFiscalRuntimeMonitor(intervalMs = 300_000): void {
  if (_monitorInterval) return;

  _monitorInterval = setInterval(() => {
    const mode = (process.env.NFE_SEFAZ_MODE ?? 'mock').toLowerCase();
    const isProducao = mode === 'production';

    if (isProducao) {
      console.error('[FISCAL_RUNTIME_ALERT]', {
        reason: 'NFE_SEFAZ_MODE mudou para production em runtime — ALERTA CRÍTICO',
        NFE_SEFAZ_MODE: mode,
        pid: _pid,
        ts: _ts(),
      });
    } else {
      console.log('[FISCAL_RUNTIME_CHECK]', {
        NFE_SEFAZ_MODE: mode,
        tpAmbDefault: '2',
        producaoAtiva: false,
        pid: _pid,
        ts: _ts(),
      });
      console.log('[FISCAL_RUNTIME_OK]', {
        status: 'HOMOLOGACAO_ATIVA',
        pid: _pid,
        ts: _ts(),
      });
    }
  }, intervalMs);

  _monitorInterval.unref();
  console.log('[FISCAL_RUNTIME_MONITOR_START]', {
    intervalMs,
    pid: _pid,
    ts: _ts(),
  });
}
