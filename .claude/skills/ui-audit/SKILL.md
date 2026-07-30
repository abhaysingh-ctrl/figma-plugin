---
name: ui-audit
description: >-
  Audit a Figma design against the Amino design system to check whether every
  component, colour, radius, border, spacing value, and typography style uses
  the correct Amino tokens for the intended brand — and flag anything that
  doesn't, including deprecated tokens. Use this skill whenever the user shares
  a Figma link (or a selected frame/node) and asks to "audit", "check", "review
  for design-system compliance", "see if it's on-system", "check tokens", "check
  if the right tokens/components were used", "QA this design", or anything that
  amounts to verifying a design against Amino. Also trigger when the user pastes
  a Figma file and asks whether it follows the design system, uses the right
  brand colours, or contains any off-token / hardcoded values — even if they
  don't say the word "audit". This is the standard Amino compliance check.
---

# UI-audit — Amino design-system compliance audit

## What this skill does

Given a Figma node, this skill reads the design's real resolved values through
the Figma MCP connector, cross-references every token against the **Amino**
design system for the **correct brand mode**, and produces a structured report
of what is compliant, what violates the system (with `used → should be`), and
what could not be verified. It runs **strict** by default: every off-token value
is flagged, however small.

Amino ships as **8 brand modes** (HK, MB/MuscleBlaze, Gritzo, Fuel One, HKV,
True Basics, Smash, Ronnie Coleman). The token *structure* is identical across
all 8; what differs is the resolved values — especially brand colours. This is
why brand mode is not optional (see below).

## Before you start: you need two things

1. **A Figma node URL** — ideally with a specific frame/node selected, so the
   URL ends with `node-id=...`. A node-specific link gives a far sharper audit
   than a whole-file link. If the URL has no `node-id`, ask the user to select a
   frame and re-copy the link, or proceed on the whole file knowing it's broader.
2. **The Amino token source** — the per-brand token JSON files (one per mode),
   the source of truth for what "correct" means. **Look at the default path
   `/mnt/user-data/uploads/` first** (filenames like `MB_tokens.json`,
   `HK_tokens.json`, …). The user may always override this — prefer any path or
   fresh files they supply in the current conversation over the default. Only if
   no files are found at the default path and none are supplied, ask the user to
   provide them. Do NOT audit colours from memory or from the design's own
   fallback hexes alone — always resolve against the real token files.

If either is missing, say so plainly and ask for it rather than guessing.

## Step 1 — Read the design

Use the Figma MCP tools:
- `get_metadata` first on the node to understand the structure (what frames and
  component instances exist).
- `get_design_context` on the node to pull the real code + resolved style values
  + component descriptions + the screenshot. This is the payload you audit for
  colours, spacing, radius, typography, and text-token bindings.
