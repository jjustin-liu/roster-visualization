import { describe, expect, test } from 'bun:test';
import { exponentForFill, pointedFill, polygonArea, polygonsOverlap, ratioForFill, shapePolygon, superellipseFill, SHAPE_ROTATIONS, type ShapeKind } from './geometry';
import { areaOf, classify, deficitBelowReplacement, estimateCreation, handlingOf, shareOf, valueOverReplacement, GAMES_FULL, INSIDE_LABEL_SHARE, PERFECT_TEAM_VALUE, SIZE_EXPONENT, type ShapeInput } from './model';
import { packShapes, placeExtras } from './pack';
import { franchiseOf, teamName } from '../teams';
import { ridge, solve, symmetricEigen, varimax, weightedQuantiles } from './fit';
import { FILL_MAX, FILL_MIN, ON_BALL_FILL_CAP, familyOf, flawsOf, outlineFor, portabilityOf, predictLineup, skillScores, type PortabilityModel } from './portability';
import { existsSync, readFileSync } from 'fs';
import { buildRosterShapePlate, plateLabels, GIANT_OVERHANG } from './index';
import { attachPlayoffReadings, playoffReadings, EFFICIENCY_K } from './playoffs';
import type { PlayoffRow } from '../data';

const KINDS: ShapeKind[] = ['square', 'rect', 'octagon', 'hexagon', 'circle', 'pentagon', 'triangle', 'diamond', 'star'];

const player = (over: Partial<ShapeInput>): ShapeInput => ({
  nbaId: 1,
  name: 'Test Player',
  position: null,
  minutes: 2000,
  games: 70,
  oDpm: 0,
  dDpm: 0,
  creation: 2,
  shooting: 5,
  tsa: 16,
  assists: 3,
  ...over,
});

describe('geometry', () => {
  // Area is the one quantity the plate encodes. An outline that came out 10%
  // large would make every pentagon read as a better player than he is.
  test('every outline is built to its exact area, at every rotation', () => {
    for (const kind of KINDS) {
      for (const rotation of SHAPE_ROTATIONS[kind]) {
        const area = polygonArea(shapePolygon(kind, 0.08, 1.8, rotation));
        // The circle's COLLISION outline is circumscribed, so it runs slightly large.
        if (kind === 'circle') expect(area).toBeGreaterThanOrEqual(0.08);
        else expect(area).toBeCloseTo(0.08, 10);
      }
    }
  });

  // Shipped once: six equal circles "packed" at scale 1 by stacking in pairs.
  test('two identical outlines on the same spot overlap', () => {
    const a = shapePolygon('circle', 0.15);
    expect(polygonsOverlap(a, shapePolygon('circle', 0.15))).toBe(true);
    const sq = shapePolygon('square', 0.1);
    expect(polygonsOverlap(sq, shapePolygon('square', 0.1))).toBe(true);
  });

  test('overlap sees containment, not just crossing edges', () => {
    const big = shapePolygon('square', 1);
    const small = shapePolygon('star', 0.01);
    expect(polygonsOverlap(big, small)).toBe(true);
    expect(polygonsOverlap(small, big)).toBe(true);
  });
});

describe('classify', () => {
  // Figures are the 2025-26 rows the model was tuned against.
  test('a primary creator who gives points back is a pentagon (Brunson)', () => {
    expect(classify(player({ oDpm: 4.3, dDpm: -0.91, creation: 16.55, assists: 9.6 })).kind).toBe('pentagon');
  });
  test('a primary creator whose defense holds is an octagon (Doncic)', () => {
    expect(classify(player({ oDpm: 4.53, dDpm: -0.07, creation: 21.96, assists: 11.2 })).kind).toBe('octagon');
  });
  test('passing counts as load: a hub with modest self-creation is still a primary engine', () => {
    expect(classify(player({ oDpm: 6, dDpm: 1.5, creation: 9, assists: 15 })).kind).toBe('octagon');
  });
  test('offense-first non-creator is a circle (Towns)', () => {
    expect(classify(player({ oDpm: 2.37, dDpm: 1.2, creation: 5.69, assists: 4.8 })).kind).toBe('circle');
  });
  test('two-way, low usage is a square (Anunoby)', () => {
    expect(classify(player({ oDpm: 1.77, dDpm: 1.82, creation: 2.61, assists: 3.2, shooting: 9.9, tsa: 20 })).kind).toBe('square');
  });
  test('defense-led with offense intact is a rectangle, longer the more it leans (Robinson)', () => {
    const a = classify(player({ oDpm: 0.12, dDpm: 2.73, creation: 0, shooting: 0, tsa: 10.8, assists: 2.2 }));
    expect(a.kind).toBe('rect');
    expect(a.aspect).toBeGreaterThan(2);
  });
  test('a catch-and-shoot specialist is a star (Shamet)', () => {
    expect(classify(player({ oDpm: 0.15, dDpm: 0.37, creation: 0.78, shooting: 10.3, tsa: 16.7, assists: 3.0 })).kind).toBe('star');
  });
  test('defends and the offense is a minus: triangle (Vanderbilt)', () => {
    expect(classify(player({ oDpm: -1.29, dDpm: 1.92, creation: 0, shooting: 4.9, tsa: 11.6, assists: 3.7 })).kind).toBe('triangle');
  });
});

