/**
 * Compare our plates with the two graphics in the video.
 *
 *   bun scripts/sanity-check.ts
 *
 * HIS numbers were measured from frames of the video (0:20 Knicks, 2:30 Lakers):
 * every pixel inside his box classified by colour, connected regions kept apart.
 *   area    share of his box the shape covers
 *   tiling  share of its own bounding box the shape fills — the same quantity
 *           our outlines are built on (square 1, octagon .83, circle .79,
 *           pentagon .69, diamond/triangle .5, four-point star ~.33)
 * Kessler's square and Anunoby's rectangle read through their black labels, so
 * their tiling is entered as the 1.0 those shapes are by construction.
 */
import { readFileSync } from 'fs';
import { buildRosterShapePlate, flawsOf, outlineFor, portabilityOf, referenceOutline, valueOverReplacement, PERFECT_TEAM_NET, PERFECT_TEAM_VALUE, type PortabilityModel } from '../src/lib/index';
import type { SeasonSnapshot } from '../src/data';

const HIS: Record<string, [name: string, shape: string, areaPct: number, tiling: number][]> = {
  'Knicks (his 77% full)': [
    ['Jalen Brunson', 'pentagon', 20.84, 0.7],
    ['Karl-Anthony Towns', 'circle', 20.15, 0.78],
    ['OG Anunoby', 'rectangle', 15.86, 1.0],
    ['Mikal Bridges', 'square', 8.84, 0.99],
    ['Mitchell Robinson', 'rectangle', 5.06, 0.96],
    ['Josh Hart', 'triangle', 2.83, 0.56],
    ['Miles McBride', 'diamond', 1.82, 0.5],
    ['Landry Shamet', '4-point star', 0.81, 0.35],
  ],
  // Measured from the posted image by GEOMETRY (rectangles, a triangle, a trapezoid; estimated fills for
  // the two stars), not by pixel count, so these are good to a few percent. Box ≈ 725 × 665 px.
  'Timberwolves, his 2026-27 roster (~57% full, estimated)': [
    ['Anthony Edwards', 'diamond', 31.4, 0.5],
    ['LaMelo Ball', 'hexagon', 24.9, 0.75],
    ['Rudy Gobert', 'notched long rectangle', 17.9, 0.9],
    ['Jaden McDaniels', 'arrow rectangle', 9.9, 0.85],
    ['Donte DiVincenzo', 'square', 6.6, 1.0],
    ['Ayo Dosunmu', 'notched square', 5.5, 0.9],
    ['Jonathan Kuminga', '4-point star', 3.0, 0.32],
    ['Bones Hyland', '5-point star', 0.9, 0.35],
  ],
  'Thunder, his 2026-27 roster (~76% full, estimated)': [
    ['Shai Gilgeous-Alexander', 'rectangle', 39.5, 1.0],
    ['Jalen Williams', 'octagon', 15.1, 0.83],
    ['Chet Holmgren', 'hexagon with bites', 14.0, 0.6],
    ['Isaiah Hartenstein', 'round-topped rectangle', 7.4, 0.8],
    ['Alex Caruso', 'trapezoid', 6.7, 0.75],
    ['Ajay Mitchell', 'rectangle', 5.9, 1.0],
    ['Jaylin Williams', 'hexagon', 5.2, 0.75],
    ['Cason Wallace', 'parallelogram', 3.6, 0.7],
    ['Jared McCain', 'triangle', 2.5, 0.5],
  ],
  'Spurs, his 2026-27 roster (~76% full, estimated)': [
    ['Victor Wembanyama', 'square', 29.1, 1.0],
    ['Stephon Castle', 'notched rectangle', 12.5, 0.93],
    ['Dylan Harper', 'square', 12.2, 1.0],
    ["De'Aaron Fox", '10-point blob', 6.4, 0.7],
    ['Julian Champagnie', 'square', 6.0, 1.0],
    ['Devin Vassell', 'parallelogram', 4.0, 0.75],
    ['Luke Kornet', 'trapezoid', 2.5, 0.8],
    ['Keldon Johnson', '6-point star', 1.8, 0.55],
  ],
  'Lakers, his projected roster (49% full)': [
    ['Luka Dončić', 'octagon', 24.97, 0.83],
    ['Austin Reaves', 'diamond', 9.18, 0.51],
    ['Walker Kessler', 'square', 8.02, 1.0],
    ['Sandro Mamukelashvili', '5-point star', 2.44, 0.35],
    ['Quentin Grimes', 'long hexagon', 1.63, 0.7],
    ['Collin Sexton', '4-point star', 1.01, 0.33],
    ['Matisse Thybulle', 'cloud', 0.72, 0.73],
    ['Jarred Vanderbilt', 'spiky burst', 0.62, 0.61],
  ],
};

