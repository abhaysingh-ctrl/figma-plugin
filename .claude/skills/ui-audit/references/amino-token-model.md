# Amino token model — reference for auditing

Read this when you need the details of how Amino is structured, how the 8 brand
modes relate, and exactly how to resolve a token. The main SKILL.md covers the
workflow; this file is the domain knowledge.

## Three tiers

Amino is a three-tier token system. Always resolve top-down until you reach a
raw value:

1. **Primitive** — raw values, no references. The atoms.
   - `Primitive/Radius/radius-{2,4,8,12,16,24,32,40}` → numbers
   - `Primitive/Spacing/space-{2,4,8,12,16,24,32}` → numbers (`space-0` may be null)
   - `Primitive/Stroke Weight/border-{01..05}` → 1..5
   - `Primitive/Opacity/opacity-{5,10,...70}` → numbers
   - `Primitive/Color Styles/...` — the palettes, incl. `Gray/#{25..900}` and
     `Brand/#{...600...}`. Colours are objects with a `hex` field.
   - `Primitive/Typography/...` — font-family, font-size (`m`,`l`,`3xl`, ...),
     font-weight, line-height.
   - `Primitive/Effects/...` — drop-shadow elevation values.
2. **Semantic** — meaning-based tokens that REFERENCE primitives. This is the
   layer designers mostly use.
   - `Semantic/Text/text-01` → `{Primitive.Color Styles.Gray.#800}`
   - `Semantic/Borders/border-05`, `border-brand`, `border-information-01`, ...
   - `Semantic/bg/Global/Brand/bg-brand-01`, `Semantic/bg/Global/Primary/bg-primary-06`, ...
   - `Semantic/Icon/icon-on-brand`, `icon-disabled`, ...
3. **Component** — component-specific tokens that REFERENCE semantics.
   - `Component/Button/Brand Set/Filled/Default/button-filled-bg-default`
     → `{Semantic.bg.Global.Brand.bg-brand-01}` → ... → hex

A reference looks like `{Primitive.Color Styles.Gray.#800}` (curly braces,
dot-separated; note some path segments contain spaces, e.g. `Color Styles`).

## FIRST check tokenised vs. hardcoded, THEN resolve

Before resolving anything, determine whether the design actually *used a token*.
In the MCP output, tokenised values are wrapped: `var(--<token-path>, <fallback>)`.
Hardcoded values are bare literals with no wrapper: `#131313`, `16px`,
`rounded-[8px]`, `bg-black`.

- **No `var()` wrapper → hardcoded → violation**, even if the literal's value
  equals a valid token. Correct-value-but-hardcoded is 🟠 Major; wrong-value-and-
  hardcoded is 🔴 Critical. Do not resolve-and-pass a bare literal.
- **`var()` wrapper present → tokenised** → now resolve the token (below) and
  check it exists / resolves correctly / isn't deprecated / is used in the right
  place.

The fallback hex *inside* a `var()` (after the comma) is Figma's fallback, not a
sign of hardcoding — a wrapped value is tokenised no matter what fallback it
carries. Hardcoding is the absence of the wrapper.

## Resolution algorithm

```
resolve(ref):
  if ref is not a "{...}" string: return ref            # already a raw value
  path = ref.strip("{}").split(".")                      # keep spaces in segments
  node = walk the brand JSON following path
  v = node["$value"]
  if v is a "{...}" string: return resolve(v)            # recurse up the tiers
  if v is an object with "hex": return v["hex"]          # colour leaf
  return v                                                # number / string leaf
```

Resolve against **the confirmed brand's file**. The same semantic token can
resolve to different primitives in different brands.

## Shared vs. brand-specific — the crucial distinction

This is the single most important fact for a colour audit:

- **Neutrals are SHARED across all 8 brands.** `text-01` resolves to `#333333`
  in every mode. The whole Gray-based chain (text, icon, most borders, neutral
  backgrounds) is identical brand to brand. A neutral value is correct
  regardless of which brand you audit.
