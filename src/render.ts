/**
 * The plate as an SVG string: a white box, a heavy black border, flat labelled
 * shapes. Its ground is fixed — white is the quantity being read ("fill it so
 * you cannot see any white") — so it never follows a theme.
 *
 * Two channels, kept apart on purpose:
 *   outline  how well his value stacks with teammates (fitted; `tiling`)
 *   colour   what kind of player he is (style family) — identification only.
 *            It says nothing about good or bad, which is why none of these
 *            hues is a red-to-green scale.
 */
import { isPointed, POINTS, ratioForFill, shapePolygon, type PointedKind, type ShapeKind } from './lib/geometry';
import type { RosterShapePlayer } from './lib/index';
import { LABEL_CHAR_WIDTH, OUTSIDE_LABEL_FONT } from './lib/model';
import { exponentForFill } from './lib/geometry';
import { FAMILY_LABEL, FILL_MAX, FILL_MIN, fitLabel, type StyleFamily } from './lib/portability';

export const PLATE_INK = '#0b0b0c';

export const FAMILY_FILL: Record<StyleFamily, string> = {
  interior: '#ea8651',
  onBall: '#cf9be9',
  perimeter: '#f4d04f',
  disruptor: '#7fb3e6',
  balanced: '#a9a9a9',
};
export const FAMILY_ORDER: StyleFamily[] = ['balanced', 'perimeter', 'onBall', 'interior', 'disruptor'];

/** Rule-based fallback only (a player with no style stats). */
const KIND_FILL: Record<ShapeKind, string> = {
  square: '#a9a9a9', rect: '#ea8651', octagon: '#7fb3e6', hexagon: '#8ed6c1', circle: '#94e06c',
  pentagon: '#cf9be9', triangle: '#5f92d8', diamond: '#e4585c', star: '#f4d04f', super: '#a9a9a9',
  tri: '#a9a9a9', quad: '#a9a9a9', penta: '#a9a9a9', burst: '#a9a9a9', notched: '#a9a9a9',
};

const fillOf = (p: RosterShapePlayer) => (p.family ? FAMILY_FILL[p.family] : KIND_FILL[p.kind]);

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pathOf = (pts: { x: number; y: number }[], map: (p: { x: number; y: number }) => string) => pts.map(map).join(' ');

const glyphSvg = (pts: { x: number; y: number }[], color: string, size: number) => {
  const r = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const k = 0.47 / r;
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 1 1" aria-hidden="true"><polygon points="${pathOf(pts, (p) => `${(0.5 + p.x * k).toFixed(3)},${(0.5 + p.y * k).toFixed(3)}`)}" fill="${color}"/></svg>`;
};

/** A small smooth outline at a given tiling, for legends and table rows. */
export function outlineGlyph(tiling: number, color: string, size = 14, aspect = 1): string {
  return glyphSvg(shapePolygon('super', 0.5, aspect, 0, exponentForFill(tiling), 72), color, size);
}

export function pointedGlyph(kind: PointedKind, tiling: number, color: string, size = 14): string {
  return glyphSvg(shapePolygon(kind, 0.5, 1, 0, ratioForFill(POINTS[kind], tiling)), color, size);
}

export function playerGlyph(p: RosterShapePlayer, size = 14): string {
  if (p.tiling === null || p.exponent === null) return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 1 1" aria-hidden="true"><rect x="0.1" y="0.1" width="0.8" height="0.8" fill="${fillOf(p)}"/></svg>`;
  if (isPointed(p.kind)) return glyphSvg(shapePolygon(p.kind, 0.5, 1, 0, p.exponent), fillOf(p), size);
  if (p.kind === 'notched') return glyphSvg(shapePolygon('notched', 0.5, 1, 0, p.exponent), fillOf(p), size);
  if (p.kind !== 'super') return glyphSvg(shapePolygon(p.kind, 0.5, 1, 0), fillOf(p), size);
  return outlineGlyph(p.tiling, fillOf(p), size, p.placement?.aspect ?? 1);
}

/** The smooth scale, easiest to build around → hardest, as legend entries. */
export function outlineLegend(): string {
  const stops = [FILL_MAX, 0.88, 0.78, 0.65, 0.5, FILL_MIN];
  return stops.map((t) => `<span>${outlineGlyph(t, '#8b8b90', 14)}${esc(fitLabel(t))}</span>`).join('');
}

/** The awkward families, each shown blunt and sharp: the rule, then how bad. */
export function flawLegend(): string {
  const rows: [PointedKind, string][] = [
    ['tri', 'One-way: no offense'],
    ['quad', 'One-way: no defense'],
    ['penta', 'One real skill'],
    ['burst', 'One-way and narrow, or hard to play in the playoffs'],
  ];
  return (
    rows.map(([k, label]) => `<span>${pointedGlyph(k, 0.68, '#8b8b90', 14)}${pointedGlyph(k, 0.34, '#8b8b90', 14)}${esc(label)}</span>`).join('') +
    `<span>${glyphSvg(shapePolygon('notched', 0.5, 1, 0, 0.3), '#8b8b90', 14)}Non-spacer</span>` +
    `<span>${glyphSvg(shapePolygon('diamond', 0.5, 1, 0), '#8b8b90', 14)}Scores on the ball, does not pass</span>`
  );
}

