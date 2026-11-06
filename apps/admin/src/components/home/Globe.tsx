import { useEffect, useRef } from 'react';
import { splitAtAntimeridian } from '../../lib/world-map';
import type { AtlasFeature } from '../../lib/world-map';

// Decorative dotted globe for the Home greeting. The country shapes of the world-atlas package (the ones of the live view) are painted
// once on a hidden equirectangular canvas; a regular lat/lon lattice is then kept where that mask is land, and the dots are drawn with an
// orthographic projection. Nothing here carries information: the canvas is aria-hidden and the page never depends on it.

const MASK_W = 720, MASK_H = 360;
const STEP = 2.7; // degrees between dot rows
type Dots = Float32Array; // lat, lon pairs in radians

let dotsPromise: Promise<Dots> | null = null;
function loadDots(): Promise<Dots> {
  dotsPromise ??= Promise.all([import('world-atlas/countries-110m.json'), import('topojson-client')]).then(([atlas, topo]) => {
    const topology = atlas.default;
    const fc = topo.feature(topology, topology.objects.countries as never) as unknown as { features: AtlasFeature[] };
    const mask = document.createElement('canvas');
    mask.width = MASK_W; mask.height = MASK_H;
    const g = mask.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no canvas');
    g.fillStyle = '#000';
    const at = (c: number[]) => [((c[0]! + 180) / 360) * MASK_W, ((90 - c[1]!) / 180) * MASK_H] as const;
    for (const f of fc.features) {
      const geom = f.geometry;
      if (!geom || f.properties?.name === 'Antarctica') continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates as number[][][]] : geom.type === 'MultiPolygon' ? (geom.coordinates as number[][][][]) : [];
      for (const poly of polys) {
        const path = new Path2D();
        for (const ring of poly) for (const part of splitAtAntimeridian(ring)) {
          part.forEach((c, i) => { const [x, y] = at(c); if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
          path.closePath();
        }
        g.fill(path, 'evenodd');
      }
    }
    const px = g.getImageData(0, 0, MASK_W, MASK_H).data;
    const out: number[] = [];
    for (let lat = -80; lat <= 84; lat += STEP) {
      const stepLon = STEP / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      for (let lon = -180; lon < 180; lon += stepLon) {
        const x = Math.min(MASK_W - 1, Math.floor(((lon + 180) / 360) * MASK_W)), y = Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H));
        if (px[(y * MASK_W + x) * 4 + 3]! > 100) out.push((lat * Math.PI) / 180, (lon * Math.PI) / 180);
      }
    }
    return new Float32Array(out);
  });
  return dotsPromise;
}

const FADE = 'radial-gradient(closest-side, #000 62%, transparent 100%)'; // the sphere melts into the page instead of ending on a hard edge
const TILT = 0.38; // radians: the north pole leans towards the viewer
const SIN_T = Math.sin(TILT), COS_T = Math.cos(TILT);

/** A point of interest on the globe (degrees); `n` sets its size relative to the others. */
export interface GlobeMarker { lat: number; lon: number; n: number; color?: string }

function draw(canvas: HTMLCanvasElement, dots: Dots, rotation: number, markers: GlobeMarker[] = []) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(canvas).color;
  const r = Math.min(w, h) / 2 - 2, cx = w / 2, cy = h / 2;
  const dot = Math.max(1, (r / 230) * 1.7);
  for (let i = 0; i < dots.length; i += 2) {
    const lat = dots[i]!, d = dots[i + 1]! - rotation;
    const cl = Math.cos(lat);
    const z = SIN_T * Math.sin(lat) + COS_T * cl * Math.cos(d);
    if (z <= 0.02) continue;
    const x = cl * Math.sin(d), y = COS_T * Math.sin(lat) - SIN_T * cl * Math.cos(d);
    g.globalAlpha = Math.min(1, 0.25 + z * 0.9);
    g.beginPath();
    g.arc(cx + x * r, cy - y * r, dot * (0.55 + z * 0.45), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const max = Math.max(1, ...markers.map((m) => m.n));
  const accent = getComputedStyle(canvas.parentElement ?? canvas).getPropertyValue('--color-accent').trim() || '#2563eb';
  for (const m of markers) {
    g.fillStyle = m.color ?? accent;
    const lat = (m.lat * Math.PI) / 180, d = (m.lon * Math.PI) / 180 - rotation, cl = Math.cos(lat);
    if (SIN_T * Math.sin(lat) + COS_T * cl * Math.cos(d) <= 0.02) continue;
    const x = cl * Math.sin(d), y = COS_T * Math.sin(lat) - SIN_T * cl * Math.cos(d), rad = dot * (2.5 + 4 * Math.sqrt(m.n / max));
    g.globalAlpha = 0.25; g.beginPath(); g.arc(cx + x * r, cy - y * r, rad * 2, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1; g.beginPath(); g.arc(cx + x * r, cy - y * r, rad, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/** Large, quiet dotted globe. Rotates slowly unless the visitor prefers reduced motion, in which case it is drawn once. */
export function DottedGlobe({ className, markers }: { className?: string; markers?: GlobeMarker[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const marks = useRef<GlobeMarker[]>([]);
  marks.current = markers ?? [];
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true, raf = 0, last = 0, spin = 0.9; // start over Europe and Africa
    let dots: Dots | null = null;
    const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const fit = () => {
      const k = Math.min(window.devicePixelRatio || 1, 2), s = canvas.clientWidth;
      if (s && canvas.width !== Math.round(s * k)) { canvas.width = canvas.height = Math.round(s * k); }
    };
    const paint = () => { if (dots) { fit(); draw(canvas, dots, spin, marks.current); } };
    const tick = (now: number) => {
      if (!live) return;
      if (now - last > 33) { spin += ((now - last) / 1000) * 0.05; last = now; paint(); }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(raf); paint(); if (!reduce?.matches) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    loadDots().then((d) => { if (live) { dots = d; start(); } }, () => undefined);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null;
    ro?.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    reduce?.addEventListener?.('change', start);
    return () => { live = false; cancelAnimationFrame(raf); ro?.disconnect(); theme.disconnect(); reduce?.removeEventListener?.('change', start); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" role="presentation" className={className} style={{ WebkitMaskImage: FADE, maskImage: FADE }} />;
}
