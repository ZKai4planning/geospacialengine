import { z } from 'zod';
import { ROOM_TYPES } from '../../data/interiorStandards.js';

/** What the applicant may change about the inside. Shared by the PATCH route and the JSON export / import. null clears a setting. */
const pt = z.tuple([z.number().min(-60).max(80), z.number().min(-60).max(80)]);
/** Rooms drawn in the floor-plan editor, per storey. Geometry is checked against the real house size in the service (geometry.js). */
export const layoutSchema = z.object({
  storeys: z.array(z.object({
    index: z.number().int().min(0).max(3),
    rooms: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{3,40}$/),
      name: z.string().trim().max(40).default(''),
      type: z.enum(Object.keys(ROOM_TYPES)),
      poly: z.array(pt).min(3).max(16),
    })).max(30),
    // doors and windows: a segment lying along a wall. Height / sill in metres; fixed = does not open
    openings: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{3,40}$/), kind: z.enum(['door', 'window']), a: pt, b: pt,
      sillM: z.number().min(0).max(2.5).optional(), heightM: z.number().min(0.3).max(2.6).optional(), fixed: z.boolean().optional(),
    })).max(80).default([]),
    // stairs rising from this floor to the next: a rectangle and the direction of travel upwards
    stairs: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]{3,40}$/), poly: z.array(pt).length(4), dir: z.enum(['+x', '-x', '+y', '-y']),
    })).max(4).default([]),
  })).min(1).max(4),
}).strict();

export const interiorSchema = z.object({
  storeys: z.number().int().min(1).max(4).nullable().optional(),
  ceilingM: z.number().min(2).max(4).nullable().optional(),
  hallSide: z.enum(['left', 'right']).nullable().optional(),
  loftUse: z.enum(['bedroom', 'study', 'storage']).nullable().optional(),
  layout: layoutSchema.nullable().optional(),   // null = back to the generated typical layout
  rooms: z.record(
    z.string().regex(/^[a-z0-9-]{3,40}$/),
    z.object({ name: z.string().trim().max(40).optional(), type: z.enum(Object.keys(ROOM_TYPES)).optional() }),
  ).optional().refine((r) => !r || Object.keys(r).length <= 40, 'Too many rooms'),
}).strict();
