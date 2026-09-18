/**
 * Fit the portability model from the snapshots → data/model.json.
 *
 *   bun scripts/fit-model.ts
 *
 * Everything the plates use is in that one file, committed, so a build never
 * refits and two builds cannot disagree. The cross-validation is printed AND
 * stored, because the honest summary of this model is its out-of-sample score:
 * the signal is real, and it is small.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { ridge, scoreWeights, symmetricEigen, varimax, weightedCorrelation, weightedQuantiles, weightedR2 } from '../src/lib/fit';
import { estimateCreation, handlingOf, STYLE_STATS, WEAK_END } from '../src/lib/model';
import { embed, neighbourShape, shapeFeatures, FEATURE_NAMES, FEATURE_USE, NEIGHBOURS_K, type NeighbourModel } from '../src/lib/neighbours';
import { playoffReadings } from '../src/lib/playoffs';
import type { PlayoffRow } from '../src/data';
import { existsSync } from 'fs';
import { portabilityOf, predictLineup, skillFeatures, skillScores, styleScores, threeMakesPer100, STYLE_COMPONENTS as K, type PortabilityModel, type SideModel, type SkillModel } from '../src/lib/portability';
import type { LineupRow, SeasonSnapshot } from '../src/data';

const MIN_FIT_MINUTES = 500; // player-seasons the PCA is fitted on
const MIN_LINEUP_PLAYER_MINUTES = 300; // every one of the five must clear this
const MIN_LINEUP_POSSESSIONS = 60; // each way; below this a residual is noise
const MINUTES_SHRINK = 400;
const RIDGE = 50;
/** Each component is flipped so this stat loads positive, which is what lets it carry a name. */
const ANCHORS: [string, string][] = [
  ['3PR', 'perimeter game'],
  ['TSA100', 'on-ball load'],
  ['d_Steals_Per100', 'disruption over scoring'],
  ['rTSPct', 'scoring efficiency'],
];

interface P {
  team: string;
  id: number;
  season: number;
  name: string;
  minutes: number;
  o: number;
  d: number;
  style: number[];
  /** On-ball creation plus assists per 100; null when the source has neither. */
  handling: number | null;
  /** On-ball creation per 100 (measured, else estimated); null when unknown. */
  creation: number | null;
  assists: number | null;
  games: number | null;
}
const players: P[] = [];
for (const f of readdirSync('data').filter((x) => /^\d{4}\.json$/.test(x))) {
  const snap: SeasonSnapshot = JSON.parse(readFileSync(`data/${f}`, 'utf8'));
  for (const p of snap.players) {
    if (!p.style) continue;
    players.push({ team: p.team, id: p.nbaId, season: snap.season, name: p.name, minutes: p.minutes, o: p.oDpm, d: p.dDpm, style: p.style, handling: handlingOf(p), creation: p.creation ?? estimateCreation(p.tsa, p.assists), assists: p.assists, games: p.games });
  }
}

// ── PCA on standardised style stats ─────────────────────────────────────────
const fitSet = players.filter((p) => p.minutes >= MIN_FIT_MINUTES);
const D = STYLE_STATS.length;
const mu = Array.from({ length: D }, (_, j) => fitSet.reduce((s, p) => s + p.style[j], 0) / fitSet.length);
const sd = Array.from({ length: D }, (_, j) => Math.sqrt(fitSet.reduce((s, p) => s + (p.style[j] - mu[j]) ** 2, 0) / fitSet.length));
const Z = fitSet.map((p) => p.style.map((v, j) => (v - mu[j]) / sd[j]));
const corr = Array.from({ length: D }, (_, i) => Array.from({ length: D }, (_, j) => Z.reduce((s, z) => s + z[i] * z[j], 0) / Z.length));
const eig = symmetricEigen(corr);
const components = eig.vectors.slice(0, K).map((vec, k) => {
  const anchor = STYLE_STATS.indexOf(ANCHORS[k][0] as (typeof STYLE_STATS)[number]);
  return vec[anchor] < 0 ? vec.map((x) => -x) : vec;
});
const componentSd = components.map((w) => {
  const s = Z.map((z) => w.reduce((a, wi, i) => a + wi * z[i], 0));
  const m = s.reduce((a, x) => a + x, 0) / s.length;
  return Math.sqrt(s.reduce((a, x) => a + (x - m) ** 2, 0) / s.length);
});
const varianceExplained = eig.values.slice(0, K).map((v) => v / D);

