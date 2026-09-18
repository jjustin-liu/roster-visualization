/**
 * The roster-shape model (`README.md`): what makes a player a
 * square and what makes him a star.
 *
 * Two readings per player, deliberately independent:
 *
 *   AREA   how much he gives   value over replacement, weighted by minutes
 *   SHAPE  how he gives it     the archetype, from role and two-way balance
 *
 * Every threshold here is a published modelling choice, not a measurement —
 * the page prints the rule that fired beside each player so a reader can argue
 * with it. They were tuned against rosters, not fitted to an outcome.
 */

import type { ShapeKind } from './geometry';

/** DPM of a freely available player. A shape's area is value ABOVE this. */
export const REPLACEMENT_DPM = -2;

/** First season with per-player DPM in the source. */
export const SHAPES_FROM_SEASON = 2001;

/**
 * First season the on-ball creation split is MEASURED (it comes from tracking
 * data). Before it, creation is estimated from usage and assists — see
 * `estimateCreation` — and every outline from those seasons says so.
 */
export const CREATION_MEASURED_FROM = 2014;

/**
 * Self-created true-shot attempts per 100, estimated from all true-shot
 * attempts and assists per 100. Least squares over the 4,646 player-seasons of
 * 2013-14 → 2025-26 with 500+ minutes that carry the measured split:
 * R² 0.81, RMSE 2.0 per 100. Good enough to tell an engine from a finisher
 * (the thresholds are 10 and 16 apart from assists), not to rank creators.
 */
export function estimateCreation(tsa: number | null, assists: number | null): number | null {
  if (tsa === null || assists === null) return null;
  return Math.max(0, -8.75 + 0.552 * tsa + 0.708 * assists);
}

/** Playmaking load for the on-ball rule: creation (measured, else estimated) plus assists, per 100. Null when neither exists. */
export function handlingOf(p: { creation: number | null; tsa: number | null; assists: number | null }): number | null {
  const creation = p.creation ?? estimateCreation(p.tsa, p.assists);
  if (creation === null || p.assists === null) return null;
  return creation + p.assists;
}

/** 3PA share of FGA that stands in for the catch-and-shoot share before it is measured. */
export const SPECIALIST_THREE_RATE = 0.6;

/**
 * The value of the box: five players at DPM = PERFECT_TEAM_NET / 5 for every
 * minute (+1.6 each at +8), drawn to the same power as everyone else.
 *
 * CALIBRATED TO HIS DIAGRAMS. He draws the 2025-26 Spurs and Knicks about
 * three-quarters full (76% and 77%, measured), and with the sizes to the power
 * that is a box worth about +7. +8 is the smallest box at which both of those
 * rosters still PACK at true size — the outlines tile to about 0.75 at best,
 * a hand does 0.77 — so his two diagram teams read 71% and 69% here with
 * nothing overflowing.
 *
 * It is a constant, so it does not fit every roster of the century: the 2003
 * Spurs are 133% of it and 19 team-seasons are over 100%. Those OVERFLOW —
 * the smallest shapes are drawn under the box, at the same scale — because a
 * shape is never shrunk. (The box used to be +21, the size at which the
 * 2010-11 Heat pack; every current roster then read under 30% and looked
 * empty, which is the opposite of his drawings.)
 *
 * Σ over a roster of (dpm - REPLACEMENT) × minutes share
 *   = team DPM-implied net rating + 5 × |REPLACEMENT|,
 * so a roster's LINEAR value is PERFECT_TEAM_NET + 10 at the box's own net.
 */
export const PERFECT_TEAM_NET = process.env.BOX_NET ? Number(process.env.BOX_NET) : 8;

/**
 * ON THE SITE THE BOX IS SIZED PER SEASON. Every above-replacement player is
 * drawn INSIDE the box, to scale, and the best rosters look the way he draws
 * them: three-quarters full. No constant does both — by these numbers the
 * 2002-03 Spurs are 3.3× the 2025-26 Spurs — so each season's box is
 * `BOX_OVER_FULLEST` times that season's fullest roster (the fullest team reads
 * 71%, his diagrams 76-77%), then grown by `BOX_GROW_STEP` until every roster
 * of the season packs at true size (`src/lib/season.ts`). For 2025-26 that is
 * the +8 box above; for 2002-03 it is about +19. The page states each
 * season's box as the "+N team" it is worth, so seasons can still be compared.
 */
