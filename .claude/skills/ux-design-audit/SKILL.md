---
name: ux-design-audit
description: >-
  Holistic UX review of a Figma screen — typography, spacing, icons,
  components, information architecture, W3C/WAI (WCAG) accessibility,
  violated UX laws (Fitts's, Hick's, Miller's, Jakob's, Gestalt, Peak-End,
  Serial Position, Von Restorff, Zeigarnik, Aesthetic-Usability, Tesler's,
  Postel's), and UX copy vs. brand voice and page content. Findings grounded
  in NN/g, Baymard, Growth.Design, W3C/WAI, or a named UX law — never
  opinion. Use for "UX audit"/"design audit" of a Figma link, "review this
  design", "check accessibility", "check the copy", "is the info shown
  right", "how should this flow better", or any design-quality pass beyond
  token checks. DIFFERENT from ui-audit (token compliance only). Trigger even
  without "audit" — e.g. "does this screen look right", "critique this
  design".
---

# UX-Design-Audit — evidence-grounded holistic design review

## What this skill does

Given a Figma node, this skill produces a structured review of the screen's
overall UX quality — not whether it uses the correct design token (that's
`ui-audit`'s job), but whether the design and content actually work:
typography, font weights/styles, spacing, icon style and icon backgrounds,
and every component, plus a dedicated read on information architecture — is
the information organized in a way that's easy to understand, and is there a
better way to present or sequence it — plus three more lenses: accessibility
against W3C/WAI (WCAG), any UX laws being violated, and whether the UX copy
actually fits the brand voice and the content it's describing.

**The non-negotiable rule of this skill: no finding is ever a hypothesis or a
personal-taste guess.** Every single row in every table must trace back to a
named source: (a) an NN/g usability heuristic, (b) a Baymard Institute
research finding, (c) a Growth.Design case study, (d) a W3C/WAI (WCAG)
success criterion, or (e) a named UX law. If you cannot ground a finding in
one of these, you do not include it as a finding — at most you can note it
separately as an unverified observation, clearly labeled as such (see
"Honesty requirements").

This skill and `ui-audit` are complementary, not overlapping:
- **ui-audit** = "does this use the right Amino token?" (mechanical, strict)
- **ux-design-audit** (this skill) = "is this good UX, per published
  research?" (evidence-grounded judgment)

If the user's ask is purely about token/DS compliance, prefer `ui-audit`. If
it's about overall quality, readability, consistency, content, or IA, use
this skill. For a complete pre-handoff pass, it's reasonable to run both and
present them as two sections — say so up front if you do.

## Before you start

1. **A Figma node URL**, ideally with `node-id=...` in it for a sharp,
   specific audit. If missing a node id, ask the user to select a frame and
   re-copy, or proceed on the whole file and say the audit will be broader.
2. **Read `/mnt/skills/user/nng-ux-heuristics/SKILL.md`** — this is your
   primary grounding framework and the first place to check for a named
   heuristic to cite.
3. **Read `/mnt/skills/user/design-critique-case-studies/SKILL.md`** if
   available — its critique methodology (structured feedback, severity
   framing) informs how findings are presented here.
4. **Baymard research is not bundled as a local skill.** For findings that
   need a specific Baymard finding (e.g. checkout flows, form design,
   filtering/sorting, product listing patterns, mobile e-commerce UX — this
   is Baymard's specialty), use `web_search` to find and cite the actual
   Baymard article or finding by name rather than asserting "Baymard says X"
   from memory. If you can't find a specific applicable Baymard finding,
   don't invent one — fall back to an NN/g heuristic, or label the point as
   an unverified observation.
5. **Growth.Design is also not bundled.** For findings about behavioral/
   psychological patterns in growth-oriented flows (onboarding, habit loops,
   pricing pages, engagement mechanics), use `web_search` to find the actual
   Growth.Design case study or article and cite it by name (e.g.
   "Growth.Design: [case study name]"). Don't assert a Growth.Design finding
   from memory — if you can't find one that applies, don't invent it.
6. **W3C/WAI accessibility guidance is also not bundled.** For the
   accessibility pass, ground findings in actual WCAG success criteria (e.g.
   "WCAG 2.2 — 1.4.3 Contrast (Minimum)", "WCAG 2.2 — 2.5.8 Target Size
   (Minimum)"). Use `web_search` to confirm the exact criterion name/number
   and threshold rather than asserting one from memory, especially for
   numeric thresholds like contrast ratios and touch target sizes.
7. **UX laws are judged from a fixed list, not asserted from memory for
   naming** — see "UX laws check" below for the list and how to apply it.
8. **Ask the user what's changed**, if not already stated — e.g. "focus only
   on the current data/copy, not older iterations." If the user says
   data/copy has changed, take the design at face value; do not reference
   anything from memory of earlier versions of the same file.
9. **If auditing copy**, ask (if not already clear from context) what brand
   voice/tone guidelines apply and what the page's subject matter is, unless
   this is obvious from the file/brand already being audited (e.g. an Amino
   brand file) — you need both to judge whether copy fits the brand and the
   content.

## Step 1 — Read the real design, not the screenshot

Use the Figma MCP tools:
- `get_metadata` first, to understand structure (frames, component
  instances, nesting).
- `get_design_context` to pull the real resolved code, styles, and a
  screenshot — this is what you audit typography, spacing, and layout from,
  not a visual guess.
- `get_variable_defs` if you need to confirm whether something is a reusable
  component/icon instance vs. a one-off, which matters for the "component
  consistency" check.

Never eyeball pixel values from the screenshot alone when the real data is
available — read the actual font sizes, weights, spacing, and radii from the
design context output.

## Step 2 — Judge across eight dimensions, each cited

Work through each dimension below. For every row you write, name the
specific heuristic or research finding backing it (e.g. "NN/g: Aesthetic and
Minimalist Design", "NN/g: Recognition Rather Than Recall", "Baymard:
[finding name], [source]", "Growth.Design: [case study]", "WCAG 2.2 —
[criterion]", "UX law: Fitts's Law"). Not every screen will have findings in
every dimension — that's fine, say so. Dimensions 7 (UX laws) and 8
(Accessibility) are the two most likely to have zero findings on a clean
screen — that's a good result, not a gap; report it plainly rather than
padding it.

### 1. Typography
Check: consistent type scale (how many distinct sizes/weights appear in one
view, and is that justified), correct visual hierarchy (does the most
important number/word actually look most important — NN/g: Aesthetic and
Minimalist Design / visual hierarchy), weight tokens rendering as intended (a
"semibold" resolving to "normal" in the real data is a bug, not a style
choice — catch this from the raw data, not the screenshot), and reasonable
line-height for the content. Flag inline text mixing 3+ sizes/weights in one
sentence as at minimum borderline, citing the relevant heuristic.

### 2. Spacing
Check: consistent rhythm (multiples of a base unit vs. arbitrary pixel
values), even/intentional padding within cards and between sections, and
whether proximity signals relationship correctly (related elements closer
together than unrelated ones — Gestalt proximity, referenced in NN/g's
grouping guidance).

### 3. Icon style & backgrounds
Check: consistent stroke weight, fill style (outline vs. filled), corner
treatment, and size across the screen. Consistent icon background shape
(circle/square/none) for the same semantic role. A single mismatched icon
style among a set violates consistency/standards (NN/g: Consistency and
Standards) — flag it even if each icon individually looks fine.

### 4. Every component
Check: are visually-identical elements actually the same component instance
or separately-built one-offs that will drift? Do repeated patterns (cards,
list rows, buttons) behave and look identically wherever they repeat
(Consistency and Standards)? Are interactive components meeting expected
states (hover/pressed/disabled) where the pattern requires it?

### 5. Content & copy
Check: is the information shown correct and coherent (numbers, labels, T&C
text, grammar, capitalization, tone)? Is there a clearer/more standard way to
format it (currency, dates, pluralization)? Where the pattern is
e-commerce-specific (pricing display, discount framing, form labels), check
for a relevant Baymard finding via web search before asserting a "better way."

**Also always check copy against two references, not just internal
consistency:**
- **Brand language fit** — does the copy's tone, vocabulary, and voice match
  the brand's established language (e.g. playful vs. clinical, formal vs.
  casual, the specific terms the brand uses for things like "cart" vs. "bag",
  "order" vs. "purchase")? Flag copy that reads off-brand, and suggest
  specific replacement wording.
- **Fit to the page/content it's describing** — does the copy accurately and
  clearly describe what's actually on the page (e.g. a CTA that says
  "Continue" when the next step is actually "Pay now"; a header that
  promises something the section below doesn't deliver; jargon the target
  content doesn't warrant)? Flag mismatches and suggest tighter, more
  accurate wording.
- Suggesting a copy change here is always a **suggestion, not a directive**
  — say what you'd change and why, but note the final call is the user's.
  Never present a copy suggestion as though it must be adopted.

### 6. Information architecture (always checked)
This check always runs, regardless of what else the user asked for. Assess:
- **Is the information organized in a pattern that's easy for the user to
  understand?** — sequence, grouping, and labeling should match the user's
  likely mental model and task (NN/g: Match Between System and the Real
  World; Recognition Rather Than Recall).
- **Is anything competing for attention that shouldn't be** (multiple
  elements all styled as "most important")?
- **Is anything buried that should be more prominent, or shown that could be
  cut/collapsed** (e.g. into an FAQ/accordion) — ground this in NN/g's
  Minimalist Design or a Baymard finding on progressive disclosure /
  information density if one applies.
- **Always end this section with concrete suggestions**: if a better order,
  grouping, or flow exists, say what it is and which finding supports it —
  don't just flag the problem.

### 7. UX laws check (only report violations)
Check the screen against this fixed list of UX laws. **Do not force all 12
into the report** — only include a row for a law if the screen actually
violates or borderline-violates it. For each violation, keep the finding to
one line (rarely two) stating: which law, where on screen, and one concrete
suggestion to fix it. **Critical constraint: a fix suggested for one law must
not undo compliance with another law already noted as fine elsewhere in the
audit** — check for this conflict before finalizing a suggestion, and if a
genuine tension exists (e.g. Hick's Law wants fewer choices shown, but Miller's
Law grouping already handles the load well), say so explicitly rather than
suggesting a fix that would trade one violation for a new one.

The 12 laws to check against:
1. **Fitts's Law** — are tap/click targets sized and positioned for how easy/
   fast they should be to hit (bigger + closer to current focus = faster)?
2. **Hick's Law** — does more choice at one decision point increase time to
   decide more than the content justifies?
3. **Miller's Law** — are related items grouped into chunks (~7±2) rather
   than dumped as one long ungrouped list?
4. **Jakob's Law** — does the pattern deviate from what users already expect
   from other common experiences, without a strong reason?
5. **Gestalt principles** — do proximity/similarity/continuity/closure
   actually signal the intended grouping/relationship (this can overlap
   with the Spacing dimension — cite here only if it's specifically a
   Gestalt-law violation, not a general spacing inconsistency)?
6. **Peak-End Rule** — does the flow's most intense moment or its final step
   leave the wrong impression (e.g. an ugly/confusing final confirmation
   screen after an otherwise good flow)?
7. **Serial Position Effect** — are the most important items in a list
   buried in the middle rather than placed first or last, where recall is
   strongest?
8. **Von Restorff Effect (Isolation Effect)** — does the one thing that
   should stand out (primary CTA, key price) actually look distinct, or does
   it blend in / do too many things compete to stand out?
9. **Zeigarnik Effect** — for multi-step flows, is incomplete/in-progress
   status made visible (progress bar, saved-step indicator) so the user
   feels pulled to finish, or is progress invisible?
10. **Aesthetic-Usability Effect** — is a genuinely broken/confusing
    interaction being masked by attractive visuals in a way that risks the
    real usability problem going unnoticed? (Flag as a caution, not as
    permission to deprioritize the underlying bug.)
11. **Tesler's Law (Conservation of Complexity)** — has inherent complexity
    been pushed onto the user (many manual steps/fields) instead of being
    absorbed by the system/design (smart defaults, auto-detection)?
12. **Postel's Law** — is input handling strict/brittle where it should be
    lenient (e.g. rigid formatting requirements on a field that could
    normalize input instead), while output/display stays clear and precise?

### 8. Accessibility (W3C / WAI — WCAG)
Check the screen against WCAG success criteria via W3C/WAI guidance (use
`web_search` to confirm exact criterion numbers/thresholds rather than
asserting from memory). At minimum, check:
- **Color contrast** — text vs. background, and non-text UI elements (icons,
  input borders) vs. their background, against the applicable WCAG contrast
  criterion.
- **Touch/click target size** — minimum target size and spacing between
  adjacent targets.
- **Color as the only signal** — is meaning (error, success, required field)
  conveyed by color alone with no icon/text backup?
- **Text alternatives** — icons or images conveying meaning without a visible
  text label or equivalent (relevant to what's inspectable from the Figma
  layer names/structure — flag if unclear, note this is a partial check since
  full alt-text auditing needs the live implementation).
- **Focus/state visibility** — where interactive states are shown in the
  design, do they provide a visible, sufficiently distinct focus/selected
  state?
- Cite the exact WCAG success criterion (name + number, e.g. "WCAG 2.2 —
  1.4.3 Contrast (Minimum)") for every finding. If you can't confirm a real
  criterion via search, don't report the finding as an accessibility
  violation — move it to unverified observations instead.

## Step 3 — Report format

Produce a single markdown file. Use this structure:

```
# UX Design Audit — [screen name]
Node: `[node id]` · File: [file name]

## Verdict
[1-2 sentence overall read: what's solid, what needs attention before ship/handoff]

---

## 1. Typography
| Element | What's used | Right or wrong | Grounded in | Notes |
|---|---|---|---|---|

## 2. Spacing
| Element | What's used | Right or wrong | Grounded in | Notes |
|---|---|---|---|---|

## 3. Icon Style & Backgrounds
| Element | What's used | Right or wrong | Grounded in | Notes |
|---|---|---|---|---|

## 4. Every Component
| Element | What's used | Right or wrong | Grounded in | Notes |
|---|---|---|---|---|

## 5. Content & Copy
| Element | What's used | Right or wrong | Grounded in | Notes |
|---|---|---|---|---|

## 6. Information Architecture
| What | Current pattern | Right or wrong | Grounded in | Suggested improvement |
|---|---|---|---|---|

## 7. UX Laws
[Only laws actually violated/borderline — omit this table entirely (write
"No laws violated" instead) if none apply]
| Law | Where on screen | Issue (1 line) | Suggested fix (1 line) |
|---|---|---|---|

## 8. Accessibility (W3C/WAI)
| Element | Issue | WCAG criterion | Right or wrong | Suggested fix |
|---|---|---|---|---|

---

## Priority fixes
[Numbered, ranked list — the handful of things to fix first, pulled from
whichever findings above are 🔴, regardless of which section they're in]

## Confidence & scope
[What was verified against real Figma data and named research vs. what's an
unverified observation not tied to a specific heuristic/finding]
```

- Use 🔴 (wrong / needs fixing), 🟡 (borderline / worth reconsidering), ✅
  (right / no issue) in the "Right or wrong" column.
- The **Grounded in** column (or equivalent column in sections 7/8) is
  mandatory on every row — name the exact NN/g heuristic, Baymard finding,
  Growth.Design case study, WCAG criterion, or UX law (with source link if
  from a web search). No row should say "best practice" or "convention" with
  nothing more specific.
- Skip a dimension's findings only by writing "No notable findings" as the
  single row — this shows the dimension was actually checked, not omitted.
  Section 6 (IA) and Section 8 (Accessibility) are never skipped even if
  there are no violations — write the assessment either way, findings or
  not. Section 7 (UX laws) is the one exception: if genuinely no law is
  violated, write "No laws violated" instead of an empty table — don't force
  a row for every law just to fill the table.
- For copy suggestions in Section 5, always phrase as a suggestion ("Consider
  changing X to Y because...") never as an instruction — the user decides
  whether to apply it.
- Save the file to `/mnt/user-data/outputs/[Screen-Name]-UX-Design-Audit.md`
  and present it.

## Honesty requirements

- **No hypotheses.** If you can't cite a specific NN/g heuristic, Baymard
  finding, Growth.Design case study, WCAG criterion, or named UX law for a
  point, it doesn't go in a table row. Move it to a clearly separate
  "Unverified observations" note below the tables if you still think it's
  worth flagging, and label it as your own opinion, not research.
- **Don't force UX-law or accessibility findings to exist.** These two
  dimensions are the most tempting to pad — resist it. A clean pass on both
  is a legitimate, useful result.
- **Copy suggestions are advisory only** — never phrase a Section 5 brand/
  content-fit finding as a required fix; the "Right or wrong" column can
  still say 🟡/🔴, but the accompanying note stays suggestion-toned.
- **Don't manufacture findings.** A genuinely clean dimension is a valid,
  useful result — say so plainly.
- **Cite the real value, not a guess** — pull weights/sizes/spacing from the
  Figma design context output, never from eyeballing the screenshot.
- **Separate hard bugs from taste calls.** A token resolving to the wrong
  value, or a broken component instance, is a fact. "This copy could be
  tighter" is a judgment call, but still needs a named heuristic behind it —
  phrase each finding so the reader can tell fact from interpretation.
- **This is not a token-compliance audit.** If you notice an obvious
  off-token value, you can mention it in passing, but don't turn this into a
  full `ui-audit` pass — recommend running that skill too if thorough DS
  compliance is also wanted.
