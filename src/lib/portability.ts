/**
 * Portability: how a player's lineups do against the sum of their parts.
 *
 * The outline of a shape is fitted to five-man lineup data
 * (`scripts/fit-model.ts`), separately for each end of the floor:
 *
 *   offense residual = lineup ORtg − league ORtg − Σ of the five O-DPM
 *   defense residual = league ORtg − lineup DRtg − Σ of the five D-DPM
 *
 * A positive residual means the five did better TOGETHER at that end than their
 * individual values add up to. Each side is explained by the lineup's style mix
 * (summed PCA style scores, linear + quadratic) plus the link terms that
 * survived an out-of-sample test:
 *
 *   offense   its weakest and its strongest offensive player
 *   defense   its weakest defender, and how many weak defenders it carries
 *
 * A player's portability is the fitted effect of putting HIM into a typical
 * lineup instead of an average-style, average-value player: points per 100 his
 * lineups gain or lose beyond what his DPM already says. It is the measured
 * version of "how easy is he to build around", and it sets his outline.
 */

import { exponentForFill, isPointed, POINTS, pointedFill, POINTED_RATIO_MAX, ratioForFill, type PointedKind, type ShapeKind } from './geometry';
import { REPLACEMENT_DPM } from './model';

export const STYLE_COMPONENTS = 4;

/**
 * A second, ROTATED PCA, over skill stats oriented so that more is better.
 * Varimax turns the components into things a player can or cannot do, which is
 * what "he is just a spot-up shooter, he doesn't have a lot of other skills"
 * needs. The interior factor is bipolar — rebounds and blocks at one pole,
 * three-point shooting at the other — so it counts as TWO skills.
 */
export interface SkillModel {
  mu: number[];
  sd: number[];
  /** features × factors score weights, already divided by each factor's sd. */
  weights: number[][];
  /** Index of the bipolar interior ↔ shooting factor. */
  splitFactor: number;
  /** One name per skill, in `skillScores` order. */
  names: string[];
  /**
   * Defense is a skill too, and the box score barely sees it (steals and blocks
   * are poor proxies), so D-DPM in SDs is appended as one. Without it a 3-and-D
   * forward read as narrow: Champagnie, who shoots, defends and rebounds, was
   * drawn as a one-skill five-point star.
   */
  defenseSd: number;
  /** A player's THIRD-best skill, in SDs: the median and the 5th percentile among regulars. */
  thirdBestMedian: number;
  thirdBestLow: number;
}

/** One end of the floor. */
export interface SideModel {
  intercept: number;
  linear: number[];
  /** Symmetric K × K: squared terms on the diagonal, half of each cross term off it. */
  quadratic: number[][];
  /** Per point of DPM (this side) of the lineup's WORST player at this end. */
  minLink: number;
  /** Per point of DPM of the lineup's BEST player at this end (offense only; 0 on defense). */
  maxLink: number;
  /** Per player in the lineup below `weakEnd` at this end (defense only; 0 on offense). */
  weakCount: number;
}

