/**
 * Build the static site from the data snapshots.
 *
 *   bun scripts/build.ts            → every season in data/
 *   bun scripts/build.ts 2016       → one season (the rest of dist/ is left alone)
 *
 * dist/index.html redirects to the latest season; each season is
 * dist/<season>/index.html + dist/<season>/team/<ABBR>.html. No server and no
 * framework: every page is a finished HTML file that opens straight from disk.
 * The only script on a page is the hover link between a shape and its row.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { predictLineup, valueOverReplacement, type PortabilityModel, DPM_EXPONENT, type RosterShapePlate } from '../src/lib/index';
import { packSeasonPlates } from '../src/lib/season';
import { attachPlayoffReadings, playoffReadings, playoffReadingText, type PlayoffReading } from '../src/lib/playoffs';
import { seasonLabel, type LineupRow, type PlayerRow, type PlayoffRow, type SeasonSnapshot } from '../src/data';
import { esc, familyLegend, flawLegend, outlineLegend, playerGlyph, renderPlate } from '../src/render';
import { franchiseOf, teamName } from '../src/teams';

const available = readdirSync('data')
  .map((f) => /^(\d{4})\.json$/.exec(f)?.[1])
  .filter((y): y is string => !!y)
  .map(Number)
  .sort((a, b) => a - b);
if (available.length === 0) {
  console.error('No snapshots in data/. Run the export first (see README).');
  process.exit(1);
}
if (!existsSync('data/model.json')) {
  console.error('data/model.json not found. Run: bun scripts/fit-model.ts');
  process.exit(1);
}
const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
const R = model.report;
const only = process.argv[2] ? Number(process.argv[2]) : null;
if (only !== null && !available.includes(only)) {
  console.error(`data/${only}.json not found. Available: ${available[0]}-${available[available.length - 1]}.`);
  process.exit(1);
}
const latest = available[available.length - 1];

/** Which abbreviation a franchise played under in each season, for the team page's picker. */
const franchiseSeasons = new Map<string, Map<number, string>>();
const snapshots = new Map<number, SeasonSnapshot>();
for (const y of available) {
  const snap: SeasonSnapshot = JSON.parse(readFileSync(`data/${y}.json`, 'utf8'));
  snapshots.set(y, snap);
  for (const abbr of new Set(snap.players.map((p) => p.team))) {
    if (!teamName(abbr, y)) continue;
    const key = franchiseOf(abbr);
    if (!franchiseSeasons.has(key)) franchiseSeasons.set(key, new Map());
    franchiseSeasons.get(key)!.set(y, abbr);
  }
}

/**
 * Team fit: the model run over the lineups a team ACTUALLY played, weighted by
 * possessions. `predicted` is what the combination is expected to gain or lose
 * beyond the sum of its players, against an average lineup; `observed` is what
 * those lineups really did beyond Σ DPM, which is mostly noise for one team and
 * is printed beside the prediction so nobody mistakes one for the other.
 */
interface TeamFit {
  predicted: number;
  offense: number;
  defense: number;
  observed: number;
  possessions: number;
  lineups: number;
}
interface TeamPlate extends RosterShapePlate {
  abbr: string;
  name: string;
  fit: TeamFit | null;
  /** The season's box as the +N team it is worth, and how many growth steps it needed past the calibrated size. */
  boxNet: number;
  boxGrown: number;
}

const allLineups: LineupRow[] = existsSync('data/lineups.json') ? JSON.parse(readFileSync('data/lineups.json', 'utf8')) : [];
/** Every player's playoff reading by season, career to date. */
const readings: Map<string, PlayoffReading> = existsSync('data/playoffs.json') ? playoffReadings(JSON.parse(readFileSync('data/playoffs.json', 'utf8')) as PlayoffRow[]) : new Map();
const readingOf = (season: number, nbaId: number) => readings.get(`${season}:${nbaId}`);
const lineupsBySeason = new Map<number, LineupRow[]>();
for (const l of allLineups) {
  if (!lineupsBySeason.has(l[0])) lineupsBySeason.set(l[0], []);
  lineupsBySeason.get(l[0])!.push(l);
}