export const BOX_OVER_FULLEST = 1.4;
export const BOX_GROW_STEP = 1.03;

/** The "+N team" a box of this area is worth: the inverse of `PERFECT_TEAM_VALUE`. */
export const boxNet = (box: number) => 5 * ((box / 5) ** (1 / SIZE_EXPONENT) + REPLACEMENT_DPM);
/**
 * AREA IS SUPERLINEAR IN VALUE: area ∝ value^SIZE_EXPONENT. Calibrated to his
 * three diagrams: a log-log fit of his 24 drawn areas on value over replacement
 * — (DPM + 2) × per-game share, see `shareOf` — with a free intercept per
 * diagram gives γ = 1.72, R² = 0.76 (with season-minute shares it was 1.59 and
 * R² 0.40). Linear areas drew Wembanyama at 1.7× Fox when his DPM is 3× Fox's;
 * he draws him at 4.5×, and this rule at 3.0×. "The bigger the shape, the
 * better the player" is not a linear scale. The table still prints the linear
 * value.
 */
export const SIZE_EXPONENT = 1.7;

/** A shape's area, in the units the box is measured in. */
export const areaOf = (value: number) => Math.max(0, value) ** SIZE_EXPONENT;

/**
 * The box: five players at DPM = PERFECT_TEAM_NET / 5 for every minute — each
 * worth (PERFECT_TEAM_NET/5 + 2) per slot, drawn at that value to the power.
 */
export const PERFECT_TEAM_VALUE = 5 * areaOf(PERFECT_TEAM_NET / 5 - REPLACEMENT_DPM);

/**
 * Every shape is drawn TO SCALE, however small. Below this share of the box a
 * name no longer fits inside the shape, so it is written beside it instead.
 * (Two shortcuts were tried and removed: hiding the small shapes made a bad
 * roster look EMPTY rather than bad, and inflating them to a readable size was
 * simply not to scale.)
 */
export const INSIDE_LABEL_SHARE = 0.012;

/** Outside-label metrics in box units (the box is 1 wide): font size, and mean glyph width as a share of it. */
export const OUTSIDE_LABEL_FONT = 0.0145;
export const LABEL_CHAR_WIDTH = 0.56;

/**
 * On-ball load per 100 that makes a PRIMARY creator: self-created true-shot
 * attempts plus half his assists. The assists matter — on his own shots alone
 * Jokić read as a secondary creator, which is the one thing he is not.
 */
export const PRIMARY_LOAD = 16;
/** …and a secondary one. */
export const SECONDARY_LOAD = 10;
export const ASSIST_LOAD_WEIGHT = 0.5;
/** An end of the floor this far below average is a weakness a roster must cover. */
export const WEAK_END = -0.75;
/** A lean this large between the two ends makes a player one-sided. */
export const LEAN = 1;

export interface ShapeInput {
  nbaId: number;
  name: string;
  position: string | null;
  minutes: number;
  games: number | null;
  oDpm: number;
  dDpm: number;
  /** On-ball creation, true-shot attempts per 100. Null when the source has no split. */
  creation: number | null;
  /** Catch-and-shoot load, same units. */
  shooting: number | null;
  /** All true-shot attempts per 100. */
  tsa: number | null;
  /** Assists per 100. */
  assists: number | null;
  /** 3PA share of FGA; only consulted when `shooting` is not measured. */
  threeRate?: number | null;
  /** The style stats the portability model reads, in `STYLE_STATS` order; null if any is missing. */
  style?: number[] | null;
  /**
   * The playoff reading (`src/lib/playoffs.ts`), part of the plate: his DPM
   * moves by `dpmDelta`, his minutes share by `shareScale`, and his outline is
   * capped by what survives (`playoffFlaw`). Absent: drawn as in the regular season.
   */
  playoff?: { dpmDelta: number; shareScale: number } | null;
}

