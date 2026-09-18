/**
 * Shapes from his diagrams by NEAREST NEIGHBOUR.
 *
 * His 41 drawn players are the ground truth for what an outline means. Every
 * other player is drawn like the drawn players he most resembles: a player is
 * placed in a PCA space of the things that could plausibly drive a shape —
 * both ends of DPM, the four style components, on-ball creation and assists
 * and the ratio between them, three-point spacing against his season, his
 * third-best skill, his playoff reading, and his minutes per game — and his
 * outline is the distance-weighted vote of the k nearest reference players
 * (their family) at the distance-weighted mean of their fills.
 *
 * The space is standardised on every 1,000-minute regular since 2000-01, so
 * "near" means near by NBA standards, not near among 41 points; which of the
 * features it uses is `FEATURE_USE`. Leave-one-out over the 41 is reported
 * honestly by `fit-model.ts`.
 */
import type { ShapeKind } from './geometry';
import { skillScores, spacingScale, styleScores, threeMakesPer100, type LineupPlayer, type PortabilityModel } from './portability';

export const FEATURE_NAMES = [
  'O-DPM',
  'D-DPM',
  'perimeter game',
  'on-ball load',
  'disruption over scoring',
  'scoring efficiency',
  'creation per 100',
  'assists per 100',
  'assists per creation (log)',
  'threes vs season (z)',
  'third-best skill',
  'playoff offense change',
  'playoff minutes share',
  'minutes per game',
] as const;

export interface NeighbourReference {
  name: string;
  season: number;
  shape: string;
  kind: ShapeKind;
  tiling: number;
  /** His position in the PCA space. */
  z: number[];
}

export interface NeighbourModel {
  featureNames: string[];
  mean: number[];
  sd: number[];
  /** K × F: the principal components of the standardised features, over regulars. */
  components: number[][];
  /** Share of variance each component carries. */
  explained: number[];
  k: number;
  reference: NeighbourReference[];
  /** Leave-one-out over the reference players: R² of the predicted fill, and the share within 0.15 of his. */
  loo: { fillR2: number; within: number; n: number };
}

/**
 * Which features the space is built on, by index into `FEATURE_NAMES`. Chosen
 * by leave-one-out over his 41 players (`scripts/fit-model.ts` prints it):
 * both ends of DPM, assists per unit of creation and minutes per game give a
 * fill R² of 14% at k = 6 — level with the linear calibration, and the best of
 * every subset tried. A PCA over all fourteen features was tested first and
 * predicted his fills WORSE than their mean (−4%): the style components, the
 * skill reading and the playoff readings add distance without adding signal.
 * His shapes are mostly judgement; this is the honest ceiling.
 */
export const FEATURE_USE = [0, 1, 8, 13];
export const NEIGHBOURS_K = 6;
/** Softening in the inverse-distance weight, in standardised units: the nearest player never takes the whole vote. */
export const DISTANCE_FLOOR = 0.25;

export type FeaturePlayer = LineupPlayer & { games?: number | null };

/** The raw feature vector, in `FEATURE_NAMES` order. Nulls read as the neutral value. */
export function shapeFeatures(model: PortabilityModel, p: FeaturePlayer, season?: number): number[] {
  const style = styleScores(model, p.style, p.minutes);
  const creation = p.creation ?? 0;
  const assists = p.assists ?? 0;
  const scale = spacingScale(model, season);
  const threesZ = scale ? (threeMakesPer100(p.style) - scale.mean) / scale.sd : 0;
  const skills = skillScores(model.skill, p.style, p.minutes, p.dDpm);
  const thirdBest = [...skills].sort((a, b) => b - a)[2] ?? 0;
  const mpg = p.games && p.games > 0 ? p.minutes / p.games : p.minutes / 70;
  return [
    p.oDpm,
    p.dDpm,
    style[0],
    style[1],
    style[2],
    style[3],
    creation,
    assists,
    Math.log((assists + 0.5) / (creation + 0.5)),
    threesZ,
    thirdBest,
    p.playoff?.dpmDelta ?? 0,
    p.playoff?.shareScale ?? 1,
    mpg,
  ];
}

/** Standardise and project into the PCA space. */
export function embed(nn: NeighbourModel, feats: number[]): number[] {
  const z = feats.map((x, j) => (nn.sd[j] > 0 ? (x - nn.mean[j]) / nn.sd[j] : 0));
  return nn.components.map((c) => c.reduce((s, w, j) => s + w * z[j], 0));
}

export interface Neighbour extends NeighbourReference {
  distance: number;
  weight: number;
}

/** The k nearest reference players to a point, with inverse-distance weights that sum to 1. */
export function nearest(nn: NeighbourModel, z: number[], exclude?: (r: NeighbourReference) => boolean): Neighbour[] {
  const scored = nn.reference
    .filter((r) => !exclude || !exclude(r))
    .map((r) => ({ ...r, distance: Math.sqrt(r.z.reduce((s, v, i) => s + (v - z[i]) ** 2, 0)), weight: 0 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, nn.k);
  const total = scored.reduce((s, r) => s + 1 / (r.distance + DISTANCE_FLOOR), 0);
  for (const r of scored) r.weight = 1 / (r.distance + DISTANCE_FLOOR) / total;
  return scored;
}

export interface NeighbourShape {
  kind: ShapeKind;
  /** The distance-weighted mean of the neighbours' fills. */
  fill: number;
  neighbours: Neighbour[];
}

/** The outline his nearest drawn players imply: their family by weighted vote, at their weighted fill. */
export function neighbourShape(nn: NeighbourModel, z: number[], exclude?: (r: NeighbourReference) => boolean): NeighbourShape {
  const neighbours = nearest(nn, z, exclude);
  const fill = neighbours.reduce((s, r) => s + r.weight * r.tiling, 0);
  const votes = new Map<ShapeKind, number>();
  for (const r of neighbours) votes.set(r.kind, (votes.get(r.kind) ?? 0) + r.weight);
  let kind: ShapeKind = neighbours[0].kind;
  let best = -1;
  for (const [k, w] of votes) {
    if (w > best + 1e-12) {
      best = w;
      kind = k;
    }
  }
  return { kind, fill, neighbours };
}

/** One line for the page: who he is drawn after. */
export function neighbourText(shape: NeighbourShape): string {
  return `Drawn after his ${shape.neighbours.map((n) => `${n.name} (${n.shape}, ${Math.round(n.weight * 100)}%)`).join(', ')}.`;
}