describe('value', () => {
  test('at or below replacement is no value, never a negative area', () => {
    expect(valueOverReplacement(-2, 1500, 19680)).toBe(0);
    expect(valueOverReplacement(-4.5, 1500, 19680)).toBe(0);
  });
  test('a player is sized by his minutes per game, not his season total: an injured star keeps his size', () => {
    const healthy = valueOverReplacement(6, 34 * 82, 19680, 82);
    const missed18 = valueOverReplacement(6, 34 * 64, 19680, 64);
    expect(missed18).toBeCloseTo(healthy, 10);
    expect(shareOf(34 * 82, 19680, 82)).toBeCloseTo(34 / 48, 10);
    // Below the games floor his size fades with availability; a ten-game cameo is not a starter.
    expect(valueOverReplacement(6, 34 * 10, 19680, 10)).toBeCloseTo(healthy * (10 / GAMES_FULL), 10);
    // Without games, the share is his share of the team's actual minutes.
    expect(valueOverReplacement(6, 3936, 19680)).toBeCloseTo(8, 10);
  });
  test('five replacement-plus-x players playing every minute sum to 5x / 5 slots', () => {
    const teamMinutes = 5 * 3936;
    const total = Array.from({ length: 5 }, () => valueOverReplacement(1, 3936, teamMinutes)).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(15, 10); // 5 slots x (1 - -2)
  });
});

describe('pack', () => {
  const roster = [
    { id: 1, kind: 'pentagon' as const, area: 0.15, aspect: 1 },
    { id: 2, kind: 'circle' as const, area: 0.14, aspect: 1 },
    { id: 3, kind: 'square' as const, area: 0.13, aspect: 1 },
    { id: 4, kind: 'square' as const, area: 0.07, aspect: 1 },
    { id: 5, kind: 'rect' as const, area: 0.06, aspect: 2.3 },
    { id: 6, kind: 'triangle' as const, area: 0.05, aspect: 1 },
    { id: 7, kind: 'star' as const, area: 0.03, aspect: 1 },
    { id: 8, kind: 'diamond' as const, area: 0.02, aspect: 1 },
  ];

  test('no two shapes overlap and none leaves the box', () => {
    const { shapes, fitScale } = packShapes(roster);
    expect(fitScale).toBe(1);
    expect(shapes).toHaveLength(roster.length);
    for (const s of shapes) {
      expect(s.bounds.minX).toBeGreaterThanOrEqual(0);
      expect(s.bounds.minY).toBeGreaterThanOrEqual(0);
      expect(s.bounds.maxX).toBeLessThanOrEqual(1);
      expect(s.bounds.maxY).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        expect(polygonsOverlap(shapes[i].points, shapes[j].points)).toBe(false);
      }
    }
  });

  test('the same roster always draws the same plate', () => {
    expect(packShapes(roster)).toEqual(packShapes([...roster].reverse()));
  });

  test('a box too full to tile reports the shrink instead of overlapping', () => {
    // Circles cannot cover more than ~0.79 of a square however they are arranged.
    const circles = Array.from({ length: 5 }, (_, i) => ({ id: i, kind: 'circle' as const, area: 0.17, aspect: 1 }));
    const { shapes, fitScale } = packShapes(circles);
    expect(fitScale).toBeLessThan(1);
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        expect(polygonsOverlap(shapes[i].points, shapes[j].points)).toBe(false);
      }
    }
  });
});

