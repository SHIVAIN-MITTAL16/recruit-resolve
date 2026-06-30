/**
 * Pulls candidate-relevant fields out of parsed CSV rows and resume text.
 * Each extracted value is wrapped in FieldEvidence so the merger and the
 * UI can trace it back to a source and a method.
 */
import type { CsvParseResult, PdfParseResult } from "./parser";
import type {
  EducationItem,
  ExperienceItem,
  ExtractedRecord,
  FieldEvidence,
} from "./types";
import {
  normalizeCompany,
  normalizeCountry,
  normalizeDate,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeSkill,
} from "./normalizer";

const EMAIL_RX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RX = /(\+?\d[\d\s().-]{7,}\d)/;

/** Case-insensitive column lookup with multiple acceptable aliases. */
function pick(row: Record<string, string>, ...keys: string[]): string | undefined {
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) lowered[k.toLowerCase()] = v;
  for (const k of keys) {
    const v = lowered[k.toLowerCase()];
    if (v && v.trim().length > 0) return v;
  }
  return undefined;
}

function ev<T>(
  value: T,
  source: "recruiter_csv" | "resume_pdf",
  method: string,
  normalizations: string[],
  baseConfidence: number,
  raw?: string,
): FieldEvidence<T> {
  return { value, source, method, normalizations, baseConfidence, raw };
}

/** CSV is the structured source; per-column confidence starts at 0.95. */
export function extractFromCsv(
  csv: CsvParseResult,
  identityEmail?: string,
): { record: ExtractedRecord | null; warnings: string[] } {
  const warnings = [...csv.warnings];
  if (csv.rows.length === 0) {
    return { record: null, warnings: [...warnings, "csv:no-rows"] };
  }

  // If we have an identity hint, prefer the row that matches it.
  let row = csv.rows[0];
  if (identityEmail) {
    const match = csv.rows.find((r) => {
      const e = pick(r, "email", "email_address", "e-mail");
      return e && e.trim().toLowerCase() === identityEmail.toLowerCase();
    });
    if (match) row = match;
  }
  if (csv.rows.length > 1 && !identityEmail) {
    warnings.push(`csv:multiple-rows(${csv.rows.length}); using first`);
  }

  const rawName = pick(row, "name", "full_name", "candidate_name", "fullname");
  const rawEmail = pick(row, "email", "email_address", "e-mail");
  const rawPhone = pick(row, "phone", "phone_number", "mobile", "contact");
  const rawCountry = pick(row, "country", "location_country", "nation");
  const rawCompany = pick(row, "company", "current_company", "employer");
  const rawTitle = pick(row, "title", "current_title", "role", "position");
  const rawSkills = pick(row, "skills", "skill_set", "tech");

  const record: ExtractedRecord = {
    source: "recruiter_csv",
    skills: [],
    experience: [],
    education: [],
  };

  const nameN = normalizeName(rawName);
  if (nameN.value) {
    record.fullName = ev(nameN.value, "recruiter_csv", "csv.column:name", nameN.steps, 0.95, rawName);
  }
  const emailN = normalizeEmail(rawEmail);
  if (emailN.value) {
    record.email = ev(emailN.value, "recruiter_csv", "csv.column:email", emailN.steps, emailN.valid ? 0.98 : 0.5, rawEmail);
  } else if (rawEmail) {
    warnings.push(`csv:invalid-email:${rawEmail}`);
  }
  const phoneN = normalizePhone(rawPhone);
  if (phoneN.value) {
    record.phone = ev(phoneN.value, "recruiter_csv", "csv.column:phone", phoneN.steps, 0.95, rawPhone);
  } else if (rawPhone) {
    warnings.push(`csv:invalid-phone:${rawPhone}`);
  }
  const countryN = normalizeCountry(rawCountry);
  if (countryN.value) {
    record.country = ev(countryN.value, "recruiter_csv", "csv.column:country", countryN.steps, 0.9, rawCountry);
  }
  const companyN = normalizeCompany(rawCompany);
  if (companyN.value) {
    record.currentCompany = ev(companyN.value, "recruiter_csv", "csv.column:company", companyN.steps, 0.9, rawCompany);
  }
  if (rawTitle) {
    const titleTrim = rawTitle.replace(/\s+/g, " ").trim();
    record.currentTitle = ev(titleTrim, "recruiter_csv", "csv.column:title", ["whitespace:collapse"], 0.85, rawTitle);
  }
  if (rawSkills) {
    for (const part of rawSkills.split(/[,;|]/)) {
      const n = normalizeSkill(part);
      if (n.value) {
        record.skills.push(ev(n.value, "recruiter_csv", "csv.column:skills", n.steps, 0.85, part));
      }
    }
  }
  return { record, warnings };
}

