# Roster Shapes

Every NBA roster drawn as shapes in a box. A player's **area** is his value over replacement, his
**outline** is how well that value stacks with teammates (fitted to 15,812 real five-man lineups), his
**colour** is what kind of player he is, and the **white** left over is what a perfect team would add.
Each team also gets a **team fit**: what its real lineups gain or lose by playing together.

The idea is Taylormetrics' Wyman diagram (the "opaque square") (TikTok, *Roster construction idea*): imagine an empty box,
fill it with your players, and the best possible team leaves no white. Squares and rectangles sit flush
against each other; a pentagon, a triangle or a star leaves white around it however you turn it. His
version is drawn by hand. Here the size of every shape is read from data and its outline is fitted to
lineup results. It agrees with him on most of his examples (Anunoby, Bridges, Hart squares; Robinson a
rectangle; Brunson, Dončić and Reaves the awkward shapes) and disagrees on one, which is a finding
rather than a bug: see "Where the data disagrees with the video".

Live: https://roster-shapes.vercel.app

## Run it

```bash
bun install
bun scripts/fit-model.ts   # only after re-exporting data: refits data/model.json and prints the cross-validation
bun run build        # every season in data/ → dist/<season>/index.html + dist/<season>/team/<ABBR>.html
bun run open         # opens dist/index.html, which redirects to the latest season
bun test             # 61 tests
bun scripts/verify.ts  # every plate of every season: nothing shrunk, nobody undrawn; lists what overflows
bun run deploy       # build + `vercel deploy --prod --archive=tgz` → https://roster-shapes.vercel.app
```

The deploy uploads one archive, not 800 files: Vercel's free tier caps file uploads per day and a
handful of full-site deploys hit it.

The site is plain static HTML: no server, no framework, opens straight from disk. It covers every
season from 2000-01 to 2025-26 (777 team-seasons, old franchises included: Sonics, New Jersey Nets,
Vancouver Grizzlies, Bobcats, both eras of Hornets). Each league page has a season picker; each team
page has one that follows the FRANCHISE across a move, so the 2007-08 Sonics link through to the
2025-26 Thunder, and a scrubber steps one season either way. The build is two passes: every season is
packed first, then the pages are written, so a team page can show the franchise's last six plates in a
strip under the big one. A full build takes about 90 seconds; `bun scripts/build.ts 2016` rebuilds one
season (every season is still packed, so its strip is complete; the other seasons' pages are left as
they were, so rebuild everything before a deploy that changes the CSS).

`data/<season>.json` are snapshots, so the build works offline. To refresh them, point the export at a
Postgres that has `player_stats_with_metrics`:

```bash
bun --env-file=../databallr_v3/.env.local scripts/export-data.ts        # every season
bun --env-file=../databallr_v3/.env.local scripts/export-data.ts 2026   # one
```

That script is the project's only contact with a database, and it is one read-only `SELECT`.

## What is data and what is layout

| | Source | Meaning |
|---|---|---|
| **Area** | `((DPM − replacement) × minutes per game / 48)^1.7` | Value over replacement, to the power his diagrams use; a games floor (50) fades a cameo |
| **Outline** | the fitted portability model (`data/model.json`) | How well his value stacks: the tier of his portability |
| **White** | `1 − Σ area` | Exactly what the roster is missing against the perfect team |
| **Position** | the packer | Nothing. Layout only |

The white a reader sees is `1 − Σ area` wherever the shapes land, so the arrangement cannot overstate
or understate a roster. What the arrangement shows is the video's point: the white collects around the
awkward shapes.

**Area is superlinear in value, and the share is per game.** His diagrams draw stars far bigger than
role players — more than linearly — and they size a player by his role, not his availability: a
log-log fit of the 24 drawn areas in his first three diagrams on value over replacement (free
intercept per diagram) gives γ = 1.72 with R² 0.76 when the share is minutes per game over 48, and γ =
1.59 with R² 0.40 when it is his share of the team's season minutes, which had docked Wembanyama a
third of his size for the 18 games he missed. With linear areas Wembanyama drew at 1.7× Fox although
his DPM is 3× Fox's; he draws him at 4.5×; this rule draws 3.0×. (Refit on all 41 after the
Timberwolves and Thunder diagrams came in, the same fit gives γ = 1.20 — those two carry many mid-size
role players — and a free fit says his sizes track minutes per game even more than DPM, which would
make Wembanyama SMALLER; 1.7 is kept deliberately, because the stars are the biggest shapes in every
diagram and that is the reading wanted.) So `area ∝ ((DPM + 2) × mpg/48 × min(1, games/50))^1.7` (`SIZE_EXPONENT`,
`shareOf`, `GAMES_FULL`): a ten-game cameo is not drawn as a starter, and a roster's shares can sum to
more than five when players missed time, because the plate is the roster as built. The table still
prints the linear value.

