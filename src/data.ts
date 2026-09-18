import type { ShapeInput } from './lib/model';

/** One exported player-season row. `team` is the abbreviation on the source row. */
export interface PlayerRow extends ShapeInput {
  team: string;
}

export interface SeasonSnapshot {
  /** END year of the season: 2026 is 2025-26. */
  season: number;
  exportedAt: string;
  source: string;
  /** Rows dropped because they carry no DPM: no measured value, so never drawn at zero. */
  unrated: number;
  players: PlayerRow[];
}

/** One five-man lineup-season: [season, five player ids, off poss, def poss, points, opp points, league ORtg]. */
export type LineupRow = [number, number[], number, number, number, number, number];

export const seasonLabel = (endYear: number) => `${endYear - 1}-${String(endYear).slice(2)}`;