function teamFits(season: number, players: PlayerRow[]): Map<string, TeamFit> {
  const byId = new Map(players.map((p) => [p.nbaId, p]));
  const acc = new Map<string, { w: number; net: number; off: number; def: number; obs: number; n: number }>();
  for (const [, ids, op, dp, pts, opp] of lineupsBySeason.get(season) ?? []) {
    const five = ids.map((id) => byId.get(id));
    if (five.some((p) => !p || !p.style)) continue;
    const ps = five as PlayerRow[];
    // A lineup belongs to the team all five are listed with. A traded player's
    // row names one team only, so his lineups for the other are left out.
    if (!ps.every((p) => p.team === ps[0].team)) continue;
    const pred = predictLineup(model, ps.map((p) => ({ style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm })));
    const w = (op + dp) / 2;
    const observed = (100 * pts) / op - (100 * opp) / dp - ps.reduce((a, p) => a + p.oDpm + p.dDpm, 0);
    const a = acc.get(ps[0].team) ?? { w: 0, net: 0, off: 0, def: 0, obs: 0, n: 0 };
    a.w += w;
    a.net += w * pred.net;
    a.off += w * pred.offense;
    a.def += w * pred.defense;
    a.obs += w * observed;
    a.n++;
    acc.set(ps[0].team, a);
  }
  // Centred on THIS season's league, over the same lineups: a team's fit is
  // against the average lineup anyone played that year. (Centring on the model's
  // own mean was tried first and made all thirty teams positive, because team fit
  // reads every lineup and the model was fitted on the heavily used ones.)
  let W = 0;
  let net = 0;
  let off = 0;
  let def = 0;
  let obs = 0;
  for (const a of acc.values()) {
    W += a.w;
    net += a.net;
    off += a.off;
    def += a.def;
    obs += a.obs;
  }
  return new Map(
    [...acc].map(([team, a]) => [
      team,
      {
        predicted: a.net / a.w - net / W,
        offense: a.off / a.w - off / W,
        defense: a.def / a.w - def / W,
        observed: a.obs / a.w - obs / W,
        possessions: Math.round(a.w),
        lineups: a.n,
      },
    ]),
  );
}