export interface PortabilityModel {
  stats: string[];
  mu: number[];
  sd: number[];
  /** K × stats loadings, each oriented so its anchor stat loads positive. */
  components: number[][];
  /** Standard deviation of each raw component score, so style scores are in SDs. */
  componentSd: number[];
  componentNames: string[];
  /** A style reading is shrunk toward average by minutes / (minutes + this). */
  minutesShrink: number;
  /** DPM below which an end of the floor counts as weak. */
  weakEnd: number;
  offense: SideModel;
  defense: SideModel;
  /** Minutes-weighted mean style score; the "average-style player" sits here. */
  meanStyle: number[];
  /** Quantiles, over real lineup slots, of what the OTHER four look like. */
  otherFour: { minOffense: number[]; maxOffense: number[]; minDefense: number[] };
  /** Median and sd of portability among 1,000+ minute player-seasons. */
  portabilityMedian: number;
  portabilitySd: number;
  /** Possession-weighted mean of the model's prediction over every lineup: "an average lineup". */
  meanPrediction: number;
  /** The rotated skill PCA behind the one-skill rule. */
  skill: SkillModel;
  /**
   * The Wyman calibration: the outline's cleanness, fitted to the 41 shapes in
   * his three diagrams (`data/wyman-reference.json`). Score = a·fit-without-
   * on-ball + b·DPM; a player's score is ranked among regulars and that
   * percentile is mapped onto the distribution of fills HE draws, so a league
   * of plates has his mix: about a quarter perfect squares, a fifth stars.
   */
  wyman: {
    fitWeight: number;
    dpmWeight: number;
    /** Leave-one-out R² of the calibration on his 41 players. Small; stated. */
    looR2: number;
    /** Quantiles (1..99) of the score among 1,000+ minute regulars. */
    scoreQuantiles: number[];
    /** His 24 fills, sorted ascending: the target distribution. */
    referenceFills: number[];
    /** The reference players themselves, drawn exactly as in his diagram. */
    reference: { name: string; season: number; shape: string; kind: ShapeKind; fill: number }[];
  };
  /**
   * Three-point makes per 100 among PERIMETER regulars (interior score below
   * 0.5), BY SEASON: the spacing scale. League three-point volume roughly
   * doubled over these 26 seasons, so a non-spacer is one against his own year.
   */
  spacingBySeason: Record<string, { mean: number; sd: number }>;
  /**
   * Playmaking load — on-ball creation plus assists per 100 — among regulars,
   * BY SEASON: the 85th and 97th percentiles. The on-ball rule reads a player
   * against his own year, like the spacing rule.
   */
  handlingBySeason?: Record<string, { p85: number; p97: number }>;
  /** On-ball creation per 100 among regulars, BY SEASON: the 85th percentile is where a player counts as a primary creator (the non-passer rule). */
  creationBySeason?: Record<string, { p85: number }>;
  report: {
    lineups: number;
    possessions: number;
    seasons: [number, number];
    calibrationSlope: number;
    calibrationIntercept: number;
    residualSd: number;
    /** Out-of-sample R² on NET residual, fitted on even seasons / tested on odd, and the reverse. */
    cvR2: [number, number];
    cvCorrelation: [number, number];
    cvR2Offense: [number, number];
    cvR2Defense: [number, number];
    cvR2StyleOnly: [number, number];
    varianceExplained: number[];
    /** Out-of-sample correlation of predicted with observed TEAM fit, and how many team-seasons. */
    teamCvCorrelation: number;
    teamCvTeams: number;
  };
}

export interface LineupPlayer {
  style: number[];
  minutes: number;
  oDpm: number;
  dDpm: number;
  /** On-ball creation plus assists per 100 (kept for the model's scale). */
  handling?: number | null;
  /** On-ball creation and assists per 100, for the non-passer rule. Null or absent: the rule abstains. */
  creation?: number | null;
  assists?: number | null;
  /** His playoff reading (`src/lib/playoffs.ts`), for the playoff rule. Null or absent: the rule abstains. */
  playoff?: { dpmDelta: number; shareScale: number } | null;
  /** Listed position; a center is never asked to space the floor. */
  position?: string | null;
}

/**
 * Skill stats from the style stats (`STYLE_STATS` order), each oriented so more
 * is better: three-point makes per 100, FT%, relative TS, assists, rim assists,
 * ball security (turnovers per shot, negated), FTA, shot volume, offensive and
 * defensive rebounds, steals, blocks.
 */
export function skillFeatures(style: number[]): number[] {
  const [tsa, ast, rimAst, threeRate, threePct, rts, fta, oreb, dreb, tov, stl, blk, twoPa, ftPct] = style;
  const threePa = (Math.min(threeRate, 0.95) * twoPa) / (1 - Math.min(threeRate, 0.95));
  return [threePa * threePct, ftPct, rts, ast, rimAst, -tov / Math.max(tsa, 5), fta, tsa, oreb, dreb, stl, blk];
}

/** Skill scores in SDs, shrunk for minutes. The bipolar factor is split into interior and shooting. */
export function skillScores(skill: SkillModel, style: number[], minutes: number, dDpm = 0): number[] {
  const z = skillFeatures(style).map((v, i) => (v - skill.mu[i]) / skill.sd[i]);
  const shrink = minutes / (minutes + 400);
  const f = skill.weights[0].map((_, k) => z.reduce((s, zi, i) => s + zi * skill.weights[i][k], 0) * shrink);
  const out = f.filter((_, k) => k !== skill.splitFactor);
  out.push(f[skill.splitFactor], -f[skill.splitFactor], dDpm / skill.defenseSd);
  return out;
}