describe('plate', () => {
  const plate = buildRosterShapePlate([
    player({ nbaId: 1, oDpm: 4, dDpm: 0, minutes: 2500 }),
    player({ nbaId: 2, oDpm: 1, dDpm: 1, minutes: 2500 }),
    player({ nbaId: 3, oDpm: -2, dDpm: -1, minutes: 2500 }), // below replacement
    player({ nbaId: 4, oDpm: 0, dDpm: 0, minutes: 10 }), // worth almost nothing
    // The rest of a rotation, so the shares are the size a real roster's are.
    ...[5, 6, 7, 8, 9].map((nbaId) => player({ nbaId, oDpm: 0.2, dDpm: 0.1, minutes: 2400 })),
  ]);
  const TEAM_MINUTES = 3 * 2500 + 10 + 5 * 2400;
  const byId = (id: number) => plate.players.find((p) => p.nbaId === id)!;

  test('fill is the sum of shares and nothing drawn for visibility changes it', () => {
    const shares = plate.players.reduce((s, p) => s + p.share, 0);
    expect(plate.fill).toBeCloseTo(shares, 12);
    // Area is value to the calibrated power, so the fill is Σ value^γ over the box, not Σ value.
    expect(plate.fill).toBeCloseTo(plate.players.reduce((s, p) => s + areaOf(p.value), 0) / PERFECT_TEAM_VALUE, 12);
    expect(SIZE_EXPONENT).toBeGreaterThan(1);
  });

  // Two shortcuts were tried and removed: hiding the small shapes (a bad roster
  // read as EMPTY) and inflating them to a readable size (not to scale).
  test('every player is on the plate, to scale, with the name beside a shape too small to hold it', () => {
    expect(byId(1).display).toBe('scale');
    expect(byId(1).placement!.labelOutside).toBeNull();
    const tiny = byId(4);
    expect(tiny.display).toBe('scale');
    expect(tiny.share).toBeLessThan(INSIDE_LABEL_SHARE);
    expect(polygonArea(tiny.placement!.points)).toBeCloseTo(tiny.share, 10);
    expect(tiny.placement!.labelOutside).not.toBeNull();
  });

  test('a hollow outline is sized by the deficit, and never counts toward the fill', () => {
    const hollow = byId(3);
    expect(hollow.display).toBe('hollow');
    expect(hollow.value).toBe(0);
    expect(hollow.share).toBe(0);
    expect(hollow.deficit).toBeCloseTo(deficitBelowReplacement(-3, 2500, TEAM_MINUTES, 70), 10);
    expect(polygonArea(hollow.placement!.points)).toBeCloseTo(areaOf(hollow.deficit) / PERFECT_TEAM_VALUE, 10);
  });

  // Inside the box they fought the real shapes for room: on bad teams the
  // outlines are big and many, and 25 players across the dataset went undrawn.
  test('below-replacement outlines sit in the strip under the box, not in it', () => {
    expect(plate.belowHeight).toBeGreaterThan(0);
    const hollow = byId(3).placement!;
    expect(Math.max(...hollow.points.map((q) => q.y))).toBeLessThanOrEqual(plate.belowHeight);
    expect(hollow.labelOutside).not.toBeNull();
    const none = buildRosterShapePlate([player({ nbaId: 1, oDpm: 2, dDpm: 1, minutes: 2500 }), ...[2, 3, 4, 5, 6].map((nbaId) => player({ nbaId, oDpm: 0, dDpm: 0, minutes: 2500 }))]);
    expect(none.belowHeight).toBe(0);
    expect(none.stripSections).toEqual([]);
  });

  // The box is a constant the size he draws it, so a roster from a stronger era
  // can be bigger than it. Nothing is shrunk: what does not fit is drawn under it.
  test('a roster bigger than the box overflows under it, largest first, at true size, and nothing shrinks', () => {
    const big = buildRosterShapePlate([
      player({ nbaId: 1, oDpm: 6, dDpm: 2, minutes: 2900, games: 80 }), // a 2004 Garnett: nearly the whole box alone
      player({ nbaId: 2, oDpm: 3, dDpm: 1, minutes: 2800 }),
      ...[3, 4, 5, 6, 7].map((nbaId) => player({ nbaId, oDpm: 1, dDpm: 0.5, minutes: 2400 })),
    ]);
    expect(big.fill).toBeGreaterThan(1);
    expect(big.fitScale).toBe(1);
    expect(big.overflow).toBeGreaterThan(0);
    expect(big.inBox).toBeLessThanOrEqual(1);
    const inBox = big.players.filter((p) => p.display === 'scale');
    const under = big.players.filter((p) => p.display === 'overflow');
    expect(inBox.length + under.length).toBe(7);
    expect(under.length).toBe(big.overflow);
    expect(big.stripSections[0]).toEqual({ kind: 'overflow', y: 0 });
    // The biggest shape is in the box, not under it.
    expect(big.players[0].display).toBe('scale');
    for (const p of [...inBox, ...under]) if (p.kind !== 'circle') expect(polygonArea(p.placement!.points)).toBeCloseTo(p.share, 10);
    for (const p of under) expect(Math.max(...p.placement!.points.map((q) => q.y))).toBeLessThanOrEqual(big.belowHeight);
    // A lone giant may break the frame by a little (that IS the reading); everything else stays inside.
    for (const p of inBox) {
      const slack = p === big.players[0] ? GIANT_OVERHANG : 0;
      for (const q of p.placement!.points) { expect(q.x).toBeGreaterThanOrEqual(-slack - 1e-9); expect(q.x).toBeLessThanOrEqual(1 + slack + 1e-9); }
    }
  });

  test('nothing on the plate is scaled: every drawn area is the number it stands for', () => {
    expect(plate.fitScale).toBe(1);
    for (const p of plate.players) {
      if (!p.placement || p.kind === 'circle') continue;
      const stands = areaOf(p.display === 'hollow' ? p.deficit : p.value) / PERFECT_TEAM_VALUE;
      expect(polygonArea(p.placement.points)).toBeCloseTo(stands, 10);
    }
  });
});

