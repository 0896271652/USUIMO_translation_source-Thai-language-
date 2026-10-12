# Translation change report

This optional report turns Git history into a language-specific list of translation tasks. It is isolated from the game data packaging workflow: it only reads repository contents and publishes a static GitHub Pages artifact.

## Local preview

```bash
node tools/generate-translation-report.mjs
python3 -m http.server 4173 --directory translation-report-dist
```

Then open `http://localhost:4173/?lang=KR`.

The published selector includes all community-maintained language folders. EN is the source language, while CN, TW, and JP are maintained as official languages and are intentionally excluded.

## Two separate lists

The default **Missing translations** list compares the English and target-language files at the current repository revision. It does not use `baseCommit` to decide which text is missing. Missing keys, null values and blank translations are `MISSING`; incompatible translation types are `CONFLICT`. Newly added and long-standing missing text are treated alike. Items disappear automatically after a nonblank, compatible translation is merged.

**Source changes to review** compares English at the language's `baseCommit` with current English and shows the current translation alongside it. `EN CHANGED` means the source changed and needs review; it does not assert that a translation is missing or outdated. `OBSOLETE` means the source was deleted but the target still contains text. Translation edits do not automatically dismiss source-change reminders.

The lists are independent. A changed source entry with no translation can appear in both lists, so their totals must not be added as a unique task count. JSON downloads contain both lists under `sections.coverage` and `sections.review` (schema version 2).

## Language checkpoints

Each language in `translation-report.config.json` retains its existing `baseCommit` for source review only. Advance it after all relevant source changes through that revision have been reviewed. A partial translation update or a new report build is not a reason to advance the entire language checkpoint. Updating a checkpoint never changes the missing-translation list for the same current files.

To add another language, add its folder code and review checkpoint to `translation-report.config.json` and include its data path in the Pages workflow triggers.

## Report rules

- JSON objects are compared by key, independent of key order or formatting.
- Arrays are treated as atomic translation units to avoid index-shift errors.
- Strings and arrays containing only strings are compatible translation text, allowing language-specific line wrapping.
- Typographic-only English edits such as curly/straight quotes, full-width/half-width punctuation, equivalent dashes, ellipses, separator punctuation, adjacent spacing, and line wrapping are ignored for source review.
- Empty source text, empty objects, booleans, numbers, and other non-translatable metadata are not reported as translation tasks.
- A nonblank target value is considered present; the report does not assess translation quality or determine whether copied English has been translated.
- Deleted English entries are reported for review but never removed from translation files.
- The report generator never writes to `data/`.
- Pushes affecting English or configured community language files automatically rebuild the Pages report.

## Deployment safety

The Pages workflow has read-only repository content permission. Its only write scopes are the dedicated GitHub Pages deployment permissions. Generated files are uploaded as a Pages artifact and are not committed back to the repository.