export function styleScores(model: PortabilityModel, stats: number[], minutes: number): number[] {
  const z = stats.map((v, i) => (v - model.mu[i]) / model.sd[i]);
  const shrink = minutes / (minutes + model.minutesShrink);
  return model.components.map((w, k) => (w.reduce((s, wi, i) => s + wi * z[i], 0) / model.componentSd[k]) * shrink);
}

function styleForm(side: SideModel, S: number[]): number {
  let f = 0;
  for (let i = 0; i < S.length; i++) {
    f += side.linear[i] * S[i];
    for (let j = 0; j < S.length; j++) f += side.quadratic[i][j] * S[i] * S[j];
  }
  return f;
}

/**
 * The model's prediction for one real lineup, split by end, in points per 100
 * beyond Σ DPM. Used for TEAM fit, where the five are known and nothing has to
 * be averaged over imaginary teammates.
 */
export function predictLineup(model: PortabilityModel, five: LineupPlayer[]): { offense: number; defense: number; net: number } {
  const K = model.components.length;
  const scores = five.map((p) => styleScores(model, p.style, p.minutes));
  const S = Array.from({ length: K }, (_, k) => scores.reduce((s, z) => s + z[k], 0));
  const o = five.map((p) => p.oDpm);
  const d = five.map((p) => p.dDpm);
  const offense = model.offense.intercept + styleForm(model.offense, S) + model.offense.minLink * Math.min(...o) + model.offense.maxLink * Math.max(...o);
  const defense =
    model.defense.intercept +
    styleForm(model.defense, S) +
    model.defense.minLink * Math.min(...d) +
    model.defense.weakCount * d.filter((x) => x < model.weakEnd).length;
  return { offense, defense, net: offense + defense };
}

export interface Portability {
  total: number;
  offense: number;
  defense: number;
  /**
   * `total` with the on-ball-load term removed at both ends, cost and credit.
   * Against his three diagrams that term has no relation to the outline he
   * draws (r = +0.13 over 24 players) while it dominated ours, rounding off
   * Wembanyama, Castle and Harper, whom he draws as squares. See `outlineFor`.
   */
  fitWithoutLoad: number;
  /** Named contributions that sum to `total`, largest magnitude first. */
  parts: { label: string; value: number }[];
  /** Style scores in SDs, shrunk for minutes. */
  style: number[];
}

const mean = (xs: number[], f: (m: number) => number) => xs.reduce((s, m) => s + f(m), 0) / xs.length;

export function portabilityOf(model: PortabilityModel, p: LineupPlayer): Portability {
  const K = model.components.length;
  const z = styleScores(model, p.style, p.minutes);
  const zbar = model.meanStyle;
  const others = zbar.map((v) => 4 * v); // four typical teammates

  // f(z + T) − f(z̄ + T) for each side's quadratic form, by component. Cross
  // terms between two of HIS OWN components are reported together as "style mix".
  const parts: { label: string; value: number; side: 'o' | 'd' }[] = [];
  for (const [side, tag, key] of [[model.offense, 'offense', 'o'], [model.defense, 'defense', 'd']] as const) {
    let mix = 0;
    for (let k = 0; k < K; k++) {
      const dz = z[k] - zbar[k];
      let own = side.linear[k] * dz + side.quadratic[k][k] * (z[k] * z[k] - zbar[k] * zbar[k]);
      for (let j = 0; j < K; j++) own += 2 * dz * side.quadratic[k][j] * others[j];
      parts.push({ label: `${model.componentNames[k]}, ${tag}`, value: own, side: key });
      for (let j = k + 1; j < K; j++) mix += 2 * side.quadratic[k][j] * (z[k] * z[j] - zbar[k] * zbar[j]);
    }
    parts.push({ label: `style mix, ${tag}`, value: mix, side: key });
  }
  // Link terms: what he does to the lineup's extremes, against an average player (DPM 0) in his place.
  const of = model.otherFour;
  parts.push({ label: 'offensive weak link', side: 'o', value: model.offense.minLink * (mean(of.minOffense, (m) => Math.min(p.oDpm, m)) - mean(of.minOffense, (m) => Math.min(0, m))) });
  parts.push({ label: 'lead scorer effect', side: 'o', value: model.offense.maxLink * (mean(of.maxOffense, (m) => Math.max(p.oDpm, m)) - mean(of.maxOffense, (m) => Math.max(0, m))) });
  parts.push({ label: 'defensive weak link', side: 'd', value: model.defense.minLink * (mean(of.minDefense, (m) => Math.min(p.dDpm, m)) - mean(of.minDefense, (m) => Math.min(0, m))) });
  parts.push({ label: 'weak defender', side: 'd', value: p.dDpm < model.weakEnd ? model.defense.weakCount : 0 });

  const offense = parts.filter((x) => x.side === 'o').reduce((s, x) => s + x.value, 0);
  const defense = parts.filter((x) => x.side === 'd').reduce((s, x) => s + x.value, 0);
  const load = parts.filter((x) => x.label.startsWith(model.componentNames[1])).reduce((s, x) => s + x.value, 0);
  parts.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { total: offense + defense, fitWithoutLoad: offense + defense - load, offense, defense, parts: parts.map(({ label, value }) => ({ label, value })), style: z };
}