const model: PortabilityModel = {
  stats: [...STYLE_STATS],
  mu,
  sd,
  components,
  componentSd,
  componentNames: ANCHORS.map((a) => a[1]),
  minutesShrink: MINUTES_SHRINK,
  weakEnd: WEAK_END,
  offense: {} as SideModel,
  defense: {} as SideModel,
  meanStyle: [],
  otherFour: { minOffense: [], maxOffense: [], minDefense: [] },
  portabilityMedian: 0,
  portabilitySd: 1,
  wyman: { fitWeight: 0, dpmWeight: 0, looR2: 0, scoreQuantiles: [], referenceFills: [], reference: [] },
  meanPrediction: 0,
  skill: {} as SkillModel,
  spacingBySeason: {},
  report: {} as PortabilityModel['report'],
};

// ── Skill PCA, rotated: what each player can and cannot do ──────────────────
const SKILL_FACTORS = 5;
const SKILL_FEATURE_NAMES = ['3pt makes', 'FT%', 'rel TS', 'assists', 'rim assists', 'ball security', 'FTA', 'shot volume', 'off reb', 'def reb', 'steals', 'blocks'];
{
  const X = fitSet.map((p) => skillFeatures(p.style));
  const F = X[0].length;
  const smu = Array.from({ length: F }, (_, j) => X.reduce((a, x) => a + x[j], 0) / X.length);
  const ssd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((a, x) => a + (x[j] - smu[j]) ** 2, 0) / X.length));
  const SZ = X.map((x) => x.map((v, j) => (v - smu[j]) / ssd[j]));
  const scorr = Array.from({ length: F }, (_, i) => Array.from({ length: F }, (_, j) => SZ.reduce((a, z) => a + z[i] * z[j], 0) / SZ.length));
  const se = symmetricEigen(scorr);
  // Loadings = eigenvector × sqrt(eigenvalue), rows = features.
  const loadings = Array.from({ length: F }, (_, i) => Array.from({ length: SKILL_FACTORS }, (_, k) => se.vectors[k][i] * Math.sqrt(se.values[k])));
  const rotated = varimax(loadings);
  // Orient each factor by its largest loading, then name it by that feature.
  for (let k = 0; k < SKILL_FACTORS; k++) {
    let top = 0;
    for (let i = 1; i < F; i++) if (Math.abs(rotated[i][k]) > Math.abs(rotated[top][k])) top = i;
    if (rotated[top][k] < 0) for (let i = 0; i < F; i++) rotated[i][k] = -rotated[i][k];
  }
  const weights = scoreWeights(rotated);
  const raw = SZ.map((z) => weights[0].map((_, k) => z.reduce((a, zi, i) => a + zi * weights[i][k], 0)));
  const fsd = Array.from({ length: SKILL_FACTORS }, (_, k) => {
    const m = raw.reduce((a, r) => a + r[k], 0) / raw.length;
    return Math.sqrt(raw.reduce((a, r) => a + (r[k] - m) ** 2, 0) / raw.length);
  });
  const orebIndex = SKILL_FEATURE_NAMES.indexOf('off reb');
  let splitFactor = 0;
  for (let k = 1; k < SKILL_FACTORS; k++) if (Math.abs(rotated[orebIndex][k]) > Math.abs(rotated[orebIndex][splitFactor])) splitFactor = k;
  const LABEL: Record<string, string> = { assists: 'playmaking', 'rim assists': 'playmaking', 'shot volume': 'scoring volume', FTA: 'scoring volume', 'rel TS': 'efficiency', steals: 'steals', 'def reb': 'rebounding', 'off reb': 'rebounding', blocks: 'rim protection', '3pt makes': 'shooting', 'FT%': 'touch', 'ball security': 'ball security' };
  const names: string[] = [];
  for (let k = 0; k < SKILL_FACTORS; k++) {
    if (k === splitFactor) continue;
    let top = 0;
    for (let i = 1; i < F; i++) if (Math.abs(rotated[i][k]) > Math.abs(rotated[top][k])) top = i;
    names.push(LABEL[SKILL_FEATURE_NAMES[top]] ?? SKILL_FEATURE_NAMES[top]);
  }
  // The split factor is oriented by offensive rebounds: + is interior, − is shooting.
  if (rotated[orebIndex][splitFactor] < 0) for (let i = 0; i < F; i++) rotated[i][splitFactor] = -rotated[i][splitFactor];
  const weights2 = scoreWeights(rotated);
  names.push('interior play', 'shooting', 'defense');
  const dvals = fitSet.map((p) => p.d);
  const dmean = dvals.reduce((a, x) => a + x, 0) / dvals.length;
  const defenseSd = Math.sqrt(dvals.reduce((a, x) => a + (x - dmean) ** 2, 0) / dvals.length);
  model.skill = { mu: smu, sd: ssd, weights: weights2.map((row) => row.map((w, k) => w / fsd[k])), splitFactor, names, defenseSd, thirdBestMedian: 0, thirdBestLow: 0 };
  const thirds = players
    .filter((p) => p.minutes >= 1000)
    .map((p) => [...skillScores(model.skill, p.style, p.minutes, p.d)].sort((a, b) => b - a)[2])
    .sort((a, b) => a - b);
  model.skill.thirdBestMedian = thirds[Math.floor(thirds.length / 2)];
  model.skill.thirdBestLow = thirds[Math.floor(thirds.length * 0.05)];
  console.log(`Skill PCA (varimax, ${SKILL_FACTORS} factors, ${(se.values.slice(0, SKILL_FACTORS).reduce((a, v) => a + v, 0) / F * 100).toFixed(0)}% of variance):`);
  for (let k = 0; k < SKILL_FACTORS; k++) {
    const top = rotated.map((row, i) => [row[k], SKILL_FEATURE_NAMES[i]] as const).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 4);
    console.log(`  ${k === splitFactor ? 'interior ↔ shooting' : 'factor ' + (k + 1)}: ${top.map(([x, n]) => `${n} ${x >= 0 ? '+' : ''}${x.toFixed(2)}`).join(', ')}`);
  }
  console.log(`  third-best skill among regulars: median ${model.skill.thirdBestMedian.toFixed(2)}, 5th percentile ${model.skill.thirdBestLow.toFixed(2)} SD`);
}

