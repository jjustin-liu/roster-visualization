# Roster Shapes — design system

## Product
Every NBA roster drawn as shapes in a box (a data-driven version of Taylormetrics' "Wyman diagram"). A player's AREA is how good he is (superlinear in value over replacement), his OUTLINE is how easily he fits (squares tile, stars don't), his COLOUR is his type, and the WHITE left in the box is what a perfect team would add. Two page types: a league page (30 team plates, fullest first, one season at a time) and a team page (one big plate, season strip, two readings — fill % and team fit — and a player table that explains every shape). Audience: NBA analytics fans arriving from TikTok; they want to find their team fast, compare seasons, and understand why a player is drawn the way he is.

## Principles
- The plate is the only loud thing. It is a white box with a heavy black border and flat coloured shapes, and it never changes with theme. Everything around it is quiet and typographic.
- Numbers set in the display face carry the reading (fill %, team fit); labels stay sentence case, no all-caps eyebrows, no middle-dot meta strings.
- Structure encodes information: rank numbers mean rank; a chip strip means seasons; green/red mean sign only.
- Data-honest copy: plain sentences, no hype; caveats in the warn colour.

## Colour
Page --bg #EDEFF1 · panel #FFFFFF · ink #17181A · muted #5C6168 · faint #8B9097 · hairline #D6D9DD · hover #F3F4F6 · good #2F7D4E · bad #B03A2E · warn #9A5B12. Dark scheme: bg #141517, panel #1C1E21, ink #ECEDEF, muted #A3A8AF, hairline #2A2D31, good #6CC08B, bad #E07A6E, warn #E0A64A.
Plate: ground #FFFFFF, border #0B0B0C. Shape fills: balanced #a9a9a9, shooter #f4d04f, on-ball #cf9be9, interior #ea8651, disruptor #7fb3e6. No gradients, no shadows.

## Type
Display: "Bricolage Grotesque" (Google Fonts), 600–800, tight tracking (-0.02em), for the wordmark, headings, team names and the big readings. Body: system sans (-apple-system, Segoe UI, Roboto), 15px/1.5; tables 13px; notes 13px. Tabular numerals everywhere numbers align.

## Spacing & shape
Content max 1280px, 20px gutters. Selects 8px radius; panels 10px; chips pill. Hairline borders (1px --line). Grid 2/3/4 columns at 720/1040px.

## Motion
Only in answer to a hover: a shape and its table row highlight together (others dim to 28%). No entrance animations. Respect prefers-reduced-motion.
