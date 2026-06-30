# Candidate Data Transformer

A deterministic ETL pipeline that ingests a recruiter CSV and a resume PDF, merges information from both sources, and produces a single canonical candidate profile with field-level **provenance**, **confidence**, and **explainable merge decisions**.

The entire pipeline runs locally in the browser—no backend server, database, or external AI APIs are required. Given the same inputs and configuration, the output is deterministic and reproducible.

---

# Features

- Deterministic ETL pipeline
- Browser-only execution
- CSV + Resume PDF ingestion
- Canonical candidate profile generation
- Explainable merge decisions
- Field-level provenance tracking
- Confidence scoring
- Runtime projection configuration
- Engineering report with warnings and validation
- Resume experience and education extraction
- Skill normalization and deduplication
- Regression-tested PDF extraction

---

# Architecture

```text
                 Recruiter CSV
                        │
                        │
                 Resume PDF
                        │
                        ▼
                  ┌──────────┐
                  │  Parser  │
                  └────┬─────┘
                       │
                       ▼
                 ┌────────────┐
                 │ Extractor  │
                 └────┬───────┘
                      │
                      ▼
                ┌─────────────┐
                │ Normalizer  │
                └────┬────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │ Merger + Confidence     │
        └──────────┬──────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   ┌────────────┐     ┌────────────┐
   │ Validator  │     │ Projector  │
   └─────┬──────┘     └─────┬──────┘
         │                  │
         └──────────┬───────┘
                    ▼
             Candidate UI
```

Each stage has a single responsibility and is implemented as a deterministic transformation.

---

# Pipeline Modules

| Module | Responsibility |
|---------|----------------|
| **parser** | Reads CSV and PDF files into neutral structures. |
| **extractor** | Extracts structured candidate information from CSV columns and resume text. |
| **normalizer** | Standardizes emails, phones, dates, countries, names and skills. |
| **merger** | Resolves conflicts using deterministic merge rules and computes confidence. |
| **validator** | Validates the canonical profile using Zod schemas. |
| **projector** | Applies runtime projection configuration without mutating the canonical model. |
| **logger** | Records pipeline events for the Engineering Report. |

---

# Project Structure

```text
src/
│
├── components/
│     pipeline-progress.tsx
│     results-view.tsx
│
├── lib/
│     pipeline/
│         parser.ts
│         extractor.ts
│         normalizer.ts
│         merger.ts
│         validator.ts
│         projector.ts
│         logger.ts
│         index.ts
│         types.ts
│
├── routes/
│     index.tsx
│
tests/
│     merger.test.ts
│     normalizer.test.ts
│     validator_projector.test.ts
│     pdf_extractor.test.ts
│
public/
└── samples/
      recruiter.csv
      resume_aarav_sharma.pdf
      resume_ananya_gupta.pdf
      resume_priya_singh.pdf
      resume_rohit_verma.pdf
      projection_default.json
      projection_hr_view.json
```

---

# Merge Policy

| Field | Merge Rule |
|---------|------------|
| Full Name | Prefer the more complete name; tie → recruiter CSV |
| Email | Prefer valid recruiter email, otherwise valid resume email |
| Phone | Prefer recruiter phone, otherwise resume phone |
| Country | Prefer recruiter country |
| Current Company | Derived from the most recent resume experience when available |
| Current Title | Uses the deterministic project merge policy |
| Skills | Union of normalized skills from both sources with duplicate removal |
| Experience | Resume-derived |
| Education | Resume-derived |

Every merge decision records:

- selected value
- competing evidence
- merge reason
- confidence score
- provenance

---

# Confidence Model

The confidence score is deterministic.

- Recruiter CSV evidence receives higher base confidence.
- Resume evidence receives slightly lower base confidence.
- Agreement between sources increases confidence.
- Conflicting values decrease confidence.
- Skill unions use the average confidence of surviving evidence.

There is no randomness in confidence calculation.

---

# Provenance

Every canonical field stores:

- selected value
- originating source
- extraction method
- normalization steps
- raw extracted value
- confidence score

Example methods include:

- `csv.column:email`
- `resume.regex:phone`
- `resume.section:experience`
- `resume.derived:current-company`

This enables complete traceability from output back to source evidence.

---

# Error Handling

The pipeline is designed to fail gracefully.

The Engineering Report captures issues such as:

- malformed CSV rows
- invalid emails
- invalid phone numbers
- schema validation failures
- empty resumes
- duplicate skills
- missing identity matches
- merge conflicts

Validation errors never crash the application.

---

# Sample Inputs

The repository includes four representative resumes:

- Aarav Sharma
- Rohit Verma
- Priya Singh
- Ananya Gupta

along with a recruiter CSV for deterministic testing.

---

# Running the Project

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build production bundle:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Open the application and click **Load Sample Inputs** to execute the pipeline with the included sample data.

---

# Testing

The project contains unit and regression tests covering:

- Email normalization
- Phone normalization
- Date normalization
- Country normalization
- Skill normalization
- Merge policy
- Confidence calculation
- Validator
- Projector
- PDF extraction
- Experience parsing
- Education parsing

Regression tests verify extraction across all included sample resumes.

---

# Configuration

Projection configuration supports:

- field inclusion/exclusion
- confidence visibility
- provenance visibility
- field renaming

Projection only changes the rendered output.

The canonical candidate profile remains immutable.

---

# Engineering Highlights

- Deterministic ETL architecture
- Explainable merge decisions
- Provenance-aware canonical model
- Browser-only execution
- Regression-tested parser
- Runtime configurable projections
- Structured validation pipeline

---

# Trade-offs

- Resume parsing is heuristic rather than AI-based to preserve determinism and explainability.
- The pipeline assumes one candidate per recruiter CSV row.
- OCR for scanned resumes is outside the current project scope.
- No fuzzy candidate matching is performed across recruiter records.

---

# Future Improvements

- OCR support for scanned PDFs
- Streaming support for very large CSV files
- Resume ranking and candidate scoring
- Pluggable skill taxonomy
- Multi-language resume support
- Optional AI-assisted extraction behind a feature flag while preserving provenance

---

# Technologies Used

- TypeScript
- React
- Vite
- Zod
- pdf-parse / unpdf
- Vitest
- Tailwind CSS
- shadcn/ui

---

# License

This project was developed as an engineering demonstrator for deterministic candidate data transformation and explainable data merging.