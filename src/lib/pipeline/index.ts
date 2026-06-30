/**
 * Pipeline orchestrator. Wires parser → extractor → merger → validator → projector.
 *
 * The orchestrator owns side-effect-free composition: every stage is a pure
 * function over its inputs, and we accumulate warnings + log entries to
 * power the engineering report.
 */
import { parseCsv, parsePdf } from "./parser";
import { extractFromCsv, extractFromPdf } from "./extractor";
import { mergeRecords } from "./merger";
import { validateCanonical } from "./validator";
import { project } from "./projector";
import { Logger } from "./logger";
import type {
  CanonicalCandidate,
  EngineeringReport,
  PipelineResult,
  ProjectionConfig,
  ResolvedField,
} from "./types";
import { DEFAULT_PROJECTION } from "./types";

export interface PipelineInput {
  csv?: File;
  pdf?: File;
  config?: ProjectionConfig;
}

export type StageName =
  | "parse_csv"
  | "parse_pdf"
  | "extract"
  | "normalize"
  | "merge"
  | "confidence"
  | "validate"
  | "project";

export interface StageEvent {
  stage: StageName;
  status: "start" | "done";
  detail?: string;
}

export async function runPipeline(
  input: PipelineInput,
  onStage?: (e: StageEvent) => void,
): Promise<PipelineResult> {
  const cfg = input.config ?? DEFAULT_PROJECTION;
  const log = new Logger();
  const startedAt = new Date();
  const warnings: string[] = [];

  const step = async <T>(stage: StageName, fn: () => Promise<T> | T, detail?: string) => {
    onStage?.({ stage, status: "start", detail });
    const v = await fn();
    onStage?.({ stage, status: "done", detail });
    return v;
  };

  const csvParsed = input.csv
    ? await step("parse_csv", () => parseCsv(input.csv!))
    : { rows: [], headers: [], warnings: [], bytes: 0 };
  warnings.push(...csvParsed.warnings);
  log.info(`parsed CSV: ${csvParsed.rows.length} rows`);

  const pdfParsed = input.pdf
    ? await step("parse_pdf", () => parsePdf(input.pdf!))
    : { text: "", pages: 0, warnings: [], bytes: 0 };
  warnings.push(...pdfParsed.warnings);
  log.info(`parsed PDF: ${pdfParsed.pages} pages`);

  // Identity hint: pull an email out of the PDF to disambiguate CSV row.
  const pdfEmailHint = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(pdfParsed.text)?.[0];

  const extracted = await step("extract", () => {
    const csvX = extractFromCsv(csvParsed, pdfEmailHint);
    const pdfX = extractFromPdf(pdfParsed);
    warnings.push(...csvX.warnings, ...pdfX.warnings);
    return { csv: csvX.record, pdf: pdfX.record };
  });

  await step("normalize", () => log.info("normalization is fused with extraction"));

  const merged = await step("merge", () => mergeRecords(extracted.csv, extracted.pdf));
  await step("confidence", () => log.info("confidence applied via merge policy bonuses/penalties"));

  const canonical: CanonicalCandidate = {
    fullName: merged.fullName.value ?? "Unknown",
    email: merged.email.value,
    phone: merged.phone.value,
    country: merged.country.value,
    currentCompany: merged.currentCompany.value,
    currentTitle: merged.currentTitle.value,
    skills: merged.skills.value ?? [],
    experience: merged.experience.value ?? [],
    education: merged.education.value ?? [],
  };

  const validation = await step("validate", () => validateCanonical(canonical));
  if (!validation.ok) {
    for (const i of validation.issues) log.warn(`validation:${i}`);
  }

  const provenance: Record<string, ResolvedField<unknown>> = {
    fullName: merged.fullName as ResolvedField<unknown>,
    email: merged.email as ResolvedField<unknown>,
    phone: merged.phone as ResolvedField<unknown>,
    country: merged.country as ResolvedField<unknown>,
    currentCompany: merged.currentCompany as ResolvedField<unknown>,
    currentTitle: merged.currentTitle as ResolvedField<unknown>,
    skills: merged.skills as ResolvedField<unknown>,
    experience: merged.experience as ResolvedField<unknown>,
    education: merged.education as ResolvedField<unknown>,
  };

  const projection = await step("project", () => project(canonical, provenance, cfg));

  const finishedAt = new Date();

  // Tally invalids by re-running validation on raw evidence values.
  const invalidEmails = warnings
    .filter((w) => w.includes(":invalid-email:"))
    .map((w) => w.split(":invalid-email:")[1]);
  const invalidPhones = warnings
    .filter((w) => w.includes(":invalid-phone:"))
    .map((w) => w.split(":invalid-phone:")[1]);

  const fieldsExtracted = countFields(extracted.csv) + countFields(extracted.pdf);
  const fieldsNormalized = countNormalizations(merged);
  const mergeConflicts = merged.decisions.filter((d) => d.kind === "conflict").length;
  const mergeAgreements = merged.decisions.filter((d) => d.kind === "agreement").length;

  const report: EngineeringReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    inputs: {
      csv: { provided: !!input.csv, rows: csvParsed.rows.length, bytes: csvParsed.bytes },
      pdf: { provided: !!input.pdf, pages: pdfParsed.pages, bytes: pdfParsed.bytes },
    },
    counts: {
      fieldsExtracted,
      fieldsNormalized,
      duplicateSkillsRemoved: merged.duplicateSkillsRemoved,
      mergeConflicts,
      mergeAgreements,
    },
    warnings,
    validation,
    invalid: { emails: invalidEmails, phones: invalidPhones },
  };

  return {
    canonical,
    provenance,
    decisions: merged.decisions,
    report,
    validation,
    projection,
  };
}

function countFields(rec: import("./types").ExtractedRecord | null): number {
  if (!rec) return 0;
  let n = 0;
  if (rec.fullName) n++;
  if (rec.email) n++;
  if (rec.phone) n++;
  if (rec.country) n++;
  if (rec.currentCompany) n++;
  if (rec.currentTitle) n++;
  n += rec.skills.length + rec.experience.length + rec.education.length;
  return n;
}

function countNormalizations(merged: ReturnType<typeof mergeRecords>): number {
  let n = 0;
  for (const r of [
    merged.fullName,
    merged.email,
    merged.phone,
    merged.country,
    merged.currentCompany,
    merged.currentTitle,
  ]) {
    if (r.chosen && r.chosen.normalizations.length > 0) n += r.chosen.normalizations.length;
  }
  for (const s of merged.skills.candidates) n += s.normalizations.length;
  return n;
}
