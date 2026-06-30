# Candidate Data Transformer

A deterministic ETL pipeline that ingests a recruiter CSV and a resume PDF and emits a single canonical candidate profile with field-level **provenance**, **confidence**, and **explainable merge decisions**.

The pipeline runs entirely in the browser — no upload server, no external API calls — so outputs are reproducible byte-for-byte given the same inputs and projection config.

## Architecture

```text
File inputs
    │
    ▼
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌────────┐
│  parser  │ -> │ extractor  │ -> │  normalizer  │ -> │ merger │
└──────────┘    └────────────┘    └──────────────┘    └────┬───┘
                                                            │
                                              ┌─────────────┴─────────────┐
                                              ▼                           ▼
                                       ┌────────────┐             ┌──────────────┐
                                       │ confidence │             │  validator   │
                                       └─────┬──────┘             └──────┬───────┘
                                             ▼                           ▼
                                       ┌──────────────────────────────────────┐
                                       │           projector (config)         │
                                       └──────────────────────────────────────┘
```

Every module has exactly one responsibility and is a pure function over its inputs.

| Module | Responsibility |
| --- | --- |
| `parser` | Reads CSV/PDF bytes into neutral structures. Never interprets fields. |
| `extractor` | Pulls candidate fields from each source, wraps them with `FieldEvidence`. |
| `normalizer` | Standardizes phones (E.164), emails (lowercase), dates (YYYY-MM), country aliases, skill canonical names. Returns the normalized value plus the steps applied. |
| `merger` | Resolves conflicts with deterministic policy. Emits `MergeDecision`s. |
| `confidence` | Base confidence per source, plus +bonus on agreement, -penalty on conflict. Folded into merger. |
| `validator` | Zod schema check; never throws. |
| `projector` | Applies runtime config (include/exclude/rename, hide confidence/provenance). Canonical model is never mutated. |

## Folder structure

```
src/
  lib/pipeline/
    types.ts          # Zod schemas + canonical types
    parser.ts         # CSV + PDF I/O
    extractor.ts      # CSV column + resume heuristic extraction
    normalizer.ts     # email/phone/name/country/skill/date normalization
    merger.ts         # deterministic merge policy
    confidence.ts     # (fused into merger; see below)
    validator.ts      # zod validation, non-throwing
    projector.ts      # runtime view config
    logger.ts         # leveled in-memory logger
    index.ts          # orchestrator
  components/
    pipeline-progress.tsx
    results-view.tsx
  routes/
    index.tsx         # upload + results UI
tests/
  normalizer.test.ts
  merger.test.ts
  validator_projector.test.ts
public/samples/
  recruiter.csv
  resume_aarav_sharma.pdf
```

## Merge policy

| Field | Rule |
| --- | --- |
| `fullName` | Pick the name with more whitespace-separated tokens; tie → CSV. |
| `email` | Valid recruiter wins, else valid resume; agreement → CSV + bonus. |
| `phone` | CSV first; resume on fallback. |
| `country` | CSV first. |
| `currentCompany` | If resume has dated experience, prefer resume (newest dated evidence); else CSV. |
| `currentTitle` | CSV first. |
| `skills` | Union of canonicalized skills; duplicates removed; cross-source skills get a small confidence bump. |
| `experience` / `education` | Resume-only. |

Every decision is captured as a `MergeDecision { field, inputs, selected, reason, kind, confidence }` and surfaced in the UI.

## Confidence model

- Base: `recruiter_csv = 0.95–0.98`, `resume_pdf = 0.80–0.90`.
- Agreement bonus: `+0.02`, capped at `1.0`.
- Conflict penalty: `-0.10`, floored at `0.0`.
- For unions (skills), confidence is the mean of the surviving evidence scores.

No randomness anywhere. Identical inputs → identical confidence values.

## Provenance

For every canonical field we keep:
- the chosen value and the candidate evidences from each source,
- the **method** that produced it (e.g. `csv.column:email`, `resume.regex:phone`, `resume.derived:current-company`),
- the **normalizations** applied in order (e.g. `whitespace:trim`, `case:lower`, `phone:E164`, `country:alias->United States`),
- the **reason** the chosen value won the merge.

## Running

```bash
bun install
bun run dev          # http://localhost:8080
bun run build        # production build
bunx vitest run      # unit tests
```

Open the app, click **Load sample inputs** in the header, and hit **Transform**.

## Configuration

The Projection Config card lets you, at runtime:
- whitelist canonical fields,
- hide `confidence` and `provenance` in the output JSON,
- (programmatically) rename fields via `ProjectionConfig.rename`.

Changes apply only to the output projection. The canonical model is immutable.

## Error handling

The pipeline never crashes on bad input. It reports issues through the Engineering Report:
missing or corrupted PDFs, malformed CSV rows, invalid emails / phones, schema validation failures, empty resumes, duplicate skills, conflicting companies. The UI shows them all in the Report tab.

## Testing

`tests/` covers the normalizer (email/phone/name/country/skill/date), the merger
(agreement bonus, conflict penalty, skill union/dedup, name completeness),
the validator (accepts good shapes, rejects bad), and the projector (include/rename).

```bash
bunx vitest run
```

## Tradeoffs

- **Browser-only.** Keeps the architecture honest (no upload state, no auth, deterministic). A Python/FastAPI version would need separate infra; the logic would be a one-to-one port.
- **Resume parsing is heuristic.** A full LLM-backed extractor would be more forgiving but non-deterministic, and we explicitly chose explainability over recall.
- **No fuzzy matching across CSV rows.** The CSV is assumed to be one candidate per row; identity disambiguation uses the resume's email if present.

## Future improvements

- Stream large CSVs row-by-row instead of buffering.
- Persist runs and diff two transforms.
- Pluggable skill registry (load from JSON).
- Optional LLM-assisted extractor behind a feature flag, with provenance recording the model + prompt hash.
