/**
 * Geometry for the roster-shape plate (`README.md`).
 *
 * Every shape is built to an EXACT area, because area is the one quantity the
 * plate encodes: a player's value over replacement. The outline (square,
 * pentagon, star…) is the archetype; it must never change how much ink a
 * player gets, or a star-shaped role player would read as smaller than the
 * square one who is worth the same.
 */

export type ShapeKind =
  | 'square'
  | 'rect'
  | 'octagon'
  | 'hexagon'
  | 'circle'
  | 'pentagon'
  | 'triangle'
  | 'diamond'
  | 'star'
  /** The continuous family: a superellipse whose exponent runs square → circle → diamond → star. */
  | 'super'
  /**
   * The awkward families: m-pointed outlines whose one parameter is the inner
   * radius as a share of the outer. Blunt (near 1) they are a hexagon, an octagon,
   * a decagon; at cos(π/m) a triangle, a diamond, a pentagon; sharper still, stars.
   */
  | 'tri'
  | 'quad'
  | 'penta'
  | 'burst'
  /** A clean rectangle with a V-shaped notch: one specific flaw on an otherwise easy fit. `param` is the notch depth as a share of the height. */
  | 'notched';

export type PointedKind = 'tri' | 'quad' | 'penta' | 'burst';
export const POINTS: Record<PointedKind, number> = { tri: 3, quad: 4, penta: 5, burst: 12 };
export const isPointed = (k: ShapeKind): k is PointedKind => k === 'tri' || k === 'quad' || k === 'penta' || k === 'burst';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Inner-to-outer radius of the four-point star. */
const STAR_INNER_RATIO = 0.45;
/** Segments used for a circle's COLLISION outline (it is drawn as a real circle). */
const CIRCLE_SEGMENTS = 36;

function regularPolygon(sides: number, circumradius: number, startAngle: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i * 2 * Math.PI) / sides;
    pts.push({ x: circumradius * Math.cos(a), y: circumradius * Math.sin(a) });
  }
  return pts;
}

function regularCircumradius(sides: number, area: number): number {
  return Math.sqrt((2 * area) / (sides * Math.sin((2 * Math.PI) / sides)));
}

/** Radius of the circle of a given area. */
export function circleRadius(area: number): number {
  return Math.sqrt(area / Math.PI);
}

/**
 * Vertices of a shape of `area`, centred on the origin, y pointing DOWN (SVG).
 *
 * `aspect` is width / height and only applies to `rect`. `rotation` (radians)
 * turns the outline about its centre; the packer tries the turns in
 * `SHAPE_ROTATIONS`, which are the ones that change how a shape nests.
 */
/** `param` is the superellipse exponent for `super`, and the inner-radius ratio for the pointed kinds. */
export function shapePolygon(kind: ShapeKind, area: number, aspect = 1, rotation = 0, param = 2, segments = 56): Point[] {
  const base = kind === 'super' ? superellipse(area, aspect, param, segments) : isPointed(kind) ? pointed(POINTS[kind], param, area) : kind === 'notched' ? notched(area, aspect, param) : baseOutline(kind, area, aspect);
  if (rotation === 0) return base;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return base.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

const QUARTER = Math.PI / 2;

/** The distinct turns worth trying per outline. A square or circle has one. */
export const SHAPE_ROTATIONS: Record<ShapeKind, number[]> = {
  square: [0],
  rect: [0, QUARTER],
  octagon: [0],
  hexagon: [0, Math.PI / 6],
  circle: [0],
  pentagon: [0, Math.PI, QUARTER, -QUARTER],
  triangle: [0, Math.PI, QUARTER, -QUARTER],
  diamond: [0],
  star: [0, Math.PI / 4, Math.PI / 8, -Math.PI / 8],
  // Only the quarter turn. A diamond turned 45° IS a square, so letting the
  // packer do that would hand a hard-to-fit player the best-tiling outline.
  super: [0, QUARTER],
  // Point up or point down. NOT the in-between turns: a diamond turned 45° is a
  // square, and an awkward player would be handed the best-tiling outline.
  tri: [0, Math.PI],
  quad: [0],
  penta: [0, Math.PI],
  burst: [0],
  notched: [0, Math.PI],
};

/** A rectangle (width = aspect × height) with a V notch cut into its bottom edge, scaled to the exact area. */
function notched(area: number, aspect: number, depth: number): Point[] {
  const h = 1;
  const w = aspect;
  const pts: Point[] = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: 0, y: h / 2 - depth * h },
    { x: -w / 2, y: h / 2 },
  ];
  const k = Math.sqrt(area / polygonArea(pts));
  return pts.map((p) => ({ x: p.x * k, y: p.y * k }));
}

/** An m-pointed outline, first point up, inner vertices at `ratio` of the outer radius, scaled to the exact area. */
function pointed(m: number, ratio: number, area: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 2 * m; i++) {
    const r = i % 2 === 0 ? 1 : ratio;
    const a = -Math.PI / 2 + (i * Math.PI) / m;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const k = Math.sqrt(area / polygonArea(pts));
  return pts.map((p) => ({ x: p.x * k, y: p.y * k }));
}

/** Share of its bounding box an m-pointed outline fills, measured on the polygon itself. */
export function pointedFill(m: number, ratio: number): number {
  const pts = pointed(m, ratio, 1);
  const b = boundsOf(pts);
  return 1 / ((b.maxX - b.minX) * (b.maxY - b.minY));
}