describe('extras', () => {
  test('fit into the room left, overlap nothing, and never move a real shape', () => {
    const real = packShapes([
      { id: 1, kind: 'octagon', area: 0.3, aspect: 1 },
      { id: 2, kind: 'square', area: 0.2, aspect: 1 },
    ]).shapes;
    const before = JSON.stringify(real);
    const extras = placeExtras(real, [
      { id: 3, kind: 'diamond', area: 0.004, aspect: 1, label: { w: 0.08, h: 0.018 } },
      { id: 4, kind: 'star', area: 0.002, aspect: 1, label: { w: 0.06, h: 0.018 } },
    ]);
    expect(extras).toHaveLength(2);
    // True size, and the reserved name sits under the shape, inside the box.
    expect(polygonArea(extras[0].points)).toBeCloseTo(0.004, 10);
    for (const e of extras) {
      expect(e.labelAt!.y).toBeGreaterThan(e.bounds.maxY);
      expect(e.labelAt!.y).toBeLessThan(1);
    }
    expect(JSON.stringify(real)).toBe(before);
    const all = [...real, ...extras];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(polygonsOverlap(all[i].points, all[j].points)).toBe(false);
    }
  });
});

describe('before the creation split is measured', () => {
  test('creation is estimated from usage and assists, and the outline says so', () => {
    // A 2005-style lead guard: heavy usage, heavy assists, no measured split.
    const a = classify(player({ oDpm: 5, dDpm: -1.2, creation: null, shooting: null, tsa: 30, assists: 11 }));
    expect(a.estimated).toBe(true);
    expect(a.kind).toBe('pentagon');
    expect(a.reason).toContain('estimated');
    expect(estimateCreation(30, 11)!).toBeGreaterThan(14);
    expect(estimateCreation(null, 5)).toBeNull();
  });
  test('a finisher is not mistaken for a creator', () => {
    expect(estimateCreation(11, 2)!).toBeLessThan(1);
    expect(classify(player({ oDpm: 0.1, dDpm: 2.7, creation: null, shooting: null, tsa: 11, assists: 2 })).kind).toBe('rect');
  });
  test('a very high three-point rate stands in for the catch-and-shoot share', () => {
    const p = player({ oDpm: 0.2, dDpm: 0.1, creation: null, shooting: null, tsa: 15, assists: 2.5, threeRate: 0.7 });
    expect(classify(p).kind).toBe('star');
    expect(classify({ ...p, threeRate: 0.3 }).kind).toBe('square');
  });
});

describe('teams', () => {
  test('a name is a fact about a season', () => {
    expect(teamName('CHA', 2010)).toBe('Charlotte Bobcats');
    expect(teamName('CHA', 2026)).toBe('Charlotte Hornets');
    expect(teamName('SEA', 2008)).toBe('Seattle SuperSonics');
    expect(teamName('XXX', 2008)).toBeNull();
  });
  test('a franchise follows its roster across a move', () => {
    expect(franchiseOf('SEA')).toBe('OKC');
    expect(franchiseOf('CHH')).toBe('NOP');
    expect(franchiseOf('BOS')).toBe('BOS');
  });
});

describe('plate labels', () => {
  test('the surname, with its suffix, and an initial only when two players share it', () => {
    const labels = plateLabels([
      { nbaId: 1, name: 'James Michael McAdoo' },
      { nbaId: 2, name: 'Jaime Jaquez Jr.' },
      { nbaId: 3, name: 'Jalen Williams' },
      { nbaId: 4, name: 'Jaylin Williams' },
      { nbaId: 5, name: 'Nene' },
    ]);
    expect(labels.get(1)).toBe('McAdoo');
    expect(labels.get(2)).toBe('Jaquez Jr.');
    expect(labels.get(3)).toBe('J. Williams');
    expect(labels.get(5)).toBe('Nene');
  });
});

describe('fitting maths', () => {
  test('Jacobi recovers the eigenvalues of a known symmetric matrix, largest first', () => {
    const { values, vectors } = symmetricEigen([
      [2, 1, 0],
      [1, 2, 0],
      [0, 0, 5],
    ]);
    expect(values[0]).toBeCloseTo(5, 10);
    expect(values[1]).toBeCloseTo(3, 10);
    expect(values[2]).toBeCloseTo(1, 10);
    expect(Math.abs(vectors[0][2])).toBeCloseTo(1, 10);
  });
  test('solve and ridge recover a planted linear relation', () => {
    expect(solve([[2, 1], [1, 3]], [5, 10])).toEqual([1, 3]);
    const F = Array.from({ length: 50 }, (_, i) => [1, i % 7, (i * 3) % 5]);
    const t = F.map((f) => 2 + 0.5 * f[1] - 1.5 * f[2]);
    const beta = ridge(F, t, F.map(() => 1), 0);
    expect(beta[0]).toBeCloseTo(2, 8);
    expect(beta[1]).toBeCloseTo(0.5, 8);
    expect(beta[2]).toBeCloseTo(-1.5, 8);
  });
  test('weighted quantiles respect the weights', () => {
    const q = weightedQuantiles([1, 2, 3], [1, 1, 8], 10);
    expect(q.filter((x) => x === 3).length).toBe(8);
  });
});

