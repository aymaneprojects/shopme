import { COUNTRY_POINTS } from './country-points';

/**
 * Geometry of the live view world map: country shapes from the world-atlas package (Natural Earth, 1:110m), drawn with the Natural Earth
 * projection (polynomial of Šavrič, Patterson and Jenny, 2011), and one point per country for its visitor bubble.
 */

/** ISO 3166-1 numeric code (world-atlas feature ids) -> alpha-2 code, for the countries of the 1:110m atlas. */
const NUMERIC = '004AF 008AL 010AQ 012DZ 024AO 031AZ 032AR 036AU 040AT 044BS 050BD 051AM 056BE 064BT 068BO 070BA 072BW 076BR 084BZ 090SB 096BN 100BG 104MM 108BI 112BY 116KH 120CM 124CA 140CF 144LK 148TD 152CL 156CN 158TW 170CO 178CG 180CD 188CR 191HR 192CU 196CY 203CZ 204BJ 208DK 214DO 218EC 222SV 226GQ 231ET 232ER 233EE 238FK 242FJ 246FI 250FR 260TF 262DJ 266GA 268GE 270GM 275PS 276DE 288GH 300GR 304GL 320GT 324GN 328GY 332HT 340HN 348HU 352IS 356IN 360ID 364IR 368IQ 372IE 376IL 380IT 384CI 388JM 392JP 398KZ 400JO 404KE 408KP 410KR 414KW 417KG 418LA 422LB 426LS 428LV 430LR 434LY 440LT 442LU 450MG 454MW 458MY 466ML 478MR 484MX 496MN 498MD 499ME 504MA 508MZ 512OM 516NA 524NP 528NL 540NC 548VU 554NZ 558NI 562NE 566NG 578NO 586PK 591PA 598PG 600PY 604PE 608PH 616PL 620PT 624GW 626TL 630PR 634QA 642RO 643RU 646RW 682SA 686SN 688RS 694SL 703SK 704VN 705SI 706SO 710ZA 716ZW 724ES 728SS 729SD 732EH 740SR 748SZ 752SE 756CH 760SY 762TJ 764TH 768TG 780TT 784AE 788TN 792TR 795TM 800UG 804UA 807MK 818EG 826GB 834TZ 840US 854BF 858UY 860UZ 862VE 887YE 894ZM';
export const NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(NUMERIC.split(' ').map((x) => [x.slice(0, 3), x.slice(3)]));
/** Shapes without an ISO number in the atlas, by name. */
const UNNUMBERED: Record<string, string> = { 'N. Cyprus': 'CY', Somaliland: 'SO', Kosovo: 'XK' };

const SCALE = 180;
const rad = Math.PI / 180;

/** Natural Earth projection of a longitude/latitude in degrees, scaled so the world is about 985 x 510 units wide; y grows downwards. */
export function project(lon: number, lat: number): [number, number] {
  const l = lon * rad; const p = lat * rad;
  const p2 = p * p; const p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [x * SCALE, -y * SCALE];
}

type Ring = number[][];
interface Geometry { type: string; coordinates: unknown }
export interface AtlasFeature { id?: string | number; properties?: { name?: string } | null; geometry: Geometry | null }
export interface MapCountry { code: string; name: string; d: string; center: [number, number] }
export interface WorldMap { viewBox: string; width: number; height: number; countries: MapCountry[] }

const polygonsOf = (g: Geometry | null): Ring[][] => (!g ? [] : g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : []);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Signed area and centroid of a projected ring (shoelace). */
function ringCentroid(pts: Array<[number, number]>): { area: number; c: [number, number] } {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x0, y0] = pts[j]!; const [x1, y1] = pts[i]!;
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) { const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); return { area: 0, c: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] }; }
  return { area: Math.abs(a / 2), c: [cx / (3 * a), cy / (3 * a)] };
}

/**
 * A ring that crosses the 180° meridian (eastern Russia, Fiji) jumps from one edge of the map to the other: cut it there into pieces that each
 * start and end on an edge, so that closing a piece draws along that edge instead of a line across the whole map.
 */
export function splitAtAntimeridian(ring: Ring): Ring[] {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  const jumps: number[] = [];
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]![0]! - pts[i - 1]![0]!) > 180) jumps.push(i);
  if (pts.length > 1 && Math.abs(pts[0]![0]! - pts[pts.length - 1]![0]!) > 180) jumps.push(0);
  if (!jumps.length) return [ring];
  const start = jumps[0]!;
  const rotated = [...pts.slice(start), ...pts.slice(0, start)];
  const cuts = new Set(jumps.map((j) => (j - start + pts.length) % pts.length));
  const parts: Ring[] = [];
  let cur: Ring = [];
  rotated.forEach((p, i) => { if (cuts.has(i) && cur.length) { parts.push(cur); cur = []; } cur.push(p); });
  if (cur.length) parts.push(cur);
  return parts.filter((p) => p.length > 2);
}

/** SVG paths of every country (Antarctica left out) and the point of each one's bubble: the centre of its largest landmass. */
export function buildWorld(features: AtlasFeature[]): WorldMap {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const countries: MapCountry[] = [];
  for (const f of features) {
    const name = f.properties?.name ?? '';
    const code = f.id != null && f.id !== '' ? NUMERIC_TO_ALPHA2[String(f.id).padStart(3, '0')] : UNNUMBERED[name];
    if (!code || code === 'AQ') continue;
    let d = ''; let best = { area: -1, c: [0, 0] as [number, number] };
    for (const poly of polygonsOf(f.geometry)) {
      poly.forEach((ring, ri) => {
        for (const part of splitAtAntimeridian(ring)) {
          const pts = part.map(([lon, lat]) => project(lon!, lat!));
          for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          d += `M${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}Z`;
          if (ri === 0) { const rc = ringCentroid(pts); if (rc.area > best.area) best = rc; }
        }
      });
    }
    if (d) countries.push({ code, name, d, center: [r1(best.c[0]), r1(best.c[1])] });
  }
  if (!countries.length) { minX = -490; maxX = 490; minY = -260; maxY = 160; }
  const pad = 6;
  const x0 = Math.floor(minX - pad); const y0 = Math.floor(minY - pad);
  const width = Math.ceil(maxX + pad) - x0; const height = Math.ceil(maxY + pad) - y0;
  return { viewBox: `${x0} ${y0} ${width} ${height}`, width, height, countries };
}

/** Where a country's bubble goes: the centre of its shape, else (small countries the 1:110m atlas has no shape for) a point inside it. */
export function pointFor(code: string, world: Pick<WorldMap, 'countries'>): [number, number] | null {
  const shape = world.countries.find((c) => c.code === code);
  if (shape) return shape.center;
  const p = COUNTRY_POINTS[code];
  return p ? project(p[0], p[1]) : null;
}

/** Bubble radius in map units: the area grows with the number of visitors (square root), from 4 to 18. */
export const bubbleRadius = (visitors: number, max: number) => (max <= 0 ? 4 : 4 + 14 * Math.sqrt(Math.max(0, visitors) / max));
