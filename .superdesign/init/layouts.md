# Layouts

Every page: `<header class="bar">` (sticky) then `<main>`. The bar holds the wordmark (with a one-line tagline under it), a season `<select data-nav>`, on team pages a team `<select data-nav>`, a spacer, and a "How it works" anchor link. Selects navigate on change via `NAV_SCRIPT`.

```ts
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
    `<span class="spacer"></span><a class="how" href="#how">How it works</a>` +
    `</div></header>`
  );
}


function keyBlock(): string {
  return `<div class="key"><div><span class="k">Outline</span>${outlineLegend()}</div><div><span class="k">Flaw</span>${flawLegend()}</div><div><span class="k">Colour</span>${familyLegend()}</div></div>`;
}


```

CSS for the shell is in theme.md.