/**
 * The outline's cleanness, calibrated to his diagrams. Two things predict his
 * shapes about equally on his 41 players (leave-one-out R² ~13%; nothing else
 * does better, and on-ball load does nothing): our measured fit with the
 * on-ball term removed, and plain quality. The score is ranked among regulars
 * and the percentile mapped onto the fills he draws, so the mix matches his.
 */
export const FILL_MIN = 0.3;
export const FILL_MAX = 0.985;
/** Kept for the rule-based fallback and the legend scale. */
export const FILL_PER_SD = 0.2;

export function wymanScore(model: PortabilityModel, port: Portability, dpm: number): number {
  return model.wyman.fitWeight * port.fitWithoutLoad + model.wyman.dpmWeight * dpm;
}

export function wymanFill(model: PortabilityModel, score: number): number {
  const q = model.wyman.scoreQuantiles;
  let below = 0;
  while (below < q.length && q[below] <= score) below++;
  const percentile = below / q.length; // 0..1
  const ref = model.wyman.referenceFills;
  const pos = percentile * (ref.length - 1);
  const i = Math.min(ref.length - 2, Math.floor(pos));
  const fill = ref[i] + (ref[i + 1] - ref[i]) * (pos - i);
  return Math.max(FILL_MIN, Math.min(FILL_MAX, fill));
}

/**
 * Two RULES, stated as rules. They are definitions taken from the video, not
 * effects found in lineup data — that was tested three ways and came up empty
 * (see the README) — and the page labels them as such. Under the Wyman
 * calibration they choose the FAMILY of a player's outline (what kind of flaw
 * the video would name); the calibrated fill sets how sharp it is drawn.
 *
 * ONE-WAY  "this guy gives you nothing on one end of the floor"
 *   His weaker end (O-DPM or D-DPM), once it is below −0.4, and only to the
 *   extent the two ends are lopsided: a player who is simply bad at both is
 *   small, not one-way.
 *
 * ONE-SKILL  "he's basically just a spot-up shooter, he doesn't have other skills"
 *   From the rotated skill PCA (plus defense as a skill): his THIRD-best skill.
 *   Most role players are narrow, so the rule is percentile-based and graded —
 *   nothing at the median of regulars, the full reading at the 5th percentile.
 *
 * NON-SPACER  "he is a non spacer, so there's a little bit of off-ball problems"
 *   A perimeter player (interior score under 0.5) whose three-point makes per
 *   100 sit below −0.5 SD among perimeter regulars OF HIS OWN SEASON (league
 *   volume doubled over these years). Drawn as a notch in an otherwise clean
 *   outline, the way his Castle is a rectangle with a bite out of it.
 *
 * NON-PASSER  "his passing volume is not high enough… this diamond is a little
 *   bit rough to build around" (Edwards)
 *   An earlier version capped every primary ball-handler at an octagon. His
 *   Thunder diagram refutes it: Gilgeous-Alexander carries the biggest on-ball
 *   load in the data and is drawn as a full rectangle, "the easiest player to
 *   build around" — because he is "a good playmaker". What he penalises is
 *   scoring on the ball WITHOUT creating for others: Edwards (17 creation,
 *   5 assists per 100) is a diamond, LaMelo (16.5 and 12.5) a hexagon. So the
 *   reading is a primary creator (creation per 100 in the top 15% of his
 *   season's regulars) whose assists per created shot are low: nothing at 0.42
 *   assists per unit of creation (SGA is 0.41, Tatum 0.43), the full reading at
 *   0.32 (Edwards 0.30, Kawhi 0.34), drawn in the four-point family down to
 *   his diamond (0.5). Harden (0.61) and Jokić (1.36) pass; they are exempt.
 */