const scoreOf = new Map<string, number[]>();
const byKey = new Map<string, P>();
for (const p of players) {
  scoreOf.set(`${p.id}:${p.season}`, styleScores(model, p.style, p.minutes));
  byKey.set(`${p.id}:${p.season}`, p);
}
const totalMinutes = players.reduce((s, p) => s + p.minutes, 0);
model.meanStyle = Array.from({ length: K }, (_, k) => players.reduce((s, p) => s + p.minutes * scoreOf.get(`${p.id}:${p.season}`)![k], 0) / totalMinutes);

// ── Lineups → residuals and features, one target per end ───────────────────
const lineups: LineupRow[] = JSON.parse(readFileSync('data/lineups.json', 'utf8'));
interface Row {
  season: number;
  w: number;
  S: number[];
  o: number[];
  d: number[];
  five: P[];
  offense: number; // ORtg − league − Σ O-DPM
  defense: number; // league − DRtg − Σ D-DPM
  expected: number;
  net: number;
}
const rows: Row[] = [];
for (const [season, ids, op, dp, pts, opp, lg] of lineups) {
  if (op < MIN_LINEUP_POSSESSIONS || dp < MIN_LINEUP_POSSESSIONS) continue;
  const five = ids.map((id) => byKey.get(`${id}:${season}`));
  if (five.some((p) => !p || p.minutes < MIN_LINEUP_PLAYER_MINUTES)) continue;
  const ps = five as P[];
  const o = ps.map((p) => p.o);
  const d = ps.map((p) => p.d);
  const ortg = (100 * pts) / op;
  const drtg = (100 * opp) / dp;
  rows.push({
    season,
    w: (op + dp) / 2,
    S: Array.from({ length: K }, (_, k) => ps.reduce((s, p) => s + scoreOf.get(`${p.id}:${season}`)![k], 0)),
    o,
    d,
    five: ps,
    offense: ortg - lg - o.reduce((a, x) => a + x, 0),
    defense: lg - drtg - d.reduce((a, x) => a + x, 0),
    expected: [...o, ...d].reduce((a, x) => a + x, 0),
    net: ortg - drtg,
  });
}

