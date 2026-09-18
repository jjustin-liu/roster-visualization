/**
 * One season's plates, in one box.
 *
 * The box is sized for the season: `BOX_OVER_FULLEST` × the fullest roster's
 * area, so the fullest plate of the year reads about 71% (his diagrams:
 * 76-77%), then grown by `BOX_GROW_STEP` until every roster of the season
 * packs at true size with nothing under the box. Every above-replacement
 * player is inside the box, to scale; nothing is shrunk and nothing overflows.
 * `grown` says how many steps the season needed beyond the calibrated size.
 */
import { buildRosterShapePlate, rosterArea, type PortabilityModel, type RosterShapePlate } from './index';
import { BOX_GROW_STEP, BOX_OVER_FULLEST, boxNet, type ShapeInput } from './model';

export interface SeasonPlates {
  box: number;
  boxNet: number;
  grown: number;
  plates: Map<string, RosterShapePlate>;
  /** The team whose roster set the box. */
  fullest: string;
}

const MAX_GROWTH = 40;

export function packSeasonPlates<T extends ShapeInput>(byTeam: Map<string, T[]>, model: PortabilityModel | undefined, season: number): SeasonPlates {
  let fullest = '';
  let fullestArea = 0;
  for (const [team, rows] of byTeam) {
    const a = rosterArea(rows);
    if (a > fullestArea) {
      fullestArea = a;
      fullest = team;
    }
  }
  let box = BOX_OVER_FULLEST * fullestArea;
  let grown = 0;
  const plates = new Map<string, RosterShapePlate>();
  const keys = [...byTeam.keys()];
  let pending = keys;
  for (let step = 0; step <= MAX_GROWTH; step++) {
    const failed: string[] = [];
    for (const team of pending) {
      const plate = buildRosterShapePlate(byTeam.get(team)!, model, season, { box });
      plates.set(team, plate);
      if (plate.overflow > 0 || plate.fitScale < 1) failed.push(team);
    }
    if (failed.length === 0 && pending.length === keys.length) break;
    if (failed.length === 0) {
      // Everything re-packed fits; confirm the rest at this box too.
      pending = keys.filter((k) => !pending.includes(k));
      continue;
    }
    box *= BOX_GROW_STEP;
    grown++;
    pending = failed;
  }
  return { box, boxNet: boxNet(box), grown, plates, fullest };
}