const CSS = `
:root { --bg:#EDEFF1; --fg:#17181A; --muted:#5C6168; --faint:#8B9097; --line:#D6D9DD; --panel:#FFFFFF; --hover:#F3F4F6; --good:#2F7D4E; --bad:#B03A2E; --warn:#9A5B12; --wm:#17181A; }
@media (prefers-color-scheme: dark) { :root { --bg:#141517; --fg:#ECEDEF; --muted:#A3A8AF; --faint:#7C8288; --line:#2A2D31; --panel:#1C1E21; --hover:#26292D; --good:#6CC08B; --bad:#E07A6E; --warn:#E0A64A; --wm:#ECEDEF; } }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
a { color:inherit; }
:focus-visible { outline:2px solid var(--fg); outline-offset:2px; }
.display { font-family:"Bricolage Grotesque",-apple-system,BlinkMacSystemFont,sans-serif; font-optical-sizing:auto; font-variation-settings:"wdth" 100; }
.bar { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid var(--line); }
.bar-in { max-width:1440px; margin:0 auto; padding:9px 24px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.wordmark { font-family:"Bricolage Grotesque",sans-serif; font-weight:800; font-size:22px; letter-spacing:-0.02em; text-decoration:none; color:var(--wm); line-height:1; }
.wordmark small { display:block; font-family:-apple-system,BlinkMacSystemFont,sans-serif; font-weight:400; font-size:12px; letter-spacing:0; color:var(--muted); margin-top:3px; }
.bar select { appearance:none; -webkit-appearance:none; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:7px 30px 7px 12px; font:inherit; font-size:14px; cursor:pointer; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%235C6168' stroke-width='1.6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; }
.bar .spacer { flex:1; }
.bar .howlink { font-size:14px; color:var(--muted); text-decoration:none; } .bar .howlink:hover { color:var(--fg); }
.tag.po { border-color:var(--warn); color:var(--warn); }
.row .why.po { color:var(--faint); }
main { max-width:1440px; margin:0 auto; padding:22px 24px 64px; }
.intro { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px 32px; margin:6px 0 22px; }
.intro h1 { font-family:"Bricolage Grotesque",sans-serif; font-weight:700; font-size:34px; line-height:1.05; letter-spacing:-0.02em; margin:0; max-width:14em; }
.intro p { margin:8px 0 0; max-width:36em; color:var(--muted); }
.key { display:grid; gap:6px 20px; font-size:13px; color:var(--muted); }
.key > div { display:flex; flex-wrap:wrap; align-items:center; gap:4px 14px; }
.key .k { color:var(--fg); font-weight:600; min-width:56px; }
.key span { display:inline-flex; align-items:center; gap:6px; }
.glyph { flex:none; vertical-align:-2px; }
.key .glyph + .glyph { margin-left:-3px; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px 16px; }
@media (min-width:720px) { .grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (min-width:1040px) { .grid { grid-template-columns:repeat(4,minmax(0,1fr)); gap:26px 20px; } }
.card { text-decoration:none; display:block; min-width:0; color:inherit; }
.card-head { display:flex; align-items:baseline; gap:8px; margin-bottom:6px; }
.card-head .rank { color:var(--faint); font-variant-numeric:tabular-nums; font-size:13px; width:20px; }
.card-head .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:"Bricolage Grotesque",sans-serif; font-weight:600; font-size:16px; letter-spacing:-0.01em; }
.card-head .fill { font-family:"Bricolage Grotesque",sans-serif; font-weight:700; font-size:18px; font-variant-numeric:tabular-nums; }
.card-head .cardfit { font-size:12px; font-variant-numeric:tabular-nums; }
.card:hover .name { text-decoration:underline; text-underline-offset:3px; }
.plate { display:block; width:100%; height:auto; }
.plate text { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; pointer-events:none; }
.card .plate { border-radius:2px; }
.team-head { margin:6px 0 18px; display:flex; flex-wrap:wrap; align-items:center; gap:12px 24px; }
.team-head h1 { font-family:"Bricolage Grotesque",sans-serif; font-weight:700; font-size:44px; line-height:1; letter-spacing:-0.025em; margin:0; }
.team-head .sub { color:var(--muted); margin:0; font-size:14px; }
.scrubber { display:inline-flex; align-items:center; gap:2px; border:1px solid var(--line); border-radius:999px; padding:3px; background:var(--panel); }
.scrubber a, .scrubber span { padding:5px 12px; font-size:13px; border-radius:999px; text-decoration:none; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
.scrubber a:hover { color:var(--fg); background:var(--hover); }
.scrubber .cur { background:var(--fg); color:var(--bg); font-weight:600; }
.scrubber .off { color:var(--faint); pointer-events:none; }
.team { display:grid; gap:28px; }
.team > .left { min-width:0; }
.team > .right { min-width:0; }
@media (min-width:1100px) { .team { grid-template-columns:minmax(0,1fr) 440px; gap:48px; } }
.recent { margin-top:22px; }
.recent h2 { font-family:"Bricolage Grotesque",sans-serif; font-weight:600; font-size:15px; letter-spacing:-0.01em; margin:0 0 10px; color:var(--muted); }
.recent-row { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; }
.recent-row a { text-decoration:none; color:inherit; min-width:0; }
.recent-row .plate { border-radius:2px; }
.recent-row .cap { display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:5px; font-variant-numeric:tabular-nums; }
.recent-row .cap b { color:var(--fg); font-weight:600; }
.recent-row a.cur .cap { color:var(--fg); }
.recent-row a:hover .cap b { text-decoration:underline; text-underline-offset:3px; }
.readings { display:grid; grid-template-columns:1fr 1fr; gap:14px 24px; margin:2px 0 22px; }
@media (min-width:1100px) { .readings { grid-template-columns:1fr; gap:18px; } }
.reading b { display:block; font-family:"Bricolage Grotesque",sans-serif; font-weight:800; font-size:52px; line-height:1; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; }
.reading span { display:block; font-size:13px; color:var(--muted); line-height:1.4; margin-top:6px; max-width:26em; }
.reading .lbl { color:var(--fg); font-weight:600; }
.players { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.players-h { display:flex; justify-content:space-between; align-items:baseline; padding:10px 14px; border-bottom:1px solid var(--line); font-size:13px; color:var(--muted); }
.players-h b { color:var(--fg); font-weight:600; font-size:14px; }
.row { display:grid; grid-template-columns:18px minmax(0,1fr) auto; gap:10px; padding:9px 14px; border-bottom:1px solid var(--line); align-items:start; }
.row:last-child { border-bottom:0; }
.row.on, .row:hover { background:var(--hover); }
.row .glyph { margin-top:2px; }
.row .nm { font-weight:600; font-size:14px; line-height:1.3; }
.row .why { color:var(--muted); font-size:12px; line-height:1.35; margin-top:1px; }
.row .num { display:flex; gap:10px; font-size:11.5px; color:var(--faint); margin-top:4px; font-variant-numeric:tabular-nums; flex-wrap:wrap; }
.row .num b { font-weight:500; color:var(--muted); }
.row .fit { font-size:15px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; padding-top:1px; }
.note { color:var(--muted); font-size:13px; max-width:44em; }
.note b { color:var(--fg); font-weight:600; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.table-wrap { overflow-x:auto; }
.key.small { font-size:12px; margin-top:16px; }
table { width:100%; border-collapse:collapse; font-size:13px; line-height:1.3; }
th { text-align:right; font-weight:500; color:var(--muted); padding:9px 8px; border-bottom:1px solid var(--line); white-space:nowrap; }
th:first-child, td:first-child { text-align:left; padding-left:12px; }
td { padding:8px 8px; border-bottom:1px solid var(--line); text-align:right; vertical-align:top; font-variant-numeric:tabular-nums; white-space:nowrap; }
td:first-child { white-space:normal; min-width:220px; }
tr:last-child td { border-bottom:0; }
tr.on td, tbody tr:hover td { background:var(--hover); }
.who { display:flex; gap:9px; align-items:flex-start; }
.who .glyph { margin-top:2px; }
.who b { font-weight:600; }
.who small { display:block; color:var(--muted); font-size:12px; line-height:1.35; }
.pos { color:var(--good); } .neg { color:var(--bad); } .dimtext { color:var(--muted); }
.caveat { color:var(--warn); font-size:13px; margin:0 0 10px; }
.shape { transition:opacity .12s; } .plate.dimming .shape:not(.on) { opacity:.28; }
@media (prefers-reduced-motion: reduce) { .shape { transition:none; } }
.tag { display:inline-block; font-size:11px; padding:0 6px; border:1px solid var(--line); border-radius:999px; color:var(--muted); margin-left:6px; vertical-align:1px; white-space:nowrap; }
.how { margin-top:36px; padding-top:22px; border-top:1px solid var(--line); max-width:44em; }
.how h2 { font-family:"Bricolage Grotesque",sans-serif; font-weight:700; font-size:22px; letter-spacing:-0.015em; margin:0 0 8px; }
.how p { color:var(--muted); font-size:14px; margin:0 0 10px; }
.how b { color:var(--fg); font-weight:600; }
.how details { margin-top:8px; font-size:14px; color:var(--muted); }
.how summary { cursor:pointer; color:var(--fg); font-weight:600; margin-bottom:8px; }
.foot { margin-top:28px; color:var(--faint); font-size:13px; max-width:44em; }
.foot a { color:var(--muted); }
@media (max-width:719px) {
  .bar-in { display:grid; grid-template-columns:1fr 1fr; gap:8px 10px; padding:8px 16px; }
  .wordmark { grid-column:1; font-size:19px; }
  .wordmark small { display:none; }
  .bar .spacer { display:none; }
  .bar .howlink { grid-column:2; grid-row:1; justify-self:end; align-self:center; font-size:13px; }
  .bar label { min-width:0; display:block; }
  .bar select { width:100%; font-size:13px; padding:6px 26px 6px 10px; }
  main { padding:16px 16px 48px; }
  .team-head { gap:10px 16px; margin-bottom:14px; }
  .team-head h1 { font-size:34px; }
  .reading b { font-size:40px; }
  .recent-row { display:flex; overflow-x:auto; gap:10px; padding-bottom:6px; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; }
  .recent-row a { flex:0 0 118px; scroll-snap-align:center; }
}
`;