// The fitted model is a committed artifact; these pin what it says about the
// players the video is about, so a refit that flips them cannot go unnoticed.
describe('portability model', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const season = (y: number) => JSON.parse(readFileSync(`data/${y}.json`, 'utf8')).players as (ShapeInput & { team: string })[];
  const port = (y: number, name: string) => {
    const p = season(y).find((x) => x.name === name)!;
    return portabilityOf(model, { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm });
  };

  test('it beat the additive baseline on seasons it was not fitted on, both ways', () => {
    expect(existsSync('data/model.json')).toBe(true);
    expect(model.report.cvR2[0]).toBeGreaterThan(0);
    expect(model.report.cvR2[1]).toBeGreaterThan(0);
    expect(model.report.calibrationSlope).toBeGreaterThan(0.9);
    expect(model.report.calibrationSlope).toBeLessThan(1.1);
  });

  test('the two claims from the video have the sign he said they would', () => {
    expect(model.offense.minLink).toBeGreaterThan(0); // a worse offensive weak link costs the lineup
    expect(model.defense.weakCount).toBeLessThan(0); // each weak defender costs beyond his own DPM
  });

  test('low-usage two-way players stack; on-ball stars do not; parts add up by end', () => {
    for (const n of ['OG Anunoby', 'Mikal Bridges', 'Mitchell Robinson']) expect(port(2026, n).total).toBeGreaterThan(0);
    for (const n of ['Jalen Brunson', 'Luka Dončić', 'Austin Reaves']) expect(port(2026, n).total).toBeLessThan(0);
    const b = port(2026, 'Jalen Brunson');
    expect(b.parts[0].label).toContain('on-ball load');
    expect(b.parts.reduce((s, x) => s + x.value, 0)).toBeCloseTo(b.total, 10);
    expect(b.offense + b.defense).toBeCloseTo(b.total, 10);
  });

  test('the outline is calibrated to his diagrams, inside its limits, and a big is drawn long', () => {
    const tiling = (n: string) => outlineFor(model, port(2026, n), undefined, 0).fill;
    // Same DPM handed to each, so this isolates the fit term: Anunoby stacks, Brunson does not.
    expect(tiling('OG Anunoby')).toBeGreaterThan(tiling('Jalen Brunson'));
    expect(model.wyman.looR2).toBeGreaterThan(0.05);
    expect(model.wyman.fitWeight).toBeGreaterThan(0);
    expect(model.wyman.dpmWeight).toBeGreaterThan(0);
    for (const n of ['OG Anunoby', 'Jalen Brunson']) {
      expect(tiling(n)).toBeGreaterThanOrEqual(FILL_MIN);
      expect(tiling(n)).toBeLessThanOrEqual(FILL_MAX);
    }
    expect(outlineFor(model, port(2026, 'Mitchell Robinson')).aspect).toBeGreaterThan(1.3);
    expect(outlineFor(model, port(2026, 'Mikal Bridges')).aspect).toBe(1);
    expect(familyOf(port(2026, 'Mitchell Robinson').style)).toBe('interior');
    expect(familyOf(port(2026, 'Jalen Brunson').style)).toBe('onBall');
  });

  test('a real lineup is predicted by end, and the ends add to the net', () => {
    const nyk = season(2026).filter((x) => x.team === 'NYK').sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const pred = predictLineup(model, nyk.map((p) => ({ style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm })));
    expect(pred.offense + pred.defense).toBeCloseTo(pred.net, 10);
    expect(Math.abs(pred.net)).toBeLessThan(10);
  });
});

describe('superellipse', () => {
  test('fills its box like a square, a circle and a diamond at the known exponents', () => {
    expect(superellipseFill(2)).toBeCloseTo(Math.PI / 4, 10);
    expect(superellipseFill(1)).toBeCloseTo(0.5, 10);
    expect(superellipseFill(40)).toBeGreaterThan(0.99);
  });
  test('the exponent is recovered from the fill, and the outline is built to its exact area', () => {
    for (const fill of [0.3, 0.5, Math.PI / 4, 0.9, 0.985]) {
      const n = exponentForFill(fill);
      expect(superellipseFill(n)).toBeCloseTo(fill, 6);
      for (const rotation of SHAPE_ROTATIONS.super) {
        expect(polygonArea(shapePolygon('super', 0.07, 1.6, rotation, n))).toBeCloseTo(0.07, 10);
      }
    }
  });
});

