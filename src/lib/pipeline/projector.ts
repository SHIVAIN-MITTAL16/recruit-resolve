/**
 * Applies a user-supplied projection config to the canonical record.
 * The canonical record itself is never mutated — the UI shows both views.
 */
import type { CanonicalCandidate, ProjectionConfig, ResolvedField } from "./types";
import { ALL_CANONICAL_FIELDS } from "./types";

export function project(
  canonical: CanonicalCandidate,
  provenance: Record<string, ResolvedField<unknown>>,
  cfg: ProjectionConfig,
): Record<string, unknown> {
  const allowed = new Set<string>(
    cfg.includeFields.length > 0 ? cfg.includeFields : ALL_CANONICAL_FIELDS,
  );
  for (const f of cfg.excludeFields) allowed.delete(f);

  const out: Record<string, unknown> = {};
  for (const field of ALL_CANONICAL_FIELDS) {
    if (!allowed.has(field)) continue;
    const outKey = cfg.rename[field] ?? field;
    const value = (canonical as Record<string, unknown>)[field];
    if (cfg.hideConfidence && cfg.hideProvenance) {
      out[outKey] = value;
    } else {
      const prov = provenance[field];
      const wrapped: Record<string, unknown> = { value };
      if (!cfg.hideConfidence && prov) wrapped.confidence = Number(prov.confidence.toFixed(3));
      if (!cfg.hideProvenance && prov) {
        wrapped.provenance = {
          source: prov.chosen?.source ?? null,
          method: prov.chosen?.method ?? null,
          normalizations: prov.chosen?.normalizations ?? [],
          reason: prov.reason,
        };
      }
      out[outKey] = wrapped;
    }
  }
  return out;
}