const styleFeatures = (r: Row) => {
  const f = [1, ...r.S, ...r.S.map((s) => s * s)];
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) f.push(r.S[i] * r.S[j]);
  return f;
};
// The link terms that improved the out-of-sample fit. Tried and dropped because
// they did not: a count of weak OFFENSIVE players, and min/max on the other end.
const offenseFeatures = (r: Row) => [...styleFeatures(r), Math.min(...r.o), Math.max(...r.o)];
const defenseFeatures = (r: Row) => [...styleFeatures(r), Math.min(...r.d), r.d.filter((x) => x < WEAK_END).length];
const dot = (f: number[], beta: number[]) => f.reduce((s, x, i) => s + x * beta[i], 0);
const weights = (set: Row[]) => set.map((r) => r.w);

function crossValidate(offF: (r: Row) => number[], defF: (r: Row) => number[]) {
  const out = { net: [] as number[], corr: [] as number[], off: [] as number[], def: [] as number[] };
  for (const fold of [0, 1]) {
    const train = rows.filter((r) => r.season % 2 === fold);
    const test = rows.filter((r) => r.season % 2 !== fold);
    const bo = ridge(train.map(offF), train.map((r) => r.offense), weights(train), RIDGE);
    const bd = ridge(train.map(defF), train.map((r) => r.defense), weights(train), RIDGE);
    const po = test.map((r) => dot(offF(r), bo));
    const pdf = test.map((r) => dot(defF(r), bd));
    const w = weights(test);
    out.off.push(weightedR2(test.map((r) => r.offense), po, w));
    out.def.push(weightedR2(test.map((r) => r.defense), pdf, w));
    out.net.push(weightedR2(test.map((r) => r.offense + r.defense), po.map((x, i) => x + pdf[i]), w));
    out.corr.push(weightedCorrelation(test.map((r) => r.offense + r.defense), po.map((x, i) => x + pdf[i]), w));
  }
  return out;
}
/**
 * The same test one level up, which is the level the plate is read at: fit on
 * half the seasons, predict every lineup in the other half, then average by
 * TEAM-season (possession-weighted, centred on that season's league) and compare
 * predicted team fit with what those lineups actually did beyond Σ DPM.
 */
function teamLevelCorrelation(): { correlation: number; teams: number } {
  const pred: number[] = [];
  const obs: number[] = [];
  const wt: number[] = [];
  for (const fold of [0, 1]) {
    const train = rows.filter((r) => r.season % 2 === fold);
    const test = rows.filter((r) => r.season % 2 !== fold && r.five.every((p) => p.team === r.five[0].team));
    const bo = ridge(train.map(offenseFeatures), train.map((r) => r.offense), weights(train), RIDGE);
    const bd = ridge(train.map(defenseFeatures), train.map((r) => r.defense), weights(train), RIDGE);
    const teams = new Map<string, { w: number; p: number; o: number; season: number }>();
    for (const r of test) {
      const key = `${r.season}:${r.five[0].team}`;
      const a = teams.get(key) ?? { w: 0, p: 0, o: 0, season: r.season };
      a.w += r.w;
      a.p += r.w * (dot(offenseFeatures(r), bo) + dot(defenseFeatures(r), bd));
      a.o += r.w * (r.offense + r.defense);
      teams.set(key, a);
    }
    const league = new Map<number, { w: number; p: number; o: number }>();
    for (const a of teams.values()) {
      const l = league.get(a.season) ?? { w: 0, p: 0, o: 0 };
      l.w += a.w;
      l.p += a.p;
      l.o += a.o;
      league.set(a.season, l);
    }
    for (const a of teams.values()) {
      const l = league.get(a.season)!;
      pred.push(a.p / a.w - l.p / l.w);
      obs.push(a.o / a.w - l.o / l.w);
      wt.push(a.w);
    }
  }
  return { correlation: weightedCorrelation(obs, pred, wt), teams: pred.length };
}
const teamCv = teamLevelCorrelation();
const cvStyle = crossValidate(styleFeatures, styleFeatures);
const cvFull = crossValidate(offenseFeatures, defenseFeatures);