/**
 * The style stats behind the PCA. Chosen because every one of them exists for
 * every player-season back to 2000-01 (zero nulls), so no season needs an
 * estimate. Value (DPM) is deliberately NOT among them: area is value, shape is
 * style, and the two must not leak into each other.
 */
export const STYLE_STATS = [
  'TSA100',
  'd_Assists_Per100',
  'd_AtRimAssists_Per100',
  '3PR',
  '3P_PERC',
  'rTSPct',
  'FTA_100',
  'd_OffRebounds_Per100',
  'd_DefRebounds_Per100',
  'd_Turnovers_Per100',
  'd_Steals_Per100',
  'd_Blocks_Per100',
  '2PA_100',
  'FT_PERC',
] as const;

export interface Archetype {
  kind: ShapeKind;
  /** Width / height, `rect` only. */
  aspect: number;
  label: string;
  /** The rule that fired, in the reader's words, with this player's numbers. */
  reason: string;
  /** True when on-ball creation was estimated rather than measured. */
  estimated: boolean;
}

export const ARCHETYPE_LABEL: Record<ShapeKind, string> = {
  square: 'Two-way plug-in',
  rect: 'Defense-first piece',
  octagon: 'Primary engine',
  hexagon: 'Secondary creator',
  circle: 'Offense-first scorer',
  pentagon: 'Primary engine, weak defense',
  triangle: 'One-way defender',
  diamond: 'Offense-leaning, weak defense',
  star: 'Spot-up specialist',
  super: 'Fitted outline',
  tri: 'One-way: no offense',
  quad: 'One-way: no defense',
  penta: 'One skill',
  burst: 'One-way and narrow',
  notched: 'Non-spacer',
};

/** One line per archetype for the legend: what the outline means for a roster. */
export const ARCHETYPE_NOTE: Record<ShapeKind, string> = {
  square: 'Helps at both ends without the ball. Stacks with anyone.',
  rect: 'Value leans to defense, offense holds up. Still tessellates.',
  octagon: 'Runs the offense and holds up on defense. Big, nearly round.',
  hexagon: 'Creates some of his own offense; defense is not a hole.',
  circle: 'Scores without running the offense; needs defenders beside him.',
  pentagon: 'Runs the offense, gives points back. The roster bends round him.',
  triangle: 'Defends, and the offense plays four-on-five.',
  diamond: 'Some offense, a defensive hole, not enough of either to build on.',
  star: 'One skill — the catch-and-shoot three. All points, little body.',
  super: 'Outline fitted to lineup data.',
  tri: 'Rule: his offense is a hole.',
  quad: 'Rule: his defense is a hole.',
  penta: 'Rule: one real skill.',
  burst: 'Rule: one-way and narrow.',
  notched: 'Rule: a perimeter player who does not make threes.',
};

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/**
 * Choose the archetype. ORDER MATTERS and is part of the definition: a primary
 * creator is classified by his creation before anything else, because the ball
 * is the scarce resource a roster is built around.
 */
