/**
 * The playoff reading: how much of a player's regular-season value survives
 * the postseason, from what he has actually done in it.
 *
 * Two things are measured, each against the player's OWN regular season, each
 * pooled over his career to date (a postseason is 4-28 games; one is noise) and
 * shrunk toward "no change" by how many playoff minutes back it up:
 *
 *   OFFENSE     shooting points added per 100 (TS added) plus a tenth of points
 *               created per 100, playoffs minus regular season, minus the
 *               league's own playoff drop that season (everyone shoots worse
 *               against playoff defences; the reading is who drops MORE than
 *               everyone). Points per 100 possessions, so it moves DPM point
 *               for point. The production term is what makes a star who
 *               shrinks from the game read as one: Harden's 2026 postseason
 *               is −2.3 on efficiency and −16 points created per 100.
 *   PLAYABILITY his share of the team's playoff minutes over his share of its
 *               regular-season minutes, capped at 1 (see `PLAYABILITY_MAX`).
 *               Rotations tighten in May and the bench loses minutes; a player
 *               his coach cannot play in the playoffs is worth less.
 *
 * Playoff value = (DPM + offense change + 2) × regular share × playability.
 *
 * Pooled over his career to date, INCLUDING the season being drawn (the plate
 * is what happened), with a RECENCY half-life of three seasons — the reading
 * is who he is now, not who he was at 25 — and shrunk toward "no change" by
 * the playoff minutes behind it: weight = minutes / (minutes + K), K = 600 for
 * offense (about two deep runs) and 300 for playability. A player with no
 * postseason at all reads exactly as in the regular season.
 */
import type { PlayoffRow } from '../data';

export const EFFICIENCY_K = 600;
export const PLAYABILITY_K = 300;
/** Seasons for a postseason's weight to halve. */
export const RECENCY_HALF_LIFE = 3;
/** Points created per 100 count a tenth: volume that moves to a teammate is mostly not lost. */
export const PRODUCTION_WEIGHT = 0.1;
/** The offense change is capped: a 6-game collapse cannot read as −10 a game forever. */
export const EFFICIENCY_CAP = 4;
export const PLAYABILITY_MIN = 0.25;
/**
 * Playability never RAISES a player above his regular-season size. Stars play
 * 38-40 minutes in May and the raw ratio says ×1.3 for every one of them; with
 * area superlinear in value that made every contender's playoff plate half
 * again as big as its season and forced the box up (the 2025-26 Spurs fell to
 * 50%). The reading the video is about is who the coach CANNOT play, so the
 * ratio is capped at 1: a bench player who loses his minutes shrinks, a star
 * who gains them stays his size, and a playoff plate can only lose ink through
 * minutes. It can still gain through offense (Kawhi Leonard).
 */
export const PLAYABILITY_MAX = 1;

export interface PlayoffReading {
  /** Change in DPM applied in the playoff plate (points per 100). */
  dpmDelta: number;
  /** Multiplier on his minutes share in the playoff plate. */
  shareScale: number;
  /** Playoff minutes behind the reading, career to date, recency-weighted. */
  minutes: number;
  /** Postseasons behind it. */
  postseasons: number;
  /** The raw, unshrunk readings, for the page. */
  rawEfficiency: number;
  rawPlayability: number;
  /** His offense change against what a player of his level gives back in the playoffs (shrunk like `dpmDelta`); the page prints it beside the value reading. */
  vsLevel: number;
}

export const NO_PLAYOFF_READING: PlayoffReading = { dpmDelta: 0, shareScale: 1, minutes: 0, postseasons: 0, rawEfficiency: 0, rawPlayability: 1, vsLevel: 0 };

interface Phase {
  team: string;
  minutes: number;
  games: number;
  tsAdded: number;
  created: number;
}

/**
 * Every player's reading for every season, keyed `${season}:${nbaId}`.
 * Seasons run in order so each reading is career to date.
 */