Constants (`src/lib/model.ts`): `REPLACEMENT_DPM = −2`, `PERFECT_TEAM_NET = 8` (the calibrated
box: five players at +1.6 DPM every minute, drawn to the same power, area 38.8), `BOX_OVER_FULLEST =
1.4`. **The box is calibrated to his diagrams and sized per season.** He draws the 2025-26 Spurs and
Knicks about three-quarters full (76% and 77%, measured from the frames), and these outlines tile to
about 0.75 of a box at best (a hand does 0.77), so a season's box is 1.4 × its fullest roster's area
(playoff readings in): the fullest roster of the year reads 71%. For 2025-26 that is a +12.7 box
(Knicks 71%, Spurs 61%). It is then grown by 3% steps until every roster of the season packs at true
size — twelve seasons needed it, the 2010-11 Heat and 2019-20 Lakers most (six steps: two giant
shapes cannot share a box smaller than that), and the page says when the box was grown. Two rules were rejected on the way. A single
+21 box, the size at which every roster of the century packs, made every current roster read under
30% and look empty, the opposite of his drawings. A single +8 box, the size he draws it, put 91
rosters partly UNDER the box (the 2002-03 Spurs are 3.3× the 2025-26 Spurs by these numbers; a 2004
Garnett is 99% of that box by himself) — and every above-replacement player belongs inside the box,
so the box moves with the season instead. Each page states what its season's box is worth as a team
(+12.7 in 2025-26, +18.1 in 2002-03, +22.8 in 2010-11), which is how seasons compare. The "+N" is
in per-game terms now — five players at 48 minutes a game — so it runs higher than the old
season-minute figures.

## The outline: measured fit, calibrated to his diagrams

The first version picked outlines with thresholds I wrote by hand. A PCA of player style was tried next
and rejected on its own: it measures how UNUSUAL a player is, and unusual is not awkward. The lineup
model below measures FIT directly. And the final step calibrates the outline to the five diagrams he
has drawn (Knicks, Lakers, Spurs, Timberwolves, Thunder; 41 players), because those are the reference
for what this chart means.

**The lineup model** (`scripts/fit-model.ts` → `data/model.json`, scored by `src/lib/portability.ts`):

1. For 15,812 five-man lineups (2000-01 → 2025-26, 2.75M possessions, 60+ each way, unweighted rows
   only) the additive baseline is almost exact: `net = 1.02 × Σ DPM − 0.02`. What is left over is what
   playing TOGETHER added or cost, modelled separately at each end (offense residual =
   `ORtg − league − Σ O-DPM`, defense residual = `league − DRtg − Σ D-DPM`).
2. Each side is a ridge regression on the lineup's **style mix** — its summed scores on four PCA
   components of 14 style stats (perimeter game, on-ball load, disruption over scoring, scoring
   efficiency; 76% of style variance), linear, squared and crossed — plus the link terms that improved
   the out-of-sample fit: offense, its weakest (+0.44 per point, "teams help off him") and strongest
   offensive player; defense, each weak defender (−0.40, "you have to put defenders around him") and
   its weakest defender. All 14 stats exist for every player-season back to 2000-01; DPM is not among
   them, because area is value and shape is style.
3. A player's **portability** (the `Fit` column) is the fitted effect of putting HIM into a typical
   lineup in place of an average-style, average-value player, split by end. Out of sample (fit on even
   seasons, test on odd, and the reverse): R² 1.08% / 0.80%, correlation ≈ 0.10, against a target that
   is nearly all sampling noise; at the TEAM level, predicted vs observed fit correlates 0.19 over 773
   team-seasons. Real and small.