export function familyLegend(): string {
  return FAMILY_ORDER.map((f) => `<span><svg class="glyph" width="11" height="11" viewBox="0 0 1 1" aria-hidden="true"><circle cx="0.5" cy="0.5" r="0.5" fill="${FAMILY_FILL[f]}"/></svg>${esc(FAMILY_LABEL[f])}</span>`).join('');
}

// A 1000-unit square: the heavy border, then the unit box inside it.
const VIEW = 1000;
const BORDER = 24;
const INNER = VIEW - 2 * BORDER;
const at = (v: number, offset = 0) => (BORDER + v * INNER + offset).toFixed(1);
const MAX_LABEL = 40;

/**
 * `mini` is the league-page thumbnail: names written beside small shapes would be
 * ~4px there, so they are left off and only names that fit inside a shape show.
 */
export function renderPlate(
  players: RosterShapePlayer[],
  opts: { ariaLabel: string; mini?: boolean; belowHeight?: number; stripSections?: { kind: 'overflow' | 'below'; y: number }[] },
): string {
  const minLabel = opts.mini ? 30 : 11;

  const draw = (p: RosterShapePlayer, dy: number): string => {
    const pl = p.placement!;
    const label = p.plateLabel;
    const fontSize = Math.min(MAX_LABEL, (pl.labelWidth * INNER * 0.82) / (label.length * LABEL_CHAR_WIDTH));
    // The packer works on a coarse polygon; the curve is redrawn smooth here,
    // from the same area, aspect, exponent and turn, so it is the same shape.
    const pts =
      p.kind === 'super' && p.exponent !== null
        ? shapePolygon('super', pl.area, pl.aspect, pl.rotation, p.exponent, opts.mini ? 48 : 96).map((q) => ({ x: q.x + pl.cx, y: q.y + pl.cy }))
        : pl.points;
    const size = Math.sqrt(pl.area);
    // A hollow outline is a player below replacement: he adds no ink to the box.
    // Its area is his deficit, so it is to scale like everything else.
    const w = Math.max(1.2, Math.min(4, size * 60));
    const paint =
      p.display === 'hollow'
        ? `fill="none" stroke="${fillOf(p)}" stroke-width="${w.toFixed(1)}" stroke-dasharray="${(w * 2.5).toFixed(1)} ${(w * 1.8).toFixed(1)}"`
        : `fill="${fillOf(p)}"`;
    const body =
      pl.radius !== null
        ? `<circle cx="${at(pl.cx)}" cy="${at(pl.cy, dy)}" r="${(pl.radius * INNER).toFixed(1)}" ${paint}/>`
        : `<polygon points="${pathOf(pts, (q) => `${at(q.x)},${at(q.y, dy)}`)}" ${paint}/>`;
    const ink = p.display === 'hollow' ? '#6b6b70' : PLATE_INK;
    const text = pl.labelOutside
      ? opts.mini
        ? ''
        : `<text x="${at(pl.labelOutside.x)}" y="${at(pl.labelOutside.y, dy)}" font-size="${(OUTSIDE_LABEL_FONT * INNER).toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${ink}">${esc(label)}</text>`
      : fontSize >= minLabel
        ? `<text x="${at(pl.labelX)}" y="${at(pl.cy, dy)}" font-size="${fontSize.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${ink}">${esc(label)}</text>`
        : '';
    return `<g class="shape" data-id="${p.nbaId}"><title>${esc(`${p.name}: ${p.label}. ${p.reason}`)}</title>${body}${text}</g>`;
  };

  // Overflow shapes and below-replacement outlines sit in a strip UNDER the box,
  // at the same scale, each section under its own heading.
  const strip = opts.mini || !opts.belowHeight ? 0 : opts.belowHeight * INNER + 12;
  const inBox = players.filter((p) => p.placement && p.display === 'scale');
  const under = players.filter((p) => p.placement && p.display !== 'scale');
  const HEADING: Record<'overflow' | 'below', string> = {
    overflow: 'MORE THAN THE BOX HOLDS · NO ROOM AT TRUE SIZE · SAME SCALE',
    below: 'BELOW REPLACEMENT · NOT IN THE BOX · SAME SCALE',
  };
  const stripTop = VIEW + 8 - BORDER;

  return (
    `<svg class="plate" viewBox="0 0 ${VIEW} ${(VIEW + strip).toFixed(0)}" role="img" aria-label="${esc(opts.ariaLabel)}">` +
    `<rect x="${BORDER / 2}" y="${BORDER / 2}" width="${VIEW - BORDER}" height="${VIEW - BORDER}" fill="#fff" stroke="${PLATE_INK}" stroke-width="${BORDER}"/>` +
    inBox.map((p) => draw(p, 0)).join('') +
    (strip
      ? (opts.stripSections ?? [{ kind: 'below' as const, y: 0 }])
          .map((s) => `<text x="${BORDER}" y="${at(s.y, stripTop + 22)}" font-size="15" fill="#6b6b70" letter-spacing="1.2">${HEADING[s.kind]}</text>`)
          .join('') + under.map((p) => draw(p, stripTop)).join('')
      : '') +
    `</svg>`
  );
}