export function playoffReadings(rows: PlayoffRow[]): Map<string, PlayoffReading> {
  // Index by season → player → phase.
  const bySeason = new Map<number, Map<number, { r?: Phase; p?: Phase }>>();
  const teamMinutes = new Map<string, number>(); // `${season}:${team}:${phase}` → Σ minutes
  for (const [season, id, phase, team, minutes, games, tsAdded, created] of rows) {
    if (!bySeason.has(season)) bySeason.set(season, new Map());
    const s = bySeason.get(season)!;
    if (!s.has(id)) s.set(id, {});
    s.get(id)![phase === 1 ? 'p' : 'r'] = { team, minutes, games, tsAdded, created };
    const k = `${season}:${team}:${phase}`;
    teamMinutes.set(k, (teamMinutes.get(k) ?? 0) + minutes);
  }

  // Two yardsticks per season. The LEAGUE's playoff drop (minutes-weighted mean
  // of the offense change): what everyone loses against playoff defences; the
  // value reading is the drop beyond it, because that is what the team loses.
  // And what a player of his LEVEL is expected to lose — a weighted line of the
  // change on the regular-season level, since the best shooters have the most
  // to give back (their regular season carried the most luck) — which the page
  // prints beside it, so a star's ordinary playoff drop is not read as his.
  const expected = new Map<number, { a: number; b: number }>();
  const leagueDrop = new Map<number, number>();
  const offenseOf = (q: Phase) => q.tsAdded + PRODUCTION_WEIGHT * q.created;
  for (const [season, s] of bySeason) {
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (const { r, p } of s.values()) {
      if (!r || !p) continue;
      xs.push(offenseOf(r));
      ys.push(offenseOf(p) - offenseOf(r));
      ws.push(p.minutes);
    }
    const line = weightedLine(xs, ys, ws);
    expected.set(season, line);
    const W = ws.reduce((a, b) => a + b, 0);
    leagueDrop.set(season, W > 0 ? ys.reduce((a, y, i) => a + ws[i] * y, 0) / W : 0);
  }

  // Each player's postseasons, oldest first; a reading pools them with recency weights.
  interface Post {
    season: number;
    minutes: number;
    regularMinutes: number;
    /** Offense change beyond the league's playoff drop. */
    offense: number;
    /** Offense change beyond what a player of his level gives back. */
    vsLevel: number;
    logPlay: number;
  }
  const posts = new Map<number, Post[]>();
  const out = new Map<string, PlayoffReading>();
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    const s = bySeason.get(season)!;
    const line = expected.get(season) ?? { a: 0, b: 0 };
    for (const [id, { r, p }] of s) {
      if (r && p && r.minutes > 0) {
        const shareR = r.minutes / ((teamMinutes.get(`${season}:${r.team}:0`) ?? r.minutes) / 5);
        const shareP = p.minutes / ((teamMinutes.get(`${season}:${p.team}:1`) ?? p.minutes) / 5);
        const list = posts.get(id) ?? [];
        list.push({
          season,
          minutes: p.minutes,
          regularMinutes: Math.min(r.minutes, 2000),
          offense: offenseOf(p) - offenseOf(r) - (leagueDrop.get(season) ?? 0),
          vsLevel: offenseOf(p) - offenseOf(r) - (line.a + line.b * offenseOf(r)),
          // Playability is RAW: rotations tighten in the playoffs and that is the reading.
          logPlay: Math.log(Math.max(0.05, shareP / Math.max(shareR, 1e-6))),
        });
        posts.set(id, list);
      }
      const list = posts.get(id);
      if (!list || list.length === 0) continue;
      // Offense change weighted by playoff minutes and recency; playability by
      // REGULAR minutes and recency, because a rotation player who lost his
      // minutes in the playoffs has few playoff minutes, and that IS the reading.
      let offW = 0;
      let offSum = 0;
      let levelSum = 0;
      let playW = 0;
      let playSum = 0;
      let minutes = 0;
      for (const q of list) {
        const recency = 0.5 ** ((season - q.season) / RECENCY_HALF_LIFE);
        offW += q.minutes * recency;
        offSum += q.minutes * recency * q.offense;
        levelSum += q.minutes * recency * q.vsLevel;
        playW += q.regularMinutes * recency;
        playSum += q.regularMinutes * recency * q.logPlay;
        minutes += q.minutes * recency;
      }
      const rawEfficiency = offSum / offW;
      const vsLevel = levelSum / offW;
      const rawPlayability = Math.exp(playSum / playW);
      const offWeight = minutes / (minutes + EFFICIENCY_K);
      const playWeight = minutes / (minutes + PLAYABILITY_K);
      // The value reading is the drop AGAINST A PLAYER OF HIS LEVEL, not the
      // league's: measured beyond the league's drop alone, the best regular
      // seasons give back the most in May (they carried the most luck) and the
      // rule tagged Jokić as a dropper for regressing from a +7.
      const dpmDelta = Math.max(-EFFICIENCY_CAP, Math.min(EFFICIENCY_CAP, vsLevel)) * offWeight;
      const shareScale = Math.exp(Math.log(Math.max(PLAYABILITY_MIN, Math.min(PLAYABILITY_MAX, rawPlayability))) * playWeight);
      out.set(`${season}:${id}`, { dpmDelta, shareScale, minutes, postseasons: list.length, rawEfficiency, rawPlayability, vsLevel: vsLevel * offWeight });
    }
  }
  return out;
}

/** Weighted least squares of y on x: y ≈ a + b·x. */
function weightedLine(xs: number[], ys: number[], ws: number[]): { a: number; b: number } {
  let W = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xs.length; i++) {
    W += ws[i];
    sx += ws[i] * xs[i];
    sy += ws[i] * ys[i];
  }
  if (W === 0) return { a: 0, b: 0 };
  const mx = sx / W;
  const my = sy / W;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += ws[i] * (xs[i] - mx) ** 2;
    sxy += ws[i] * (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** Put each player's reading for this season on his row (`ShapeInput.playoff`), so the plate draws him at his playoff value and shape. */
export function attachPlayoffReadings<T extends { nbaId: number; playoff?: { dpmDelta: number; shareScale: number } | null }>(
  players: T[],
  season: number,
  readings: Map<string, PlayoffReading>,
): void {
  for (const p of players) {
    const r = readings.get(`${season}:${p.nbaId}`);
    p.playoff = r ? { dpmDelta: r.dpmDelta, shareScale: r.shareScale } : null;
  }
}

/** One line for the page: the two readings and what stands behind them. */
export function playoffReadingText(r: PlayoffReading): string {
  if (r.postseasons === 0) return 'No postseason on record: drawn as in the regular season.';
  const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  const eff = `${signed(r.dpmDelta)} per 100 on offense against a player of his level (${signed(r.rawEfficiency * (r.minutes / (r.minutes + EFFICIENCY_K)))} beyond the league's playoff drop)`;
  const play = `minutes share ×${r.shareScale.toFixed(2)}`;
  return `${eff}, ${play}, from ${r.postseasons} postseason${r.postseasons === 1 ? '' : 's'} (${Math.round(r.minutes).toLocaleString()} playoff minutes, recent ones weighted most).`;
}
