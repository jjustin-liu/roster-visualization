/** Team names keyed by the abbreviation the source rows carry, old franchises included. */
const NAMES: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets',
  CHI: 'Chicago Bulls', CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets',
  DET: 'Detroit Pistons', GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers',
  LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat',
  MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz', WAS: 'Washington Wizards',
  NJN: 'New Jersey Nets', SEA: 'Seattle SuperSonics', VAN: 'Vancouver Grizzlies', CHH: 'Charlotte Hornets',
  NOH: 'New Orleans Hornets', NOK: 'New Orleans/Oklahoma City Hornets',
};

/** A name is a fact about a SEASON: `CHA` was the Bobcats from 2004-05 through 2013-14. */
export function teamName(abbr: string, season: number): string | null {
  if (abbr === 'CHA' && season >= 2005 && season <= 2014) return 'Charlotte Bobcats';
  if (abbr === 'LAC' && season <= 2015) return 'Los Angeles Clippers';
  return NAMES[abbr] ?? null;
}

/**
 * The franchise an abbreviation belongs to, so a team page can link the same
 * club across a move: the 2007-08 Sonics and the 2025-26 Thunder are one line.
 * Follows where the ROSTER went, which is what a roster plate is about — the
 * 2001-02 Charlotte Hornets became the New Orleans Hornets, not today's Hornets.
 */
const FRANCHISE: Record<string, string> = { NJN: 'BKN', SEA: 'OKC', VAN: 'MEM', CHH: 'NOP', NOH: 'NOP', NOK: 'NOP' };
export const franchiseOf = (abbr: string) => FRANCHISE[abbr] ?? abbr;
