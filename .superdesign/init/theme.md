# Theme

## Token summary
Light: --bg #EDEFF1 (page), --panel #FFFFFF, --fg #17181A, --muted #5C6168, --faint #8B9097, --line #D6D9DD, --hover #F3F4F6, --good #2F7D4E, --bad #B03A2E, --warn #9A5B12.
Dark (prefers-color-scheme): --bg #141517, --panel #1C1E21, --fg #ECEDEF, --muted #A3A8AF, --faint #7C8288, --line #2A2D31, --hover #26292D, --good #6CC08B, --bad #E07A6E, --warn #E0A64A.
The plate never changes: ground #FFFFFF, border #0B0B0C. Shape fills by player type: balanced #a9a9a9, perimeter shooter #f4d04f, on-ball creator #cf9be9, interior big #ea8651, disruptor #7fb3e6.
Type: display "Bricolage Grotesque" 600/700/800 (wordmark 22px, h1 34–40px, readings 44px, card names 16px, card fill 18px); body system sans 15px/1.5; table 13px; notes 13px. Radii: 8px selects, 10px panel, 999px chips. Max content width 1280px, 20px gutters. Grid: 2 → 3 (720px) → 4 (1040px) columns.

## Raw CSS (the whole stylesheet)
```css

:root { --bg:#EDEFF1; --fg:#17181A; --muted:#5C6168; --faint:#8B9097; --line:#D6D9DD; --panel:#FFFFFF; --hover:#F3F4F6; --good:#2F7D4E; --bad:#B03A2E; --warn:#9A5B12; --wm:#17181A; }
@media (prefers-color-scheme: dark) { :root { --bg:#141517; --fg:#ECEDEF; --muted:#A3A8AF; --faint:#7C8288; --line:#2A2D31; --panel:#1C1E21; --hover:#26292D; --good:#6CC08B; --bad:#E07A6E; --warn:#E0A64A; --wm:#ECEDEF; } }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
a { color:inherit; }
:focus-visible { outline:2px solid var(--fg); outline-offset:2px; }
.display { font-family:"Bricolage Grotesque",-apple-system,BlinkMacSystemFont,sans-serif; font-optical-sizing:auto; font-variation-settings:"wdth" 100; }
.bar { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid var(--line); }
.bar-in { max-width:1280px; margin:0 auto; padding:10px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.wordmark { font-family:"Bricolage Grotesque",sans-serif; font-weight:800; font-size:22px; letter-spacing:-0.02em; text-decoration:none; color:var(--wm); line-height:1; }
.wordmark small { display:block; font-family:-apple-system,BlinkMacSystemFont,sans-serif; font-weight:400; font-size:12px; letter-spacing:0; color:var(--muted); margin-top:3px; }
.bar select { appearance:none; -webkit-appearance:none; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:7px 30px 7px 12px; font:inherit; font-size:14px; cursor:pointer; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%235C6168' stroke-width='1.6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; }
.bar .spacer { flex:1; }
.bar .how { font-size:14px; color:var(--muted); text-decoration:none; } .bar .how:hover { color:var(--fg); }
main { max-width:1280px; margin:0 auto; padding:22px 20px 64px; }
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
.team-head { margin:6px 0 16px; display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:10px 24px; }
.team-head h1 { font-family:"Bricolage Grotesque",sans-serif; font-weight:700; font-size:40px; line-height:1; letter-spacing:-0.025em; margin:0; }
.team-head .sub { color:var(--muted); margin:6px 0 0; }
.strip { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; padding:2px 0 10px; margin:0 0 14px; -webkit-overflow-scrolling:touch; }
.strip::-webkit-scrollbar { display:none; }
.strip a, .strip span { flex:none; font-size:13px; padding:5px 10px; border-radius:999px; text-decoration:none; font-variant-numeric:tabular-nums; border:1px solid var(--line); color:var(--muted); background:var(--panel); }
.strip a:hover { color:var(--fg); border-color:var(--muted); }
.strip .cur { background:var(--fg); color:var(--bg); border-color:var(--fg); font-weight:600; }
.team { display:grid; gap:24px; }
.team > .left { max-width:640px; min-width:0; }
.team > .right { min-width:0; }
@media (min-width:1100px) { .team { grid-template-columns:minmax(0,560px) minmax(0,1fr); gap:36px; } }
.readings { display:grid; grid-template-columns:1fr 1fr; gap:14px 24px; margin:0 0 18px; }
.reading b { display:block; font-family:"Bricolage Grotesque",sans-serif; font-weight:800; font-size:44px; line-height:1; letter-spacing:-0.03em; font-variant-numeric:tabular-nums; }
.reading span { display:block; font-size:13px; color:var(--muted); line-height:1.4; margin-top:6px; max-width:22em; }
.reading .lbl { color:var(--fg); font-weight:600; }
.note { color:var(--muted); font-size:13px; max-width:44em; }
.note b { color:var(--fg); font-weight:600; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.table-wrap { overflow-x:auto; }
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

```
