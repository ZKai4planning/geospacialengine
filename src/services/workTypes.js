import { z } from 'zod';
import { ringSchema } from '../utils/drawn.js';

/**
 * Single source of truth for every kind of work the applicant can propose.
 * It drives: the API validation, the form the UI renders, the summary card rows,
 * the map geometry (proposalGeometry.js) and the permitted-development rules.
 */
const num = (name, label, extra = {}) => ({ name, label, kind: 'number', unit: 'm', min: 0.1, max: 30, step: 0.1, ...extra });
const sel = (name, label, options, def) => ({ name, label, kind: 'select', options, default: def });
const poly = (name, label, extra = {}) => ({ name, label, kind: 'polygon', required: true, ...extra });
const bool = (name, label, extra = {}) => ({ name, label, kind: 'boolean', default: false, advanced: true, ...extra });
const storeys = [{ value: 1, label: 'Single storey' }, { value: 2, label: 'Two storey' }];
const sides = [{ value: 'right', label: 'Right (facing the house)' }, { value: 'left', label: 'Left (facing the house)' }];
const align = (extra = []) => sel('alignment', 'Position across the plot', [...extra, { value: 'center', label: 'Centred' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], 'center');

// Yes / No / Not checked. "Not checked" is the default: the engine then asks for confirmation instead of silently passing the rule.
const yn = (name, label, extra = {}) => ({ ...sel(name, label, [{ value: 'unknown', label: 'Not checked' }, { value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }], 'unknown'), advanced: true, yesNo: true, ...extra });
const rightOfWay = yn('crossesRightOfWay', 'Built over a public footpath or bridleway');
const claddingOptions = [{ value: 'unknown', label: 'Not decided' }, { value: 'none', label: 'No cladding' }, { value: 'render', label: 'Render' }, { value: 'stone', label: 'Stone' }, { value: 'artificial_stone', label: 'Artificial stone' }, { value: 'pebble_dash', label: 'Pebble dash' }, { value: 'tile', label: 'Tiles' }, { value: 'timber', label: 'Timber' }, { value: 'plastic', label: 'Plastic' }];
const classA = [yn('beyondFront', 'Reaches in front of the front wall, or a wall facing a road'), yn('hasProhibited', 'Includes a balcony, raised platform, chimney / flue, antenna or roof alteration'), yn('convertedUnderPart3', 'House was created from an office / shop / barn under a change-of-use right'), { ...sel('cladding', 'Outer finish (matters on protected land)', claddingOptions, 'unknown'), advanced: true }];

export const WORK_TYPES = {
  rear_extension: {
    label: 'Rear extension',
    hint: 'Single or two-storey extension at the back of the house.',
    fields: [
      sel('storeys', 'Storeys', storeys, 1),
      num('depthM', 'Depth', { required: true, default: 3, max: 20 }),
      num('heightM', 'Height', { required: true, default: 3, max: 12 }),
      num('widthM', 'Width', { hint: 'Empty = full width of the house' }),
      { ...align([{ value: 'full', label: 'Full width' }]), advanced: true },
      { ...num('eavesHeightM', 'Eaves height'), advanced: true },
      { ...num('distanceToSideBoundaryM', 'Distance to side boundary', { min: 0 }), advanced: true },
      { ...num('distanceToRearBoundaryM', 'Distance to rear boundary', { min: 0, max: 100 }), advanced: true },
      { ...num('additionsAreaM2', 'All extensions + outbuildings area', { unit: 'm²', min: 0, max: 1000, step: 1 }), advanced: true },
      ...classA,
    ],
  },
  side_extension: {
    label: 'Side extension',
    hint: 'Extension alongside the house (side return or garage conversion).',
    fields: [
      sel('side', 'Which side?', sides, 'right'),
      sel('storeys', 'Storeys', storeys, 1),
      num('widthM', 'Width', { required: true, default: 2.5, max: 10 }),
      num('heightM', 'Height', { required: true, default: 3, max: 12 }),
      { ...num('lengthM', 'Length along the side', { hint: 'Empty = full depth of the house' }), advanced: true },
      { ...num('eavesHeightM', 'Eaves height'), advanced: true },
      { ...num('distanceToSideBoundaryM', 'Distance to boundary', { min: 0 }), advanced: true },
      ...classA,
    ],
  },
  wraparound_extension: {
    label: 'Wraparound extension',
    hint: 'Rear extension that also extends along one side (L-shape).',
    fields: [
      sel('side', 'Which side?', sides, 'right'),
      num('depthM', 'Rear depth', { required: true, default: 3, max: 20 }),
      num('widthM', 'Side width', { required: true, default: 2.5, max: 10 }),
      num('heightM', 'Height', { required: true, default: 3, max: 12 }),
      { ...num('sideLengthM', 'Side length', { hint: 'Default 4 m' }), advanced: true },
      { ...num('eavesHeightM', 'Eaves height'), advanced: true },
      { ...num('distanceToSideBoundaryM', 'Distance to boundary', { min: 0 }), advanced: true },
      ...classA,
    ],
  },
  front_porch: {
    label: 'Front porch',
    hint: 'Small porch at the front door.',
    fields: [
      num('widthM', 'Width', { required: true, default: 1.6, max: 6 }),
      num('depthM', 'Projection', { required: true, default: 1.5, max: 4 }),
      num('heightM', 'Height', { required: true, default: 2.8, max: 5 }),
      { ...num('distanceToHighwayM', 'Distance to the pavement / road boundary', { min: 0, max: 50 }), advanced: true },
    ],
  },
  rear_dormer: {
    label: 'Loft dormer (roof)',
    hint: 'Dormer window / loft conversion on the rear roof slope.',
    fields: [
      num('widthM', 'Width', { required: true, default: 3.5, max: 12 }),
      num('depthM', 'Depth on plan', { required: true, default: 2.5, max: 6 }),
      num('heightM', 'Height', { required: true, default: 2.3, max: 4 }),
      { ...num('volumeM3', 'Added roof volume (if known)', { unit: 'm³', min: 1, max: 200, step: 1 }), advanced: true },
      bool('balcony', 'Includes a balcony / terrace'),
      { ...num('topHeightM', 'Height of the top of the dormer above ground', { min: 1, max: 20 }), advanced: true },
      yn('higherThanRoof', 'Higher than the existing ridge'),
      yn('chimneyFlue', 'New or altered chimney / flue / soil pipe'),
      yn('convertedUnderPart3', 'House was created from an office / shop / barn under a change-of-use right'),
    ],
  },
  additional_storey: {
    label: 'Extra storey (roof-top)',
    hint: 'Adding one or more floors on top of the house.',
    fields: [
      sel('storeys', 'Extra storeys', [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], 1),
      num('heightM', 'Added height', { required: true, default: 2.7, max: 8 }),
    ],
  },
  outbuilding: {
    label: 'Garden outbuilding',
    hint: 'Garden room, studio, shed or garage in the garden.',
    fields: [
      num('widthM', 'Width', { required: true, default: 3, max: 15 }),
      num('depthM', 'Depth', { required: true, default: 4, max: 15 }),
      num('heightM', 'Overall height', { required: true, default: 2.5, max: 6 }),
      sel('roof', 'Roof', [{ value: 'flat', label: 'Flat / mono-pitch' }, { value: 'pitched', label: 'Dual pitched' }], 'flat'),
      num('setbackM', 'Distance from the back of the house', { min: 0, max: 60, default: 5, step: 0.5 }),
      { ...align(), advanced: true },
      { ...num('eavesHeightM', 'Eaves height'), advanced: true },
      { ...num('distanceToBoundaryM', 'Distance to nearest boundary', { min: 0, max: 50 }), advanced: true },
      { ...num('additionsAreaM2', 'All extensions + outbuildings area', { unit: 'm²', min: 0, max: 1000, step: 1 }), advanced: true },
      bool('usedAsHome', 'Will be lived/slept in as a separate home'),
      yn('raisedPlatform', 'Has a veranda, balcony or raised platform'),
    ],
  },
  custom_polygon: {
    label: 'Draw my own shape',
    hint: 'Draw the footprint on the aerial photo. We measure it, test it against the house, neighbours, plot boundary, roads and trees, and screen it as the kind of work you pick.',
    fields: [
      poly('ring', 'Outline drawn on the map'),
      sel('treatAs', 'Screen it as', [{ value: 'rear_extension', label: 'Rear extension' }, { value: 'side_extension', label: 'Side extension' }, { value: 'outbuilding', label: 'Garden outbuilding' }], 'rear_extension'),
      sel('storeys', 'Storeys', storeys, 1),
      num('heightM', 'Height', { required: true, default: 3, max: 12 }),
      { ...sel('roof', 'Roof', [{ value: 'flat', label: 'Flat / mono-pitch' }, { value: 'pitched', label: 'Dual pitched' }], 'flat'), onlyFor: ['outbuilding'] },
      { ...num('eavesHeightM', 'Eaves height'), advanced: true },
      { ...num('distanceToSideBoundaryM', 'Distance to side boundary', { min: 0, hint: 'Empty = measured from the title boundary' }), advanced: true, onlyFor: ['rear_extension', 'side_extension'] },
      { ...num('distanceToRearBoundaryM', 'Distance to rear boundary', { min: 0, max: 100 }), advanced: true, onlyFor: ['rear_extension'] },
      { ...num('distanceToBoundaryM', 'Distance to nearest boundary', { min: 0, max: 50, hint: 'Empty = measured from the title boundary' }), advanced: true, onlyFor: ['outbuilding'] },
      { ...num('additionsAreaM2', 'All extensions + outbuildings area', { unit: 'm²', min: 0, max: 1000, step: 1 }), advanced: true },
      bool('usedAsHome', 'Will be lived/slept in as a separate home', { onlyFor: ['outbuilding'] }),
    ],
  },
};

for (const t of Object.values(WORK_TYPES)) t.fields.push({ ...rightOfWay });

function fieldSchema(f) {
  let s;
  if (f.kind === 'polygon') return ringSchema;
  if (f.kind === 'number') s = z.number().min(f.min ?? 0).max(f.max ?? 1000);
  else if (f.kind === 'boolean') s = z.boolean();
  else s = z.union(f.options.map((o) => z.literal(o.value)));
  if (f.required) return s;
  return f.default !== undefined ? s.default(f.default) : s.optional();
}

/** Zod schema generated from the registry: { type: 'rear_extension', depthM: 4, ... } */
export const proposalSchema = z.discriminatedUnion(
  'type',
  Object.entries(WORK_TYPES).map(([type, def]) =>
    z.object({ type: z.literal(type), ...Object.fromEntries(def.fields.map((f) => [f.name, fieldSchema(f)])) }),
  ),
);

export const listWorkTypes = () => Object.entries(WORK_TYPES).map(([type, d]) => ({ type, label: d.label, hint: d.hint, fields: d.fields }));

/** Human-readable rows for the summary card. */
export function describeProposal(p) {
  const def = WORK_TYPES[p.type];
  return def.fields
    .filter((f) => !f.advanced && f.kind !== 'polygon' && p[f.name] != null && (!f.onlyFor || f.onlyFor.includes(p.treatAs)))
    .map((f) => ({
      label: f.label,
      value: f.kind === 'select' ? f.options.find((o) => o.value === p[f.name])?.label ?? String(p[f.name]) : `Approx. ${p[f.name]} ${f.unit ?? ''}`.trim(),
    }));
}