- `get_variable_defs` — call this **in addition**, specifically to check
  **icon fill tokens**. `get_design_context` exports icons as flattened `<img>`
  assets with no token information at all — icon fill bindings are invisible
  there. `get_variable_defs` can surface them, but ONLY works reliably when
  queried against the **plain component ID**, not the instance path inside the
  page. In Figma's node IDs, an instance looks like
  `I5815:30053;555:13316;680:5747` — the segment AFTER THE LAST SEMICOLON
  (`680:5747` here) is the plain component ID to query. Call
  `get_variable_defs(fileKey, "680:5747")` and look for `Semantic/Icon/*` in the
  result. See the dedicated section below ("Token family MUST match element
  type") for exactly how to use this and its current confidence level.

The design context exposes tokens as CSS variables with fallback values, e.g.
`var(--semantic/text/text-01, #333)` or
`var(--component/button/brand-set/filled/default/button-filled-bg-default,
#ffbe00)`. The variable *name* tells you which Amino token was intended; the
fallback hex tells you what Figma rendered. Your job is to confirm the intended
token exists in Amino and that its resolved value for the chosen brand matches —
**and, crucially, to catch values that appear as bare literals with no `var()`
wrapper at all**, which means the design hardcoded them instead of using a token.
Those are violations even when the value is correct (see Step 3, the gate).

## Step 2 — Determine the brand mode (auto-detect, then CONFIRM)

Brand mode drives the entire colour audit, so getting it right matters more than
anything else. The same hex can be correct for one brand and a violation for
another.

1. **Auto-detect.** Infer the brand from evidence in the design: a brand logo
   component (e.g. a node named `MB_logo`), brand-specific naming, or a brand
   colour that resolves cleanly in exactly one mode. Cross-check any brand-looking
   colour against each mode's `Primitive/Color Styles/Brand/#600` to see which
   brand it belongs to.
2. **Confirm before auditing.** State the detected brand and ask the user to
   confirm (e.g. "This looks like **MuscleBlaze** — the logo is `MB_logo` and the
   button resolves to MB's amber `#FFBE00`. Auditing against MuscleBlaze — correct?").
   Do not run the full audit until the brand is confirmed. If detection is
   ambiguous, present the candidates and ask.

Read `references/amino-token-model.md` for how the brand modes relate and which
token groups are shared vs. brand-specific.

## Step 3 — Resolve and check every value

The single most important principle: **a value being correct is NOT enough. The
design must USE THE TOKEN, not a hardcoded literal that happens to equal the
token's value.** A raw `#131313` is a violation even if `text-on-brand` also
resolves to `#131313`, because the literal won't track the token when the palette
changes — the whole point of the system is defeated. Never pass a value just
because its number is right; check *how* the value was produced first.

### CRITICAL — always compare TWO independently-obtained numbers

Every colour/value check is a comparison between **two separate things**, and you
must obtain each one from its own source. Never let one substitute for the other:

- **The RENDERED value** = what the design actually shows for this node. For a
  **hardcoded** value this is the bare literal itself (`#656565`). For a
  **tokenized** value, do NOT trust the fallback hex inside the `var()` — the
  fallback is the *token's* value, not proof of what rendered; obtain the rendered
  value from the node's actual paint/fill in the design data.
- **The RESOLVED TOKEN value** = what the relevant Amino token resolves to when
  you walk its reference chain in the brand JSON (e.g. `text-02` → `#646464`).

A value passes the "correct value" test ONLY when `RENDERED == RESOLVED-TOKEN`,
where each was read from its own source. **Failure mode to avoid (this has
happened):** reading the token's value and reporting it as the "used" value, so
the audit compares the token to itself and always finds a match. If a design
hardcodes `#656565` while `text-02` resolves to `#646464`, the correct finding is
"hardcoded AND wrong value: rendered `#656565`, token resolves `#646464`" — a
🔴 Critical — NOT "value correct". The number you print in the **Used** column
must be the RENDERED number, never the token's number.

### The mechanical tell — `var()` present or not

In the Figma MCP `get_design_context` output, a **tokenized** value appears
wrapped in a CSS variable with a fallback, e.g.
`var(--semantic/text/text-01, #333)` or
`var(--component/button/.../button-filled-bg-default, #ffbe00)`. A **hardcoded**
value appears as a bare literal with NO `var(...)` wrapper — e.g. `#131313`,
`bg-black`, `padding: 16px`, `rounded-[8px]`. This is the reliable signal:

- **`var(--token, …)` wrapper present** → tokenized. Proceed to check the token
  exists and resolves correctly (steps 2–5 below).
- **Bare literal, no `var()`** → **hardcoded. This is a violation** even if the
  value is correct for the brand. Do not resolve-and-pass it. (Only exception:
  device chrome/assets, which are still surfaced as ⚪ Informational — see Scope.)

### Check order for every styled value

1. **Tokenized or hardcoded? (THE GATE.)** Is the value wrapped in `var(--…)` or
   is it a bare literal?
   - Bare literal → violation. Now read the RENDERED number (the literal itself)
     and separately find what the *semantically-correct* token would resolve to,
     then compare:
     - Rendered value **matches** the correct token's value → **🟠 Major**
       ("correct value, but hardcoded — must use the token").
     - Rendered value **does NOT match** (like `#656565` vs `text-02`'s `#646464`)
       → **🔴 Critical** ("hardcoded AND wrong value"). Show both numbers.
     Either way it goes in Table 1, never Table 2. In "Should be", name the token
     the design *should* have used and its resolved value.
   - `var(--…)` present → continue.
2. **Does the referenced token exist in Amino?** A `var(--…)` naming a token that
   isn't in the JSON is a **🔴 Critical** violation (stale or invented token).
3. **Does it resolve to the right value for this brand?** Resolve the token
   through the tier chain to get the RESOLVED-TOKEN number, obtain the RENDERED
   number independently, and compare the two. Mismatch = **🟠 Major** (wrong
   value for brand). Print the rendered number in **Used**, the token's in
   **Should be**.
4. **Is it a deprecated `Old Tokens` reference?** → **🔴 Critical**, see priority
   rule below.
5. **Does the token's FAMILY match the element's kind?** (See the dedicated rule
   below — "Token family must match element type".) A right-value token from the
   wrong family (e.g. `text-02` on an icon) → **🔴 Critical**. Other semantic
   misuse (border token as background, non-information border on a focus ring)
   → **🟠 Major**.

Only a value that passes ALL of steps 1–5 (properly tokenized, token exists,
resolves correctly, not deprecated, correct family + semantically right) goes
into Table 2.

### This rule applies to EVERY value type, not just colours

The token-not-literal requirement covers **colours** (text, icon, border, bg,
brand), **radius**, **stroke/border weight**, **spacing / padding / gap**,
**opacity**, **typography** (family, size, weight, line-height), and **effects**
(shadows/elevation). A bare `px` spacing, a bare `rounded-[8px]`, a raw font
size, or a hand-typed border width is just as much a violation as a bare hex —
even when the number matches a primitive. Resolution chain for reference:

**Component tier → Semantic tier → Primitive tier → raw value.** Example (MB):
`button-filled-bg-default` → `{Semantic.bg.Global.Brand.bg-brand-01}` → … →
`#FFBE00`.

> Note on the fallback hex: the value after the comma in `var(--token, #hex)` is
> just Figma's fallback — it is NOT evidence of hardcoding. A `var()` wrapper
> means tokenized regardless of what fallback sits inside it. Hardcoding is the
> *absence* of the wrapper.

## Token family MUST match element type — 🔴 Critical if it doesn't

A token can be properly referenced, exist in Amino, AND resolve to the exact
right colour — and still be **wrong**, because it belongs to the wrong semantic
family for the element it's applied to. The classic danger: an **icon** painted
with `Semantic/Text/text-02` instead of `Semantic/Icon/icon-02`. Both resolve to
the same grey today, so every value check passes — but they are different tokens
with different intents, and the moment icon and text greys diverge in the system,
that icon silently breaks. This must be caught and must **block handoff to dev**.

**How to actually check this (verified method):** `get_design_context` cannot
see icon fills at all — icons export as flattened `<img>` assets with zero
token data. Use `get_variable_defs` instead:

1. From the design context output, find the icon's instance node ID, e.g.
   `I5815:30053;555:13316;680:5747;582:13535`.
2. Take the segment **after the last semicolon before the icon's own sub-path**
   — for a list-item icon this is typically the enclosing component ID, e.g.
   `680:5747`. (If unsure, try the plain-ID segments from the path, innermost
   first, until one returns results.)
3. Call `get_variable_defs(fileKey, "<that ID>")`. Look for any
   `Semantic/Icon/*` key in the result. If instead you find a `Semantic/Text/*`
   (or `bg/*`, `Borders/*`) key where you expected an icon token, and no
   matching `Icon/*` key appears — that is a family mismatch. 🔴 Critical.

**⚠️ Confidence caveat — state this in every report where this check runs.**
This method is confirmed to correctly surface a component's icon token when
queried at the plain component ID (verified: `680:5747` → returned
`Semantic/Icon/icon-02` correctly). It is **not yet confirmed** whether it also
detects a **per-instance override** — i.e., if one specific placed instance on
a page was individually changed to a different family (the exact danger
scenario this rule exists for), it is unproven whether `get_variable_defs`
reflects that override or silently reports the master component's original
binding instead. Until this is verified against a real overridden instance,
**treat a "pass" from this check as a check against the component's canonical
definition, not a guaranteed check of every placed instance.** Say so plainly
in the report rather than implying full per-instance coverage.

Determine element kind (icon vs. text vs. bg vs. border) from the design data
(layer name, node type, `data-name`, whether it's a vector/icon glyph vs a text
run) to know which family to expect in the first place.

| Element kind | Correct token family | Flag if it uses… |
|---|---|---|
| Icon / vector glyph | `Semantic/Icon/*` (e.g. `icon-01`, `icon-on-brand`) | a `Text/*`, `bg/*`, or `Borders/*` colour token |
| Text / label run | `Semantic/Text/*` (e.g. `text-01`, `text-02`) | an `Icon/*`, `bg/*`, or `Borders/*` colour token |
| Background / fill surface | `Semantic/bg/*` | a `Text/*` or `Icon/*` token |
| Border / stroke | `Semantic/Borders/*` | a `bg/*`, `Text/*`, or `Icon/*` token |

Any family mismatch → **🔴 Critical** (right hex, wrong family, danger — do not
ship). In the report, state it plainly: *"icon uses `text-02` (Text family); an
icon must use an `Icon/*` token such as `icon-02` — same colour today, but wrong
semantic token."*

**The one allowed exception — component-tier tokens on their own parts.** When an
element is part of a component and uses that component's own token, the family is
correct even though the token name isn't `icon-*`/`text-*`. A button's icon using
`Component/Button/.../button-filled-icon-default` is **correct** — that component
token is *defined for* the button's icon (it resolves through `Semantic/Icon/*`
internally). Do NOT flag component-tier tokens applied to the matching part of
their own component. The test is intent, not string-matching: `button-…-icon-…`
on a button icon = fine; `text-02` on that same icon = 🔴 Critical.

To apply this, read `references/amino-token-model.md` for the full family list
(the `Semantic/Icon`, `Semantic/Text`, `Semantic/bg`, `Semantic/Borders` groups)
and the component-token naming convention.

## PRIORITY RULE — deprecated `Old Tokens`, flag on sight

The Amino JSON contains an `Old Tokens` group (including an `Old-Buttons` set
such as `button-primary-fill`, `ecom-primary-fill`, and various `stroke on
tonal` tokens). **These are deprecated. No design should reference them.**

If any `Old Tokens` value appears — in the design, in the resolved chain, or
anywhere — flag it **explicitly and with high priority**: name the exact token,
say where it was found, and recommend the current replacement. Never treat its
presence as acceptable and never resolve through it silently. This check runs on
every audit regardless of what else is found.

## Scope & strictness — flag EVERYTHING, including chrome

This skill is configured to **flag every deviation, including device chrome and
raster images.** Do NOT silently exclude chrome. When you find raw/off-token
values in mockup scaffolding — the iOS/Android status bar (the `9:41` clock,
signal/wifi/battery icons), the notch, OS-level indicators — or in raster image
assets, surface them as **⚪ Informational** rows in Table 1, with a one-line note
that they are likely intentional mock/OS content. This honours "flag everything"
while ranking chrome below real UI issues so it never competes with a genuine
violation. The reader decides whether to act; your job is not to hide it.

Everything inside the actual product UI is, of course, in scope at full
severity.

## Step 4 — Report as TWO TABLES

The deliverable is tabular. ALWAYS use this exact structure: a one-line header,
a one-line verdict, then **Table 1 (violations & flags) first**, then **Table 2
(passed checks) second**, then two short closing lines. Keep prose to a minimum
— the tables carry the result.

```
# Amino Compliance Audit — [screen/component name]
Brand mode audited against: [BRAND] · Node [id] · file [name]

## Verdict: [one line — e.g. "Clean, fully on-system" / "3 violations, 1 critical"]

## Table 1 — Violations & flags

| # | Severity | Location (layer / node id) | Property | Used | Should be | Fix |
|---|----------|----------------------------|----------|------|-----------|-----|
```

- One row per finding, **sorted by severity** (Critical → Major → Minor → Info).
- **Used** = the actual value/token in the design. **Should be** = the correct
  Amino token, with its resolved value in parentheses where helpful.
- Put deprecated `Old Tokens` findings at the top (they are Critical).
- If there are zero violations, still render the header and write one row:
  `| — | — | — | — | No violations found | — | — |`.

```
## Table 2 — Passed checks

| Property / token used | Resolves to | Correct for [brand]? |
|-----------------------|-------------|----------------------|
```

- List the **distinct** tokens the design used correctly (dedupe repeats). This
  is the evidence the audit was thorough, not hand-waved.

After the two tables, add exactly these two short lines:

- **Deprecated-token scan:** state whether any `Old Tokens` were found (list them
  if so, else "none found").
- **Confidence & scope:** what was verified with FULL confidence (token layer —
  colours, radii, borders, spacing, typography tokens, effects, deprecated
  tokens, text-token bindings) vs. PARTIAL confidence (component anatomy —
  heights, exact padding specs — not defined in the token files; AND icon-family
  checks — verified against each icon's canonical component definition via
  `get_variable_defs`, but per-instance overrides on a specific placed icon are
  not yet confirmed to be caught by this method). Never claim full coverage of
  sizing or of instance-level icon overrides.

## Severity tiers (assign one per finding)

This is what lets the audit "flag everything" without burying the real problems.

- **🔴 Critical** — any of: a hardcoded value whose value is ALSO wrong for the
  brand (show both numbers); a **wrong token family for the element kind**
  (e.g. `text-02` on an icon — right hex, wrong family, blocks handoff); a
  deprecated `Old Tokens` reference; or a `var()` naming a token that doesn't
  exist in Amino. These break the system contract.
- **🟠 Major** — a **hardcoded literal whose value is correct** for the brand but
  which bypasses the token (must use the token, not the raw hex/px); OR a token
  that resolves to the wrong value for this brand; OR other semantic misuse
  within the right family neighbourhood (e.g. a border token used as a
  background, a non-information border on a focus ring).
- **🟡 Minor** — an off-scale value that doesn't exactly equal any Amino token
  but sits close to one (e.g. `padding: 15px` when the nearest primitive is
  `space-16`). These are drift, not a clean "should have used token X" — flag
  them so they're visible, but they rank below a hardcoded value that *does* map
  cleanly to a token (that one is 🟠 Major).
- **⚪ Informational** — deviations inside device chrome/mockups (iOS status bar,
  notch, battery, signal) and raster images/assets. These ARE surfaced, ranked
  lowest, and labelled as likely-intentional mock/OS content.

### Worked example rows

`| 1 | 🔴 Critical | Header / CTA button (195:6067) | background | #0066CC (hardcoded) | button-filled-bg-default (#FFBE00) | Replace hex with token |`
`| 2 | 🔴 Critical | Nav icon (I5815:30045;9823:9091) | icon color | text-02 (Text family, #646464) | icon-02 (Icon family) — same colour, wrong family | Swap to the Icon-family token |`
`| 3 | 🔴 Critical | Sub-text (I5815:30041;195:6044) | text color | #656565 (hardcoded AND wrong: text-02 resolves #646464) | text-02 (#646464) via var() | Use the token; also fixes the wrong value |`
`| 4 | 🟠 Major | List label text (555:12290) | color | #131313 (hardcoded — value correct but not tokenised) | text-01 (whichever fits context) | Swap raw hex for the token |`
`| 5 | 🟠 Major | Card container (555:12671) | padding | 16px (hardcoded) | space-16 primitive | Swap raw px for the spacing token |`
`| 6 | 🔴 Critical | Footer / old button (620:12) | fill | Old-Buttons/button-primary-fill | Component/Button/Brand Set/Filled/Default | Migrate to current token |`
`| 9 | ⚪ Info | Status bar / battery (I5815:30044) | fill | bg-black (raw) | — (iOS mock chrome, likely intentional) | Confirm; tokenise only if required |`

## Honesty requirements

- **Report the token layer with confidence; be explicit about the anatomy gap.**
  Amino's token files define colours, radii, borders, spacing primitives,
  typography, and effects — audit those definitively. They may NOT define
  per-component sizing (button height, exact internal padding specs); do not call
  a height "wrong" against a spec that doesn't exist. Say so in Coverage.
- **Don't invent violations to seem useful.** A clean design is a valid and good
  result. Say it's clean and show the evidence.
- **Cite exact node ids** for every finding so the user can jump straight to it.
- **Resolve, don't assume.** Every colour claim must come from resolving the
  token against the confirmed brand's JSON, not from the design's fallback hex
  and not from memory.
- **Tokenised, not just correct.** A value only passes if the design used a
  `var(--token, …)` reference. A bare literal (`#131313`, `16px`, `bg-black`)
  whose value happens to be correct is still a violation (🟠 Major) — the goal is
  a design built from tokens, not one that merely looks right today. Never move a
  hardcoded value into the passed table because its number checks out.

## Notes on strictness

Default and intended behaviour is **flag everything**: every off-token value,
hardcoded colour/number, stale token, semantic misuse, and every chrome/asset
deviation gets a row in Table 1, ranked by the severity tiers above. Nothing is
hidden. The severity ordering (Critical → Info) is what keeps the output usable
— a mock battery pixel and a hardcoded button colour both appear, but never at
the same weight.

If the user explicitly asks for a *pragmatic* pass instead, you may drop the
🟡 Minor and ⚪ Informational rows and keep only 🔴 Critical and 🟠 Major — but
always keep deprecated-token and wrong-brand-colour findings as Critical, no
matter what.