const SITE = 'Roster Shapes';
const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=swap" rel="stylesheet">`;

const page = (title: string, description: string, body: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}">${FONT}<style>${CSS}</style></head><body>${body}${script}</body></html>`;

const CREDIT = `The idea is Taylormetrics&rsquo; Wyman diagram: fill the box so you cannot see any white. His is drawn by hand; here the size of every shape is read from data and its outline is fitted to lineup results and to his three diagrams.`;

const signedText = (n: number) => `${n >= 0 ? '+' : '&minus;'}${Math.abs(n).toFixed(1)}`;
const signedCell = (n: number) =>
  `<td class="${n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : ''}">${n >= 0 ? '+' : '&minus;'}${Math.abs(n).toFixed(1)}</td>`;

const NAV_SCRIPT = `<script>document.querySelectorAll('select[data-nav]').forEach(s=>s.addEventListener('change',()=>{if(s.value)location.href=s.value;}));(()=>{const c=document.querySelector('.recent-row .cur');const r=c&&c.parentElement;if(r&&r.scrollWidth>r.clientWidth)r.scrollLeft=c.offsetLeft-(r.clientWidth-c.offsetWidth)/2;})();</script>`;
const HOVER = `<script>(()=>{const plates=[...document.querySelectorAll('.team .plate')];if(!plates.length)return;const set=id=>{plates.forEach(p=>p.classList.toggle('dimming',id!==null));document.querySelectorAll('[data-id]').forEach(e=>e.classList.toggle('on',e.dataset.id===id));};document.querySelectorAll('[data-id]').forEach(e=>{e.addEventListener('mouseenter',()=>set(e.dataset.id));e.addEventListener('mouseleave',()=>set(null));});})()</script>`;

