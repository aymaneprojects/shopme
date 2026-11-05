import { describe, expect, it } from 'vitest';
import { bubbleRadius, buildWorld, NUMERIC_TO_ALPHA2, pointFor, project, splitAtAntimeridian } from './world-map';

const square = (lon: number, lat: number, size: number) => [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]];

describe('live view world map', () => {
  it('projects with the Natural Earth projection (y grows downwards)', () => {
    expect(project(0, 0).map((v) => v + 0)).toEqual([0, 0]);
    const [x, y] = project(180, 0);
    expect(x).toBeCloseTo(Math.PI * 0.8707 * 180, 3);
    expect(y).toBeCloseTo(0, 6);
    expect(project(2, 48)[1]).toBeLessThan(0); // the north is up
    expect(project(-60, 0)[0]).toBeLessThan(0);
  });

  it('maps the atlas ids to ISO codes', () => {
    expect(NUMERIC_TO_ALPHA2['250']).toBe('FR');
    expect(NUMERIC_TO_ALPHA2['840']).toBe('US');
    expect(NUMERIC_TO_ALPHA2['826']).toBe('GB');
    expect(NUMERIC_TO_ALPHA2['036']).toBe('AU');
    expect(Object.values(NUMERIC_TO_ALPHA2).every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  });

  it('builds country paths, leaves Antarctica out and puts the bubble on the largest landmass', () => {
    const world = buildWorld([
      { id: '250', properties: { name: 'France' }, geometry: { type: 'MultiPolygon', coordinates: [square(-53, 3, 2), square(-4, 43, 10)] } },
      { id: '010', properties: { name: 'Antarctica' }, geometry: { type: 'Polygon', coordinates: square(-180, -90, 360) } },
      { properties: { name: 'Kosovo' }, geometry: { type: 'Polygon', coordinates: square(20, 42, 1) } },
    ]);
    expect(world.countries.map((c) => c.code)).toEqual(['FR', 'XK']);
    const fr = world.countries[0]!;
    expect(fr.d.match(/M/g)).toHaveLength(2);
    const [cx, cy] = project(1, 48);
    expect(fr.center[0]).toBeCloseTo(cx, 0);
    expect(fr.center[1]).toBeCloseTo(cy, 0);
    expect(world.viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
  });

  it('cuts rings that cross the 180° meridian so no line runs across the map', () => {
    const ring = [[170, 60], [180, 62], [-178, 64], [-175, 66], [-179, 67], [175, 66], [170, 60]];
    const parts = splitAtAntimeridian(ring);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(new Set(p.map(([lon]) => Math.sign(lon!))).size).toBe(1); // each piece stays on one side
    expect(parts.flat()).toHaveLength(6);
    expect(splitAtAntimeridian(square(0, 0, 5)[0]!)).toHaveLength(1);
  });

  it('places countries without a shape from the time zone coordinates, and sizes bubbles by area', () => {
    const world = buildWorld([]);
    const sg = pointFor('SG', world)!;
    const [x, y] = project(103.83, 1.28);
    expect(sg[0]).toBeCloseTo(x, 0);
    expect(sg[1]).toBeCloseTo(y, 0);
    expect(pointFor('ZZ', world)).toBeNull();
    expect(bubbleRadius(4, 4)).toBe(18);
    expect(bubbleRadius(1, 4)).toBe(11);
    expect(bubbleRadius(0, 0)).toBe(4);
  });
});