export const ONE_WAY_MAX_PENALTY = 0.45;
export const ONE_SKILL_MAX_PENALTY = 0.3;
/** A flaw this large (in the gross reading) names the player's outline. */
export const FLAW_NAMES_OUTLINE = 0.075;
export const SPACING_MAX_PENALTY = 0.08;
export const NOTCH_NAMES_OUTLINE = 0.025;
/** The non-passer's outline at the full reading: his Edwards diamond. */
export const NON_PASSER_FILL = 0.5;
/** Assists per unit of on-ball creation between which the non-passer reading fades in (full at or below the first). */
export const NON_PASSER_FULL = 0.32;
export const NON_PASSER_FROM = 0.42;
/**
 * PLAYOFFS  "he's a playoff dropper" / "you can't play him in the playoffs"
 *   The playoff reading (see `src/lib/playoffs.ts`) already sets his SIZE:
 *   his value is his playoff value. It also sets his outline. The share of
 *   his regular-season value that survives the playoffs lowers how cleanly
 *   he can be drawn — a man worth 60% of himself in May is at best a circle,
 *   30% at best a hexagon — and a player his coach could not play at all
 *   (minutes share under PLAYOFF_UNPLAYABLE) is drawn as a burst, the most
 *   awkward family, whatever else he does. Both readings are already shrunk
 *   by the postseason minutes behind them, so a rookie is untouched.
 */
export const PLAYOFF_CAP_SLOPE = 0.5;
export const PLAYOFF_UNPLAYABLE = 0.7;
/** A playoff cap this far under the ceiling names the outline ("playoff dropper"): under 85% of his value surviving. Harden (80%) is named; Dončić (86%) is not. */
export const PLAYOFF_NAMES_OUTLINE = 0.075;

export interface Flaws {
  /** `gross` decides whether he is one-way; `penalty` is the reading net of what the lineup model already charges a weak defender. */
  oneWay: { end: 'offense' | 'defense' | null; gross: number; penalty: number; weakEnd: number };
  oneSkill: { penalty: number; thirdBest: number; best: string[] };
  /** NON-SPACER: `z` is his three-point makes per 100 in SDs among perimeter regulars of his season. */
  spacing: { penalty: number; z: number | null };
  /** NON-PASSER: `cap` is the most his outline may fill (FILL_MAX when the rule is silent), `t` the reading from 0 to 1, `ratio` his assists per unit of on-ball creation (null when unknown or not a primary creator). */
  nonPasser: { cap: number; t: number; ratio: number | null };
  /** PLAYOFFS: `survives` is the share of his regular-season value left in the playoffs (1 with no record), `cap` the fill that allows, `unplayable` whether his minutes share collapsed. */
  playoff: { survives: number; cap: number; unplayable: boolean };
}