**The Wyman calibration** (`data/wyman-reference.json`). His Knicks, Lakers and Spurs diagrams were
measured — how much of its bounding box each of his 41 shapes fills — and used as labels. Two things
predict his shapes about equally, and nothing else does better: the measured Fit **with its on-ball
term removed**, and plain quality (DPM). On-ball load, as the lineup model measures it (a usage
component), has no relation to the outlines he draws (r = +0.13) while it had dominated ours, rounding
off Wembanyama, Castle and Harper, whom he draws as squares — what he does draw round is the primary
BALL-HANDLER, which is the fourth rule below, read from playmaking rather than usage; and he does draw
good players cleaner ("the bigger the shape, the better the player… a square
is really easy to build around"). So `score = 0.129 × fit-without-on-ball + 0.060 × DPM`; a player's
score is ranked among 1,000+ minute regulars and that percentile is mapped onto the distribution of
fills he draws, so a league of plates has his mix (about a quarter perfect squares, a fifth stars).
Leave-one-out R² on his 41 players is **13%**. His shapes are only weakly predictable from stats — that
is the honest number, and it is the ceiling of any formula on 24 hand-drawn examples.

**The 41 reference players are drawn as he drew them.** They are the baseline this chart is calibrated
to, so on the 2025-26 Knicks, Lakers and Spurs pages (and wherever else a reference player turns up
that season) the outline is his: an exact polygon where one exists (circle, octagon, hexagon,
pentagon, triangle, diamond, four-point star), otherwise the nearest family (smooth for his squares,
rectangles, parallelogram and trapezoid; five-point for his five-point star; burst for his cloud,
burst, blob and six-point star; notched for his notched rectangle). The page tags them *his diagram*.
The reference is a fact about a SEASON — the same name in another year is drawn by the calibration —
and the calibration's leave-one-out score is what to expect of it: 15%, plus the families the rules
choose. Nearest-neighbour matching to the 24 was tried as the generaliser and was worse than the
linear calibration at every setting (leave-one-out R² −12% to −51%).

Outlines are superellipses, `|x/a|ⁿ + |y/b|ⁿ = 1`, whose one exponent runs square → circle → diamond →
four-point star; the fill (share of its bounding box the shape covers) is what the calibration sets.
Only quarter turns are allowed when packing, because a diamond turned 45° IS a square. An interior big
is drawn long, the way he draws Robinson and Kessler.

**Colour is the kind of player, nothing else.** From the style scores: interior big, on-ball creator,
perimeter shooter, disruptor/connector, or balanced. It is not a rating.

**Team fit.** The lineup model is also run over the lineups each team ACTUALLY played (10+ possessions
each way, all five on the roster), weighted by possessions and centred on that season's league: what
the combination gains or loses beyond the sum of its players. The page prints it beside the fill.

## Five rules choose the FAMILY of an outline, and they ARE rules

The calibration sets how clean or sharp an outline is; these rules decide which awkward FAMILY a
flawed player is drawn in (and, for the fourth and fifth, how clean he may be at all), so the plate
uses his vocabulary. The fifth, the playoffs, has its own section below. The lineup data does not show one-way or
narrow players dragging their lineups down (tested three ways: on average; against contender-level
lineups only; with explicit non-shooter and creator counts — nothing out of sample), so these are the
VIDEO's ideas drawn from our numbers, and the page says so. The `Fit` column stays purely measured.

**One-way** — "this guy gives you nothing on one end of the floor". His weaker end (O-DPM or D-DPM)
once it is below −0.4, scaled by how lopsided the two ends are, so a player who is bad at both is small,
not one-way. A defensive hole is charged NET of what the lineup model already charges a weak defender
(no double counting), but the label uses the gross figure, or Sexton — "all offense and no defense" —
would lose the label to the subtraction. 2025-26 regulars: 11% no offense, 11% no defense.

**One skill** — "he's basically just a spot-up shooter, he doesn't have a lot of other skills". A second
PCA, this one ROTATED (varimax, 5 factors, 82% of variance) so the components read as skills rather
than contrasts: playmaking, scoring volume, efficiency, steals, and a bipolar interior ↔ shooting
factor that counts as two, plus **defense** (D-DPM in SDs) appended as a skill in its own right, because
the box score barely sees it. A player's THIRD-best skill is the reading. Most role players are narrow (a
fixed cut flagged 59% of regulars), so the rule is percentile-based and graded: nothing at the median
of regulars (0.13 SD), the full penalty at the 5th percentile (−0.40). 16% of regulars; both at once 12%.