function sideFrom(beta: number[], extras: { minLink?: number; maxLink?: number; weakCount?: number }): SideModel {
  const quadratic = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  for (let k = 0; k < K; k++) quadratic[k][k] = beta[1 + K + k];
  let c = 1 + 2 * K;
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) quadratic[i][j] = quadratic[j][i] = beta[c++] / 2;
  return { intercept: beta[0], linear: beta.slice(1, 1 + K), quadratic, minLink: extras.minLink ?? 0, maxLink: extras.maxLink ?? 0, weakCount: extras.weakCount ?? 0 };
}
const bo = ridge(rows.map(offenseFeatures), rows.map((r) => r.offense), weights(rows), RIDGE);
const bd = ridge(rows.map(defenseFeatures), rows.map((r) => r.defense), weights(rows), RIDGE);
const tail = 1 + 2 * K + (K * (K - 1)) / 2;
model.offense = sideFrom(bo, { minLink: bo[tail], maxLink: bo[tail + 1] });
model.defense = sideFrom(bd, { minLink: bd[tail], weakCount: bd[tail + 1] });

// What a player's four lineup-mates look like, from real lineups, over every
// slot, weighted by possessions.
const slot = { minO: [] as number[], maxO: [] as number[], minD: [] as number[], w: [] as number[] };
for (const r of rows) {
  for (let i = 0; i < 5; i++) {
    const o = r.o.filter((_, j) => j !== i);
    slot.minO.push(Math.min(...o));
    slot.maxO.push(Math.max(...o));
    slot.minD.push(Math.min(...r.d.filter((_, j) => j !== i)));
    slot.w.push(r.w);
  }
}
model.otherFour = {
  minOffense: weightedQuantiles(slot.minO, slot.w, 99),
  maxOffense: weightedQuantiles(slot.maxO, slot.w, 99),
  minDefense: weightedQuantiles(slot.minD, slot.w, 99),
};

// The scale the outline is drawn on: real rotation players.
const asLineupPlayer = (p: P) => ({ style: p.style, minutes: p.minutes, oDpm: p.o, dDpm: p.d, handling: p.handling, creation: p.creation, assists: p.assists });
const ports = players.filter((p) => p.minutes >= 1000).map((p) => portabilityOf(model, asLineupPlayer(p)).total).sort((a, b) => a - b);
model.portabilityMedian = ports[Math.floor(ports.length / 2)];
const meanPort = ports.reduce((s, x) => s + x, 0) / ports.length;
model.portabilitySd = Math.sqrt(ports.reduce((s, x) => s + (x - meanPort) ** 2, 0) / ports.length);

