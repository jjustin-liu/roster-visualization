/**
 * Roster shapes: a roster drawn as shapes in a box (`README.md`).
 * Pure — rows in, a plate out — so it is unit-tested and the build script only reads.
 */

import { boundsOf, circleRadius, shapePolygon, translate, type Point, type ShapeKind } from './geometry';
import {
  INSIDE_LABEL_SHARE,
  LABEL_CHAR_WIDTH,
  OUTSIDE_LABEL_FONT,
  PERFECT_TEAM_VALUE,
  REPLACEMENT_DPM,
  areaOf,
  classify,
  deficitBelowReplacement,
  valueOverReplacement,
  handlingOf,
  type ShapeInput,
} from './model';
import { packShapes, placeExtras, type PlacedShape } from './pack';
import { familyOf, fitLabel, flawsOf, outlineFor, portabilityOf, portabilityReason, referenceOutline, FILL_MAX, FLAW_NAMES_OUTLINE, PLAYOFF_NAMES_OUTLINE, type PortabilityModel, type StyleFamily } from './portability';

export * from './model';

/**
 * The most of the box these outlines have ever packed at true size is about
 * 0.75 (a hand can do 0.77: his diagrams). Above this share the packer is not
 * even tried; the smallest shapes overflow first until the rest is under it.
 */
export const PACK_CEILING = 0.8;
/** Room above each section of the strip under the box, in box units, for its heading. */
export const STRIP_HEADING = 0.06;

/**
 * How far past the box's edge a lone giant may reach, in box units per side.
 * A shape that is 99% of the box has no room for the packer's gap; a circle of
 * that area is wider than the box itself. Centred, it breaks the frame by that
 * much — which is the true reading: he alone is more than the box holds.
 */
export const GIANT_OVERHANG = 0.06;

/** One shape placed in the middle of the box, upright, at its true area; null if it would overhang the box by more than `GIANT_OVERHANG`. */
function centred(item: { id: number; kind: ShapeKind; area: number; aspect: number; exponent?: number }): PlacedShape | null {
  const points = translate(shapePolygon(item.kind, item.area, item.aspect, 0, item.exponent), 0.5, 0.5);
  const bounds = boundsOf(points);
  if (bounds.minX < -GIANT_OVERHANG || bounds.maxX > 1 + GIANT_OVERHANG || bounds.minY < -GIANT_OVERHANG || bounds.maxY > 1 + GIANT_OVERHANG) return null;
  return { id: item.id, kind: item.kind, area: item.area, cx: 0.5, cy: 0.5, rotation: 0, points, bounds };
}
export * from './portability';
export type { ShapeKind, Point } from './geometry';

export interface RosterShapePlayer {
  nbaId: number;
  name: string;
  position: string | null;
  minutes: number;
  games: number | null;
  oDpm: number;
  dDpm: number;
  dpm: number;
  /** Points per 100 of team margin above a replacement player, minutes-weighted. */
  value: number;
  /** The shape's share of the box: `value` to the calibrated power, over the box. */
  share: number;
  kind: ShapeKind;
  label: string;
  reason: string;
  /** True when his on-ball creation was estimated (rule-based fallback only). */
  estimated: boolean;
  /**
   * Points per 100 his lineups gain or lose beyond the sum of their DPM, from
   * the fitted model. It picks the outline. Null only under the rule-based fallback.
   */
  portability: number | null;
  /** …split by end of the floor. */
  portabilityOffense: number | null;
  portabilityDefense: number | null;
  /** The outline's parameter: a superellipse exponent for `super`, an inner-radius ratio for the pointed kinds; null under the fallback. */
  exponent: number | null;
  /** Which of the two rules named his outline, if either. */
  flaw: 'no offense' | 'no defense' | 'one skill' | 'one-way and narrow' | 'non-spacer' | 'on-ball' | 'playoff dropper' | 'hard to play in the playoffs' | null;
  /** The shape he drew, when this player-season is one of the 24 in his diagrams; the outline is his. */
  reference: string | null;
  /** Share of its bounding box his outline fills: how well it tiles. Linear in portability. */
  tiling: number | null;
  /** What kind of player his style scores describe. Picks the colour only. */
  family: StyleFamily | null;
  /**
   * `scale`: a solid shape whose area is his value, in the box. `overflow`: the
   * same solid shape, but the box was full before his turn — drawn in the strip
   * under it. `hollow`: at or below replacement — an outline, because he adds no
   * ink to the box, whose area is how far below replacement he was. All to scale.
   */
  display: 'scale' | 'overflow' | 'hollow';
  /** Points per 100 he cost the team against a replacement player; 0 unless `hollow`. */
  deficit: number;
  /** The name as written on the plate ("Towns", or "J. Williams" when a surname repeats). */
  plateLabel: string;
  /**
   * Where he is drawn. A `scale` shape is placed in the BOX (unit square). An
   * `overflow` shape or a `hollow` outline is placed in the strip UNDER the box,
   * in the same units and at the same scale (x 0..1, y 0..`belowHeight`), each
   * in its own section (`stripSections`). Null only when his area is exactly zero.
   */
  placement: {
    cx: number;
    cy: number;
    points: Point[];
    /** Set for circles, which are drawn as circles rather than as their outline. */
    radius: number | null;
    /** Centre and width of the horizontal run through the shape, for fitting a label. */
    labelX: number;
    labelWidth: number;
    /** Where the name goes when it is written BESIDE the shape; null when it fits inside. */
    labelOutside: Point | null;
    /** Drawn area, aspect and turn, so a renderer can redraw the curve at any resolution. */
    area: number;
    aspect: number;
    rotation: number;
  } | null;
}