/**
 * Resume extraction is best-effort heuristics on a flat text blob.
 * We deliberately keep it small and inspectable rather than trying to be clever.
 */
export function extractFromPdf(pdf: PdfParseResult): {
  record: ExtractedRecord | null;
  warnings: string[];
} {
  const warnings = [...pdf.warnings];
  const text = pdf.text;
  if (!text || text.trim().length === 0) {
    return { record: null, warnings: [...warnings, "pdf:no-text"] };
  }

  const record: ExtractedRecord = {
    source: "resume_pdf",
    skills: [],
    experience: [],
    education: [],
  };

  // Name: first non-empty line that looks like a person's name.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const nameLine = lines.slice(0, 8).find((l) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(l));
  if (nameLine) {
    const n = normalizeName(nameLine);
    if (n.value) {
      record.fullName = ev(n.value, "resume_pdf", "resume.heuristic:first-name-line", n.steps, 0.8, nameLine);
    }
  }

  const emailMatch = text.match(EMAIL_RX);
  if (emailMatch) {
    const n = normalizeEmail(emailMatch[0]);
    if (n.value) {
      record.email = ev(n.value, "resume_pdf", "resume.regex:email", n.steps, 0.9, emailMatch[0]);
    } else {
      warnings.push(`pdf:invalid-email:${emailMatch[0]}`);
    }
  }
  const phoneMatch = text.match(PHONE_RX);
  if (phoneMatch) {
    const n = normalizePhone(phoneMatch[1]);
    if (n.value) {
      record.phone = ev(n.value, "resume_pdf", "resume.regex:phone", n.steps, 0.85, phoneMatch[1]);
    } else {
      warnings.push(`pdf:invalid-phone:${phoneMatch[1]}`);
    }
  }

  // Sectioned extraction. We look for section headers and split the body.
  const sections = splitSections(text);

  if (sections.skills) {
    const seen = new Set<string>();
    for (const part of sections.skills.split(/[,;|\n•·]/)) {
      const cleaned = part.replace(/^[-*•·\s]+/, "").trim();
      if (cleaned.length === 0 || cleaned.length > 40) continue;
      const n = normalizeSkill(cleaned);
      if (n.value && !seen.has(n.value.toLowerCase())) {
        seen.add(n.value.toLowerCase());
        record.skills.push(
          ev(n.value, "resume_pdf", "resume.section:skills", n.steps, 0.8, cleaned),
        );
      }
    }
  }

  if (sections.experience) {
    const items = parseExperience(sections.experience);
    for (const { item, raw } of items) {
      record.experience.push(
        ev(item, "resume_pdf", "resume.section:experience", ["whitespace:collapse"], 0.8, raw),
      );
    }
    // Most-recent experience → currentCompany/currentTitle, if not already on record.
    const mostRecent = items
      .map((x) => x.item)
      .sort((a, b) => endDateScore(b.endDate) - endDateScore(a.endDate))[0];
    if (mostRecent) {
      record.currentCompany = ev(
        mostRecent.company,
        "resume_pdf",
        "resume.derived:current-company",
        [],
        0.75,
        mostRecent.company,
      );
      if (mostRecent.title) {
        record.currentTitle = ev(
          mostRecent.title,
          "resume_pdf",
          "resume.derived:current-title",
          [],
          0.75,
          mostRecent.title,
        );
      }
    }
  }

  if (sections.education) {
    for (const { item, raw } of parseEducation(sections.education)) {
      record.education.push(
        ev(item, "resume_pdf", "resume.section:education", ["whitespace:collapse"], 0.8, raw),
      );
    }
  }

  return { record, warnings };
}