for (const season of new Set(players.map((p) => p.season))) {
  const perimeter = players.filter((p) => p.season === season && p.minutes >= 1000 && -styleScores(model, p.style, p.minutes)[0] < 0.5).map((p) => threeMakesPer100(p.style));
  const m = perimeter.reduce((a, x) => a + x, 0) / perimeter.length;
  model.spacingBySeason[String(season)] = { mean: m, sd: Math.sqrt(perimeter.reduce((a, x) => a + (x - m) ** 2, 0) / perimeter.length) };
}
{
  const first = model.spacingBySeason[String(Math.min(...players.map((p) => p.season)))];
  const last = model.spacingBySeason[String(Math.max(...players.map((p) => p.season)))];
  console.log(`Spacing scale by season: perimeter regulars' three-point makes per 100, mean ${first.mean.toFixed(2)} → ${last.mean.toFixed(2)}`);
}
// The on-ball scale: playmaking load (creation + assists per 100) among regulars, by season.
model.handlingBySeason = {};
for (const season of new Set(players.map((p) => p.season))) {
  const loads = players.filter((p) => p.season === season && p.minutes >= 1000 && p.handling !== null).map((p) => p.handling as number).sort((a, b) => a - b);
  if (loads.length === 0) continue;
  const at = (q: number) => loads[Math.min(loads.length - 1, Math.floor(q * loads.length))];
  model.handlingBySeason[String(season)] = { p85: at(0.85), p97: at(0.97) };
}
{
  const last = model.handlingBySeason[String(Math.max(...players.map((p) => p.season)))];
  console.log(`Playmaking-load scale: among regulars, latest season 85th pct ${last.p85.toFixed(1)}, 97th ${last.p97.toFixed(1)} per 100.`);
}
// The non-passer scale: on-ball creation per 100 among regulars, by season — the
// 85th percentile is where a player counts as a primary creator.
model.creationBySeason = {};
for (const season of new Set(players.map((p) => p.season))) {
  const cs = players.filter((p) => p.season === season && p.minutes >= 1000 && p.creation !== null).map((p) => p.creation as number).sort((a, b) => a - b);
  if (cs.length === 0) continue;
  model.creationBySeason[String(season)] = { p85: cs[Math.min(cs.length - 1, Math.floor(0.85 * cs.length))] };
}
// ── The Wyman calibration: his 24 shapes → the outline's cleanness ─────────
{
  const ref: { season: number; players: { name: string; tiling: number; shape: string; kind: PortabilityModel['wyman']['reference'][number]['kind'] }[] } = JSON.parse(readFileSync('data/wyman-reference.json', 'utf8'));
  const labelled = ref.players.map((r) => {
    const p = players.find((x) => x.name === r.name && x.season === ref.season);
    if (!p) throw new Error(`reference player not in data/${ref.season}.json: ${r.name}`);
    const port = portabilityOf(model, asLineupPlayer(p));
    return { f: [1, port.fitWithoutLoad, p.o + p.d], y: r.tiling };
  });
  const beta = ridge(labelled.map((l) => l.f), labelled.map((l) => l.y), labelled.map(() => 1), 0.5);
  // Leave-one-out, because 24 points fit anything in-sample.
  let sse = 0;
  const mean = labelled.reduce((s, l) => s + l.y, 0) / labelled.length;
  const sst = labelled.reduce((s, l) => s + (l.y - mean) ** 2, 0);
  labelled.forEach((_, i) => {
    const rest = labelled.filter((__, j) => j !== i);
    const b = ridge(rest.map((l) => l.f), rest.map((l) => l.y), rest.map(() => 1), 0.5);
    sse += (labelled[i].f.reduce((s, x, k) => s + x * b[k], 0) - labelled[i].y) ** 2;
  });
  model.wyman.fitWeight = beta[1];
  model.wyman.dpmWeight = beta[2];
  model.wyman.looR2 = 1 - sse / sst;
  const scores = players
    .filter((p) => p.minutes >= 1000)
    .map((p) => model.wyman.fitWeight * portabilityOf(model, asLineupPlayer(p)).fitWithoutLoad + model.wyman.dpmWeight * (p.o + p.d))
    .sort((a, b) => a - b);
  model.wyman.scoreQuantiles = Array.from({ length: 99 }, (_, i) => scores[Math.floor(((i + 1) / 100) * scores.length)]);
  model.wyman.referenceFills = ref.players.map((r) => r.tiling).sort((a, b) => a - b);
  model.wyman.reference = ref.players.map((r) => ({ name: r.name, season: ref.season, shape: r.shape, kind: r.kind, fill: r.tiling }));
  console.log(`Wyman calibration on his ${labelled.length} shapes: fill ≈ ${beta[0].toFixed(2)} + ${beta[1].toFixed(3)} × fit-without-on-ball + ${beta[2].toFixed(3)} × DPM; leave-one-out R² ${(model.wyman.looR2 * 100).toFixed(0)}%`);
}