export interface RosterShapePlate {
  players: RosterShapePlayer[];
  /** Σ share of every player with positive value, in the box or under it. Above 1 when the roster is bigger than the box. */
  fill: number;
  /** The share of the box actually covered: Σ share of the players packed INSIDE it. */
  inBox: number;
  /** Roster value (linear, points per 100 above replacement) and the box's size in area units. */
  value: number;
  perfectValue: number;
  replacementDpm: number;
  /** Always 1: a plate is never shrunk. Kept so a renderer can assert it. */
  fitScale: number;
  /** How many valued players the box could not hold at true size (drawn under it). */
  overflow: number;
  /** Height of the strip under the box in box units; 0 when nobody is in it. */
  belowHeight: number;
  /** The strip's sections, top to bottom, each starting at `y` (box units, from the strip's top). */
  stripSections: { kind: 'overflow' | 'below'; y: number }[];
}

/**
 * The horizontal run through a shape at height `cy`: where a label can sit.
 * A triangle turned on its side is widest AWAY from its centroid, so the label
 * is anchored to the middle of this run rather than to `cx`.
 */
function chordAt(points: Point[], cy: number): { x: number; width: number } | null {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y === b.y) continue;
    if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
      xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { x: (min + max) / 2, width: max - min };
}

/** "Karl-Anthony Towns" → "Towns"; a repeated surname gets its initial. */
export function plateLabels(players: { nbaId: number; name: string }[]): Map<number, string> {
  // The last word, keeping a generational suffix with it: "James Michael McAdoo"
  // is "McAdoo", "Jaime Jaquez Jr." is "Jaquez Jr.".
  const surname = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[parts.length - 1]);
    return suffix && parts.length > 2 ? parts.slice(-2).join(' ') : parts[parts.length - 1];
  };
  const counts = new Map<string, number>();
  for (const p of players) counts.set(surname(p.name), (counts.get(surname(p.name)) ?? 0) + 1);
  return new Map(
    players.map((p) => {
      const s = surname(p.name);
      return [p.nbaId, (counts.get(s) ?? 0) > 1 ? `${p.name[0]}. ${s}` : s];
    }),
  );
}

/**
 * `model` is the fitted portability model (data/model.json). With it, every
 * outline is MEASURED: it is the tier of the player's portability. Without it
 * (or for a player missing style stats) the hand-written rules in `classify`
 * are the fallback.
 */
export interface PlateOptions {
  /** The box's size in area units; the calibrated constant when not given. The site sizes it per season (`src/lib/season.ts`). */
  box?: number;
}

/**
 * A player's value with his playoff reading applied (`ShapeInput.playoff`): DPM
 * moved by his measured playoff offense change, minutes share by his playoff
 * playability. A player with no reading is his regular-season self.
 */
