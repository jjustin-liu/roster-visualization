/**
 * Snapshot one season's player rows into data/<season>.json.
 *
 *   bun --env-file=../databallr_v3/.env.local scripts/export-data.ts          # every season
 *   bun --env-file=../databallr_v3/.env.local scripts/export-data.ts 2026     # one
 *
 * This is the project's ONLY contact with a database; everything else reads the
 * snapshot, so the site builds offline and a plate can be reproduced from a file.
 * Read-only: one SELECT.
 */
import postgres from 'postgres';
import { mkdirSync, writeFileSync } from 'fs';
import { SHAPES_FROM_SEASON, STYLE_STATS } from '../src/lib/model';
import type { LineupRow, PlayerRow, SeasonSnapshot } from '../src/data';

const LATEST = 2026;
const arg = process.argv[2];
const seasons = arg ? [Number(arg)] : Array.from({ length: LATEST - SHAPES_FROM_SEASON + 1 }, (_, i) => SHAPES_FROM_SEASON + i);
if (seasons.some((y) => !Number.isInteger(y) || y < SHAPES_FROM_SEASON)) {
  console.error(`Season must be an end year >= ${SHAPES_FROM_SEASON} (2001 is 2000-01, the first with DPM).`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run with: bun --env-file=<path to .env> scripts/export-data.ts');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
mkdirSync('data', { recursive: true });

for (const season of seasons) {
  const rows = await sql.unsafe(
    `select nba_id, "Name" as name, "TeamAbbreviation" as team, "Pos2" as pos, "Minutes" as minutes,
            "GamesPlayed" as games, o_dpm, d_dpm, "TSA100" as tsa, "3PR" as three_rate,
            "final_creation_TSA100" as creation, "final_shooting_TSA100" as shooting,
            "d_Assists_Per100" as assists,
            ${STYLE_STATS.map((c, i) => `"${c}"::float as s${i}`).join(', ')}
       from player_stats_with_metrics
      where year = $1 and playoffs = 0`,
    [season],
  );

  const players: PlayerRow[] = [];
  let unrated = 0;
  for (const r of rows) {
    const o = num(r.o_dpm);
    const d = num(r.d_dpm);
    const minutes = num(r.minutes);
    if (r.nba_id === null || !r.team || o === null || d === null || !minutes) {
      unrated++;
      continue;
    }
    players.push({
      nbaId: Number(r.nba_id),
      name: r.name ?? 'Unknown',
      team: r.team,
      position: r.pos ?? null,
      minutes,
      games: num(r.games),
      oDpm: o,
      dDpm: d,
      creation: num(r.creation),
      shooting: num(r.shooting),
      tsa: num(r.tsa),
      assists: num(r.assists),
      threeRate: num(r.three_rate),
      style: (() => {
        const v = STYLE_STATS.map((_, i) => num(r[`s${i}`]));
        return v.every((x) => x !== null) ? (v as number[]) : null;
      })(),
    });
  }

  const snapshot: SeasonSnapshot = {
    season,
    exportedAt: new Date().toISOString(),
    source: 'player_stats_with_metrics (regular season)',
    unrated,
    players: players.sort((a, b) => a.team.localeCompare(b.team) || b.minutes - a.minutes),
  };
  writeFileSync(`data/${season}.json`, JSON.stringify(snapshot));
  console.log(`data/${season}.json: ${players.length} players, ${unrated} without DPM left out.`);
}

// Five-man lineups. Unweighted rows only: `leverage` is a WEIGHTING of the same
// possessions, not a subset, so the two must never be pooled. Regular season,
// 10+ possessions each way: the model fits on the 60+ ones (a residual over a
// handful of possessions is noise), team fit reads them all.
if (!arg) {
  const lineups = await sql.unsafe(
    `select "EntityId" as e, year::int as y, "OffPoss"::float as op, "DefPoss"::float as dp, "Points"::float as pts,
            "OpponentPoints"::float as opp, lg_avg_ortg::float as lg
       from wowy_stats_two
      where leverage = 0 and playoffs = 0 and "OffPoss" >= 10 and "DefPoss" >= 10 and lg_avg_ortg is not null`,
  );
  const rows: LineupRow[] = [];
  for (const l of lineups) {
    const ids = String(l.e).split('-').map(Number);
    if (ids.length !== 5 || ids.some((i) => !Number.isFinite(i))) continue;
    rows.push([Number(l.y), ids, l.op, l.dp, l.pts, l.opp, l.lg]);
  }
  writeFileSync('data/lineups.json', JSON.stringify(rows));
  console.log(`data/lineups.json: ${rows.length} five-man lineups.`);
}
await sql.end();