- **Brand colours are BRAND-SPECIFIC.** `Primitive/Color Styles/Brand/#600`
  differs per mode. Known reference values:

  | Brand | Brand/#600 |
  |-------|-----------|
  | HK | `#00B4B7` (teal) |
  | MB / MuscleBlaze | `#F9AF06` (amber) |
  | Gritzo | `#434E8F` (indigo) |
  | Fuel One | `#FF7D4F` (orange) |
  | HKV | `#6C5C46` |
  | True Basics | `#5C7373` |
  | Smash | `#325788` |
  | Ronnie Coleman | `#48669C` |

  (Resolve the actual value from the file rather than trusting this table alone;
  it's a sanity anchor, not the source of truth.)

Consequence: to audit a **brand-coloured** element you MUST know the brand — a
teal button is correct for HK and a violation for MuscleBlaze. To audit a
**neutral** element, any single brand file suffices. Use brand colours as the
main signal when auto-detecting the mode.

## Semantic families by element kind (for the family-match rule)

Each semantic colour group is intended for a specific kind of element. The audit
must require that an element's token comes from the matching family (see the
"Token family MUST match element type" rule in SKILL.md). Same-colour-different-
family is still a 🔴 Critical.

**Tooling note:** `get_design_context` cannot see icon fills (they export as
flattened images). Icon-family checks must use `get_variable_defs` against the
icon's plain component ID instead — see SKILL.md Step 1 and the "Token family
MUST match element type" section for the exact method and its confidence
caveat (verified for a component's canonical binding; not yet verified for
per-instance overrides).

| Element kind | Required family | Example tokens |
|---|---|---|
| Icon / vector glyph | `Semantic/Icon/*` | `icon-01`, `icon-02`, `icon-on-brand`, `icon-disabled`, `icon-white`, `icon-inverse` |
| Text / label run | `Semantic/Text/*` | `text-01`, `text-02`, `text-on-brand`, `text-disabled`, `text-white`, `text-inverse` |
| Background / fill surface | `Semantic/bg/*` | `bg-white`, `bg-primary-06`, `bg-brand-01`, `bg-disable` |
| Border / stroke | `Semantic/Borders/*` | `border-05`, `border-brand`, `border-information-01` |

Note that several families share resolved values (e.g. `text-02` and `icon-02`
may both resolve to the same grey today). That shared value is exactly why the
family check matters — it cannot be caught by comparing hexes; it must be caught
by comparing the token's family to the element's kind.

**Component-tier exception.** Component tokens named for a part
(`Component/Button/<Set>/<Style>/<State>/button-…-icon-…`,
`button-…-text-…`, `button-…-bg-…`, `button-…-border-…`) are the *correct*
tokens for that part of that component and resolve through the right semantic
family internally. Applying `button-filled-icon-default` to a button's icon is
correct and must NOT be flagged. Only flag when a bare semantic token from the
wrong family is used (e.g. `text-02` on an icon), or a component token is used on
the wrong part.

## Button — the matrix

The Button is not one component. It is:
- **Set:** Brand · Primary · Ecommerce
- **Style:** Filled · Outline · Tonal
- **State:** Default · Hover · Focus · Disable

Every combination has real colour tokens under `Component/Button/<Set>/<Style>/
<State>`. Shared structural tokens live under
`Component/Button/Global Button tokens` (e.g. `button-outline-border` =
`border-01`, `button-border-focus` = `border-02`).

Confirmed anatomy rule: **all buttons are fully pill-shaped at every size** —
every `button-radius-{xs..xl}` points to `radius-40`. A button with a smaller
radius is a violation.

Disabled is shared, not branded: every set/style routes disabled bg to
`bg-disable` and disabled text/icon to `text-disabled` / `icon-disabled`. A
brand-tinted disabled state is a violation.

## Deprecated: `Old Tokens`

Top-level `Old Tokens` group. Contains `Old-Buttons` with tokens such as
`button-primary-fill`, `button-primary-fill 2`, `ecom-primary-fill`, and several
`if stroke on tonal (...)` entries. **All deprecated.** Any reference to anything
under `Old Tokens` is a high-priority flag (see the PRIORITY RULE in SKILL.md).
The current replacements live under the normal `Component/Button` tree.

## What the token files do NOT contain

Be honest about this in the Coverage section of every report. The files define
colours, radii, borders, spacing primitives, typography, effects, and
per-component *colour* tokens. They generally do NOT define per-component
**sizing/anatomy** — button height, exact internal padding, icon-to-label gap
specs. Audit sizing only as far as it maps to spacing primitives; do not fail a
height against a spec that isn't in the system.
