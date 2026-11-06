import { buildWorld } from './world-map';
import type { AtlasFeature, WorldMap } from './world-map';

let worldPromise: Promise<WorldMap> | null = null;
/** The atlas (about 100 KB) is loaded the first time a live view opens, in its own chunk. */
export function loadWorld(): Promise<WorldMap> {
  worldPromise ??= Promise.all([import('world-atlas/countries-110m.json'), import('topojson-client')]).then(([atlas, topo]) => {
    const topology = atlas.default;
    const fc = topo.feature(topology, topology.objects.countries as never) as unknown as { features: AtlasFeature[] };
    return buildWorld(fc.features);
  });
  return worldPromise;
}