export function playoffValue(p: ShapeInput, teamMinutes: number): { dpm: number; value: number; deficit: number } {
  const adj = p.playoff ?? { dpmDelta: 0, shareScale: 1 };
  const dpm = p.oDpm + p.dDpm + adj.dpmDelta;
  return {
    dpm,
    value: valueOverReplacement(dpm, p.minutes * adj.shareScale, teamMinutes, p.games),
    deficit: deficitBelowReplacement(dpm, p.minutes * adj.shareScale, teamMinutes, p.games),
  };
}

/** A roster's total area in box units before any box is chosen: Σ areaOf(value over replacement). */
export function rosterArea(inputs: ShapeInput[]): number {
  const teamMinutes = inputs.reduce((s, p) => s + Math.max(0, p.minutes), 0);
  return inputs.reduce((s, p) => s + areaOf(playoffValue(p, teamMinutes).value), 0);
}

export function buildRosterShapePlate(inputs: ShapeInput[], model?: PortabilityModel, season?: number, opts: PlateOptions = {}): RosterShapePlate {
  const teamMinutes = inputs.reduce((s, p) => s + Math.max(0, p.minutes), 0);
  const BOX = opts.box ?? PERFECT_TEAM_VALUE;

  const rated = inputs.map((p) => {
    // His value is his playoff value when he has a playoff reading: DPM moved
    // by his measured offense change, minutes share by his playability. The
    // team's minutes stay the regular season's, so the shares are on one scale.
    const { dpm, value, deficit } = playoffValue(p, teamMinutes);
    // The drawn area: his value, or for a hollow outline his deficit — both to the
    // calibrated power, as a share of the box.
    const area = areaOf(value > 0 ? value : deficit) / BOX;
    let archetype = classify(p);
    let fitted: { total: number; offense: number; defense: number; exponent: number; tiling: number; family: StyleFamily; flaw: RosterShapePlayer['flaw']; reference: string | null } | null = null;
    if (model && p.style) {
      const lp = { style: p.style, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm, handling: handlingOf(p), playoff: p.playoff ?? null, position: p.position };
      const port = portabilityOf(model, lp);
      const flaws = flawsOf(model, lp, season);
      const entry = model.wyman.reference.find((e) => e.name === p.name && e.season === season);
      const outline = entry ? referenceOutline(entry, Math.max(0, -port.style[0] - 0.5)) : outlineFor(model, port, flaws, p.oDpm + p.dDpm);
      const way = flaws.oneWay.gross >= FLAW_NAMES_OUTLINE;
      const narrow = flaws.oneSkill.penalty >= FLAW_NAMES_OUTLINE;
      // A cap names a smooth outline only when it is what held the fill down; the playoff cap takes precedence over the on-ball cap when both bind.
      const dropper = flaws.playoff.cap < FILL_MAX - PLAYOFF_NAMES_OUTLINE && outline.fitFill <= flaws.playoff.cap + 1e-9;
      const onBall = flaws.onBall.cap < FILL_MAX - 1e-9 && outline.fitFill <= flaws.onBall.cap + 1e-9;
      const flaw = entry
        ? null
        : outline.kind === 'super'
          ? dropper
            ? ('playoff dropper' as const)
            : onBall
              ? ('on-ball' as const)
              : null
          : outline.kind === 'notched'
            ? ('non-spacer' as const)
            : flaws.playoff.unplayable
              ? ('hard to play in the playoffs' as const)
              : way && narrow
                ? ('one-way and narrow' as const)
                : way
                  ? flaws.oneWay.end === 'offense'
                    ? ('no offense' as const)
                    : ('no defense' as const)
                  : ('one skill' as const);
      fitted = { total: port.total, offense: port.offense, defense: port.defense, exponent: outline.param, tiling: outline.fill, family: familyOf(port.style), flaw, reference: entry?.shape ?? null };
      archetype = { kind: outline.kind, aspect: outline.aspect, label: entry ? `His diagram: ${entry.shape}` : fitLabel(outline.fill), reason: (entry ? 'Drawn as in his Wyman diagram. ' : '') + portabilityReason(port, flaws), estimated: false };
    }
    return { p, dpm, value, deficit, area, share: value > 0 ? area : 0, archetype, fitted };
  });
  const labels = plateLabels(inputs);

  const labelBox = (r: (typeof rated)[number]) => ({
    w: (labels.get(r.p.nbaId) ?? r.p.name).length * LABEL_CHAR_WIDTH * OUTSIDE_LABEL_FONT,
    h: OUTSIDE_LABEL_FONT * 1.25,
  });
  // A shape too big to fit the box at its drawn aspect is drawn squarer: the
  // aspect is cosmetic (an interior big is drawn long), and a 2004 Garnett is
  // nearly the whole box.
  const aspectOf = (r: (typeof rated)[number]) => Math.min(r.archetype.aspect, Math.max(1, 0.94 / Math.max(r.area, 1e-9)));
  const asItem = (r: (typeof rated)[number]) => ({ id: r.p.nbaId, kind: r.archetype.kind, area: r.area, aspect: aspectOf(r), exponent: r.fitted?.exponent });

  // ── The box: everyone with value, at true size, largest first ─────────────
  // Shapes big enough to carry their own name are packed first; the small ones
  // are then fitted into the white with room reserved under each for its name.
  // The box is a fixed size and nothing is ever shrunk, so a roster the box
  // cannot hold OVERFLOWS: shapes are taken largest first and one that no
  // longer fits is drawn in the strip under the box, at the same scale, while
  // the smaller ones behind it still get their turn. `overflow` counts them.
  const valued = rated.filter((r) => r.value > 0).sort((a, b) => b.area - a.area);
  let main = valued.filter((r) => r.area >= INSIDE_LABEL_SHARE);
  let small = valued.filter((r) => r.area < INSIDE_LABEL_SHARE);
  const overflow: typeof rated = [];
  const areaOfList = (list: typeof rated) => list.reduce((s, r) => s + r.area, 0);
  let packed = areaOfList(main) <= PACK_CEILING ? packShapes(main.map(asItem)) : { shapes: [] as PlacedShape[], fitScale: 0 };
  if (packed.fitScale < 1) {
    // The usual pack failed (or was never possible): take the shapes one at a
    // time, largest first, and overflow each one the box cannot take.
    const inside: typeof rated = [];
    packed = { shapes: [], fitScale: 1 };
    for (const r of main) {
      if (inside.length > 0 && areaOfList(inside) + r.area > PACK_CEILING) {
        overflow.push(r);
        continue;
      }
      let attempt = packShapes([...inside, r].map(asItem));
      // A lone shape that is nearly the whole box (a 2004 Garnett is 99% of
      // it) has no room for the packer's gap: it is simply centred.
      if (attempt.fitScale < 1 && inside.length === 0) {
        const alone = centred(asItem(r));
        if (alone) attempt = { shapes: [alone], fitScale: 1 };
      }
      if (attempt.fitScale < 1) {
        overflow.push(r);
        continue;
      }
      inside.push(r);
      packed = attempt;
    }
    main = inside;
  }
  const fitSmall = () => placeExtras(packed.shapes, small.map((r) => ({ ...asItem(r), label: labelBox(r) })));
  let extras = fitSmall();
  // A small shape that finds no gap joins the main pack (and gives up its name);
  // if the pack no longer fits at true size, it overflows instead.
  for (let round = 0; round < 4; round++) {
    const stranded = small.filter((r) => !extras.some((e) => e.id === r.p.nbaId));
    if (stranded.length === 0) break;
    const tryPacked = packShapes([...main, ...stranded].map(asItem));
    small = small.filter((r) => !stranded.includes(r));
    if (tryPacked.fitScale < 1) {
      overflow.push(...stranded);
      break;
    }
    main = [...main, ...stranded];
    packed = tryPacked;
    extras = fitSmall();
  }
  const { shapes, fitScale } = packed;
  const overflowIds = new Set(overflow.map((r) => r.p.nbaId));
  const displayOf = (r: (typeof rated)[number]) => (r.value > 0 ? (overflowIds.has(r.p.nbaId) ? ('overflow' as const) : ('scale' as const)) : ('hollow' as const));

  // ── Under the box: overflow shapes, then below-replacement outlines ───────
  // Same scale. A plain shelf layout per section, largest first, each shape with
  // its name under it, and a heading's worth of room above each section.
  const ROW_GAP = 0.02;
  const COL_GAP = 0.025;
  const under: PlacedShape[] = [];
  const stripSections: RosterShapePlate['stripSections'] = [];
  let y = 0;
  const shelf = (kind: 'overflow' | 'below', list: typeof rated) => {
    if (list.length === 0) return;
    stripSections.push({ kind, y });
    y += STRIP_HEADING;
    let x = 0;
    let rowHeight = 0;
    for (const r of list) {
      const outline = shapePolygon(r.archetype.kind, r.area, aspectOf(r), 0, r.fitted?.exponent);
      const ob = boundsOf(outline);
      const label = labelBox(r);
      const w = Math.max(ob.maxX - ob.minX, label.w);
      const h = ob.maxY - ob.minY + 0.006 + label.h;
      if (x > 0 && x + w > 1) {
        x = 0;
        y += rowHeight + ROW_GAP;
        rowHeight = 0;
      }
      const cx = x + w / 2;
      const cy = y - ob.minY;
      const points = translate(outline, cx, cy);
      under.push({
        id: r.p.nbaId,
        kind: r.archetype.kind,
        area: r.area,
        cx,
        cy,
        rotation: 0,
        points,
        bounds: boundsOf(points),
        labelAt: { x: cx, y: y + (ob.maxY - ob.minY) + 0.006 + label.h / 2 },
      });
      x += w + COL_GAP;
      rowHeight = Math.max(rowHeight, h);
    }
    y += rowHeight + ROW_GAP;
  };
  shelf('overflow', overflow.sort((a, b) => b.area - a.area));
  shelf('below', rated.filter((q) => q.value <= 0 && q.area > 0).sort((a, b) => b.area - a.area));
  const belowHeight = y;
  const placedById = new Map([...shapes, ...extras, ...under].map((sh) => [sh.id, sh]));

  const players: RosterShapePlayer[] = rated
    .map((r) => {
      const placed = placedById.get(r.p.nbaId);
      const chord = placed && placed.kind !== 'circle' ? chordAt(placed.points, placed.cy) : null;
      return {
        nbaId: r.p.nbaId,
        name: r.p.name,
        position: r.p.position,
        minutes: r.p.minutes,
        games: r.p.games,
        oDpm: r.p.oDpm,
        dDpm: r.p.dDpm,
        dpm: r.dpm,
        value: r.value,
        share: r.share,
        kind: r.archetype.kind,
        label: r.archetype.label,
        reason: r.archetype.reason,
        estimated: r.archetype.estimated,
        portability: r.fitted?.total ?? null,
        portabilityOffense: r.fitted?.offense ?? null,
        portabilityDefense: r.fitted?.defense ?? null,
        exponent: r.fitted?.exponent ?? null,
        tiling: r.fitted?.tiling ?? null,
        family: r.fitted?.family ?? null,
        flaw: r.fitted?.flaw ?? null,
        reference: r.fitted?.reference ?? null,
        display: displayOf(r),
        deficit: r.deficit,
        plateLabel: labels.get(r.p.nbaId) ?? r.p.name,
        placement: placed
          ? {
              cx: placed.cx,
              cy: placed.cy,
              points: placed.points,
              radius: placed.kind === 'circle' ? circleRadius(placed.area) : null,
              labelX: chord && placed.kind !== 'star' ? chord.x : placed.cx,
              // A star turned 45° is narrowest exactly where its name goes. The name may
              // run over the notches (they are white), so it is fitted to the body instead.
              labelWidth:
                placed.kind === 'circle'
                  ? 2 * circleRadius(placed.area)
                  : placed.kind === 'star'
                    ? Math.max(chord?.width ?? 0, 0.62 * (placed.bounds.maxX - placed.bounds.minX))
                    : (chord?.width ?? 0),
              labelOutside: placed.labelAt ?? null,
              area: placed.area,
              aspect: aspectOf(r),
              rotation: placed.rotation,
            }
          : null,
      };
    })
    .sort((a, b) => b.value - a.value || b.dpm - a.dpm || b.minutes - a.minutes);

  const value = rated.reduce((s, r) => s + r.value, 0);
  return {
    players,
    fill: rated.reduce((s, r) => s + r.share, 0),
    inBox: rated.reduce((s, r) => s + (overflowIds.has(r.p.nbaId) ? 0 : r.share), 0),
    value,
    perfectValue: BOX,
    replacementDpm: REPLACEMENT_DPM,
    fitScale,
    overflow: overflow.length,
    belowHeight,
    stripSections,
  };
}