// ── Shapes by nearest neighbour: his 41 drawn players as ground truth ──────
{
  const readings = existsSync('data/playoffs.json') ? playoffReadings(JSON.parse(readFileSync('data/playoffs.json', 'utf8')) as PlayoffRow[]) : new Map();
  const asFeaturePlayer = (p: P) => {
    const r = readings.get(`${p.season}:${p.id}`);
    return { ...asLineupPlayer(p), games: p.games, playoff: r ? { dpmDelta: r.dpmDelta, shareScale: r.shareScale } : null };
  };
  const regulars = players.filter((p) => p.minutes >= 1000);
  const X = regulars.map((p) => shapeFeatures(model, asFeaturePlayer(p), p.season));
  const F = X[0].length;
  const mean = Array.from({ length: F }, (_, j) => X.reduce((a, x) => a + x[j], 0) / X.length);
  const sd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((a, x) => a + (x[j] - mean[j]) ** 2, 0) / X.length));
  // The space: the chosen features, standardised (see FEATURE_USE for why not a
  // PCA of all of them — it was tried, and predicted his fills worse than chance).
  const K = FEATURE_USE.length;
  const nn: NeighbourModel = {
    featureNames: [...FEATURE_NAMES],
    mean,
    sd,
    components: FEATURE_USE.map((j) => Array.from({ length: F }, (_, i) => (i === j ? 1 : 0))),
    explained: FEATURE_USE.map(() => 1 / K),
    k: NEIGHBOURS_K,
    reference: [],
    loo: { fillR2: 0, within: 0, n: 0 },
  };
  const acc = 1;
  const ref: { season: number; players: { name: string; tiling: number; shape: string; kind: NeighbourModel['reference'][number]['kind'] }[] } = JSON.parse(readFileSync('data/wyman-reference.json', 'utf8'));
  for (const r of ref.players) {
    const p = players.find((x) => x.name === r.name && x.season === ref.season)!;
    nn.reference.push({ name: r.name, season: ref.season, shape: r.shape, kind: r.kind, tiling: r.tiling, z: embed(nn, shapeFeatures(model, asFeaturePlayer(p), p.season)) });
  }
  // Leave-one-out: each drawn player predicted from the other 40.
  const ys = nn.reference.map((r) => r.tiling);
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sse = 0;
  let within = 0;
  for (const r of nn.reference) {
    const pred = neighbourShape(nn, r.z, (o) => o.name === r.name);
    sse += (pred.fill - r.tiling) ** 2;
    if (Math.abs(pred.fill - r.tiling) <= 0.15) within++;
  }
  nn.loo = { fillR2: 1 - sse / ys.reduce((a, y) => a + (y - my) ** 2, 0), within: within / ys.length, n: ys.length };
  model.nn = nn;
  console.log(`Nearest-neighbour shapes: ${K} of ${F} features (${FEATURE_USE.map((j) => FEATURE_NAMES[j]).join(', ')}), standardised over ${regulars.length} regulars, k = ${NEIGHBOURS_K}; leave-one-out over his ${ys.length} players: fill R² ${(nn.loo.fillR2 * 100).toFixed(0)}%, ${(nn.loo.within * 100).toFixed(0)}% within 0.15 of his fill.${acc ? '' : ''}`);
}

const sw = rows.reduce((s, r) => s + r.w, 0);
model.meanPrediction = rows.reduce((s, r) => s + r.w * predictLineup(model, r.five.map(asLineupPlayer)).net, 0) / sw;