/** The playoff rule's reading from a player's DPM and his playoff reading. */
export function playoffFlaw(dpm: number, playoff: LineupPlayer['playoff']): Flaws['playoff'] {
  if (!playoff) return { survives: 1, cap: FILL_MAX, unplayable: false };
  const before = Math.max(0, dpm - REPLACEMENT_DPM);
  const after = Math.max(0, dpm + playoff.dpmDelta - REPLACEMENT_DPM) * playoff.shareScale;
  const survives = before > 0 ? Math.min(1, after / before) : 1;
  return { survives, cap: FILL_MAX - PLAYOFF_CAP_SLOPE * (1 - survives), unplayable: playoff.shareScale < PLAYOFF_UNPLAYABLE };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function threeMakesPer100(style: number[]): number {
  const [, , , threeRate, threePct, , , , , , , , twoPa] = style;
  const r = Math.min(threeRate, 0.95);
  return ((r * twoPa) / (1 - r)) * threePct;
}

/** The spacing scale for a season; the nearest season stands in for one the model has not seen. */
export function spacingScale(model: PortabilityModel, season: number | undefined): { mean: number; sd: number } | null {
  const keys = Object.keys(model.spacingBySeason).map(Number);
  if (keys.length === 0) return null;
  const y = season ?? Math.max(...keys);
  const nearest = keys.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  return model.spacingBySeason[String(nearest)];
}

/** The playmaking-load scale for a season; the nearest season stands in for one the model has not seen. */
export function handlingScale(model: PortabilityModel, season: number | undefined): { p85: number; p97: number } | null {
  const table = model.handlingBySeason;
  if (!table) return null;
  const keys = Object.keys(table).map(Number);
  if (keys.length === 0) return null;
  const y = season ?? Math.max(...keys);
  const nearest = keys.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  return table[String(nearest)];
}

/** The creation scale for a season; the nearest season stands in for one the model has not seen. */
export function creationScale(model: PortabilityModel, season: number | undefined): { p85: number } | null {
  const table = model.creationBySeason;
  if (!table) return null;
  const keys = Object.keys(table).map(Number);
  if (keys.length === 0) return null;
  const y = season ?? Math.max(...keys);
  const nearest = keys.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  return table[String(nearest)];
}

/** The non-passer reading: a primary creator's assists per unit of creation, and the fill cap that implies. */
export function nonPasserOf(model: PortabilityModel, creation: number | null | undefined, assists: number | null | undefined, season: number | undefined): Flaws['nonPasser'] {
  const scale = creationScale(model, season);
  if (creation === null || creation === undefined || assists === null || assists === undefined || !scale) return { cap: FILL_MAX, t: 0, ratio: null };
  if (creation < scale.p85) return { cap: FILL_MAX, t: 0, ratio: null };
  const ratio = assists / Math.max(creation, 0.1);
  const t = clamp01((NON_PASSER_FROM - ratio) / (NON_PASSER_FROM - NON_PASSER_FULL));
  return { cap: FILL_MAX - t * (FILL_MAX - NON_PASSER_FILL), t, ratio };
}

export function flawsOf(model: PortabilityModel, p: LineupPlayer, season?: number): Flaws {
  const weakEnd = Math.min(p.oDpm, p.dDpm);
  const end = p.oDpm < p.dDpm ? 'offense' : 'defense';
  const gross = ONE_WAY_MAX_PENALTY * clamp01((-weakEnd - 0.4) / 1.6) * clamp01((Math.abs(p.oDpm - p.dDpm) - 0.5) / 1.0);
  let oneWay = gross;
  if (end === 'defense' && p.dDpm < model.weakEnd) {
    oneWay = Math.max(0, oneWay - (FILL_PER_SD * Math.abs(model.defense.weakCount)) / model.portabilitySd);
  }

  const skills = skillScores(model.skill, p.style, p.minutes, p.dDpm);
  const ranked = skills.map((v, i) => [v, model.skill.names[i]] as const).sort((a, b) => b[0] - a[0]);
  const thirdBest = ranked[2][0];
  const oneSkill = ONE_SKILL_MAX_PENALTY * clamp01((model.skill.thirdBestMedian - thirdBest) / (model.skill.thirdBestMedian - model.skill.thirdBestLow));

  const style = styleScores(model, p.style, p.minutes);
  // A center is never asked to space: the style score reads Jokić as a guard
  // (he passes like one) and had him notched for 1.5 threes per 100.
  const perimeter = -style[0] < 0.5 && !/C/.test(p.position ?? '');
  const scale = spacingScale(model, season);
  const zSpacing = perimeter && scale ? (threeMakesPer100(p.style) - scale.mean) / scale.sd : null;
  const spacing = zSpacing === null ? 0 : SPACING_MAX_PENALTY * clamp01((-0.5 - zSpacing) / 1.0);

  return {
    oneWay: { end: gross > 0 ? end : null, gross, penalty: oneWay, weakEnd },
    oneSkill: { penalty: oneSkill, thirdBest, best: ranked.filter((x) => x[0] >= 0.5).map((x) => x[1]) },
    spacing: { penalty: spacing, z: zSpacing },
    nonPasser: nonPasserOf(model, p.creation, p.assists, season),
    playoff: playoffFlaw(p.oDpm + p.dDpm, p.playoff),
  };
}

export interface Outline {
  kind: ShapeKind;
  /** Superellipse exponent, or the inner-radius ratio of a pointed outline. */
  param: number;
  aspect: number;
  /** Share of its bounding box the outline fills. */
  fill: number;
  /** The calibrated fill before the family was chosen. */
  fitFill: number;
}

/** Which awkward family a flaw draws: a triangle for no offense, a four-point star for no defense, a five-point star for one skill, a burst for both — or for a player who cannot be played in the playoffs. */
function familyFor(flaws: Flaws): PointedKind | null {
  const way = flaws.oneWay.gross >= FLAW_NAMES_OUTLINE;
  const skill = flaws.oneSkill.penalty >= FLAW_NAMES_OUTLINE;
  if (flaws.playoff.unplayable) return 'burst';
  if (way && skill) return 'burst';
  // A scorer who does not pass is drawn in the four-point family, like his Edwards diamond.
  if (flaws.nonPasser.t >= 0.5 && !way && !skill) return 'quad';
  if (way) return flaws.oneWay.end === 'offense' ? 'tri' : 'quad';
  if (skill) return 'penta';
  return null;
}

/** The outline for one of his reference players: his shape, at the fill his drawing has, in our family for it. */
export function referenceOutline(entry: { kind: ShapeKind; fill: number }, interior: number): Outline {
  const aspect = 1 + Math.min(interior, 2.5) * 0.4;
  if (entry.kind === 'super') return { kind: 'super', param: exponentForFill(Math.min(FILL_MAX, entry.fill)), aspect, fill: entry.fill, fitFill: entry.fill };
  if (entry.kind === 'notched') {
    const depth = Math.max(0.12, Math.min(0.5, 2 * (1 - entry.fill)));
    return { kind: 'notched', param: depth, aspect, fill: 1 - depth / 2, fitFill: entry.fill };
  }
  if (isPointed(entry.kind)) {
    const m = POINTS[entry.kind];
    const param = ratioForFill(m, Math.min(entry.fill, pointedFill(m, POINTED_RATIO_MAX)));
    return { kind: entry.kind, param, aspect: 1, fill: pointedFill(m, param), fitFill: entry.fill };
  }
  // An exact polygon he drew: its fill is a property of the shape.
  return { kind: entry.kind, param: 0, aspect: 1, fill: FIXED_FILL[entry.kind] ?? entry.fill, fitFill: entry.fill };
}

/** Share of its bounding box each exact outline fills. */
const FIXED_FILL: Partial<Record<ShapeKind, number>> = { circle: Math.PI / 4, octagon: 0.828, hexagon: 0.75, pentagon: 0.691, triangle: 0.5, diamond: 0.5, star: 0.318, square: 1, rect: 1 };

export function outlineFor(model: PortabilityModel, port: Portability, flaws?: Flaws, dpm = 0): Outline {
  // The calibrated fill, then the non-passer cap (a scorer who does not create
  // for others is at best his Edwards diamond) and the playoff cap (a dropper
  // is drawn as cleanly as the value that survives May).
  const fill = Math.min(wymanFill(model, wymanScore(model, port, dpm)), flaws?.nonPasser.cap ?? FILL_MAX, flaws?.playoff.cap ?? FILL_MAX);
  // Component 0 is perimeter ↔ interior. An interior big is drawn long, the way
  // the video draws Robinson and Kessler; it costs nothing in tiling.
  const interior = Math.max(0, -port.style[0] - 0.5);
  const smooth = (f: number): Outline => ({ kind: 'super', param: exponentForFill(f), aspect: 1 + Math.min(interior, 2.5) * 0.4, fill: f, fitFill: fill });
  if (!flaws) return smooth(fill);

  // The rules choose the FAMILY — what kind of flaw the video would name — and
  // the calibrated fill sets how blunt or sharp it is drawn.
  const family = familyFor(flaws);
  if (!family) {
    if (flaws.spacing.penalty >= NOTCH_NAMES_OUTLINE && fill >= 0.8) {
      const depth = Math.max(0.12, Math.min(0.5, 2 * (1 - Math.min(fill, 0.94))));
      return { kind: 'notched', param: depth, aspect: 1 + Math.min(interior, 2.5) * 0.4, fill: 1 - depth / 2, fitFill: fill };
    }
    return smooth(fill);
  }
  const target = Math.min(fill, pointedFill(POINTS[family], POINTED_RATIO_MAX));
  const param = ratioForFill(POINTS[family], target);
  return { kind: family, param, aspect: 1, fill: pointedFill(POINTS[family], param), fitFill: fill };
}

/** What kind of player the style scores describe; it picks the colour, nothing else. */
export type StyleFamily = 'interior' | 'onBall' | 'perimeter' | 'disruptor' | 'balanced';

export const FAMILY_LABEL: Record<StyleFamily, string> = {
  interior: 'Interior big',
  onBall: 'On-ball creator',
  perimeter: 'Perimeter shooter',
  disruptor: 'Disruptor / connector',
  balanced: 'Balanced',
};

/** How many SDs from the average style before a player is given a family colour. */
export const FAMILY_THRESHOLD = 0.6;

export function familyOf(style: number[]): StyleFamily {
  const candidates: [StyleFamily, number][] = [
    ['interior', -style[0]],
    ['onBall', style[1]],
    ['perimeter', style[0]],
    ['disruptor', style[2]],
  ];
  const [family, strength] = candidates.sort((a, b) => b[1] - a[1])[0];
  return strength >= FAMILY_THRESHOLD ? family : 'balanced';
}

export function fitLabel(fill: number): string {
  if (fill >= 0.93) return 'Plugs in anywhere';
  if (fill >= 0.84) return 'Fits most rosters';
  if (fill >= 0.72) return 'Average fit';
  if (fill >= 0.6) return 'Needs some shaping';
  if (fill >= 0.45) return 'The roster bends round him';
  return 'Hardest to fit';
}

const threeMakesPer100Text = (z: number | null) => (z === null ? 'few threes' : `${z.toFixed(1)} SD below perimeter players for threes made`);
const signedText = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/** The reading printed under a name: the measured total by end and its drivers, then any rule that fired. */
export function portabilityReason(port: Portability, flaws?: Flaws): string {
  const drivers = port.parts.filter((x) => Math.abs(x.value) >= 0.15).slice(0, 3);
  let text = `${signedText(port.total)} per 100 beyond his DPM (offense ${signedText(port.offense)}, defense ${signedText(port.defense)})`;
  if (drivers.length) text += `: ${drivers.map((x) => `${x.label} ${signedText(x.value)}`).join('; ')}`;
  if (flaws && flaws.oneWay.gross >= FLAW_NAMES_OUTLINE) text += `. One-way: ${flaws.oneWay.end} is the hole (${signedText(flaws.oneWay.weakEnd)})`;
  if (flaws && flaws.oneSkill.penalty >= FLAW_NAMES_OUTLINE) text += `. Narrow: ${flaws.oneSkill.best.length ? flaws.oneSkill.best.join(' and ') : 'no standout skill'}, little else`;
  if (flaws && flaws.spacing.penalty >= NOTCH_NAMES_OUTLINE) text += `. Non-spacer: ${threeMakesPer100Text(flaws.spacing.z)}`;
  if (flaws && flaws.nonPasser.t > 0 && flaws.nonPasser.ratio !== null) text += `. Non-passer: a primary creator with ${flaws.nonPasser.ratio.toFixed(2)} assists per unit of on-ball creation${flaws.nonPasser.t >= 0.5 ? ', rough to build around' : ''}`;
  if (flaws && flaws.playoff.unplayable) text += `. Hard to play in the playoffs: his minutes share falls to ×${(flaws.playoff.survives > 0 ? flaws.playoff.survives : 0).toFixed(2)} of his regular-season self`;
  else if (flaws && flaws.playoff.cap < FILL_MAX - PLAYOFF_NAMES_OUTLINE) text += `. Playoff dropper: ${Math.round(flaws.playoff.survives * 100)}% of his regular-season value survives the playoffs`;
  return text;
}