function endDateScore(end?: string): number {
  if (!end) return 0;
  if (end === "present") return 9_999_999;
  const m = /^(\d{4})-(\d{2})$/.exec(end);
  if (!m) return 0;
  return Number(m[1]) * 12 + Number(m[2]);
}

function splitSections(text: string): {
  skills?: string;
  experience?: string;
  education?: string;
} {
  // Match common section headers; capture body until the next header or EOF.
  const order = ["skills", "experience", "education"] as const;
  const headers: Record<string, RegExp> = {
    skills: /^\s*(technical\s+)?skills\s*:?\s*$/im,
    experience: /^\s*(work\s+|professional\s+)?experience\s*:?\s*$/im,
    education: /^\s*education\s*:?\s*$/im,
  };
  const positions: { key: string; index: number }[] = [];
  for (const key of order) {
    const m = headers[key].exec(text);
    if (m) positions.push({ key, index: m.index + m[0].length });
  }
  positions.sort((a, b) => a.index - b.index);
  const out: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index - 0 : text.length;
    // Cut off the next header line itself.
    let body = text.slice(start, end);
    body = body.replace(/^\s*(technical\s+)?skills\s*:?\s*$/im, "")
      .replace(/^\s*(work\s+|professional\s+)?experience\s*:?\s*$/im, "")
      .replace(/^\s*education\s*:?\s*$/im, "");
    out[positions[i].key] = body.trim();
  }
  return out;
}

const DATE_RANGE_RX =
  /([A-Za-z]+\.?\s+\d{4}|\d{4}[-/]\d{1,2}|\d{4})\s*(?:[-–—to]+)\s*(present|current|[A-Za-z]+\.?\s+\d{4}|\d{4}[-/]\d{1,2}|\d{4})/i;

function parseExperience(block: string): { item: ExperienceItem; raw: string }[] {
  // Split on blank lines: each chunk is one role.
  const chunks = block
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const out: { item: ExperienceItem; raw: string }[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // Heuristic: first non-date line is "Title at Company" or "Title — Company".
    const titleLine = lines.find((l) => !DATE_RANGE_RX.test(l)) ?? lines[0];
    const parts = titleLine.split(/\s+(?:at|@|—|-)\s+/i);
    const title = parts[0]?.trim();
    const company = (parts[1] ?? "").trim() || (lines[1] ?? "").trim();
    const dateMatch = chunk.match(DATE_RANGE_RX);
    const startDate = dateMatch ? normalizeDate(dateMatch[1]).value ?? undefined : undefined;
    const endDate = dateMatch ? normalizeDate(dateMatch[2]).value ?? undefined : undefined;
    const companyN = normalizeCompany(company);
    if (!companyN.value) continue;
    out.push({
      item: {
        company: companyN.value,
        title: title?.length ? title : undefined,
        startDate,
        endDate,
      },
      raw: chunk,
    });
  }
  return out;
}

function parseEducation(block: string): { item: EducationItem; raw: string }[] {
  const chunks = block
    .split(/\n\s*\n|\n(?=[A-Z])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const out: { item: EducationItem; raw: string }[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const institution = lines[0];
    const degreeLine = lines.slice(1).join(" ");
    const degMatch = /\b(B\.?\s*Tech|B\.?\s*E\.?|B\.?\s*Sc\.?|M\.?\s*Tech|M\.?\s*S\.?|M\.?\s*Sc\.?|Ph\.?\s*D\.?|MBA|Bachelor[a-z']*|Master[a-z']*)\b\s*(?:in|of)?\s*([A-Za-z &]+)?/i.exec(
      degreeLine,
    );
    const dateMatch = chunk.match(/(\d{4})\s*[-–—]\s*(\d{4}|present)/i);
    out.push({
      item: {
        institution: institution.replace(/\s+/g, " ").trim(),
        degree: degMatch?.[1]?.trim(),
        field: degMatch?.[2]?.trim(),
        endDate: dateMatch ? normalizeDate(dateMatch[2]).value ?? undefined : undefined,
      },
      raw: chunk,
    });
  }
  return out;
}
