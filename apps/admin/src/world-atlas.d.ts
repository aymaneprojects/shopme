// Country shapes of the world-atlas package (ISC, derived from Natural Earth, public domain), loaded on demand by the live view map.
declare module 'world-atlas/countries-110m.json' {
  import type { feature } from 'topojson-client';
  const topology: Parameters<typeof feature>[0];
  export default topology;
}