describe('awkward outlines', () => {
  test('the pointed families pass through the shapes they are named for', () => {
    expect(pointedFill(3, 0.5)).toBeCloseTo(0.5, 6); // a triangle
    expect(pointedFill(4, Math.SQRT1_2)).toBeCloseTo(0.5, 6); // a diamond
    expect(pointedFill(5, Math.cos(Math.PI / 5))).toBeCloseTo(0.691, 3); // a regular pentagon
  });
  test('sharper means it tiles worse, the ratio is recovered from the fill, and the area stays exact', () => {
    for (const [kind, m] of [['tri', 3], ['quad', 4], ['penta', 5], ['burst', 12]] as const) {
      expect(pointedFill(m, 0.35)).toBeLessThan(pointedFill(m, 0.8));
      const ratio = ratioForFill(m, 0.45);
      expect(pointedFill(m, ratio)).toBeCloseTo(0.45, 4);
      for (const rotation of SHAPE_ROTATIONS[kind]) expect(polygonArea(shapePolygon(kind, 0.05, 1, rotation, ratio))).toBeCloseTo(0.05, 10);
    }
  });
  // A diamond turned 45° is a square: the packer must not be able to do that.
  test('no rotation can turn an awkward outline into a well-tiling one', () => {
    expect(SHAPE_ROTATIONS.quad).toEqual([0]);
    expect(SHAPE_ROTATIONS.super.every((r) => Math.abs((r / (Math.PI / 2)) % 1) < 1e-9)).toBe(true);
  });
});

describe('varimax', () => {
  test('rotating keeps each variable\'s communality and concentrates the loadings', () => {
    const L = [[0.7, 0.7], [0.7, 0.6], [0.6, -0.7], [0.7, -0.6]];
    const R = varimax(L);
    for (let i = 0; i < L.length; i++) expect(R[i][0] ** 2 + R[i][1] ** 2).toBeCloseTo(L[i][0] ** 2 + L[i][1] ** 2, 8);
    const simple = (M: number[][]) => M.flat().reduce((s, x) => s + x ** 4, 0);
    expect(simple(R)).toBeGreaterThan(simple(L));
  });
});

describe('the two rules', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const players = JSON.parse(readFileSync('data/2026.json', 'utf8')).players as (ShapeInput & { team: string })[];
  const lp = (name: string) => {
    const p = players.find((x) => x.name === name)!;
    return { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm };
  };
  const outline = (name: string) => { const p = lp(name); return outlineFor(model, portabilityOf(model, p), flawsOf(model, p, 2026), p.oDpm + p.dDpm); };

  test('one-way: a defender with no offense is a triangle, a scorer with no defense a four-point star', () => {
    expect(outline('Jarred Vanderbilt').kind).toBe('tri');
    expect(outline('Matisse Thybulle').kind).toBe('tri');
    expect(outline('Austin Reaves').kind).toBe('quad');
    expect(outline('Collin Sexton').kind).toBe('quad');
    expect(flawsOf(model, lp('Jarred Vanderbilt')).oneWay.end).toBe('offense');
  });
  test('a defensive hole is not charged twice: the penalty is net of the lineup model, the label is not', () => {
    const f = flawsOf(model, lp('Collin Sexton'));
    expect(f.oneWay.penalty).toBeLessThan(f.oneWay.gross);
  });
  test('two-way players and complete ones stay smooth; being bad at BOTH ends is small, not one-way', () => {
    for (const n of ['OG Anunoby', 'Mikal Bridges', 'Mitchell Robinson', 'Karl-Anthony Towns', 'Luka Dončić']) expect(outline(n).kind).toBe('super');
    expect(flawsOf(model, { ...lp('OG Anunoby'), oDpm: -1.5, dDpm: -1.5 }).oneWay.gross).toBe(0);
  });
  test('one skill comes from the rotated PCA, defense counts as a skill, and the rule never makes anyone squarer', () => {
    expect(outline('Jordan Clarkson').kind).toBe('penta');
    expect(model.skill.names).toContain('shooting');
    expect(model.skill.names).toContain('defense');
    // Champagnie shoots, defends and rebounds; before defense was a skill he drew as a one-skill star.
    expect(outline('Julian Champagnie').kind).toBe('super');
    expect(outline('Julian Champagnie').fill).toBeGreaterThan(0.8);
    expect(skillScores(model.skill, lp('Landry Shamet').style, 1171, 0.4)).toHaveLength(model.skill.names.length);
    for (const n of ['Jordan Clarkson', 'Jarred Vanderbilt', 'OG Anunoby']) expect(outline(n).fill).toBeLessThanOrEqual(outline(n).fitFill + 1e-9);
  });
});

