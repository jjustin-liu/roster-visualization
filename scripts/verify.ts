/**
 * Verify the plates over EVERY team-season in data/:
 *
 *   bun scripts/verify.ts
 *
 * Fails (exit 1) if any plate had to be shrunk, any above-replacement player is
 * left outside the box, or any player with a non-zero area is left undrawn.
 * Run it after changing the outlines, the packer, the box rule, the playoff
 * reading or the data; "everything is to scale, in the box" is only true while
 * this passes. It also prints each season's box (as the +N team it is worth)
 * and how far it had to grow past the calibrated size.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { type PortabilityModel } from '../src/lib/index';
import { packSeasonPlates } from '../src/lib/season';
import { attachPlayoffReadings, playoffReadings } from '../src/lib/playoffs';
import type { PlayoffRow, SeasonSnapshot } from '../src/data';
import { teamName } from '../src/teams';

const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
const readings = existsSync('data/playoffs.json') ? playoffReadings(JSON.parse(readFileSync('data/playoffs.json', 'utf8')) as PlayoffRow[]) : new Map();
const shrunk: string[] = [];
const undrawn: string[] = [];
const outside: string[] = [];
const boxes: string[] = [];
let plates = 0;
let zeroArea = 0;
let fullest = { key: '', fill: 0 };
for (const f of readdirSync('data').filter((x) => /^\d{4}\.json$/.test(x))) {
  const snap: SeasonSnapshot = JSON.parse(readFileSync(`data/${f}`, 'utf8'));
  attachPlayoffReadings(snap.players, snap.season, readings);
  const byTeam = new Map<string, typeof snap.players>();
  for (const p of snap.players) {
    if (!teamName(p.team, snap.season)) continue;
    byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
  }
  const t0 = performance.now();
  const s = packSeasonPlates(byTeam, model, snap.season);
  boxes.push(`${snap.season}: +${s.boxNet.toFixed(1)} box (${s.fullest} fullest at ${Math.round(s.plates.get(s.fullest)!.fill * 100)}%, grown ${s.grown}×, ${Math.round(performance.now() - t0)}ms)`);
  for (const [team, plate] of s.plates) {
    plates++;
    if (plate.fill > fullest.fill) fullest = { key: `${snap.season} ${team}`, fill: plate.fill };
    if (plate.fitScale < 1) shrunk.push(`${snap.season} ${team} (drawn at ${plate.fitScale.toFixed(2)})`);
    if (plate.overflow > 0) outside.push(`${snap.season} ${team} (${plate.overflow} under the box)`);
    for (const p of plate.players) {
      if (p.placement) continue;
      if (p.value === 0 && p.deficit === 0) zeroArea++;
      else undrawn.push(`${snap.season} ${team} ${p.name}`);
    }
  }
}
console.log(boxes.join('\n'));
console.log(`${plates} plates. Fullest: ${fullest.key} ${Math.round(fullest.fill * 100)}%. ${zeroArea} players exactly at replacement (area zero).`);
console.log(`Shrunk: ${shrunk.length}${shrunk.length ? '\n  ' + shrunk.join('\n  ') : ''}`);
console.log(`Outside the box: ${outside.length}${outside.length ? '\n  ' + outside.join('\n  ') : ''}`);
console.log(`Undrawn: ${undrawn.length}${undrawn.length ? '\n  ' + undrawn.join('\n  ') : ''}`);
if (shrunk.length || undrawn.length || outside.length) process.exit(1);