**Non-spacer** — "he is a non spacer, so there's a little bit of off-ball problems" (Castle, Fox). A
perimeter player (interior score under 0.5 and not a listed center — the style score reads Jokić as
a guard, because he passes like one, and had him notched for 1.5 threes per 100) whose three-point makes
per 100 sit more than half a standard deviation below perimeter regulars OF HIS OWN SEASON — league
three-point volume doubled over these 26 years (1.5 → 3.0 makes per 100), so an all-seasons scale
flagged nobody. Worth at most 0.08 of fill, about the size of the bite his Castle has out of it, and on
an otherwise clean outline it is drawn exactly so: a rectangle with a V notch. About 2% of regulars
get the notch; more get the penalty inside another shape. Lineup support is weak (a third non-shooter
costs ~0.6 per 100, t = −2.5). By our numbers Castle and Harper are non-spacers; Fox is not (2.8 threes
per 100 is average).

**Non-passer** — "his passing volume is not high enough… this diamond is a little bit rough to build
around" (Edwards). An earlier version of this rule capped every primary ball-handler at an octagon;
his Thunder diagram refuted it: Gilgeous-Alexander carries the biggest on-ball load in the data and is
drawn as a full rectangle, "the easiest player to build around", because he is "a good playmaker".
What he penalises is scoring on the ball WITHOUT creating for others: Edwards (17 creation, 5 assists
per 100) is a diamond, LaMelo (16.5 and 12.5) a hexagon. So the reading is a primary creator (on-ball
creation per 100 in the top 15% of his season's regulars, `creationBySeason`; creation estimated from
usage and assists before 2013-14) whose assists per unit of creation are low: nothing at 0.42 (SGA is
0.41, Tatum 0.43), the full reading at 0.32 (Edwards 0.30, Kawhi 0.34), drawn in the four-point family
down to his diamond. Harden (0.61), Mitchell (0.55) and Jokić (1.36) pass, so they are exempt — which
means Harden reads as a square unless the playoff rule says otherwise, and by the level yardstick it
does not.

**The families.** Each rule has a family of m-pointed shapes with one parameter (the inner radius as a
share of the outer), set so the family fills what the calibration says:

| Rule | Family | Blunt → named → sharp |
|---|---|---|
| no offense | 3 points | hexagon → **triangle** (0.50) → three-point star |
| no defense | 4 points | octagon → **diamond** (0.50) → four-point star |
| one skill | 5 points | decagon → **pentagon** (0.69) → five-point star |
| both | 12 points | near-circle → **spiky burst** |
| non-spacer, otherwise clean | notched rectangle | his Castle |

**Against his drawings** (`bun scripts/sanity-check.ts`): the 41 reference players match by
construction (r = 1.00). Before they were pinned, the calibration alone scored r = 0.44 over them
(Knicks 0.38, Spurs 0.63, Lakers 0.24), from 0.11 on the lineup model alone and 0.17 with rules but no
calibration; and since those 24 are the calibration set, the leave-one-out 15% is the number to quote
for any other player. Wembanyama, Anunoby, Champagnie and Robinson are squares; Castle is a notched
rectangle, exactly as drawn; Brunson a four-point at 0.69 against his pentagon at 0.70; Thybulle 0.74
against his 0.73. The misses are the same low-usage role players every time (Hart, McBride, Shamet,
Mamukelashvili, Keldon Johnson): he draws them awkward, and by every number we have they are not.

## Things that were tested and NOT adopted

Each was a plausible improvement that made the numbers worse, so it is left out on purpose:

- **Blending in the prior season's DPM** for a steadier value. It lowers the R² of lineup net rating on
  Σ value at every weight (18.7% → 14.7% from no blend to a heavy one), for low-minute players too, and
  it is also worse at predicting NEXT season's lineups (8.9% → 7.4%). DPM is already a stabilised
  estimate.