/** The top bar: wordmark, season menu, and on a team page a team menu. `hrefFor(season)` is the page this season maps to. */
function topBar(current: number, hrefForSeason: (y: number) => string | null, teamMenu = '', home = '../index.html'): string {
  const options = [...available]
    .reverse()
    .map((y) => {
      const href = y === current ? '' : hrefForSeason(y);
      if (y !== current && !href) return '';
      return `<option value="${href}"${y === current ? ' selected' : ''}>${seasonLabel(y)}</option>`;
    })
    .join('');
  return (
    `<header class="bar"><div class="bar-in">` +
    `<a class="wordmark" href="${home}">${SITE}<small>Every NBA roster as shapes in a box</small></a>` +
    `<label><select data-nav aria-label="Season">${options}</select></label>` +
    teamMenu +
    `<span class="spacer"></span><a class="howlink" href="#how">How it works</a>` +
    `</div></header>`
  );
}

function keyBlock(): string {
  return `<div class="key"><div><span class="k">Outline</span>${outlineLegend()}</div><div><span class="k">Flaw</span>${flawLegend()}</div><div><span class="k">Colour</span>${familyLegend()}</div></div>`;
}

const platesBySeason = new Map<number, TeamPlate[]>();

/** Pack one season's rosters (the slow part), kept so team pages can show a franchise's other seasons. */
function packSeason(season: number): { teams: number; ms: number; top: string } {
  const snapshot = snapshots.get(season)!;
  attachPlayoffReadings(snapshot.players, season, readings);

  const byTeam = new Map<string, PlayerRow[]>();
  for (const p of snapshot.players) {
    if (!teamName(p.team, season)) continue;
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team)!.push(p);
  }
  const t0 = performance.now();
  const fits = teamFits(season, snapshot.players);
  const packed = packSeasonPlates(byTeam, model, season);
  const teams: TeamPlate[] = [...packed.plates.entries()]
    .map(([abbr, plate]) => ({ abbr, name: teamName(abbr, season)!, fit: fits.get(abbr) ?? null, boxNet: packed.boxNet, boxGrown: packed.grown, ...plate }))
    .sort((a, b) => b.fill - a.fill);
  platesBySeason.set(season, teams);
  return { teams: teams.length, ms: Math.round(performance.now() - t0), top: `box +${packed.boxNet.toFixed(1)}${packed.grown ? ` (grown ${packed.grown}×)` : ''}; ` + teams.slice(0, 3).map((t) => `${t.abbr} ${Math.round(t.fill * 100)}%`).join(', ') };
}

