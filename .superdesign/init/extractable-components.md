# Extractable components

- TopBar — `scripts/build.ts` `topBar()`: wordmark + tagline, season select, optional team select, "How it works" link. Props: season, seasons[], team (optional), teams[].
- Plate — `src/render.ts` `renderPlate()`: the SVG plate. Not a template component (data-driven SVG); treat as an image block in drafts, but keep its look: white box, thick black border, flat coloured shapes with names.
- Key — `keyBlock()`: three legend rows (Outline scale glyphs, Flaw family glyphs, Colour swatches).
- TeamCard — league grid item: rank, name, fit (signed, green/red), fill %, mini plate.
- Reading — team page big number + caption (fill %, team fit).
- PlayerTable — columns Player (glyph, name, tags, one-line reason), Fit, Min, Value, Box, O-DPM, D-DPM.
