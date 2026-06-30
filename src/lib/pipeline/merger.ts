/**
 * Deterministic merge of CSV and PDF evidence into canonical fields.
 *
 * Policy (no randomness, no model-based judgment):
 *  - name:    longer valid name wins; ties → recruiter_csv
 *  - email:   valid recruiter wins; else valid resume
 *  - phone:   valid recruiter wins; else valid resume
 *  - country: recruiter_csv first; else resume
 *  - company: prefer source with newest dated evidence; else recruiter_csv
 *  - title:   recruiter_csv first; else resume
 *  - skills:  union, canonicalized + deduplicated
 *  - experience / education: resume-only
 */
import type {
  EducationItem,
  ExperienceItem,
  ExtractedRecord,
  FieldEvidence,
  MergeDecision,
  ResolvedField,
} from "./types";

interface MergeOutput {
  fullName: ResolvedField<string>;
  email: ResolvedField<string>;
  phone: ResolvedField<string>;
  country: ResolvedField<string>;
  currentCompany: ResolvedField<string>;
  currentTitle: ResolvedField<string>;
  skills: ResolvedField<string[]>;
  experience: ResolvedField<ExperienceItem[]>;
  education: ResolvedField<EducationItem[]>;
  decisions: MergeDecision[];
}

function present<T>(...xs: (FieldEvidence<T> | undefined)[]): FieldEvidence<T>[] {
  return xs.filter((x): x is FieldEvidence<T> => x !== undefined);
}

function decide<T>(
  field: string,
  candidates: FieldEvidence<T>[],
  pickIdx: number,
  reason: string,
  kind: MergeDecision["kind"],
): { resolved: ResolvedField<T>; decision: MergeDecision } {
  const chosen = candidates[pickIdx] ?? null;
  const confidence = chosen ? chosen.baseConfidence : 0;
  return {
    resolved: {
      value: chosen ? chosen.value : null,
      confidence,
      chosen,
      candidates,
      reason,
    },
    decision: {
      field,
      inputs: candidates.map((c) => ({ source: c.source, value: c.value, raw: c.raw })),
      selected: { source: chosen?.source ?? null, value: chosen?.value ?? null },
      reason,
      confidence,
      kind,
    },
  };
}

function pickByPolicy<T>(
  field: string,
  csv: FieldEvidence<T> | undefined,
  pdf: FieldEvidence<T> | undefined,
  prefer: "csv-first" | "pdf-first",
  agreementBonus = 0.02,
  conflictPenalty = 0.1,
): { resolved: ResolvedField<T>; decision: MergeDecision } {
  const cands = present(csv, pdf);
  if (cands.length === 0) {
    return {
      resolved: { value: null, confidence: 0, chosen: null, candidates: [], reason: "no evidence" },
      decision: {
        field,
        inputs: [],
        selected: { source: null, value: null },
        reason: "no evidence from either source",
        confidence: 0,
        kind: "single-source",
      },
    };
  }
  if (cands.length === 1) {
    return decide(field, cands, 0, `only ${cands[0].source} provided this field`, "single-source");
  }
  // Two candidates: csv and pdf.
  const a = csv!;
  const b = pdf!;
  const equal = JSON.stringify(a.value) === JSON.stringify(b.value);
  if (equal) {
    const idx = prefer === "csv-first" ? 0 : 1;
    const r = decide(
      field,
      [a, b],
      idx === 0 ? 0 : 1,
      "both sources agree; applied agreement bonus",
      "agreement",
    );
    r.resolved.confidence = Math.min(1, r.resolved.confidence + agreementBonus);
    r.decision.confidence = r.resolved.confidence;
    return r;
  }
  // Conflict: apply policy preference and penalty.
  const idx = prefer === "csv-first" ? 0 : 1;
  const r = decide(
    field,
    [a, b],
    idx,
    `conflict between sources; policy preferred ${cands[idx].source}`,
    "conflict",
  );
  r.resolved.confidence = Math.max(0, r.resolved.confidence - conflictPenalty);
  r.decision.confidence = r.resolved.confidence;
  return r;
}