describe('non-spacer', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const players = JSON.parse(readFileSync('data/2026.json', 'utf8')).players as (ShapeInput & { team: string })[];
  const lp = (name: string) => { const p = players.find((x) => x.name === name)!; return { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm }; };
  test('is judged against the player\'s own season, because three-point volume doubled over these years', () => {
    const early = model.spacingBySeason['2001'].mean;
    const late = model.spacingBySeason['2026'].mean;
    expect(late).toBeGreaterThan(early * 1.5);
    // Castle makes 1.9 threes per 100: a non-spacer in 2026, average by a 2001 yardstick.
    expect(flawsOf(model, lp('Stephon Castle'), 2026).spacing.penalty).toBeGreaterThan(0);
    expect(flawsOf(model, lp('Stephon Castle'), 2001).spacing.penalty).toBe(0);
  });
  test('a big is not expected to space, and a shooter is not a non-spacer', () => {
    expect(flawsOf(model, lp('Mitchell Robinson'), 2026).spacing.z).toBeNull();
    expect(flawsOf(model, lp('Landry Shamet'), 2026).spacing.penalty).toBe(0);
  });
});

describe('playoff reading', () => {
  const rows = JSON.parse(readFileSync('data/playoffs.json', 'utf8')) as PlayoffRow[];
  const readings = playoffReadings(rows);
  const players = JSON.parse(readFileSync('data/2026.json', 'utf8')).players as (ShapeInput & { team: string })[];
  const of = (name: string, season = 2026) => readings.get(`${season}:${players.find((x) => x.name === name)!.nbaId}`);
  test('Harden and Mitchell give back offense; Vanderbilt loses his minutes and his shot; Kawhi rises; stars play more', () => {
    expect(of('James Harden')!.dpmDelta).toBeLessThan(0);
    expect(of('Donovan Mitchell')!.dpmDelta).toBeLessThan(0);
    expect(of('Jarred Vanderbilt')!.shareScale).toBeLessThan(0.9);
    expect(of('Jarred Vanderbilt')!.dpmDelta).toBeLessThan(-0.5);
    expect(of('Kawhi Leonard')!.dpmDelta).toBeGreaterThan(0.5);
    // A star who plays more in May keeps his size; playability only ever lowers a player.
    expect(of('Paul George')!.shareScale).toBe(1);
    expect(of('Paul George')!.rawPlayability).toBeGreaterThan(1.2);
    // Against a player of his level, Harden's recent playoff drop is ordinary; the page says so.
    expect(Math.abs(of('James Harden')!.vsLevel)).toBeLessThan(1);
  });
  test('it is career to date and shrunk by evidence: a first postseason moves a reading less than a career of them', () => {
    const harden = players.find((x) => x.name === 'James Harden')!.nbaId;
    const first = [...readings.entries()].filter(([k]) => k.endsWith(`:${harden}`)).sort()[0][1];
    expect(first.postseasons).toBe(1);
    expect(Math.abs(first.dpmDelta)).toBeLessThan(Math.abs(first.rawEfficiency) + 1e-9);
    expect(of('James Harden')!.postseasons).toBeGreaterThan(10);
    expect(of('James Harden')!.minutes).toBeGreaterThan(EFFICIENCY_K);
  });
  test('the reading is in the plate: a player with no postseason is his regular-season self, one with a bad record is smaller and less clean', () => {
    const rookie = players.find((p) => !readings.has(`2026:${p.nbaId}`) && p.minutes > 500)!;
    const team = players.filter((p) => p.team === rookie.team).map((p) => ({ ...p }));
    const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
    const bare = buildRosterShapePlate(team, model, 2026, { box: 60 });
    attachPlayoffReadings(team, 2026, readings);
    expect(team.find((p) => p.nbaId === rookie.nbaId)!.playoff).toBeNull();
    const withReadings = buildRosterShapePlate(team, model, 2026, { box: 60 });
    const r = bare.players.find((p) => p.nbaId === rookie.nbaId)!;
    const q = withReadings.players.find((p) => p.nbaId === rookie.nbaId)!;
    expect(q.value).toBeCloseTo(r.value, 10);
    expect(q.tiling).toBe(r.tiling);
    expect(withReadings.fill).not.toBeCloseTo(bare.fill, 3);
    // Vanderbilt: minutes and shot both go in May, so he is drawn smaller and never as a clean square.
    const lakers = players.filter((p) => p.team === 'LAL').map((p) => ({ ...p }));
    attachPlayoffReadings(lakers, 2026, readings);
    const lal = buildRosterShapePlate(lakers, model, 2026, { box: 60 });
    const v = lal.players.find((p) => p.name === 'Jarred Vanderbilt')!;
    const vReg = valueOverReplacement(v.oDpm + v.dDpm, v.minutes, lakers.reduce((s, p) => s + p.minutes, 0), v.games);
    expect(v.value).toBeLessThan(vReg * 0.8);
    expect(v.tiling!).toBeLessThan(0.9);
  });
});

