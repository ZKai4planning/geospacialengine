import { DATASETS } from './datasets.js';
import { CHECK_BY_ID } from './checks.js';
import { TOPICS } from './standards.js';

/**
 * The data-loading guide (reports/dataset-loading-guide.md), generated from the dataset catalogue so it can never disagree with the code:
 * which dataset feeds which checks, who publishes it, its licence, what to put in each column, and the exact command to load it.
 * It never invents a download link: the publishers' own pages change, so it names the publisher and what to ask for.
 */
const GROUPS = [
  ['open', 'A. Open national datasets - load once for the whole country (or the region you serve)', (d) => d.scope === 'national' && /Open Government/.test(d.licence)],
  ['conf', 'B. National datasets with their own re-use terms - confirm the terms, then load', (d) => d.scope === 'national' && !/Open Government/.test(d.licence) && !/Licensed \/ paid/.test(d.licence)],
  ['council', 'C. Council data - one load PER council (--authority <code>)', (d) => d.scope === 'authority'],
  ['paid', 'D. Licensed / paid / utility data - only under your own licence agreement', (d) => /Licensed \/ paid/.test(d.licence) && d.scope === 'national'],
];

const cmd = (d) => `npm run import:geo -- --dataset ${d.key} --file <${d.matchBy === 'postcode' ? 'file.csv' : 'file.geojsonl'}>${d.scope === 'authority' ? ' --authority <code>' : ''}${d.ratings ? ` --rating-field <${d.ratingProp} column>` : ''}${d.matchBy === 'postcode' ? ' --key-field <postcode column>' : ''} --source "<publisher, version/date>"`;

export function buildDatasetGuide() {
  const out = [];
  const w = (s = '') => out.push(s);
  w('# Loading data for the 228-parameter register');
  w();
  w(`${DATASETS.length} datasets feed ${new Set(DATASETS.flatMap((d) => d.checks)).size} checks. Every dataset is loaded **once, onto your own server** (the Postgres behind \`DATABASE_URL\`), then looked up per application. The engine never downloads anything itself and never treats a dataset that is not loaded as "clear": the check says *awaiting data* until the data is there.`);
  w();
  w('## How to load a dataset (about ten minutes each, on the VPS or your own machine)');
  w();
  w('1. **Once:** `npm run db:schema:geo` creates the tables (`geo_features`, `geo_meta`, `lpa_standards`). Plain Postgres, no PostGIS. Use the *direct* connection string in `DATABASE_DIRECT_URL`, not the pooler.');
  w('2. Download the dataset from its publisher (see below) and copy it to the machine that runs the import (`scp file.zip you@vps:/data/`).');
  w('3. Convert it to GeoJSON or newline-delimited GeoJSON in WGS84, or leave it in British National Grid and pass `--crs 27700`. For shapefiles / GeoPackage: `ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 out.geojsonl Source.shp`. CSVs with a postcode column need no conversion.');
  w('4. Check it first: add `--dry-run`. It prints the row count, the first row and the bounding box (should be inside Great Britain: longitude about -8 to 2, latitude about 50 to 59).');
  w('5. Load it: run the command shown for the dataset. Re-running **replaces** that dataset (and council) in one transaction. If the file covers only part of the country add `--partial`, so a point outside the extract stays *unavailable* rather than *outside*.');
  w('6. No restart needed: the app re-reads what is loaded within a minute. Open `/api/applications/<id>/intelligence` and the checks move from *awaiting data* to a real reading.');
  w();
  w('Banded datasets (flood risk, shrink-swell, landslide, night lights, heat) need `--rating-field` pointing at the band column, otherwise every feature ranks as unknown. Council standards (parking, cycle, density, SuDS, privacy) are numbers, not maps: see the last section.');
  w();
  const used = new Set();
  for (const [, title, pred] of GROUPS) {
    const ds = DATASETS.filter((d) => pred(d) && !used.has(d.key));
    if (!ds.length) continue;
    ds.forEach((d) => used.add(d.key));
    w(`## ${title}`);
    w();
    w('| Dataset | Feeds checks | Publisher | Licence | What to ask for |');
    w('|---|---|---|---|---|');
    for (const d of ds) w(`| \`${d.key}\` ${d.title} | ${d.checks.map((c) => `${c} ${CHECK_BY_ID[c]?.name ?? ''}`.trim()).join('<br>')} | ${d.publisher} | ${d.licence.replace(/\|/g, '/')} | ${d.obtain.replace(/\|/g, '/')} |`);
    w();
    w('```');
    for (const d of ds) w(cmd(d));
    w('```');
    w();
  }
  w('## Council standards (parking, cycle parking, density, SuDS, privacy)');
  w();
  w(`These are numbers from each council's adopted documents, loaded per council with \`npm run import:geo -- --standards standards.json --authority <code>\`. Topics: ${TOPICS.map((t) => `\`${t}\``).join(', ')}. Every topic must name its **source** (the policy or document) so each figure can be traced; the file format is documented at the top of \`src/register/standards.js\`. A council with no row gets *awaiting data*, never a guessed number.`);
  w();
  w('## Not loaded, by design');
  w();
  w('Registered proprietor, covenants, easements, rights of way, deeds, load-bearing walls, bat and bird surveys and similar checks cannot come from a dataset: they come from documents and people. The engine takes them as **evidence** (`POST /api/applications/:id/evidence/:checkId`), shows what the evidence says, and only a **named reviewer** can verify it (`POST /api/applications/:id/sign-off/:checkId`, needs `REVIEWER_TOKEN`).');
  w();
  w('## Suggested order');
  w();
  w('1. Environment Agency flood datasets (surface water, historic floods, reservoirs, defences, main river, climate allowances): six checks from one publisher.');
  w('2. Your pilot councils\' council data (conditions, enforcement, S106, local list, archaeology, traffic orders, HMO / selective licensing) - these decide most real-world refusals.');
  w('3. DEFRA noise and AQMA, HSE COMAH, Ofcom broadband, then the licensed BGS / utility data once the licence is signed.');
  return out.join('\n');
}
