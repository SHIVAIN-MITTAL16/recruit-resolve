/**
 * Zod-backed validation of the canonical record. Never throws — issues
 * are surfaced through the pipeline result for the UI to show inline.
 */
import { CanonicalCandidateSchema } from "./types";

export function validateCanonical(candidate: unknown): { ok: boolean; issues: string[] } {
  const result = CanonicalCandidateSchema.safeParse(candidate);
  if (result.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
  };
}
