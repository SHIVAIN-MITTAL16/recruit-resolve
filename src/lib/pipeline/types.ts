/**
 * Canonical schemas for the candidate transformation pipeline.
 *
 * Every value that flows through merger / confidence / projector is shaped
 * by these types. The Zod schemas double as runtime validation and as the
 * source of truth for the engineering report.
 */
import { z } from "zod";

export type SourceName = "recruiter_csv" | "resume_pdf";

/** A single piece of evidence for a field, from one source. */
export interface FieldEvidence<T> {
  value: T;
  source: SourceName;
  /** How this value was obtained (e.g. "csv.column:email", "resume.regex:phone"). */
  method: string;
  /** Normalization steps applied, in order. Empty if value was used as-is. */
  normalizations: string[];
  /** Source-intrinsic confidence before merge adjustments (0..1). */
  baseConfidence: number;
  /** Optional raw value before normalization, for the provenance UI. */
  raw?: string;
}

/** A resolved field with provenance: the chosen value plus every contender.
 *  Candidates may be per-item evidence (skills/experience) so we leave them
 *  untyped — the UI introspects them generically. */
export interface ResolvedField<T> {
  value: T | null;
  confidence: number;
  chosen: FieldEvidence<T> | null;
  candidates: FieldEvidence<unknown>[];
  /** Human-readable reason the chosen value won. */
  reason: string;
}

export interface ExperienceItem {
  company: string;
  title?: string;
  startDate?: string; // ISO YYYY-MM
  endDate?: string; // ISO YYYY-MM or "present"
}

export interface EducationItem {
  institution: string;
  degree?: string;
  field?: string;
  endDate?: string;
}

/** What a single source contributes to the merge. */
export interface ExtractedRecord {
  source: SourceName;
  fullName?: FieldEvidence<string>;
  email?: FieldEvidence<string>;
  phone?: FieldEvidence<string>;
  country?: FieldEvidence<string>;
  currentCompany?: FieldEvidence<string>;
  currentTitle?: FieldEvidence<string>;
  skills: FieldEvidence<string>[];
  experience: FieldEvidence<ExperienceItem>[];
  education: FieldEvidence<EducationItem>[];
}

export const CanonicalCandidateSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  currentCompany: z.string().nullable(),
  currentTitle: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().optional(),
      field: z.string().optional(),
      endDate: z.string().optional(),
    }),
  ),
});

export type CanonicalCandidate = z.infer<typeof CanonicalCandidateSchema>;

/** The full result the UI consumes. */
export interface PipelineResult {
  canonical: CanonicalCandidate;
  /** Per-field provenance, keyed by canonical field name. */
  provenance: Record<string, ResolvedField<unknown>>;
  /** Merge decisions worth surfacing in the UI (conflicts + agreements). */
  decisions: MergeDecision[];
  report: EngineeringReport;
  /** Validation outcome — never throws; reports issues instead. */
  validation: { ok: boolean; issues: string[] };
  /** The user-projected view, after config is applied. */
  projection: Record<string, unknown>;
}

export interface MergeDecision {
  field: string;
  inputs: { source: SourceName; value: unknown; raw?: string }[];
  selected: { source: SourceName | null; value: unknown };
  reason: string;
  confidence: number;
  kind: "agreement" | "conflict" | "single-source" | "union";
}

export interface EngineeringReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputs: {
    csv: { provided: boolean; rows: number; bytes: number };
    pdf: { provided: boolean; pages: number; bytes: number };
  };
  counts: {
    fieldsExtracted: number;
    fieldsNormalized: number;
    duplicateSkillsRemoved: number;
    mergeConflicts: number;
    mergeAgreements: number;
  };
  warnings: string[];
  validation: { ok: boolean; issues: string[] };
  invalid: {
    emails: string[];
    phones: string[];
  };
}

export interface ProjectionConfig {
  /** Whitelist of canonical fields; empty means "include all". */
  includeFields: string[];
  /** Blacklist applied after includeFields. */
  excludeFields: string[];
  /** Map canonical field name -> output key. */
  rename: Record<string, string>;
  hideConfidence: boolean;
  hideProvenance: boolean;
}

export const DEFAULT_PROJECTION: ProjectionConfig = {
  includeFields: [],
  excludeFields: [],
  rename: {},
  hideConfidence: false,
  hideProvenance: false,
};

export const ALL_CANONICAL_FIELDS = [
  "fullName",
  "email",
  "phone",
  "country",
  "currentCompany",
  "currentTitle",
  "skills",
  "experience",
  "education",
] as const;