- **A different replacement level.** Measured, not assumed: minutes-weighted DPM is −2.16 for players
  under 100 minutes, −1.89 for 100-250 and −1.77 for everyone under 500, in every season between −2.2
  and −1.4. −2 stands.
- **PCA distance as "awkwardness"**, and **k-means clusters as archetypes**: see above.
- **A count of weak offensive players**, and min/max links on the opposite end: no out-of-sample gain.
- **Spacing and creator counts** as lineup features: no out-of-sample gain.
- **A big's on-ball load costing less than a guard's** (the Wembanyama question), and load carried by
  efficient scorers costing less: no out-of-sample gain, t ≈ 1 on every term. Wembanyama's rounded
  outline stands as the measured reading.
- **Drawing the outline from fit COSTS only** (credits never count): it put over half of role players at
  the ceiling, or else broke Robinson, depending on how the parts were grouped.

The hand-written rules survive in `classify` as a fallback for a player with no style stats; with the
current data that is nobody.

## Everything is to scale

Every drawn area is the number it stands for, and a test asserts it. Three shortcuts were tried and
removed, each because it lied a little:

- **Hiding small shapes.** All sixteen 2025-26 Kings have a negative DPM, fourteen are still above
  replacement, and most of them vanished, so a bad roster read as an EMPTY one. Now every shape is
  drawn at true size, and a name that does not fit inside is written under it (the packer reserves
  that room, so a name can never land on a neighbour).
- **Inflating small shapes to a readable size.** Not to scale, however clearly it was marked.
- **Shrinking a plate that was too full to tile.** Instead the box is sized per season (see the
  constants above) and grown until every roster of the year packs: `fitScale` is always 1, nothing is
  under the box, and `verify.ts` fails otherwise. The plate builder still has an overflow path
  (shapes taken largest first, one the box cannot take drawn in a strip under it at the same scale,
  `overflow` counting them) — it is what `src/lib/season.ts` uses to detect that a box is too small,
  and a unit test keeps it honest, but no plate on the site uses it. A lone shape that is nearly the
  whole box is centred rather than packed, and a giant is drawn squarer than its aspect asks, because
  the aspect is cosmetic. Shapes may touch the frame (his do); the packer keeps its gap between
  shapes only, which at these box sizes is the difference between a two-star roster fitting and not.

**Below-replacement players are not in the box.** The box holds value over replacement and they added
none, so each team page draws them as hollow dashed outlines in a strip directly under the box, at the
same scale, with area equal to what they cost against a replacement player. Inside the box they fought
the real shapes for room: on bad teams those outlines are large and numerous, and 25 players across
the dataset went undrawn. They never count toward the fill. A player whose DPM is exactly −2.00 has an
area of zero and is listed as having nothing to draw (23 of them in 26 seasons); a player with no DPM
at all is left out and counted.

Verified over all 776 team-seasons, in both modes: 0 plates shrunk, 0 players outside the box, 0
players with a non-zero area left undrawn; `bun scripts/verify.ts` prints each season's box.

## Sanity check against his drawing

His Knicks graphic was measured directly: every pixel inside his box, classified by colour, gives the
share of the box each of his eight shapes covers. Against our 2025-26 values for the same eight:

| | His drawing | Ours |
|---|---|---|
| Brunson | 27.5% | 22.1% |
| Towns | 26.7% | 20.5% |
| Anunoby | 20.1% | 19.7% |
| Bridges | 11.6% | 10.5% |
| Robinson | 6.5% | 9.0% |
| Hart | 3.8% | 8.0% |
| McBride | 2.6% | 5.5% |
| Shamet | 1.2% | 4.7% |

