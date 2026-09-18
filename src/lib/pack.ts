/**
 * Packs the roster's shapes into the unit box.
 *
 * What is DATA and what is LAYOUT, because the plate is only honest if the two
 * are not confused:
 *
 *   data    every shape's area and outline, and therefore the total white.
 *   layout  where each shape sits. Deterministic, and free to be anything.
 *
 * The white a reader sees is exactly `1 - Σ area` wherever the shapes land, so
 * the arrangement cannot overstate or understate a roster. What the arrangement
 * DOES show is the video's point: a triangle or a star cannot sit flush against
 * its neighbours, so the white collects around the awkward shapes.
 *
 * Method: a squarified treemap gives every shape a home cell sized to its area
 * (so big shapes spread across the box instead of piling into a corner), then
 * shapes are placed largest first at the free position nearest their home,
 * trying each turn of the outline. Nothing is random — the same roster always draws the same plate.
 */

import {
  boundsOf,
  boundsOverlap,
  polygonsOverlap,
  SHAPE_ROTATIONS,
  scaleAboutOrigin,
  shapePolygon,
  translate,
  type Bounds,
  type Point,
  type ShapeKind,
} from './geometry';

export interface PackItem {
  id: number;
  kind: ShapeKind;
  /** Share of the unit box, 0..1. */
  area: number;
  aspect: number;
  /** Superellipse exponent, `super` only. */
  exponent?: number;
  /** Room to reserve UNDER the shape for a name that does not fit inside it, in box units. */
  label?: { w: number; h: number };
}

export interface PlacedShape {
  id: number;
  kind: ShapeKind;
  area: number;
  cx: number;
  cy: number;
  /** Radians the outline was turned by to make it fit. */
  rotation: number;
  /** Absolute vertices in the unit box (a circle's are its collision outline). */
  points: Point[];
  bounds: Bounds;
  /** Centre of the reserved outside label, when the item asked for one. */
  labelAt?: Point;
}

export interface PackResult {
  shapes: PlacedShape[];
  /**
   * 1 when every shape was drawn at its true area. Below 1 the box was too
   * full for these outlines and EVERY shape was shrunk by this linear factor
   * to fit; the page must say so, because areas no longer sum to the fill.
   */
  fitScale: number;
}

/** Clear space kept between shapes, in box units. */
const GAP = 0.009;
/** Clear space kept from the wall. Zero: his shapes touch the frame, and at a box the size he draws it every hundredth counts. */
const WALL = 0;
/** Candidate positions per axis: coarse when aiming for a home, fine when packing tight. */
const GRID: Record<Strategy, number> = { home: 72, corner: 144 };
const SHRINK_STEP = 0.97;
const MIN_FIT_SCALE = 0.7;
/** Restarts allowed per strategy when a shape finds no room. */
const MAX_BUMPS = 16;

type Strategy = 'home' | 'corner';

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk) over the unit square. `areas`
 * must be sorted descending; they are normalised to fill the box, so a cell is
 * the shape's share of the ROSTER, not of the perfect team — it is a home to
 * aim for, not a quantity anyone reads.
 */