function pickEmail(
  csv: FieldEvidence<string> | undefined,
  pdf: FieldEvidence<string> | undefined,
): { resolved: ResolvedField<string>; decision: MergeDecision } {
  // "valid" means we kept it through normalization, signaled by baseConfidence > 0.6.
  if (csv && csv.baseConfidence >= 0.8) return pickByPolicy("email", csv, pdf, "csv-first");
  if (pdf && pdf.baseConfidence >= 0.8) return pickByPolicy("email", csv, pdf, "pdf-first");
  return pickByPolicy("email", csv, pdf, "csv-first");
}

function pickName(
  csv: FieldEvidence<string> | undefined,
  pdf: FieldEvidence<string> | undefined,
): { resolved: ResolvedField<string>; decision: MergeDecision } {
  const cands = present(csv, pdf);
  if (cands.length < 2) return pickByPolicy("fullName", csv, pdf, "csv-first");
  // Prefer "more complete" name: more whitespace-separated tokens, then longer.
  const tokens = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const a = csv!;
  const b = pdf!;
  const aScore = tokens(a.value) * 100 + a.value.length;
  const bScore = tokens(b.value) * 100 + b.value.length;
  if (aScore === bScore || a.value.toLowerCase() === b.value.toLowerCase()) {
    return pickByPolicy("fullName", csv, pdf, "csv-first");
  }
  const winner = aScore >= bScore ? 0 : 1;
  return decide(
    "fullName",
    [a, b],
    winner,
    "chose more complete name (more tokens / longer)",
    "conflict",
  );
}

function pickCompany(
  csv: FieldEvidence<string> | undefined,
  pdf: FieldEvidence<string> | undefined,
  pdfExperience: FieldEvidence<ExperienceItem>[],
): { resolved: ResolvedField<string>; decision: MergeDecision } {
  // Find newest dated company from resume experience.
  const newest = [...pdfExperience].sort((a, b) => {
    const score = (e?: string) => (e === "present" ? 9e9 : Number((e ?? "0000-00").replace("-", "")));
    return score(b.value.endDate) - score(a.value.endDate);
  })[0];
  const cands = present(csv, pdf);
  if (cands.length === 0) {
    return {
      resolved: { value: null, confidence: 0, chosen: null, candidates: [], reason: "no evidence" },
      decision: {
        field: "currentCompany",
        inputs: [],
        selected: { source: null, value: null },
        reason: "no evidence",
        confidence: 0,
        kind: "single-source",
      },
    };
  }
  if (cands.length === 1) {
    return decide(
      "currentCompany",
      cands,
      0,
      `only ${cands[0].source} provided this field`,
      "single-source",
    );
  }
  if (csv!.value === pdf!.value) {
    const r = decide("currentCompany", [csv!, pdf!], 0, "both sources agree", "agreement");
    r.resolved.confidence = Math.min(1, r.resolved.confidence + 0.02);
    r.decision.confidence = r.resolved.confidence;
    return r;
  }
  if (newest && newest.value.endDate) {
    // Resume has dated evidence → prefer resume.
    const r = decide(
      "currentCompany",
      [csv!, pdf!],
      1,
      `resume has dated evidence (most recent: ${newest.value.endDate}); preferred resume`,
      "conflict",
    );
    r.resolved.confidence = Math.max(0, r.resolved.confidence - 0.1);
    r.decision.confidence = r.resolved.confidence;
    return r;
  }
  const r = decide(
    "currentCompany",
    [csv!, pdf!],
    0,
    "no dated evidence on resume; policy fallback to recruiter_csv",
    "conflict",
  );
  r.resolved.confidence = Math.max(0, r.resolved.confidence - 0.1);
  r.decision.confidence = r.resolved.confidence;
  return r;
}