(shares of the eight players' combined area). **Same rank order, Pearson r = 0.985.** The one
systematic difference: he draws stars bigger and role players smaller than minutes-weighted DPM does.
He also leaves out Alvarado, whom we rate level with McBride.

His box is 77% full; ours is 63% (the Spurs: his ~76%, ours 65%; against the calibrated +8 box they
are 69% and 71%). The box is 1.4 × the season's fullest plate, so the fullest reads 71%, and the
remaining gap is packing, not the players: a hand tiles these outlines to 0.77 of a box, the packer to
about 0.75.

### Shapes: how the match was reached, and its limit

`bun scripts/sanity-check.ts` measures, from the same frames, how much of its own bounding box each of
his shapes fills (octagon 0.83, circle 0.78, pentagon 0.70, diamond 0.50, four-point star 0.33 — the
pixels match the geometry), which is the quantity our outlines are built on. The lineup model alone
scored r = 0.11 against his 24 shapes (the first three diagrams): it charges on-ball load, he does not, and it left every role
player a near-square. Removing the low-usage credit took it to 0.20; the three rules to 0.17-0.28;
calibrating the fill to his diagrams to 0.44. The remaining disagreement is structural: in his drawing a
clean shape means a good, complete player; ours now says that too, blended with measured fit, and the
players he draws awkward that we cannot are low-usage role players whose lineups do not underperform.

### His Spurs graphic

His second video (the Spurs, next season's roster) spells out the encoding — "the bigger the shape, the
better the player… something like a square is really easy to build around… something that has a lot of
points is difficult" — and names it the Wyman diagram. The graphic was measured from its geometry
(rectangles, a triangle, a trapezoid; estimated fills for the two stars), good to a few percent.

- **Sizes: r = 0.86, rank 0.74.** Wembanyama is the biggest shape in both, and again he draws the star
  bigger than DPM does (39% of the eight against our 26%). He has Castle and Harper second and third,
  whom he grades on trajectory and the playoffs; we have Fox and Champagnie, on regular-season DPM —
  and his own caveat is that Fox's regular season was good. His box is ~76% full; ours 50%, the same
  gap as the Knicks (the box, not the players).
- **Shapes: r = −0.13.** He draws the whole core clean — Wembanyama, Harper and Champagnie perfect
  squares, Castle a rectangle with a notch — and only Keldon Johnson (a six-point star) and the newly
  signed Tobias Harris (a triangle) awkward. We agree on Harper, Fox ("funky"; a ten-point blob, ours
  rounded), Champagnie, Vassell and Kornet, and differ on the three that decide the number: Wembanyama
  draws rounded (0.69) because the lineup model charges his on-ball load; Castle is rounded (0.72) for
  the same reason; Keldon Johnson draws clean (0.93) where he sees an odd shape.
- The one real bug it found: Champagnie, "an elite 3-and-D wing… a really strong rebounder", drew as a
  one-skill five-point star, because the skill PCA had no defense skill and rebounding sits on the
  bipolar interior ↔ shooting factor. Defense is now a skill; Champagnie is a 0.98 square, as he drew.

Across all 41 of his drawn players, shape r = 0.99 (by construction: they are drawn as he drew them);
sizes r = 0.95 / 0.92 / 0.88 / 0.90 / 0.88 by graphic (Knicks, Timberwolves, Thunder, Spurs, Lakers).

## The playoffs are in the plate

Every player is drawn at his **playoff value and playoff shape** (`src/lib/playoffs.ts`, the fifth
rule in `portability.ts`). There is no toggle: the plate is the roster as it would be in May, and the
row states the regular-season value beside what he is drawn at. Two things are measured, each against
the player's OWN regular season, from `data/playoffs.json` (both phases of every player-season):

- **Offense** — shooting points added per 100 (TS added) plus a tenth of points created per 100,
  playoffs minus regular season, minus the league's minutes-weighted playoff drop that season
  (everyone shoots worse against playoff defences). Points per 100 possessions, so it moves DPM point
  for point. The production term is what lets a star who shrinks from the game read as one.
- **Playability** — his share of the team's playoff minutes over his share of its regular-season
  minutes, capped at 1. Rotations tighten in the playoffs and the bench loses minutes; a player his
  coach cannot play in May is worth less, and this multiplies his minutes share. It never raises a
  player: the raw ratio says ×1.3 for every star (38-40 minutes in May), and with area superlinear in
  value that made every contender's plate half again as big and forced the season's box up. The
  reading is who cannot be played, not who plays more.

The offense change that moves his value is measured **against a player of his level** (a per-season
weighted line of the change on regular-season level), not against the league alone: the best regular
seasons give back the most in May because they carried the most luck, and measured against the league
the rule tagged Jokić as a playoff dropper for regressing from a +7 (−2.2 beyond the league's drop;
+0.6 against his level). The row prints both. Size: `(DPM + offense change + 2) × per-game share ×
playability`, to the power. Shape: the share
of his regular-season value that survives caps how cleanly he can be drawn — `cap = 0.985 − 0.5 ×
(1 − survives)`, so a man worth 60% of himself in May is at best a circle, 30% at best a hexagon —
and a player whose playoff minutes share falls under ×0.7 is drawn as a burst, the most awkward
family, whatever else he does (tags: **playoff dropper**, **hard to play in the playoffs**). Both
readings are pooled over the player's career TO DATE, including the season drawn (the plate is what
happened), with a recency half-life of three seasons, and shrunk toward "no change" by the
recency-weighted playoff minutes behind them (`K` = 600 minutes for offense, 300 for playability),
so one bad series does not follow a man for a decade and a player with no postseason is his
regular-season self. By the level yardstick Harden's and Mitchell's recent playoff drops are ordinary
for stars, so neither is tagged a dropper; the page prints the numbers rather than hiding them.
Reference players from his diagrams keep his shapes.

Not used: DPM itself has no playoff version (the source copies the season's number onto the playoff
row), and single-postseason plus-minus is too confounded by opponent quality to read one player from.

## Packing (`src/lib/pack.ts`)

Deterministic; the same roster always draws the same plate.

1. A squarified treemap gives every shape a home cell, so big shapes spread across the box.
2. Shapes are placed largest first at the free grid position nearest home, trying each allowed turn of
   the outline. Collision is a real polygon test, which is what lets a star nest into the gap between a
   circle and a pentagon.
3. A shape with nowhere to go is bumped to the front of the queue and the pass restarts. If that
   fails, a tight corner pack is tried, by area and then widest-first.
4. Shapes too small to hold their name are fitted afterwards (`placeExtras`) into the most open
   white, at true size, each with room reserved under it for the name. One that finds no gap is
   promoted into the main pack and gives up its name rather than being dropped.
5. The packer's shrink-to-fit result is never drawn. When the usual pack fails, the shapes are taken
   one at a time, largest first, and each one the box cannot take overflows under it (see "Everything
   is to scale"); `fitScale` is 1 on every plate and `verify.ts` fails if not.

Two traps found while building it, both pinned by tests:

- **Coincident shapes do not "cross".** Two identical outlines on the same spot share every edge, so
  no edge pair properly intersects and every vertex lies ON the other's boundary, which
  point-in-polygon calls outside. Six equal circles "packed" at full size by stacking in pairs.
  `polygonsOverlap` also tests the centres and every vertex.
- **An impossible input must not cost 26 seconds.** Bumping one of two equal shapes re-ran an
  identical scan; orders are now deduplicated by their outline sequence.

## Layout of the repo

```
src/lib/geometry.ts   outlines built to an exact area, polygon overlap
src/lib/model.ts      value over replacement, the constants, the rule-based fallback
src/lib/portability.ts  scores a player against the fitted model, applies the two rules, picks his outline
src/lib/fit.ts        PCA (Jacobi), varimax, ridge regression, weighted quantiles: no dependencies
scripts/fit-model.ts  lineups + style stats → data/model.json, with cross-validation
src/lib/pack.ts       the packer
src/lib/index.ts      rows in → a plate out (regular or playoff mode, in a given box)
src/lib/season.ts     a season's plates: the box sized to the year, grown until every roster packs
src/lib/playoffs.ts   the playoff reading per player-season, from data/playoffs.json
src/render.ts         the plate as an SVG string (fixed colours: white is the reading)
scripts/export-data.ts  one SELECT → data/<season>.json
scripts/build.ts        data → dist/
```

## Coverage and caveats

- 2000-01 onward, which is as far back as DPM goes. Nothing is estimated in any season: the 14 style
  stats and the lineup data both reach back to 2000-01.
- Regular season only. One row per player-season, so a traded player is drawn on the team his row names.
- DPM is a blend that leans on box score and on/off; it is one reading of value, not the reading.

## Not built

- Put team fit INTO the picture, not just beside it: e.g. a band of the box shaded for what the
  combination gains or loses.
- Drop a trade target into a box and watch the white change.
- A vertical 9:16 export of one plate, for posting.
