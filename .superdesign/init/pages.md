# Pages

## League page `dist/<season>/index.html`
Entry: scripts/build.ts (buildSeason → league block). Uses topBar, keyBlock, renderPlate (mini), howBlock.
```ts
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


```

## Team page `dist/<season>/team/<ABBR>.html`
Entry: scripts/build.ts (buildSeason → team block). Uses topBar (with team menu), strip, renderPlate (full, with belowHeight), readings, table, keyBlock, howBlock, HOVER script (hovering a shape highlights its table row and vice versa).
```ts
  // ── Team pages ────────────────────────────────────────────────────────────
  const teamMenu = `<label><select data-nav aria-label="Team">${teams.map((t) => `<option value="TEAM_${t.abbr}">${esc(t.name)}</option>`).join('')}</select></label>`;
  for (const t of teams) {
    const fillPct = Math.round(t.fill * 100);
    const unplaced = t.players.filter((p) => !p.placement);
    const hollowCount = t.players.filter((p) => p.display === 'hollow' && p.placement).length;

    const rows = t.players
      .map((p) => {
        const tag = (p.display === 'hollow' ? `<span class="tag">below replacement</span>` : '') + (p.flaw ? `<span class="tag">${esc(p.flaw)}</span>` : '') + (p.reference ? `<span class="tag">his diagram</span>` : '');
        return (
          `<tr data-id="${p.nbaId}"><td><div class="who">${playerGlyph(p)}<div><b>${esc(p.name)}</b>${tag}<small>${esc(p.label)}. ${esc(p.reason)}</small></div></div></td>` +
          (p.portability === null ? `<td class="dimtext">&ndash;</td>` : signedCell(p.portability)) +
          `<td class="dimtext">${Math.round(p.minutes)}</td><td>${p.display === 'hollow' ? (p.deficit > 0 ? `<span class="neg">&minus;${p.deficit.toFixed(p.deficit < 0.1 ? 2 : 1)}</span>` : '0.0') : p.value.toFixed(p.value < 0.1 ? 2 : 1)}</td><td class="dimtext">${(p.share * 100).toFixed(1)}%</td>${signedCell(p.oDpm)}${signedCell(p.dDpm)}</tr>`
        );
      })
      .join('');

    const lineage = franchiseSeasons.get(franchiseOf(t.abbr)) ?? new Map<number, string>();
    const strip =
      `<nav class="strip" aria-label="This franchise by season">` +
      [...available]
        .reverse()
        .map((y) => (y === season ? `<span class="cur">${seasonLabel(y)}</span>` : lineage.has(y) ? `<a href="../../${y}/team/${lineage.get(y)}.html">${seasonLabel(y)}</a>` : ''))
        .join('') +
      `</nav>`;
    const menu = teamMenu.replace(/value="TEAM_([A-Z]+)"/g, (_, abbr) => (abbr === t.abbr ? `value="" selected` : `value="${abbr}.html"`));

    const body =
      topBar(season, (y) => (lineage.has(y) ? `../../${y}/team/${lineage.get(y)}.html` : null), menu) +
      `<main>` +
      `<div class="team-head"><div><h1 class="display">${esc(t.name)}</h1><p class="sub">${label} regular season. ${t.players.filter((p) => p.placement && p.display === 'scale').length} players in the box${hollowCount ? `, ${hollowCount} below replacement under it` : ''}.</p></div></div>` +
      strip +
      (t.fitScale < 1 && t.fitScale > 0
        ? `<p class="caveat">Drawn at ${Math.round(t.fitScale * 100)}% size: these outlines do not tile into a box this full. The fill figure is exact; the shapes are each slightly smaller than their value.</p>`
        : '') +
      `<div class="team"><div class="left">` +
      renderPlate(t.players, { ariaLabel: `${t.name} roster drawn as shapes filling ${fillPct}% of a box`, belowHeight: t.belowHeight }) +
      `</div><div class="right">` +
      `<div class="readings">` +
      `<div class="reading"><b class="display">${fillPct}%</b><span><span class="lbl">of the box filled.</span> the roster is worth ${t.value.toFixed(1)} points per 100 above replacement; the white is what a perfect team would add.</span></div>` +
      (t.fit
        ? `<div class="reading"><b class="display ${t.fit.predicted > 0.05 ? 'pos' : t.fit.predicted < -0.05 ? 'neg' : ''}">${signedText(t.fit.predicted)}</b><span><span class="lbl">team fit,</span> points per 100 this roster&rsquo;s real lineups are predicted to gain or lose by playing together, beyond the sum of their players (offense ${signedText(t.fit.offense)}, defense ${signedText(t.fit.defense)}). It would move the fill to ${Math.round(t.fill * ((t.value + t.fit.predicted) / t.value) ** SIZE_EXPONENT * 100)}%. Observed over ${t.fit.possessions.toLocaleString()} possessions: ${signedText(t.fit.observed)}, which for one team is mostly noise.</span></div>`
        : '') +
      `</div>` +
      `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Player</th><th title="Points per 100 his lineups gain or lose beyond the sum of their players' DPM, from the lineup model">Fit</th><th>Min</th><th title="Points per 100 of team margin above a replacement player, weighted by his share of the minutes">Value</th><th title="Share of the box">Box</th><th>O-DPM</th><th>D-DPM</th></tr></thead><tbody>${rows}</tbody></table></div></div>` +
      (unplaced.length ? `<p class="note" style="margin-top:10px"><b>Nothing to draw</b> (exactly at replacement, so an area of zero): ${esc(unplaced.map((p) => p.name).join(', '))}.</p>` : '') +
      `<div style="margin-top:16px">${keyBlock()}</div>` +
      `</div></div>` +
      howBlock('') +
      `</main>`;

    writeFileSync(`dist/${season}/team/${t.abbr}.html`, page(`${t.name} ${label}: ${SITE}`, `The ${label} ${t.name} drawn as shapes in a box: ${fillPct}% of a perfect team.`, body, NAV_SCRIPT + HOVER));
  }


```

Rendered samples for context: `.superdesign/tmp/team-NYK.html` (full team page) and `.superdesign/tmp/league-8.html` (league page trimmed to 8 cards).