describe('on-ball', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const players = JSON.parse(readFileSync('data/2026.json', 'utf8')).players as (ShapeInput & { team: string })[];
  const lp = (name: string) => { const p = players.find((x) => x.name === name)!; return { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm, handling: handlingOf(p) }; };
  const outline = (name: string) => { const p = lp(name); return outlineFor(model, portabilityOf(model, p), flawsOf(model, p, 2026), p.oDpm + p.dDpm); };
  test('an engine is never a square: Harden and Mitchell are capped at his Dončić octagon', () => {
    for (const n of ['James Harden', 'Donovan Mitchell', 'Luka Dončić', 'Nikola Jokić']) {
      expect(outline(n).fill).toBeLessThan(0.93);
      expect(flawsOf(model, lp(n), 2026).onBall.cap).toBeLessThanOrEqual(ON_BALL_FILL_CAP + 0.1);
    }
    expect(outline('James Harden').fill).toBeCloseTo(ON_BALL_FILL_CAP, 2);
  });
  test('it reads playmaking load, not usage: a high-usage big who does not run the offense stays square', () => {
    for (const n of ['Victor Wembanyama', 'Karl-Anthony Towns', 'Jalen Duren']) {
      expect(flawsOf(model, lp(n), 2026).onBall.cap).toBe(FILL_MAX);
      expect(outline(n).fill).toBeGreaterThan(0.93);
    }
  });
  test('the rule abstains without the numbers, and is scaled to the season', () => {
    expect(flawsOf(model, { ...lp('James Harden'), handling: null }, 2026).onBall.cap).toBe(FILL_MAX);
    expect(model.handlingBySeason!['2001'].p97).toBeGreaterThan(model.handlingBySeason!['2001'].p85);
    expect(Object.keys(model.handlingBySeason!).length).toBeGreaterThanOrEqual(26);
  });
  test('the notch is cut to the exact area and fills 1 − depth/2 of its box', () => {
    const pts = shapePolygon('notched', 0.06, 1.2, 0, 0.3);
    expect(polygonArea(pts)).toBeCloseTo(0.06, 10);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    expect(0.06 / box).toBeCloseTo(1 - 0.3 / 2, 6);
  });
});

describe('the Wyman calibration', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const players = JSON.parse(readFileSync('data/2026.json', 'utf8')).players as (ShapeInput & { team: string })[];
  const outline = (name: string) => { const p = players.find((x) => x.name === name)!; const lp = { style: p.style!, minutes: p.minutes, oDpm: p.oDpm, dDpm: p.dDpm }; return outlineFor(model, portabilityOf(model, lp), flawsOf(model, lp, 2026), p.oDpm + p.dDpm); };
  test('the players he draws as squares are squares, and his notch is a notch', () => {
    for (const n of ['Victor Wembanyama', 'OG Anunoby', 'Julian Champagnie', 'Mitchell Robinson']) expect(outline(n).fill).toBeGreaterThan(0.93);
    expect(outline('Stephon Castle').kind).toBe('notched');
  });
  test('the mix of outlines across the league follows his: about a quarter squares, a fifth stars', () => {
    const fills = players.filter((p) => p.minutes >= 1000 && p.style).map((p) => outline(p.name).fitFill);
    const share = (f: (x: number) => boolean) => fills.filter(f).length / fills.length;
    expect(share((x) => x >= 0.93)).toBeGreaterThan(0.15);
    expect(share((x) => x >= 0.93)).toBeLessThan(0.45);
    expect(share((x) => x <= 0.4)).toBeGreaterThan(0.08);
  });
});

describe('reference players', () => {
  const model: PortabilityModel = JSON.parse(readFileSync('data/model.json', 'utf8'));
  const snap = JSON.parse(readFileSync('data/2026.json', 'utf8'));
  const plate = (team: string) => buildRosterShapePlate(snap.players.filter((p: any) => p.team === team), model, 2026);
  test('the 24 players in his diagrams are drawn as he drew them, and say so', () => {
    const nyk = plate('NYK');
    const brunson = nyk.players.find((p) => p.name === 'Jalen Brunson')!;
    expect(brunson.reference).toBe('pentagon');
    expect(brunson.kind).toBe('pentagon');
    expect(brunson.tiling).toBeCloseTo(0.7, 1);
    const towns = nyk.players.find((p) => p.name === 'Karl-Anthony Towns')!;
    expect(towns.kind).toBe('circle');
    expect(towns.tiling).toBeCloseTo(Math.PI / 4, 4);
    const castle = plate('SAS').players.find((p) => p.name === 'Stephon Castle')!;
    expect(castle.kind).toBe('notched');
    expect(castle.reference).toBe('notched rectangle');
    // A teammate he did not draw is drawn by the calibration.
    expect(nyk.players.find((p) => p.name === 'Jose Alvarado')!.reference).toBeNull();
  });
  test('the reference is a fact about a SEASON: the same name in another year is not overridden', () => {
    const snap2025 = JSON.parse(readFileSync('data/2025.json', 'utf8'));
    const nyk = buildRosterShapePlate(snap2025.players.filter((p: any) => p.team === 'NYK'), model, 2025);
    expect(nyk.players.find((p) => p.name === 'Jalen Brunson')!.reference).toBeNull();
  });
});
