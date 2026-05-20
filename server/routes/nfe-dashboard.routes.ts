/**
 * NF-e Dashboard — READ ONLY operacional
 *
 * GET /api/admin/nfe/metrics        — métricas agregadas
 * GET /api/admin/nfe/timeline       — últimos 100 eventos
 * GET /api/admin/nfe/recent-errors  — últimos 20 erros/rejeições
 *
 * PROIBIDO: qualquer escrita em nfe_emissoes ou estado fiscal.
 * tpAmb=2 apenas. SEM VALOR FISCAL.
 *
 * Roles: MASTER / ADMIN / DEVELOPER
 */
import { Express } from 'express';
import { pool } from '../database/db';
import { requireAuth as requireAuthCore, requireRole } from '../core/http/requireAuth';

const LOG = (label: string, data?: any) =>
  console.log(JSON.stringify({ label, ts: new Date().toISOString(), ...(data ?? {}) }));

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const ROLES = ['MASTER', 'ADMIN', 'DEVELOPER'] as const;

export function register(app: Express) {

  // ── GET /api/admin/nfe/metrics ─────────────────────────────────────────────
  app.get(
    '/api/admin/nfe/metrics',
    requireAuthCore,
    requireRole([...ROLES]),
    async (req, res, next) => {
      const corrId = uid();
      try {
        const { rows } = await pool.query<{
          total_emitidas: string;
          total_autorizadas: string;
          total_rejeitadas: string;
          total_em_processamento: string;
          total_erro: string;
          taxa_autorizacao: string;
          tempo_medio_sefaz_ms: string | null;
          ultima_autorizada: string | null;
          ultima_rejeitada: string | null;
        }>(`
          SELECT
            COUNT(*)::text                                                    AS total_emitidas,
            COUNT(*) FILTER (WHERE status = 'autorizada')::text              AS total_autorizadas,
            COUNT(*) FILTER (WHERE status = 'rejeitada')::text               AS total_rejeitadas,
            COUNT(*) FILTER (WHERE status IN ('gerada','assinada','enviando','enviada'))::text
                                                                              AS total_em_processamento,
            COUNT(*) FILTER (WHERE status = 'erro')::text                   AS total_erro,
            ROUND(
              CASE WHEN COUNT(*) > 0
                THEN COUNT(*) FILTER (WHERE status = 'autorizada') * 100.0 / COUNT(*)
                ELSE 0
              END, 1
            )::text                                                           AS taxa_autorizacao,
            ROUND(
              AVG(
                CASE WHEN status = 'autorizada' AND "dataAutorizacao" IS NOT NULL
                  THEN EXTRACT(EPOCH FROM ("dataAutorizacao" - "createdAt")) * 1000
                  ELSE NULL
                END
              )
            )::text                                                           AS tempo_medio_sefaz_ms,
            MAX(CASE WHEN status = 'autorizada' THEN "dataAutorizacao" ELSE NULL END)::text
                                                                              AS ultima_autorizada,
            MAX(CASE WHEN status = 'rejeitada'  THEN "createdAt"       ELSE NULL END)::text
                                                                              AS ultima_rejeitada
          FROM nfe_emissoes
        `);

        const row = rows[0];

        const metricas = {
          total_emitidas:          parseInt(row.total_emitidas ?? '0', 10),
          total_autorizadas:       parseInt(row.total_autorizadas ?? '0', 10),
          total_rejeitadas:        parseInt(row.total_rejeitadas ?? '0', 10),
          total_em_processamento:  parseInt(row.total_em_processamento ?? '0', 10),
          total_erro:              parseInt(row.total_erro ?? '0', 10),
          taxa_autorizacao:        parseFloat(row.taxa_autorizacao ?? '0'),
          tempo_medio_sefaz_ms:    row.tempo_medio_sefaz_ms ? parseFloat(row.tempo_medio_sefaz_ms) : null,
          tempo_medio_total_ms:    row.tempo_medio_sefaz_ms ? parseFloat(row.tempo_medio_sefaz_ms) : null,
          ultima_autorizada:       row.ultima_autorizada ?? null,
          ultima_rejeitada:        row.ultima_rejeitada ?? null,
          ambiente:                'homologacao',
          uptime_operacional_s:    Math.floor(process.uptime()),
          gerado_em:               new Date().toISOString(),
        };

        LOG('NFE_DASHBOARD_METRICS', { corrId, total: metricas.total_emitidas, taxa: metricas.taxa_autorizacao });
        res.json({ ok: true, metricas });
      } catch (err) {
        LOG('NFE_DASHBOARD_METRICS_ERROR', { corrId, error: String(err) });
        next(err);
      }
    }
  );

  // ── GET /api/admin/nfe/timeline ────────────────────────────────────────────
  app.get(
    '/api/admin/nfe/timeline',
    requireAuthCore,
    requireRole([...ROLES]),
    async (req, res, next) => {
      const corrId = uid();
      try {
        const { rows } = await pool.query<{
          id: number;
          order_id: number;
          numero: string | null;
          serie: string | null;
          status: string;
          chave_nfe: string | null;
          protocolo: string | null;
          c_stat: string | null;
          x_motivo: string | null;
          data_emissao: string | null;
          data_autorizacao: string | null;
          ambiente_fiscal: string | null;
          created_at: string;
        }>(`
          SELECT
            id,
            "orderId"          AS order_id,
            numero,
            serie,
            status,
            "chaveNFe"         AS chave_nfe,
            protocolo,
            "cStat"            AS c_stat,
            "xMotivo"          AS x_motivo,
            "dataEmissao"      AS data_emissao,
            "dataAutorizacao"  AS data_autorizacao,
            "ambienteFiscal"   AS ambiente_fiscal,
            "createdAt"        AS created_at
          FROM nfe_emissoes
          ORDER BY "createdAt" DESC
          LIMIT 100
        `);

        // Enrich each row with a derived event type for the timeline
        const eventos = rows.map(r => {
          let tipo: string;
          let descricao: string;
          let risco: 'ok' | 'warn' | 'error' | 'info' = 'info';

          switch (r.status) {
            case 'autorizada':
              tipo = 'AUTORIZADA';
              descricao = `NF-e ${r.numero} autorizada pelo SEFAZ`;
              risco = 'ok';
              break;
            case 'rejeitada':
              tipo = 'REJEITADA';
              descricao = `NF-e ${r.numero} rejeitada — cStat ${r.c_stat}: ${r.x_motivo ?? ''}`;
              risco = 'error';
              break;
            case 'erro':
              tipo = 'ERRO';
              descricao = `NF-e ${r.numero} com erro de processamento`;
              risco = 'error';
              break;
            case 'enviando':
              tipo = 'SOAP_ENVIADO';
              descricao = `NF-e ${r.numero} enviada ao SEFAZ (aguardando)`;
              risco = 'warn';
              break;
            case 'enviada':
              tipo = 'ENVIADA';
              descricao = `NF-e ${r.numero} enviada (resposta pendente)`;
              risco = 'warn';
              break;
            case 'assinada':
              tipo = 'ASSINADA';
              descricao = `NF-e ${r.numero} assinada — pronta para envio`;
              risco = 'info';
              break;
            case 'gerada':
              tipo = 'XML_CRIADO';
              descricao = `NF-e ${r.numero} gerada (XML criado)`;
              risco = 'info';
              break;
            case 'cancelada':
              tipo = 'CANCELADA';
              descricao = `NF-e ${r.numero} cancelada`;
              risco = 'warn';
              break;
            default:
              tipo = r.status.toUpperCase();
              descricao = `NF-e ${r.numero} — ${r.status}`;
          }

          return {
            nfe_id:          r.id,
            order_id:        r.order_id,
            numero:          r.numero,
            status:          r.status,
            tipo,
            descricao,
            risco,
            chave_nfe:       r.chave_nfe,
            protocolo:       r.protocolo,
            c_stat:          r.c_stat,
            x_motivo:        r.x_motivo,
            ambiente:        r.ambiente_fiscal ?? 'homologacao',
            timestamp:       r.data_autorizacao ?? r.created_at,
            created_at:      r.created_at,
          };
        });

        LOG('NFE_DASHBOARD_TIMELINE', { corrId, count: eventos.length });
        res.json({ ok: true, eventos, total: eventos.length, gerado_em: new Date().toISOString() });
      } catch (err) {
        LOG('NFE_DASHBOARD_TIMELINE_ERROR', { corrId, error: String(err) });
        next(err);
      }
    }
  );

  // ── GET /api/admin/nfe/recent-errors ──────────────────────────────────────
  app.get(
    '/api/admin/nfe/recent-errors',
    requireAuthCore,
    requireRole([...ROLES]),
    async (req, res, next) => {
      const corrId = uid();
      try {
        const { rows } = await pool.query<{
          id: number;
          order_id: number;
          numero: string | null;
          serie: string | null;
          status: string;
          c_stat: string | null;
          x_motivo: string | null;
          chave_nfe: string | null;
          created_at: string;
        }>(`
          SELECT
            id,
            "orderId"    AS order_id,
            numero,
            serie,
            status,
            "cStat"      AS c_stat,
            "xMotivo"    AS x_motivo,
            "chaveNFe"   AS chave_nfe,
            "createdAt"  AS created_at
          FROM nfe_emissoes
          WHERE status IN ('rejeitada', 'erro')
          ORDER BY "createdAt" DESC
          LIMIT 20
        `);

        LOG('NFE_DASHBOARD_RECENT_ERRORS', { corrId, count: rows.length });
        res.json({ ok: true, erros: rows, total: rows.length, gerado_em: new Date().toISOString() });
      } catch (err) {
        LOG('NFE_DASHBOARD_RECENT_ERRORS_ERROR', { corrId, error: String(err) });
        next(err);
      }
    }
  );
}
