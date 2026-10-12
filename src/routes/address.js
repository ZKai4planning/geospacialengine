import { Router } from 'express';
import { z } from 'zod';
import { asyncH } from '../middleware/errorHandler.js';

export function addressRoutes({ addressService }) {
  const r = Router();

  // GET /api/address/search?q=E6 2AA | e6 | 22 example rd
  r.get('/search', asyncH(async (req, res) => {
    const { q, limit } = z.object({ q: z.string().max(120), limit: z.coerce.number().int().min(1).max(20).default(10) }).parse(req.query);
    res.json(await addressService.search(q, limit));
  }));

  // GET /api/address/postcode/E62AA
  r.get('/postcode/:postcode', asyncH(async (req, res) => {
    res.json(await addressService.byPostcode(req.params.postcode));
  }));

  // GET /api/address/id/1234567890  (UPRN or osm:way:123)   – /uprn/:id kept as an alias
  r.get(['/id/:id', '/uprn/:id'], asyncH(async (req, res) => {
    res.json(await addressService.getById(req.params.id));
  }));

  return r;
}
