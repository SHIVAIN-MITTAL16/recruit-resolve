/**
 * Pulls candidate-relevant fields out of parsed CSV rows and resume text.
 * Each extracted value is wrapped in FieldEvidence so the merger and the
 * UI can trace it back to a source and a method.
 */
import type { CsvParseResult, PdfParseResult } from "./parser";
import type { EducationItem, ExperienceItem, ExtractedRecord, FieldEvidence } from "./types";
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
    if (match) {
      row = match;
    } else {
      return { record: null, warnings: [...warnings, "csv:no-identity-match"] };
    }
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
    record.fullName = ev(
      nameN.value,
      "recruiter_csv",
      "csv.column:name",
      nameN.steps,
      0.95,
      rawName,
    );
  }
  const emailN = normalizeEmail(rawEmail);
  if (emailN.value) {
    record.email = ev(
      emailN.value,
      "recruiter_csv",
      "csv.column:email",
      emailN.steps,
      emailN.valid ? 0.98 : 0.5,
      rawEmail,
    );
  } else if (rawEmail) {
    warnings.push(`csv:invalid-email:${rawEmail}`);
  }
  const phoneN = normalizePhone(rawPhone);
  if (phoneN.value) {
    record.phone = ev(
      phoneN.value,
      "recruiter_csv",
      "csv.column:phone",
      phoneN.steps,
      0.95,
      rawPhone,
    );
  } else if (rawPhone) {
    warnings.push(`csv:invalid-phone:${rawPhone}`);
  }
  const countryN = normalizeCountry(rawCountry);
  if (countryN.value) {
    record.country = ev(
      countryN.value,
      "recruiter_csv",
      "csv.column:country",
      countryN.steps,
      0.9,
      rawCountry,
    );
  }
  const companyN = normalizeCompany(rawCompany);
  if (companyN.value) {
    record.currentCompany = ev(
      companyN.value,
      "recruiter_csv",
      "csv.column:company",
      companyN.steps,
      0.9,
      rawCompany,
    );
  }
  if (rawTitle) {
    const titleTrim = rawTitle.replace(/\s+/g, " ").trim();
    record.currentTitle = ev(
      titleTrim,
      "recruiter_csv",
      "csv.column:title",
      ["whitespace:collapse"],
      0.85,
      rawTitle,
    );
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
  const nameLine =
    lines.slice(0, 8).find((l) => /^[A-Z][a-z'’-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(l)) ??
    extractLeadingName(text);
  if (nameLine) {
    const n = normalizeName(nameLine);
    if (n.value) {
      record.fullName = ev(
        n.value,
        "resume_pdf",
        "resume.heuristic:first-name-line",
        n.steps,
        0.8,
        nameLine,
      );
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
  const countryMatch = text.match(/\b(India|Bharat|United States|USA|US|United Kingdom|UK|UAE)\b/i);
  const phoneMatch = text.match(PHONE_RX);
  if (phoneMatch) {
    const n = normalizePhone(phoneMatch[1], phoneDefaultCountry(countryMatch?.[1]));
    if (n.value) {
      record.phone = ev(n.value, "resume_pdf", "resume.regex:phone", n.steps, 0.85, phoneMatch[1]);
    } else {
      warnings.push(`pdf:invalid-phone:${phoneMatch[1]}`);
    }
  }
  if (countryMatch) {
    const n = normalizeCountry(countryMatch[1]);
    if (n.value) {
      record.country = ev(
        n.value,
        "resume_pdf",
        "resume.regex:country",
        n.steps,
        0.75,
        countryMatch[1],
      );
    }
  }

  const sections = splitSections(text);

  if (sections.skills) {
    const seen = new Set<string>();
    for (const part of splitSkillParts(sections.skills)) {
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
    const cleaned = sections.experience.replace(/\s+/g, " ").trim();
    const items = parseExperience(cleaned);

    for (const { item, raw } of items) {
      record.experience.push(
        ev(item, "resume_pdf", "resume.section:experience", ["whitespace:collapse"], 0.8, raw),
      );
    }

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

function phoneDefaultCountry(rawCountry: string | undefined): string | undefined {
  const normalized = normalizeCountry(rawCountry).value;
  if (normalized === "India") return "IN";
  if (normalized === "United States") return "US";
  if (normalized === "United Kingdom") return "GB";
  if (normalized === "United Arab Emirates") return "AE";
  return undefined;
}

function splitSkillParts(block: string): string[] {
  const delimited = block
    .split(/[,;|\n•·]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const parts =
    delimited.length > 1
      ? delimited
      : block
          .split(/\s+/)
          .map((p) => p.trim())
          .filter(Boolean);
  const joined: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const current = parts[i];
    const next = parts[i + 1];
    if (next && /^(machine|google)$/i.test(current) && /^(learning|cloud)$/i.test(next)) {
      joined.push(`${current} ${next}`);
      i += 1;
    } else {
      joined.push(current);
    }
  }
  return joined;
}

function extractLeadingName(text: string): string | undefined {
  const firstMarker =
    /\b(?:Email|Phone|Location|Summary|Professional Summary|Experience|Skills|Education)\b/.exec(
      text,
    );
  const email = EMAIL_RX.exec(text);
  const end = Math.min(
    ...[firstMarker?.index, email?.index, 120].filter((v): v is number => typeof v === "number"),
  );
  const intro = text.slice(0, end).replace(/[|,]/g, " ").replace(/\s+/g, " ").trim();
  const stopWords = new Set([
    "Senior",
    "Staff",
    "Principal",
    "Lead",
    "Junior",
    "Software",
    "Backend",
    "Frontend",
    "Full",
    "Stack",
    "DevOps",
    "Cloud",
    "Data",
    "Machine",
    "Learning",
    "Engineer",
    "Developer",
    "Architect",
    "Manager",
    "Analyst",
    "Designer",
    "Consultant",
    "Specialist",
    "Scientist",
  ]);
  const nameTokens: string[] = [];
  for (const token of intro.split(/\s+/)) {
    const cleaned = token.replace(/[^A-Za-z'.-]/g, "");
    if (!cleaned) continue;
    if (stopWords.has(cleaned)) break;
    if (!/^[A-Z][A-Za-z'.-]+$/.test(cleaned)) break;
    nameTokens.push(cleaned);
    if (nameTokens.length === 4) break;
  }
  return nameTokens.length >= 2 ? nameTokens.join(" ") : undefined;
}

function endDateScore(end?: string): number {
  if (!end) return 0;
  if (end === "present") return 9_999_999;
  const m = /^(\d{4})-(\d{2})$/.exec(end);
  if (!m) return 0;
  return Number(m[1]) * 12 + Number(m[2]);
}

function splitSections(text: string) {
  const result: {
    skills?: string;
    experience?: string;
    education?: string;
  } = {};

  const sectionHeaders: { label: string; key?: keyof typeof result }[] = [
    { label: "Technical Skills", key: "skills" },
    { label: "Core Skills", key: "skills" },
    { label: "Professional Skills", key: "skills" },
    { label: "Skills", key: "skills" },
    { label: "Professional Experience", key: "experience" },
    { label: "Work Experience", key: "experience" },
    { label: "Work History", key: "experience" },
    { label: "Employment", key: "experience" },
    { label: "Experience", key: "experience" },
    { label: "Academic Background", key: "education" },
    { label: "Education", key: "education" },
    { label: "Certifications" },
    { label: "Certification" },
    { label: "Certificates" },
    { label: "Projects" },
    { label: "Achievements" },
    { label: "Languages" },
  ];

  const aliases = sectionHeaders
    .map((h) => h.label)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const headerRx = new RegExp(`(^|[^A-Za-z])(${aliases})(?=$|[^A-Za-z])`, "g");
  const matches: {
    label: string;
    key?: keyof typeof result;
    start: number;
    end: number;
  }[] = [];

  for (const match of text.matchAll(headerRx)) {
    const label = match[2];
    const start = match.index! + match[1].length;
    const end = start + label.length;
    if (!looksLikeSectionHeader(text, start, end)) continue;
    const header = sectionHeaders.find((h) => h.label === label);
    matches.push({ label, key: header?.key, start, end });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current.key || result[current.key]) continue;
    const next = matches[i + 1];
    const body = text.slice(current.end, next?.start ?? text.length).trim();
    if (body) result[current.key] = body;
  }

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeSectionHeader(text: string, start: number, end: number): boolean {
  const matched = text.slice(start, end);
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, end + 24).trimStart();
  const nextWord = after.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase();

  if (matched[0] !== matched[0].toUpperCase()) return false;
  if (/\b(of|in|with)$/i.test(before.trim())) return false;
  if (
    (matched === "Experience" && ["of", "in", "with"].includes(nextWord ?? "")) ||
    (matched === "Education" && ["loan", "loans", "policy", "policies"].includes(nextWord ?? ""))
  ) {
    return false;
  }

  return true;
}
const DATE_RANGE_RX =
  /([A-Za-z]+\.?\s+\d{4}|\d{4}[-/]\d{1,2}|\d{4})\s*(?:-|–|—|\bto\b)\s*(present|current|now|[A-Za-z]+\.?\s+\d{4}|\d{4}[-/]\d{1,2}|\d{4})/gi;

function parseExperience(block: string): { item: ExperienceItem; raw: string }[] {
  const out: { item: ExperienceItem; raw: string }[] = [];
  const dates = [...block.matchAll(DATE_RANGE_RX)];
  let previousDateEnd = 0;

  for (const date of dates) {
    const dateStart = date.index ?? 0;
    const dateEnd = dateStart + date[0].length;
    const header = extractRoleHeader(block.slice(previousDateEnd, dateStart));
    const parsed = parseRoleHeader(header);
    previousDateEnd = dateEnd;
    if (!parsed) continue;

    out.push({
      item: {
        company: parsed.company,
        title: parsed.title,
        startDate: normalizeDate(date[1]).value ?? undefined,
        endDate: normalizeDate(date[2]).value ?? undefined,
      },
      raw: `${header} ${date[0]}`.trim(),
    });
  }

  return out;
}

function extractRoleHeader(prefix: string): string {
  const cleaned = prefix
    .replace(/\s+/g, " ")
    .replace(/^[-*•·\s]+/, "")
    .trim();
  const fragments = cleaned
    .split(/(?<=[.;])\s+/)
    .map((p) => p.replace(/^[-*•·\s]+/, "").trim())
    .filter(Boolean);
  return fragments.at(-1) ?? cleaned;
}

function parseRoleHeader(header: string): { company: string; title?: string } | null {
  const cleaned = header
    .replace(/\s+/g, " ")
    .replace(/^[-*•·\s]+/, "")
    .replace(/\s*[|–—-]\s*$/g, "")
    .trim();
  if (!cleaned) return null;

  const atMatch = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(cleaned);
  if (atMatch) {
    return buildRole(atMatch[2], atMatch[1]);
  }

  const separated = cleaned
    .split(/\s+\|\s+|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (separated.length >= 2) {
    const titleIndex = separated
      .map((part, index) => ({ index, score: titleScore(part) }))
      .sort((a, b) => b.score - a.score)[0];
    if (titleIndex.score > 0) {
      const company = separated.find((_, index) => index !== titleIndex.index);
      if (company) return buildRole(company, separated[titleIndex.index]);
    }
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const titleSpan = findTitleSpan(tokens);
  if (!titleSpan) return null;

  const title = tokens.slice(titleSpan.start, titleSpan.end).join(" ");
  const company =
    titleSpan.start > 0
      ? tokens.slice(0, titleSpan.start).join(" ")
      : tokens.slice(titleSpan.end).join(" ");

  return buildRole(company, title);
}

function buildRole(
  companyRaw: string,
  titleRaw: string,
): { company: string; title?: string } | null {
  const company = normalizeCompany(companyRaw.replace(/[,:;|–—-]+$/g, "")).value;
  const title = titleRaw.replace(/[,:;|–—-]+$/g, "").trim();
  if (!company || !title || titleScore(title) === 0) return null;
  return { company, title };
}

function findTitleSpan(tokens: string[]): { start: number; end: number } | null {
  let best: { start: number; end: number; score: number } | null = null;
  for (let start = 0; start < tokens.length; start++) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 6); end++) {
      const text = tokens.slice(start, end).join(" ");
      const score = titleScore(text);
      if (score === 0) continue;
      const candidate = { start, end, score };
      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.end - candidate.start < best.end - best.start)
      ) {
        best = candidate;
      }
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function titleScore(value: string): number {
  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  const roleNouns = new Set([
    "engineer",
    "developer",
    "architect",
    "manager",
    "analyst",
    "designer",
    "consultant",
    "specialist",
    "scientist",
    "administrator",
    "lead",
    "director",
    "intern",
    "tester",
  ]);
  const roleModifiers = new Set([
    "senior",
    "staff",
    "principal",
    "lead",
    "junior",
    "software",
    "backend",
    "frontend",
    "front-end",
    "full",
    "stack",
    "fullstack",
    "devops",
    "cloud",
    "data",
    "machine",
    "learning",
    "product",
    "project",
    "program",
    "qa",
    "ui",
    "ux",
  ]);

  const hasNoun = words.some((word) => roleNouns.has(word));
  if (!hasNoun) return 0;
  return words.reduce((score, word) => {
    if (roleNouns.has(word)) return score + 3;
    if (roleModifiers.has(word)) return score + 1;
    return score;
  }, 0);
}
function parseEducation(block: string): { item: EducationItem; raw: string }[] {
  block = stripLaterSections(block);

  const chunks = block
    .split(/\n\s*\n|\n(?=[A-Z])/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const out: { item: EducationItem; raw: string }[] = [];
  for (const chunk of chunks) {
    for (const segment of splitEducationSegments(chunk)) {
      const item = parseEducationSegment(segment);
      if (item) out.push({ item, raw: segment });
    }
  }
  return out;
}

const DEGREE_RX =
  /\b(Bachelor of Technology|Bachelor of Engineering|B\.?\s*Tech|BTech|B\.?\s*E\.?|BE|B\.?\s*S\.?|BS|M\.?\s*Tech|MTech|M\.?\s*S\.?|MS|MBA|Ph\.?\s*D\.?|PhD)\b/i;

function stripLaterSections(block: string): string {
  return block
    .replace(
      /\b(?:Technical Skills|Core Skills|Professional Skills|Skills|Professional Experience|Work Experience|Work History|Employment|Experience|Certifications?|Certificates|Projects|Achievements|Languages)\b[\s\S]*$/i,
      "",
    )
    .trim();
}

function splitEducationSegments(chunk: string): string[] {
  const cleaned = chunk.replace(/\s+/g, " ").trim();
  const degreeMatches = [...cleaned.matchAll(new RegExp(DEGREE_RX.source, "gi"))];
  if (degreeMatches.length <= 1) return cleaned ? [cleaned] : [];

  const segments: string[] = [];
  for (let i = 0; i < degreeMatches.length; i++) {
    const start = degreeMatches[i].index ?? 0;
    const end = degreeMatches[i + 1]?.index ?? cleaned.length;
    const prefix = i === 0 ? cleaned.slice(0, start).trim() : "";
    const segment = `${prefix} ${cleaned.slice(start, end)}`.trim();
    if (segment) segments.push(segment);
  }
  return segments;
}

function parseEducationSegment(segment: string): EducationItem | null {
  const cleaned = segment.replace(/\s+/g, " ").trim();
  const degreeMatch = DEGREE_RX.exec(cleaned);
  const years = [...cleaned.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);
  const endDate = years.length > 0 ? (normalizeDate(years.at(-1)).value ?? undefined) : undefined;

  if (!degreeMatch) {
    return cleaned ? { institution: cleaned, endDate } : null;
  }

  const degree = normalizeDegreeLabel(degreeMatch[1]);
  const beforeDegree = cleaned
    .slice(0, degreeMatch.index)
    .replace(/\b(19|20)\d{2}\b/g, "")
    .trim();
  const afterDegree = cleaned
    .slice(degreeMatch.index + degreeMatch[0].length)
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s*[-–—]\s*$/g, "")
    .trim();

  if (beforeDegree) {
    const field = afterDegree.replace(/^(?:in|of)\s+/i, "").trim();
    return {
      institution: beforeDegree,
      degree,
      field: field || undefined,
      endDate,
    };
  }

  const { field, institution } = splitFieldInstitution(afterDegree);
  if (!institution) return { institution: afterDegree || degree, degree, endDate };

  return {
    institution,
    degree,
    field,
    endDate,
  };
}

function normalizeDegreeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\./g, "").trim();
}

function splitFieldInstitution(value: string): { field?: string; institution?: string } {
  const cleaned = value.replace(/^(?:in|of)\s+/i, "").trim();
  if (!cleaned) return {};
  const fieldPrefix = matchFieldPrefix(cleaned);
  if (fieldPrefix) {
    const institution = cleaned.slice(fieldPrefix.length).trim();
    if (institution) return { field: fieldPrefix, institution };
  }
  const tokens = cleaned.split(/\s+/);
  const start = findInstitutionStart(tokens);
  if (start === -1) return { institution: cleaned };
  return {
    field: tokens.slice(0, start).join(" ") || undefined,
    institution: tokens.slice(start).join(" "),
  };
}

function matchFieldPrefix(value: string): string | null {
  const fields = [
    "Computer Science",
    "Information Technology",
    "Computer Engineering",
    "Software Engineering",
    "Software Systems",
    "Data Science",
    "Electrical Engineering",
    "Electronics and Communication",
    "Mechanical Engineering",
    "Civil Engineering",
    "Business Administration",
    "Product Management",
    "Finance",
    "Marketing",
    "Mathematics",
    "Statistics",
    "Physics",
    "Chemistry",
  ];
  const lower = value.toLowerCase();
  return fields.find((field) => lower.startsWith(field.toLowerCase() + " ")) ?? null;
}

function findInstitutionStart(tokens: string[]): number {
  const wordCues = new Set(["University", "Institute", "College", "School"]);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/[,.]/g, "");
    if (/^[A-Z]{2,6}$/.test(token)) return i;
    if (wordCues.has(token)) return Math.max(0, i - 2);
  }
  return -1;
}