/** Sharpest and bluntest the awkward outlines are drawn. */
export const POINTED_RATIO_MIN = 0.3;
export const POINTED_RATIO_MAX = 0.97;

/** The inner ratio at which an m-pointed outline fills `fill` of its box (clamped to what the family can reach). */
export function ratioForFill(m: number, fill: number): number {
  let lo = POINTED_RATIO_MIN;
  let hi = POINTED_RATIO_MAX;
  if (fill <= pointedFill(m, lo)) return lo;
  if (fill >= pointedFill(m, hi)) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (pointedFill(m, mid) < fill) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * |x/a|^n + |y/b|^n = 1. One parameter spans the video's whole vocabulary:
 * n → ∞ a square, n = 2 a circle, n = 1 a diamond, n < 1 a four-point star.
 * The share of its bounding box it fills falls monotonically with n
 * (`superellipseFill`), which is what lets a measured quantity pick n.
 * Built as a polygon and then scaled to the EXACT area asked for.
 */
function superellipse(area: number, aspect: number, n: number, segments: number): Point[] {
  const pts: Point[] = [];
  const e = 2 / n;
  for (let i = 0; i < segments; i++) {
    const t = (i * 2 * Math.PI) / segments;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push({ x: aspect * Math.sign(c) * Math.abs(c) ** e, y: Math.sign(s) * Math.abs(s) ** e });
  }
  const k = Math.sqrt(area / polygonArea(pts));
  return pts.map((p) => ({ x: p.x * k, y: p.y * k }));
}

/** Lanczos approximation, accurate to ~1e-13 for the arguments used here (1 to 5). */
function gamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const z = x - 1;
  let a = c[0];
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a;
}

/** Share of its bounding box a superellipse of exponent n fills: 1 for a square, π/4 for a circle, ½ for a diamond. */
export function superellipseFill(n: number): number {
  return gamma(1 + 1 / n) ** 2 / gamma(1 + 2 / n);
}

/** The exponent whose superellipse fills `fill` of its bounding box (bisection; fill is monotone in n). */
export function exponentForFill(fill: number): number {
  let lo = 0.3;
  let hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    if (superellipseFill(mid) < fill) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

function baseOutline(kind: Exclude<ShapeKind, 'super' | PointedKind | 'notched'>, area: number, aspect: number): Point[] {
  const up = -Math.PI / 2;
  switch (kind) {
    case 'square': {
      const h = Math.sqrt(area) / 2;
      return [
        { x: -h, y: -h },
        { x: h, y: -h },
        { x: h, y: h },
        { x: -h, y: h },
      ];
    }
    case 'rect': {
      const height = Math.sqrt(area / aspect);
      const w = (aspect * height) / 2;
      const h = height / 2;
      return [
        { x: -w, y: -h },
        { x: w, y: -h },
        { x: w, y: h },
        { x: -w, y: h },
      ];
    }
    case 'octagon':
      return regularPolygon(8, regularCircumradius(8, area), Math.PI / 8);
    case 'hexagon':
      return regularPolygon(6, regularCircumradius(6, area), 0);
    case 'pentagon':
      return regularPolygon(5, regularCircumradius(5, area), up);
    case 'triangle':
      return regularPolygon(3, regularCircumradius(3, area), up);
    case 'diamond': {
      const d = Math.sqrt(area / 2);
      return [
        { x: 0, y: -d },
        { x: d, y: 0 },
        { x: 0, y: d },
        { x: -d, y: 0 },
      ];
    }
    case 'star': {
      // A 4-point star is an 8-gon alternating outer and inner radii; its area
      // is n * R * r * sin(pi / n) with n = 4.
      const R = Math.sqrt(area / (4 * STAR_INNER_RATIO * Math.sin(Math.PI / 4)));
      const pts: Point[] = [];
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? R : R * STAR_INNER_RATIO;
        const a = up + (i * Math.PI) / 4;
        pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
      }
      return pts;
    }
    case 'circle': {
      // Circumscribed, so the collision outline CONTAINS the drawn circle and a
      // neighbour can never be placed inside the arc between two vertices.
      const r = circleRadius(area) / Math.cos(Math.PI / CIRCLE_SEGMENTS);
      return regularPolygon(CIRCLE_SEGMENTS, r, 0);
    }
  }
}

export function polygonArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function boundsOf(pts: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function translate(pts: Point[], dx: number, dy: number): Point[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Scale about the origin — callers pass origin-centred outlines. */
export function scaleAboutOrigin(pts: Point[], k: number): Point[] {
  return pts.map((p) => ({ x: p.x * k, y: p.y * k }));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/**
 * Whether two simple polygons share any area. Works for the concave star, which
 * is why this is an edge-crossing + containment test rather than SAT.
 */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  // No edges PROPERLY cross: disjoint, nested, or coincident. Coincident is the
  // trap — two identical outlines on the same spot share every edge, so no
  // pair crosses and every vertex lies ON the other's boundary, which
  // point-in-polygon reports as outside. The centres settle it (every outline
  // here is symmetric about its own), and testing every vertex catches a small
  // shape whose first vertex happens to sit on a neighbour's edge.
  if (pointInPolygon(centreOf(a), b) || pointInPolygon(centreOf(b), a)) return true;
  return a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a));
}

function centreOf(pts: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
