import type { Express } from "express";
import { requireAuth as requireAuthCore } from "../core/http/requireAuth";
import { storage } from "../services/storage.ts";

const cceHistory: Record<string, any[]> = {};

export function register(app: Express) {
  app.post('/api/nfe/:id/cce', requireAuthCore, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { correcao } = req.body;

      if (!correcao || correcao.length < 15) {
        return res.status(400).json({
          success: false,
          error: { message: "Texto da correção inválido (mínimo 15 caracteres)" },
        });
      }

      const nfe = await storage.getNfeEmissao(Number(id));
      if (!nfe) {
        return res.status(404).json({ success: false, error: { message: "NF-e não encontrada" } });
      }
      if (nfe.status !== "autorizada") {
        return res.status(422).json({
          success: false,
          error: { message: "CC-e só pode ser emitida para NF-e com status AUTORIZADA" },
        });
      }

      if (!cceHistory[id]) cceHistory[id] = [];
      const sequencia = cceHistory[id].length + 1;
      const entrada = {
        id: `${id}-${sequencia}`,
        nfeId: Number(id),
        sequencia,
        correcao,
        createdAt: new Date(),
        createdByUserId: req.session?.userId || null,
      };
      cceHistory[id].push(entrada);

      return res.json({
        success: true,
        message: "Carta de Correção registrada com sucesso",
        cce: entrada,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { message: e.message } });
    }
  });

  app.get('/api/nfe/:id/cce', requireAuthCore, async (req: any, res) => {
    try {
      const { id } = req.params;
      return res.json({ success: true, history: cceHistory[id] || [] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { message: e.message } });
    }
  });
}
