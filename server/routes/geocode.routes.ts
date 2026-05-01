import type { Express } from "express";

export function register(app: Express) {
  app.get('/api/geocode', async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: 'Missing address query' });
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'VivaFrutaz/1.0 (comercial@vivafrutaz.com)',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      });
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: 'Geocoding failed', detail: err.message });
    }
  });
}