function buildSeason(season: number): void {
  const label = seasonLabel(season);
  const teams = platesBySeason.get(season)!;
  mkdirSync(`dist/${season}/team`, { recursive: true });

  const howBlock = (teamNote: string) =>
    `<section class="how" id="how"><h2>How it works</h2>` +
    `<p><b>Area is how good the player is.</b> A shape&rsquo;s area is his value &mdash; his DPM above a replacement player (&minus;2.0) to the power ${DPM_EXPONENT}, times his minutes per game as a share of 48, with his playoff reading applied (below). The power is a choice, set so his star pairs come out as he draws them (Wembanyama at 4.3&times; Fox and 2.2&times; Anunoby; his diagrams 4.5&times; and about 1.9&times;): stars are drawn much bigger than role players, more than linearly, and a player is sized by his level and his role, not by the games he missed. The box is sized for the season: 1.4 times the fullest roster of the year, so the fullest reads about 71% the way his Spurs and Knicks diagrams are about three-quarters full, and grown only if some roster still could not pack at true size. Every above-replacement player is inside it, to scale, and nothing is shrunk. Each page says what the season&rsquo;s box is worth as a team, so seasons can be compared. Players below replacement add nothing to the box, so they sit in a strip under it as hollow outlines, sized by what they cost.</p>` +
    `<p><b>Outline is how easily he fits.</b> Squares and rectangles sit flush; circles, diamonds and stars leave white around them. The outline comes from two things: a lineup model, and his three diagrams. The model reads ${R.lineups.toLocaleString()} real five-man lineups since ${seasonLabel(R.seasons[0])} and asks how much better or worse a group played than the sum of its players&rsquo; DPM; a player&rsquo;s <b>Fit</b> is the fitted effect of putting him in a typical lineup, in points per 100 beyond his DPM. The five Wyman diagrams he has drawn (Knicks, Lakers, Spurs, Timberwolves, Thunder) were measured shape by shape and used to calibrate what a clean or an awkward outline is; the 41 players in them are drawn as he drew them, and say so.</p>` +
    `<p><b>Colour is the kind of player</b> (interior, on-ball, shooter, disruptor, balanced). It is not a rating. Where a shape sits is layout and means nothing.</p>` +
    `<p><b>The playoffs are in the size and the shape.</b> Two things are measured against each player&rsquo;s own regular season and pooled over his career to date, recent postseasons weighted most: his offense in the playoffs (shooting points added per 100, plus a tenth of points created) beyond the league&rsquo;s own playoff drop, which moves his DPM point for point; and his share of the team&rsquo;s playoff minutes over his regular-season share, which moves his size the same way but only ever down (rotations tighten in May and the bench loses minutes; a player his coach cannot play is worth less, while a star who plays more keeps his size rather than growing past it). Each is shrunk toward &ldquo;no change&rdquo; by the playoff minutes behind it, so one bad series does not follow a man for a decade and a rookie reads as in the regular season. The share of his value that survives the playoffs also caps how cleanly he is drawn &mdash; a man worth 60% of himself in May is at best a circle &mdash; and a player whose playoff minutes collapse is drawn as a burst whatever else he does. The row states each reading, and his drop against a player of his level, because the best offensive players give back the most in the playoffs and a star&rsquo;s ordinary drop should not be read as his.</p>` +
    teamNote +
    `<details><summary>The numbers behind it</summary>` +
    `<p>The additive baseline is nearly exact: lineup net rating = ${R.calibrationSlope.toFixed(2)} &times; &Sigma; DPM ${R.calibrationIntercept >= 0 ? '+' : '&minus;'} ${Math.abs(R.calibrationIntercept).toFixed(2)}. The residual is modelled separately for offense and defense from the lineup&rsquo;s style mix (a PCA of ${model.stats.length} style stats: ${model.componentNames.join(', ')}) plus its weakest and strongest offensive player, its weakest defender and how many weak defenders it carries. Out of sample (fit on even seasons, test on odd, and the reverse): R&sup2; ${(R.cvR2[0] * 100).toFixed(1)}% and ${(R.cvR2[1] * 100).toFixed(1)}% against a target that is nearly all sampling noise; at the team level, predicted fit correlates ${R.teamCvCorrelation.toFixed(2)} with what lineups actually did across ${R.teamCvTeams} team-seasons.</p>` +
    `<p>The calibration to his diagrams: fill &asymp; ${model.wyman.fitWeight.toFixed(2)} &times; fit-without-on-ball + ${model.wyman.dpmWeight.toFixed(2)} &times; DPM, ranked among regulars and mapped onto the fills he draws, so a league of plates has his mix. On-ball load did not predict his 24 fills, so it is left out of the calibration (it stays in the Fit column) and handled by the on-ball rule instead. Leave-one-out R&sup2; on his 41 players is ${(model.wyman.looR2 * 100).toFixed(0)}%: his shapes are only weakly predictable from stats, and that is the honest expectation for any player he has not drawn.</p>` +
    `<p>Team fit is the model run over the lineups a team actually played, weighted by possessions, against the average lineup of that season. These outlines pack to about three-quarters of a box at best (a hand does 0.77), which is why the box is 1.4 times the fullest roster and not less.</p>` +
    `</details></section>` +
    `<p class="foot">${CREDIT} Sizes are our numbers, not his: he draws his stars larger still (his Wembanyama is 4.5&times; his Fox; DPM and minutes make him 3&times;). Data through the ${seasonLabel(latest)} playoffs.</p>`;

  // ── League page ───────────────────────────────────────────────────────────
  const cards = teams
    .map(
      (t, i) =>
        `<a class="card" href="team/${t.abbr}.html" aria-label="${esc(`${t.name}: ${Math.round(t.fill * 100)}% of the box filled`)}">` +
        `<div class="card-head"><span class="rank">${i + 1}</span><span class="name">${esc(t.name)}</span>${t.fit ? `<span class="cardfit ${t.fit.predicted > 0.05 ? 'pos' : t.fit.predicted < -0.05 ? 'neg' : ''}" title="Team fit, points per 100">${signedText(t.fit.predicted)}</span>` : ''}<span class="fill">${Math.round(t.fill * 100)}%</span></div>` +
        renderPlate(t.players, { ariaLabel: `${t.name} roster drawn as shapes`, mini: true }) +
        `</a>`,
    )
    .join('');

  writeFileSync(
    `dist/${season}/index.html`,
    page(
      `${SITE}: ${label}`,
      `Every NBA roster of ${label} drawn as shapes in a box: a player's area is how good he is, his outline is how easily he fits, and the white is what a perfect team would add.`,
      topBar(season, (y) => `../${y}/index.html`, '', 'index.html') +
        `<main>` +
        `<div class="intro"><div><h1 class="display">Every roster is a box to fill.</h1><p>${label}, fullest first. Bigger shapes are better players; squarer shapes are easier to build around; the percentage is how much of a perfect team the roster is, and the signed number is what its lineups gain or lose by playing together.</p></div>${keyBlock()}</div>` +
        `<div class="grid">${cards}</div>` +
        howBlock('') +
        `</main>`,
      NAV_SCRIPT,
    ),
  );

  // ── Team pages ────────────────────────────────────────────────────────────
  const teamMenu = `<label><select data-nav aria-label="Team">${teams.map((t) => `<option value="TEAM_${t.abbr}">${esc(t.name)}</option>`).join('')}</select></label>`;
  for (const t of teams) {
    const fillPct = Math.round(t.fill * 100);
    const unplaced = t.players.filter((p) => !p.placement);
    const hollowCount = t.players.filter((p) => p.display === 'hollow' && p.placement).length;
    const teamMinutes = t.players.reduce((s, p) => s + Math.max(0, p.minutes), 0);
    const valText = (p: { display: string; deficit: number; value: number }) => (p.display === 'hollow' ? (p.deficit > 0 ? `&minus;${p.deficit.toFixed(p.deficit < 0.1 ? 2 : 1)}` : '0.0') : p.value.toFixed(p.value < 0.1 ? 2 : 1));

    const rows = t.players
      .map((p) => {
        const reading = readingOf(season, p.nbaId);
        const isPlayoffTag = p.flaw === 'playoff dropper' || p.flaw === 'hard to play in the playoffs';
        const tag =
          (p.display === 'hollow' ? `<span class="tag">below replacement</span>` : p.display === 'overflow' ? `<span class="tag">under the box</span>` : '') +
          (p.flaw ? `<span class="tag${isPlayoffTag ? ' po' : ''}">${esc(p.flaw)}</span>` : '') +
          (p.reference ? `<span class="tag">his diagram</span>` : '');
        const fit = p.portability === null ? `<span class="dimtext">&ndash;</span>` : `<span class="${p.portability > 0.05 ? 'pos' : p.portability < -0.05 ? 'neg' : ''}">${signedText(p.portability)}</span>`;
        const val = valText(p);
        // He is drawn at his value with the playoff reading in; the regular-season value is stated beside it.
        const regular = valueOverReplacement(p.oDpm + p.dDpm, p.minutes, teamMinutes, p.games);
        const poLine = reading
          ? `<div class="why po">Playoffs: ${esc(playoffReadingText(reading))} Regular-season value ${regular.toFixed(regular < 0.1 ? 2 : 1)}, drawn at ${val}.</div>`
          : `<div class="why po">Playoffs: no postseason on record, drawn as in the regular season.</div>`;
        return (
          `<div class="row" data-id="${p.nbaId}">${playerGlyph(p)}<div><div class="nm">${esc(p.name)}${tag}</div><div class="why">${esc(p.label)}. ${esc(p.reason)}</div>${poLine}` +
          `<div class="num"><span><b>${Math.round(p.minutes)}</b> min</span><span>value <b>${val}</b></span><span>box <b>${(p.share * 100).toFixed(1)}%</b></span><span>O <b class="${p.oDpm > 0.05 ? 'pos' : p.oDpm < -0.05 ? 'neg' : ''}">${signedText(p.oDpm)}</b></span><span>D <b class="${p.dDpm > 0.05 ? 'pos' : p.dDpm < -0.05 ? 'neg' : ''}">${signedText(p.dDpm)}</b></span></div></div>` +
          `<div class="fit" title="Fit: points per 100 his lineups gain or lose beyond the sum of their players' DPM">${fit}</div></div>`
        );
      })
      .join('');

    const lineage = franchiseSeasons.get(franchiseOf(t.abbr)) ?? new Map<number, string>();
    const seasonsPlayed = [...lineage.keys()].sort((a, b) => a - b);
    const at = seasonsPlayed.indexOf(season);
    const prev = at > 0 ? seasonsPlayed[at - 1] : null;
    const next = at >= 0 && at < seasonsPlayed.length - 1 ? seasonsPlayed[at + 1] : null;
    const teamHref = (y: number) => `../../${y}/team/${lineage.get(y)}.html`;
    const scrubber =
      `<nav class="scrubber" aria-label="Season">` +
      (prev ? `<a href="${teamHref(prev)}" aria-label="Previous season">&lsaquo;</a><a href="${teamHref(prev)}">${seasonLabel(prev)}</a>` : `<span class="off">&lsaquo;</span>`) +
      `<span class="cur">${label}</span>` +
      (next ? `<a href="${teamHref(next)}">${seasonLabel(next)}</a><a href="${teamHref(next)}" aria-label="Next season">&rsaquo;</a>` : `<span class="off">&rsaquo;</span>`) +
      `</nav>`;
    // This franchise's recent seasons as tiny plates: the six ending at this one.
    const window = seasonsPlayed.filter((y) => y <= season).slice(-6);
    const recent = window.length > 1
      ? `<section class="recent"><h2>${esc(t.name)} season by season</h2><div class="recent-row">` +
        window.map((y) => { const tp = platesBySeason.get(y)?.find((x) => x.abbr === lineage.get(y)); if (!tp) return ''; return `<a class="${y === season ? 'cur' : ''}" href="${y === season ? '#' : teamHref(y)}" aria-label="${esc(`${seasonLabel(y)}: ${Math.round(tp.fill * 100)}% of the box filled`)}">${renderPlate(tp.players, { ariaLabel: `${seasonLabel(y)} roster`, mini: true })}<div class="cap"><b>${seasonLabel(y)}</b><span>${Math.round(tp.fill * 100)}%</span></div></a>`; }).join('') +
        `</div></section>`
      : '';
    const menu = teamMenu.replace(/value="TEAM_([A-Z]+)"/g, (_, abbr) => (abbr === t.abbr ? `value="" selected` : `value="${abbr}.html"`));

    const body =
      topBar(season, (y) => (lineage.has(y) ? `../../${y}/team/${lineage.get(y)}.html` : null), menu) +
      `<main>` +
      `<div class="team-head"><h1 class="display">${esc(t.name)}</h1>${scrubber}<p class="sub">${t.players.filter((p) => p.placement && p.display === 'scale').length} players in the box${t.overflow ? `, ${t.overflow} more under it` : ''}${hollowCount ? `, ${hollowCount} below replacement` : ''}.</p></div>` +
      (t.overflow > 0
        ? `<p class="caveat">${t.fill > 1 ? `This roster is bigger than the box (${fillPct}%)` : `The box could not take this whole roster at true size (${fillPct}% of it; these outlines do not tile that tightly)`}: ${t.overflow} ${t.overflow === 1 ? 'shape is' : 'shapes are'} drawn under it, at the same scale. Nothing is shrunk.</p>`
        : '') +
      `<div class="team"><div class="left">` +
      renderPlate(t.players, { ariaLabel: `${t.name} roster drawn as shapes filling ${fillPct}% of a box`, belowHeight: t.belowHeight, stripSections: t.stripSections }) +
      recent +
      `</div><div class="right">` +
      `<div class="readings">` +
      `<div class="reading"><b class="display">${fillPct}%</b><span><span class="lbl">of the box filled.</span> The roster is worth ${t.value.toFixed(1)} points per 100 above replacement, playoff readings in; this season&rsquo;s box is a +${t.boxNet.toFixed(1)} team${t.boxGrown ? ', grown so every roster of the year fits' : ', 1.4× the fullest roster of the year'}, and the white is what such a team would add.</span></div>` +
      (t.fit
        ? `<div class="reading"><b class="display ${t.fit.predicted > 0.05 ? 'pos' : t.fit.predicted < -0.05 ? 'neg' : ''}">${signedText(t.fit.predicted)}</b><span><span class="lbl">team fit,</span> points per 100 these lineups are predicted to gain or lose by playing together, beyond the sum of their players (offense ${signedText(t.fit.offense)}, defense ${signedText(t.fit.defense)}). Observed over ${t.fit.possessions.toLocaleString()} possessions: ${signedText(t.fit.observed)}, mostly noise for one team.</span></div>`
        : '') +
      `</div>` +
      `<div class="players"><div class="players-h"><b>Players</b><span>Fit, points per 100 beyond his DPM</span></div>${rows}</div>` +
      (unplaced.length ? `<p class="note" style="margin-top:10px"><b>Nothing to draw</b> (exactly at replacement, so an area of zero): ${esc(unplaced.map((p) => p.name).join(', '))}.</p>` : '') +
      `<div class="key small">${keyBlock().slice('<div class="key">'.length, -'</div>'.length)}</div>` +
      `</div></div>` +
      howBlock('') +
      `</main>`;

    writeFileSync(`dist/${season}/team/${t.abbr}.html`, page(`${t.name} ${label}: ${SITE}`, `The ${label} ${t.name} drawn as shapes in a box: ${fillPct}% of a perfect team.`, body, NAV_SCRIPT + HOVER));
  }
}

// Pass 1: pack. Every season is packed even for a one-season build, because a
// team page shows the franchise's recent seasons as tiny plates.
for (const season of available) {
  const r = packSeason(season);
  if (only === null || season === only) console.log(`${seasonLabel(season)}: ${r.teams} teams packed in ${r.ms}ms. Fullest: ${r.top}.`);
}
// Pass 2: write.
for (const season of only !== null ? [only] : available) buildSeason(season);

mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/index.html',
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${latest}/index.html"><title>${SITE}</title><a href="${latest}/index.html">${SITE}, ${seasonLabel(latest)}</a>`,
);
console.log(`dist/index.html → ${latest}/index.html`);