function unionSkills(
  csvSkills: FieldEvidence<string>[],
  pdfSkills: FieldEvidence<string>[],
): { resolved: ResolvedField<string[]>; decision: MergeDecision; dedupRemoved: number } {
  const all = [...csvSkills, ...pdfSkills];
  const byKey = new Map<string, FieldEvidence<string>>();
  let removed = 0;
  for (const s of all) {
    const key = s.value.toLowerCase();
    if (byKey.has(key)) {
      removed += 1;
      const existing = byKey.get(key)!;
      // Promote agreement: bump confidence if from both sources.
      if (existing.source !== s.source) {
        existing.baseConfidence = Math.min(1, existing.baseConfidence + 0.02);
      }
    } else {
      byKey.set(key, { ...s });
    }
  }
  const final = [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value));
  const values = final.map((f) => f.value);
  const confidence =
    final.length > 0 ? final.reduce((s, f) => s + f.baseConfidence, 0) / final.length : 0;
  return {
    resolved: {
      value: values,
      confidence,
      chosen: null,
      candidates: final,
      reason: `union of ${csvSkills.length} CSV + ${pdfSkills.length} resume skills; ${removed} duplicates removed`,
    },
    decision: {
      field: "skills",
      inputs: all.map((s) => ({ source: s.source, value: s.value, raw: s.raw })),
      selected: { source: null, value: values },
      reason: `union + canonical dedup (${removed} dupes removed)`,
      confidence,
      kind: "union",
    },
    dedupRemoved: removed,
  };
}

export function mergeRecords(
  csv: ExtractedRecord | null,
  pdf: ExtractedRecord | null,
): MergeOutput & { duplicateSkillsRemoved: number } {
  const decisions: MergeDecision[] = [];
  const push = <T,>(r: { resolved: ResolvedField<T>; decision: MergeDecision }) => {
    decisions.push(r.decision);
    return r.resolved;
  };

  const fullName = push(pickName(csv?.fullName, pdf?.fullName));
  const email = push(pickEmail(csv?.email, pdf?.email));
  const phone = push(pickByPolicy("phone", csv?.phone, pdf?.phone, "csv-first"));
  const country = push(pickByPolicy("country", csv?.country, pdf?.country, "csv-first"));
  const currentCompany = push(
    pickCompany(csv?.currentCompany, pdf?.currentCompany, pdf?.experience ?? []),
  );
  const currentTitle = push(pickByPolicy("currentTitle", csv?.currentTitle, pdf?.currentTitle, "csv-first"));

  const skillsResult = unionSkills(csv?.skills ?? [], pdf?.skills ?? []);
  decisions.push(skillsResult.decision);
  const skills = skillsResult.resolved;

  const expEv = pdf?.experience ?? [];
  const experience: ResolvedField<ExperienceItem[]> = {
    value: expEv.map((e) => e.value),
    confidence: expEv.length > 0 ? expEv.reduce((s, e) => s + e.baseConfidence, 0) / expEv.length : 0,
    chosen: null,
    candidates: expEv,
    reason: "resume is the only authoritative source for work history",
  };
  decisions.push({
    field: "experience",
    inputs: expEv.map((e) => ({ source: e.source, value: e.value, raw: e.raw })),
    selected: { source: "resume_pdf", value: experience.value },
    reason: "resume-only by policy",
    confidence: experience.confidence,
    kind: "single-source",
  });

  const eduEv = pdf?.education ?? [];
  const education: ResolvedField<EducationItem[]> = {
    value: eduEv.map((e) => e.value),
    confidence: eduEv.length > 0 ? eduEv.reduce((s, e) => s + e.baseConfidence, 0) / eduEv.length : 0,
    chosen: null,
    candidates: eduEv,
    reason: "resume is the only authoritative source for education",
  };
  decisions.push({
    field: "education",
    inputs: eduEv.map((e) => ({ source: e.source, value: e.value, raw: e.raw })),
    selected: { source: "resume_pdf", value: education.value },
    reason: "resume-only by policy",
    confidence: education.confidence,
    kind: "single-source",
  });

  return {
    fullName,
    email,
    phone,
    country,
    currentCompany,
    currentTitle,
    skills,
    experience,
    education,
    decisions,
    duplicateSkillsRemoved: skillsResult.dedupRemoved,
  };
}