export function treemapCells(areas: number[]): Cell[] {
  const total = areas.reduce((s, a) => s + a, 0);
  const cells: Cell[] = new Array(areas.length);
  if (total <= 0) return cells.fill({ x: 0, y: 0, w: 1, h: 1 });

  const norm = areas.map((a) => a / total);
  let free: Cell = { x: 0, y: 0, w: 1, h: 1 };
  let i = 0;

  const worst = (row: number[], side: number) => {
    const sum = row.reduce((s, a) => s + a, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (i < norm.length) {
    const side = Math.min(free.w, free.h);
    const row: number[] = [norm[i]];
    let j = i + 1;
    while (j < norm.length && worst([...row, norm[j]], side) <= worst(row, side)) {
      row.push(norm[j]);
      j++;
    }
    const sum = row.reduce((s, a) => s + a, 0);
    const horizontal = free.w >= free.h; // lay the row along the short side
    const thickness = sum / side;
    let offset = 0;
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thickness;
      cells[i + k] = horizontal
        ? { x: free.x, y: free.y + offset, w: thickness, h: len }
        : { x: free.x + offset, y: free.y, w: len, h: thickness };
      offset += len;
    }
    free = horizontal
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    i = j;
  }
  return cells;
}

function inflate(outline: Point[], gap: number): Point[] {
  const b = boundsOf(outline);
  const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  return scaleAboutOrigin(outline, (radius + gap) / radius);
}

/**
 * One placement pass. `order` indexes into `items`; `homes` stay tied to the
 * ITEM, so re-ordering changes who chooses first, not where anyone is aiming.
 * Returns the index (into `order`) of the first shape with nowhere to go.
 */
function placeAll(
  items: PackItem[],
  homes: Cell[],
  order: number[],
  linearScale: number,
  strategy: Strategy,
): { placed: PlacedShape[] } | { failedAt: number } {
  const placed: PlacedShape[] = [];
  // Inflated copies are what collide, so GAP is honoured between every pair.
  const placedInflated: { pts: Point[]; bounds: Bounds }[] = [];

  for (let n = 0; n < order.length; n++) {
    const item = items[order[n]];
    const cell = homes[order[n]];
    const homeX = cell.x + cell.w / 2;
    const homeY = cell.y + cell.h / 2;
    const area = item.area * linearScale * linearScale;

    let rotations = SHAPE_ROTATIONS[item.kind];
    // Lay a rectangle along its cell first; ties keep the first rotation tried.
    if (item.kind === 'rect' && cell.h > cell.w) rotations = [...rotations].reverse();

    let best: { d: number; cx: number; cy: number; rotation: number; outline: Point[] } | null = null;

    for (const rotation of rotations) {
      const outline = shapePolygon(item.kind, area, item.aspect, rotation, item.exponent);
      const fat = inflate(outline, GAP / 2);
      const ob = boundsOf(outline);
      const fb = boundsOf(fat);

      const grid = GRID[strategy];
      for (let gy = 0; gy <= grid; gy++) {
        const cy = gy / grid;
        if (cy + ob.minY < WALL || cy + ob.maxY > 1 - WALL) continue;
        for (let gx = 0; gx <= grid; gx++) {
          const cx = gx / grid;
          if (cx + ob.minX < WALL || cx + ob.maxX > 1 - WALL) continue;
          const d =
            strategy === 'home'
              ? (cx - homeX) ** 2 + (cy - homeY) ** 2
              : // Tight: push the shape's far corner toward the origin.
                (cy + ob.maxY) * 4 + (cx + ob.maxX);
          if (best && d >= best.d) continue;

          const bounds: Bounds = {
            minX: cx + fb.minX,
            minY: cy + fb.minY,
            maxX: cx + fb.maxX,
            maxY: cy + fb.maxY,
          };
          let moved: Point[] | null = null;
          let clash = false;
          for (const other of placedInflated) {
            if (!boundsOverlap(bounds, other.bounds)) continue;
            moved ??= translate(fat, cx, cy);
            if (polygonsOverlap(moved, other.pts)) {
              clash = true;
              break;
            }
          }
          if (!clash) best = { d, cx, cy, rotation, outline };
        }
      }
    }

    if (!best) return { failedAt: n };

    const points = translate(best.outline, best.cx, best.cy);
    placed.push({
      id: item.id,
      kind: item.kind,
      area,
      cx: best.cx,
      cy: best.cy,
      rotation: best.rotation,
      points,
      bounds: boundsOf(points),
    });
    const fatPts = translate(inflate(best.outline, GAP / 2), best.cx, best.cy);
    placedInflated.push({ pts: fatPts, bounds: boundsOf(fatPts) });
  }

  return { placed };
}

/**
 * Pack at one scale. A shape that finds no room is moved to the FRONT of the
 * queue and the pass restarts: the awkward shape claims its space first and the
 * easy ones flow round it. If home-seeking still cannot fit the roster, a tight
 * corner pack is tried before the caller gives up on this scale.
 */
function tryPack(items: PackItem[], linearScale: number): PlacedShape[] | null {
  const homes = treemapCells(items.map((it) => it.area));

  // Widest-first is the classic opener for a tight pack: the shape hardest to
  // find room for (a big star, a long rectangle) goes in while the box is empty.
  const extent = items.map((it) => {
    const b = boundsOf(shapePolygon(it.kind, it.area, it.aspect, 0, it.exponent));
    return Math.max(b.maxX - b.minX, b.maxY - b.minY);
  });
  const byArea = items.map((_, i) => i);
  const byExtent = [...byArea].sort((a, b) => extent[b] - extent[a]);
  const plans: { strategy: Strategy; order: number[] }[] = [
    { strategy: 'home', order: byArea },
    { strategy: 'corner', order: byArea },
    { strategy: 'corner', order: byExtent },
  ];

  for (const plan of plans) {
    let order = plan.order;
    // An order that places the same outlines in the same sequence fails the
    // same way; bumping one of two equal shapes must not buy a full re-scan.
    const tried = new Set<string>();
    for (let attempt = 0; attempt < MAX_BUMPS; attempt++) {
      const signature = `${plan.strategy}|${order.map((i) => `${items[i].kind}:${items[i].area}:${items[i].aspect}:${items[i].exponent ?? ''}`).join(',')}`;
      if (tried.has(signature)) break;
      tried.add(signature);
      const result = placeAll(items, homes, order, linearScale, plan.strategy);
      if ('placed' in result) return result.placed;
      if (result.failedAt === 0) break; // the first shape alone does not fit
      const bumped = order[result.failedAt];
      order = [bumped, ...order.filter((i) => i !== bumped)];
    }
  }
  return null;
}

export function packShapes(input: PackItem[]): PackResult {
  const items = [...input].filter((it) => it.area > 0).sort((a, b) => b.area - a.area || a.id - b.id);
  if (items.length === 0) return { shapes: [], fitScale: 1 };

  let scale = 1;
  while (scale >= MIN_FIT_SCALE) {
    const shapes = tryPack(items, scale);
    if (shapes) return { shapes, fitScale: scale };
    scale *= SHRINK_STEP;
  }
  // Unreachable for a real roster (the box is never that full); an empty plate
  // with the list beside it is better than overlapping shapes.
  return { shapes: [], fitScale: 0 };
}

/** Gap between a small shape and the name written under it. */
const LABEL_GAP = 0.004;

/**
 * Fit the small shapes into whatever room a finished pack left, without moving
 * anything, each AT ITS TRUE AREA. A shape too small to hold its name reserves a
 * box under itself for it, so a label can never land on a neighbour. Each goes
 * to the most open free spot (largest clearance), so they collect in the white.
 * Returns the ones placed; the caller lists any it could not (a box with no room
 * at all), rather than shrinking one to make it fit.
 */
export function placeExtras(placed: PlacedShape[], extras: PackItem[]): PlacedShape[] {
  const grid = 120;
  const solids: { pts: Point[]; bounds: Bounds }[] = [];
  const addSolid = (pts: Point[]) => solids.push({ pts, bounds: boundsOf(pts) });
  for (const s of placed) {
    const centred = translate(s.points, -s.cx, -s.cy);
    addSolid(translate(inflate(centred, GAP / 2), s.cx, s.cy));
  }
  const out: PlacedShape[] = [];

  for (const item of extras) {
    let best: { score: number; cx: number; cy: number; rotation: number; outline: Point[]; label: Point[] | null } | null = null;
    // With its name first; if the pair fits nowhere, the SHAPE still goes in and
    // only the name is given up (the table and the hover carry it).
    for (const withLabel of item.label ? [true, false] : [false]) {
    if (best) break;
    for (const rotation of SHAPE_ROTATIONS[item.kind]) {
      const outline = shapePolygon(item.kind, item.area, item.aspect, rotation, item.exponent);
      const ob = boundsOf(outline);
      const fat = inflate(outline, GAP / 2);
      // The label box hangs under the shape, centred on it.
      const label: Point[] | null = withLabel && item.label
        ? [
            { x: -item.label.w / 2, y: ob.maxY + LABEL_GAP },
            { x: item.label.w / 2, y: ob.maxY + LABEL_GAP },
            { x: item.label.w / 2, y: ob.maxY + LABEL_GAP + item.label.h },
            { x: -item.label.w / 2, y: ob.maxY + LABEL_GAP + item.label.h },
          ]
        : null;
      const parts = label ? [fat, label] : [fat];
      const whole = boundsOf(parts.flat());

      for (let gy = 0; gy <= grid; gy++) {
        const cy = gy / grid;
        if (cy + whole.minY < WALL || cy + whole.maxY > 1 - WALL) continue;
        for (let gx = 0; gx <= grid; gx++) {
          const cx = gx / grid;
          if (cx + whole.minX < WALL || cx + whole.maxX > 1 - WALL) continue;
          // Clearance: distance to the nearest neighbour's bounds, capped by the wall.
          let clearance = Math.min(cx, cy, 1 - cx, 1 - cy);
          for (const o of solids) {
            const dx = Math.max(o.bounds.minX - cx, 0, cx - o.bounds.maxX);
            const dy = Math.max(o.bounds.minY - cy, 0, cy - o.bounds.maxY);
            const dist = Math.hypot(dx, dy);
            if (dist < clearance) clearance = dist;
          }
          if (best && clearance <= best.score) continue;
          const bounds: Bounds = { minX: cx + whole.minX, minY: cy + whole.minY, maxX: cx + whole.maxX, maxY: cy + whole.maxY };
          let clash = false;
          let moved: Point[][] | null = null;
          for (const o of solids) {
            if (!boundsOverlap(bounds, o.bounds)) continue;
            moved ??= parts.map((part) => translate(part, cx, cy));
            if (moved.some((part) => polygonsOverlap(part, o.pts))) {
              clash = true;
              break;
            }
          }
          if (!clash) best = { score: clearance, cx, cy, rotation, outline, label };
        }
      }
    }
    }
    if (!best) continue;
    const points = translate(best.outline, best.cx, best.cy);
    const shape: PlacedShape = { id: item.id, kind: item.kind, area: item.area, cx: best.cx, cy: best.cy, rotation: best.rotation, points, bounds: boundsOf(points) };
    addSolid(translate(inflate(best.outline, GAP / 2), best.cx, best.cy));
    if (best.label) {
      const box = translate(best.label, best.cx, best.cy);
      addSolid(box);
      const lb = boundsOf(box);
      shape.labelAt = { x: (lb.minX + lb.maxX) / 2, y: (lb.minY + lb.maxY) / 2 };
    }
    out.push(shape);
  }
  return out;
}