const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
const snap: SeasonSnapshot = JSON.parse(readFileSync('data/2026.json', 'utf8'));

const pearson = (a: number[], b: number[]) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
};
const ranks = (v: number[]) => v.map((x) => v.filter((y) => y > x).length + (v.filter((y) => y === x).length - 1) / 2);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const all: { his: number; ours: number }[] = [];
for (const [title, list] of Object.entries(HIS)) {
  const rows = list.map(([name, shape, areaPct, tiling]) => {
    const p = snap.players.find((x) => x.name === name)!;
    const teamMinutes = snap.players.filter((x) => x.team === p.team).reduce((s, x) => s + x.minutes, 0);
    const lp = { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm };
    const port = portabilityOf(model, lp);
    const entry = model.wyman.reference.find((e) => e.name === name && e.season === 2026);
    const outline = entry ? referenceOutline(entry, 0) : outlineFor(model, port, flawsOf(model, lp, 2026), p.oDpm + p.dDpm);
    return { name, team: p.team, minutes: p.minutes, shape, hisArea: areaPct, hisTiling: tiling, value: valueOverReplacement(p.oDpm + p.dDpm, p.minutes, teamMinutes, p.games), fit: port.total, tiling: outline.fill, kind: outline.kind };
  });
  const hisTotal = rows.reduce((s, r) => s + r.hisArea, 0);
  const ourTotal = rows.reduce((s, r) => s + r.value, 0);
  console.log(`\n${title}`);
  console.table(
    rows.map((r) => ({
      player: r.name,
      'played for': `${r.team} ${Math.round(r.minutes)}m`,
      'his size': pct(r.hisArea / hisTotal),
      'our size': pct(r.value / ourTotal),
      'his shape': `${r.shape} ${r.hisTiling.toFixed(2)}`,
      'our shape': `${({ super: 'smooth', tri: 'triangle', quad: '4-point', penta: '5-point', burst: 'burst' } as Record<string, string>)[r.kind] ?? r.kind} ${r.tiling.toFixed(2)}`,
      fit: `${r.fit >= 0 ? '+' : ''}${r.fit.toFixed(1)}`,
      shapes: Math.abs(r.tiling - r.hisTiling) <= 0.2 ? 'agree' : r.tiling > r.hisTiling ? 'we say easier' : 'we say harder',
    })),
  );
  console.log(`  SIZE   r = ${pearson(rows.map((r) => r.hisArea), rows.map((r) => r.value)).toFixed(2)}, rank r = ${pearson(ranks(rows.map((r) => r.hisArea)), ranks(rows.map((r) => r.value))).toFixed(2)}`);
  console.log(`  SHAPE  r = ${pearson(rows.map((r) => r.hisTiling), rows.map((r) => r.tiling)).toFixed(2)}, rank r = ${pearson(ranks(rows.map((r) => r.hisTiling)), ranks(rows.map((r) => r.tiling))).toFixed(2)}`);
  for (const r of rows) all.push({ his: r.hisTiling, ours: r.tiling });
}
console.log(`\nSHAPE over all ${all.length} of his players: r = ${pearson(all.map((x) => x.his), all.map((x) => x.ours)).toFixed(2)}`);

// His box vs ours, on the one roster that is the same in both.
const nyk = buildRosterShapePlate(snap.players.filter((p) => p.team === 'NYK'), model, 2026);
const sas = buildRosterShapePlate(snap.players.filter((p) => p.team === 'SAS'), model, 2026);
console.log(`\nSpurs fill: his ~76%, ours ${Math.round(sas.fill * 100)}%.`);
console.log(`Knicks fill: his 77%, ours ${Math.round(nyk.fill * 100)}% of the calibrated box (worth ${PERFECT_TEAM_VALUE.toFixed(1)}, a +${PERFECT_TEAM_NET} team). On the site the box is 1.4× the season's fullest roster, which for 2025-26 is this same size.`);
