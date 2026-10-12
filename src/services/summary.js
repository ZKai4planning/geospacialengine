import { WORK_TYPES, describeProposal } from './workTypes.js';

const val = (v, suffix = '') => (v == null ? 'To confirm' : `${v}${suffix}`);
const yn = (v) => (v == null ? 'To confirm' : v ? 'Yes' : 'No');
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Shapes an application into the three cards (property / proposal / site map) plus constraints and assessment. */
export function buildSummary(app) {
  const a = app.address, p = app.profile, pr = app.proposal, map = app.map;
  const parts = a.fullAddress.split(', ');
  const title = parts.slice(0, -2).join(', ') || parts[0];
  const base = `/api/applications/${app.id}/media`;
  const ex = p.existingExtension;
  const viewKey = `${map.view.zoom}-${map.view.lat.toFixed(6)}-${map.view.lng.toFixed(6)}`;
  const facing = COMPASS[Math.round(map.frame.frontBearingDeg / 45) % 8];

  return {
    id: app.id, reference: app.reference, status: app.status, createdAt: app.createdAt,
    address: {
      id: a.id, uprn: a.uprn, uprnMatch: a.uprnMatch ?? null, fullAddress: a.fullAddress, line1: title, town: a.postTown, postcode: a.postcode, lat: a.lat, lng: a.lng,
    },
    authority: app.authority,
    cards: {
      property: {
        title, subtitle: parts.slice(-2).join(', '),
        imageUrl: `${base}/street-view`,
        imageAvailable: !!app.media.streetView?.available,
        attribution: app.media.streetView?.attribution ?? null,
        rows: [
          { label: 'Property type', value: a.classification.propertyType },
          { label: 'UPRN', value: a.uprn ? (a.uprnMatch ? `${a.uprn} (matched by location${a.uprnMatch.confidence === 'low' ? ' – please confirm' : ''})` : a.uprn) : 'Not available' },
          { label: 'Site area', value: val(p.siteAreaM2.value, ' m²') },
          { label: 'Building footprint', value: val(p.footprintAreaM2.value, ' m²') },
        ],
      },
      proposal: {
        title: pr ? WORK_TYPES[pr.type].label : 'Your proposal',
        rows: pr ? describeProposal(pr) : [{ label: 'Status', value: 'Choose the type of work below' }],
      },
      site: {
        imageUrl: `${base}/aerial?v=${viewKey}`,
        attribution: app.media.aerial?.attribution ?? null,
        rows: [
          { label: 'Original dwelling', value: yn(p.originalDwelling.value) },
          { label: 'Existing extension', value: ex.present == null ? 'To confirm' : ex.present ? `Yes${ex.depthM ? ` (c. ${ex.depthM} m)` : ''}` : 'No' },
          { label: 'Roof type', value: val(p.roofType.value) },
          { label: 'Storeys', value: val(p.storeys.value) },
        ],
      },
    },
    map: {
      ...map,
      frontNote: `Front of the house faces ${facing} (${{ road: 'from the nearest road', camera: 'from the street photo', user: 'set by you', assumed: 'assumed – please check' }[map.frame.frontSource]}).`,
    },
    profile: p, proposal: pr, constraints: app.constraints, assessment: app.assessment, warnings: app.warnings,
  };
}