// Calibration of the additive baseline: actual net on Σ DPM, weighted.
const mx = rows.reduce((s, r) => s + r.w * r.expected, 0) / sw;
const my = rows.reduce((s, r) => s + r.w * r.net, 0) / sw;
const slope = rows.reduce((s, r) => s + r.w * (r.expected - mx) * (r.net - my), 0) / rows.reduce((s, r) => s + r.w * (r.expected - mx) ** 2, 0);
const mt = rows.reduce((s, r) => s + r.w * (r.offense + r.defense), 0) / sw;

model.report = {
  lineups: rows.length,
  possessions: Math.round(sw),
  seasons: [Math.min(...rows.map((r) => r.season)), Math.max(...rows.map((r) => r.season))],
  calibrationSlope: slope,
  calibrationIntercept: my - slope * mx,
  residualSd: Math.sqrt(rows.reduce((s, r) => s + r.w * (r.offense + r.defense - mt) ** 2, 0) / sw),
  cvR2: cvFull.net as [number, number],
  cvCorrelation: cvFull.corr as [number, number],
  cvR2Offense: cvFull.off as [number, number],
  cvR2Defense: cvFull.def as [number, number],
  cvR2StyleOnly: cvStyle.net as [number, number],
  varianceExplained,
  teamCvCorrelation: teamCv.correlation,
  teamCvTeams: teamCv.teams,
};

writeFileSync('data/model.json', JSON.stringify(model, null, 1));

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
console.log(`PCA on ${fitSet.length} player-seasons (${MIN_FIT_MINUTES}+ min): ${varianceExplained.map((v) => `${(v * 100).toFixed(0)}%`).join(' ')} of variance`);
components.forEach((w, k) => {
  const top = w.map((x, i) => [x, STYLE_STATS[i]] as const).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 5);
  console.log(`  PC${k + 1} "${ANCHORS[k][1]}": ${top.map(([x, n]) => `${n} ${x >= 0 ? '+' : ''}${x.toFixed(2)}`).join(', ')}`);
});
console.log(`${rows.length} lineups, ${Math.round(sw).toLocaleString()} possessions. Additive baseline: net = ${slope.toFixed(2)} × ΣDPM ${(my - slope * mx).toFixed(2)}`);
console.log(`Out-of-sample R² on net: style only ${cvStyle.net.map(pct).join(' / ')}; full ${cvFull.net.map(pct).join(' / ')} (corr ${cvFull.corr.map((x) => x.toFixed(3)).join(' / ')})`);
console.log(`   TEAM level, out of sample: predicted vs observed team fit, r = ${teamCv.correlation.toFixed(3)} over ${teamCv.teams} team-seasons`);
console.log(`   offense alone ${cvFull.off.map(pct).join(' / ')}; defense alone ${cvFull.def.map(pct).join(' / ')}`);
const lin = (side: SideModel) => side.linear.map((x, k) => `${ANCHORS[k][1]} ${x >= 0 ? '+' : ''}${x.toFixed(2)}`).join(', ');
console.log(`OFFENSE  ${lin(model.offense)} | weakest O ${model.offense.minLink.toFixed(3)}, best O ${model.offense.maxLink.toFixed(3)}`);
console.log(`DEFENSE  ${lin(model.defense)} | weakest D ${model.defense.minLink.toFixed(3)}, each weak defender ${model.defense.weakCount.toFixed(3)}`);
console.log(`Portability among 1,000+ minute players: median ${model.portabilityMedian.toFixed(2)}, sd ${model.portabilitySd.toFixed(2)} pts/100. Mean lineup prediction ${model.meanPrediction.toFixed(2)}.`);
const total = (p: P) => portabilityOf(model, asLineupPlayer(p)).total;
const show = (list: P[]) => list.map((p) => `${p.name} ${String(p.season).slice(2)} ${total(p).toFixed(1)}`).join(', ');
const ranked = players.filter((p) => p.minutes >= 1500).sort((a, b) => total(a) - total(b));
console.log(`Hardest to fit: ${show(ranked.slice(0, 8))}`);
console.log(`Easiest to fit: ${show(ranked.slice(-8).reverse())}`);
