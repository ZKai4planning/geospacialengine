/**
 * "Where does this come from?" for everything the page shows. One row per item:
 *   kind: 'measured' (surveyed or sensed) | 'official' (a public register) | 'mapped' (volunteer or map data) | 'estimated' (worked out here) | 'you' (typed in) | 'assumed' (a default, check it)
 * Only rows the application actually has are returned, so a missing source is never shown as if it were known.
 */
const OSM = 'OpenStreetMap contributors';
const profileSource = (s) => (s === 'user' ? { kind: 'you', source: 'Entered by you' } : s === 'unconfirmed' || s == null || s === 'unset' ? null : { kind: 'mapped', source: s === 'mock' ? 'Sample data' : /osm|openstreetmap/i.test(s) ? `${OSM} (building tags)` : String(s) });

export function buildSources(app) {
  const rows = [], add = (topic, value, kind, source, note = null) => { if (source) rows.push({ topic, value: value ?? null, kind, source, note }); };
  const p = app.profile ?? {};

  add('Address', app.address?.fullAddress, 'official', app.address?.uprn ? 'Address search (Ordnance Survey Places if a key is set, otherwise OpenStreetMap / postcodes.io), with the UPRN from Ordnance Survey Open UPRN' : 'Address search (OpenStreetMap / postcodes.io)');
  add('Planning authority (council)', app.authority?.name, 'estimated', 'postcodes.io: the council the postcode belongs to. This is not the exact boundary line, so check it with the planning authority finder, especially near a council border.');
  add('House outline', app.footprint?.areaM2 ? `${Math.round(app.footprint.areaM2)} m² on the ground` : null, app.footprint?.source === 'mock' ? 'assumed' : 'mapped', app.footprint ? (app.footprint.source === 'mock' ? 'Sample data' : app.footprint.source === 'nominatim' ? `${OSM} (via Nominatim)` : `${OSM} (building outline)`) : null);
  if (app.plot) {
    const est = app.plot.estimated || /estimate/i.test(app.plot.source ?? '');
    add('Plot boundary', app.plot.areaM2 ? `${Math.round(app.plot.areaM2)} m²` : null, est ? 'estimated' : 'official', est ? 'Estimated from neighbouring buildings and roads (no registered title found). Not a legal boundary.' : app.plot.source, est ? null : app.plot.attribution ?? null);
  }
  if (app.lidar && app.lidar.status !== 'unavailable') add('Roof ridge and eaves height', app.lidar.ridgeM != null && app.lidar.eavesM != null ? `ridge ${app.lidar.ridgeM} m, eaves ${app.lidar.eavesM} m` : null, 'measured', app.lidar.source ?? 'Environment Agency LiDAR', app.lidar.confidence ? `Confidence: ${app.lidar.confidence}` : null);
  const roof = profileSource(p.roofType?.source);
  add('Roof type', p.roofType?.value, roof?.kind ?? 'assumed', roof?.source ?? 'Not known: a pitched roof is assumed in the 3D view', 'Roof shape and ridge direction are never measured here. Only the pitch and heights come from LiDAR.');
  const st = profileSource(p.storeys?.source);
  if (p.storeys?.value != null) add('Number of storeys', p.storeys.value, st?.kind ?? 'assumed', st?.source ?? null);
  add('Energy certificate (type, floor area, rooms)', app.epc ? `${app.epc.propertyType ?? ''} ${app.epc.builtForm ?? ''}`.trim() : null, 'official', app.epc?.source);
  add('Rooms inside the 3D view', app.interior?.available ? (app.interiorSetup?.layout ? 'drawn by you' : 'typical layout') : null, app.interiorSetup?.layout ? 'you' : 'assumed', app.interior?.available ? (app.interiorSetup?.layout ? 'Drawn by you in the floor-plan editor' : 'Generated from the building outline. Not from the council, a survey or floor plans') : null);
  add('Size of the new work', app.proposal ? 'your proposal' : null, 'you', app.proposal ? 'The dimensions you entered' : null);
  add('Designations (listed, conservation area, Article 4, flood, green belt...)', app.constraints?.items ? `${app.constraints.items.length} found` : null, 'official', app.constraints?.source ? `${app.constraints.source} (national planning data)` : null, app.constraints?.checkedAt ? `Checked ${String(app.constraints.checkedAt).slice(0, 10)}` : null);
  add('Protected trees', app.protectedTrees ? `${(app.protectedTrees.zones?.length ?? 0) + (app.protectedTrees.trees?.length ?? 0)} found` : null, 'official', app.protectedTrees ? 'Council tree preservation orders on planning.data.gov.uk (coverage varies by council)' : null);
  add('Roads, paths, trees, neighbours, power lines', null, 'mapped', app.roads || app.neighbours ? `${OSM} (via Overpass)` : null);
  add('Planning history', app.history?.here ? `${app.history.here.length} here` : null, 'official', app.history?.source, app.history?.attribution ?? null);
  add('House sales', app.ppd?.sales ? `${app.ppd.sales.length} recorded` : null, 'official', app.ppd?.source, app.ppd?.attribution ?? null);
  add('Coal mining', app.coal?.status && app.coal.status !== 'unavailable' ? app.coal.status : null, 'official', app.coal?.status && app.coal.status !== 'unavailable' ? app.coal.source : null);
  add('Historic landfill (made ground)', app.landfill?.status && app.landfill.status !== 'unavailable' ? app.landfill.status : null, 'official', app.landfill?.status && app.landfill.status !== 'unavailable' ? app.landfill.source : null);
  add('Aerial photo', null, 'official', app.media?.aerial?.attribution ?? (app.media?.aerial ? 'Aerial imagery provider' : null));
  add('Street photo', null, 'official', app.media?.streetView?.attribution ?? (app.media?.streetView?.imageUrl || app.media?.streetView?.url ? 'Street imagery provider' : null));
  return rows;
}