export function classify(p: ShapeInput): Archetype {
  const o = p.oDpm;
  const d = p.dDpm;
  const estimated = p.creation === null;
  const creation = p.creation ?? estimateCreation(p.tsa, p.assists) ?? 0;
  const load = creation + ASSIST_LOAD_WEIGHT * (p.assists ?? 0);
  const od = `${signed(o)} O / ${signed(d)} D`;
  const make = (kind: ShapeKind, reason: string, aspect = 1): Archetype => ({
    kind,
    aspect,
    label: ARCHETYPE_LABEL[kind],
    reason,
    estimated,
  });

  const loadText = `${creation.toFixed(1)} ${estimated ? 'estimated ' : ''}self-created shots and ${(p.assists ?? 0).toFixed(1)} assists per 100`;

  if (load >= PRIMARY_LOAD) {
    return d < WEAK_END
      ? make('pentagon', `${loadText}, and ${signed(d)} on defense`)
      : make('octagon', `${loadText}; defense holds at ${signed(d)}`);
  }

  if (load >= SECONDARY_LOAD) {
    return d < WEAK_END
      ? make('diamond', `${loadText}, ${signed(d)} on defense`)
      : make('hexagon', `${loadText}; ${od}`);
  }

  // A spot-up specialist: most of his offense is the catch-and-shoot, he does
  // not create or pass, and the defense is not what he is on the floor for.
  // Before the catch-and-shoot load is measured, a very high three-point rate
  // stands in for it.
  const measuredShare = p.shooting !== null && p.tsa !== null && p.tsa > 0 ? p.shooting / p.tsa : null;
  const specialist =
    measuredShare !== null ? measuredShare >= 0.55 : (p.threeRate ?? 0) >= SPECIALIST_THREE_RATE;
  if (specialist && creation < 2 && (p.assists ?? 0) < 4 && d < LEAN) {
    return make(
      'star',
      measuredShare !== null
        ? `${Math.round(measuredShare * 100)}% of his shots are catch-and-shoot, ${(p.assists ?? 0).toFixed(1)} assists per 100`
        : `${Math.round((p.threeRate ?? 0) * 100)}% of his shots are threes, ${(p.assists ?? 0).toFixed(1)} assists per 100`,
    );
  }

  if (o < WEAK_END && d >= 0) return make('triangle', `${od}: defends, offense is a minus`);

  if (d < WEAK_END) {
    return o >= LEAN
      ? make('circle', `${od}: scores, needs cover`)
      : make('diamond', `${od}: a defensive hole without the offense to pay for it`);
  }

  if (o < WEAK_END) return make('diamond', `${od}: a minus at both ends`);

  if (o >= LEAN && o - d >= LEAN) return make('circle', `${od}: offense-first, not a creator`);

  if (d - o >= LEAN) {
    // The further the value leans to one end, the longer the rectangle.
    const aspect = 1 + Math.min(d - o, 3) / 2;
    return make('rect', `${od}: defense-led, offense holds up`, aspect);
  }

  return make('square', `${od}: no weak end, no ball needed`);
}

/**
 * Value over replacement in points per 100 of TEAM margin: his rate above
 * replacement times the share of the team's five floor slots he filled.
 * Never negative — a player at or below replacement has no shape, which is
 * different from having a small one, and the page lists him as such.
 */
export function valueOverReplacement(dpm: number, minutes: number, teamMinutes: number, games?: number | null): number {
  const share = shareOf(minutes, teamMinutes, games);
  if (share <= 0) return 0;
  return Math.max(0, dpm - REPLACEMENT_DPM) * share;
}

/** A player with at least this many games is sized by his minutes per game in full; fewer, and his size fades with availability. */
export const GAMES_FULL = 50;

/**
 * The share of the team's five floor slots a player fills. PER GAME when his
 * games are known — minutes per game over 48, so a 34-minute starter is 0.71
 * whether he played 60 games or 82 — times an availability floor,
 * min(1, games / GAMES_FULL), so a ten-game cameo is not drawn as a starter.
 * His diagrams size players this way: a log fit of his 24 drawn areas on
 * (DPM + 2) × share gives R² 0.76 with minutes per game and 0.40 with season
 * minutes, which had docked Wembanyama a third of his size for the 18 games he
 * missed. "The bigger the shape, the better the player" is about the player,
 * not his medical record. Without games (tests, old rows) it is his share of
 * the team's actual minutes.
 */
export function shareOf(minutes: number, teamMinutes: number, games?: number | null): number {
  if (minutes <= 0) return 0;
  if (games && games > 0) return (minutes / games / 48) * Math.min(1, games / GAMES_FULL);
  if (teamMinutes <= 0) return 0;
  return minutes / (teamMinutes / 5);
}

/**
 * How far BELOW replacement a player was, in the same units: what he cost the
 * team against a freely available player in his minutes. It sizes his hollow
 * outline, so that is to scale too. It is never subtracted from the fill — the
 * box measures value over replacement, and a team could have replaced him.
 */
export function deficitBelowReplacement(dpm: number, minutes: number, teamMinutes: number, games?: number | null): number {
  const share = shareOf(minutes, teamMinutes, games);
  if (share <= 0) return 0;
  return Math.max(0, REPLACEMENT_DPM - dpm) * share;
}
