/**
 * Deterministic normalization. Every function returns both the normalized
 * value and the list of normalization steps applied, so provenance can
 * explain exactly what changed.
 */
import { parsePhoneNumberFromString, isValidPhoneNumber } from "libphonenumber-js";

export interface Normalized<T> {
  value: T | null;
  steps: string[];
  valid: boolean;
}

const WHITESPACE = /\s+/g;

export function normalizeName(raw: string | undefined): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  let v = raw.normalize("NFKC");
  if (v !== raw) steps.push("unicode:NFKC");
  const collapsed = v.replace(WHITESPACE, " ").trim();
  if (collapsed !== v) steps.push("whitespace:collapse");
  v = collapsed;
  // Title-case only if input is all upper or all lower.
  if (v === v.toUpperCase() || v === v.toLowerCase()) {
    v = v
      .split(" ")
      .map((p) => (p.length > 0 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p))
      .join(" ");
    steps.push("case:title");
  }
  return { value: v.length > 0 ? v : null, steps, valid: v.length > 0 };
}

export function normalizeEmail(raw: string | undefined): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  let v = raw.trim();
  if (v !== raw) steps.push("whitespace:trim");
  const lowered = v.toLowerCase();
  if (lowered !== v) {
    steps.push("case:lower");
    v = lowered;
  }
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  return { value: ok ? v : null, steps, valid: ok };
}

export function normalizePhone(
  raw: string | undefined,
  defaultCountry?: string,
): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  const trimmed = raw.trim();
  if (trimmed !== raw) steps.push("whitespace:trim");
  try {
    const parsed = parsePhoneNumberFromString(trimmed, (defaultCountry ?? "US") as "US");
    if (parsed && parsed.isValid()) {
      steps.push("phone:E164");
      return { value: parsed.number, steps, valid: true };
    }
    if (isValidPhoneNumber(trimmed)) {
      steps.push("phone:E164");
      return { value: trimmed, steps, valid: true };
    }
  } catch {
    // fall through
  }
  return { value: null, steps, valid: false };
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States",
  us: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  america: "United States",
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  england: "United Kingdom",
  britain: "United Kingdom",
  uae: "United Arab Emirates",
  india: "India",
  bharat: "India",
};

export function normalizeCountry(raw: string | undefined): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  const trimmed = raw.replace(WHITESPACE, " ").trim();
  if (trimmed !== raw) steps.push("whitespace:collapse");
  const key = trimmed.toLowerCase();
  if (COUNTRY_ALIASES[key]) {
    steps.push(`country:alias->${COUNTRY_ALIASES[key]}`);
    return { value: COUNTRY_ALIASES[key], steps, valid: true };
  }
  // Title-case fallback for unknown countries.
  const titled = trimmed
    .split(" ")
    .map((p) => (p.length > 0 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p))
    .join(" ");
  if (titled !== trimmed) steps.push("case:title");
  return { value: titled, steps, valid: titled.length > 0 };
}

const COMPANY_SUFFIXES = /\b(inc\.?|llc|ltd\.?|gmbh|pvt\.?\s*ltd\.?|corp\.?|co\.?)\b/gi;

export function normalizeCompany(raw: string | undefined): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  let v = raw.replace(WHITESPACE, " ").trim();
  if (v !== raw) steps.push("whitespace:collapse");
  const stripped = v.replace(COMPANY_SUFFIXES, "").replace(WHITESPACE, " ").trim();
  if (stripped !== v && stripped.length > 0) {
    steps.push("company:strip-suffix");
    v = stripped;
  }
  // Preserve internal capitalization (e.g. "eBay", "GitHub").
  return { value: v.length > 0 ? v : null, steps, valid: v.length > 0 };
}

/**
 * Canonical skill registry. Maps lowercased aliases to canonical labels.
 * Keep small and explicit; unknown skills pass through with whitespace cleanup.
 */
const SKILL_ALIASES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  "node.js": "Node.js",
  nodejs: "Node.js",
  node: "Node.js",
  reactjs: "React",
  "react.js": "React",
  react: "React",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  psql: "PostgreSQL",
  k8s: "Kubernetes",
  kubernetes: "Kubernetes",
  aws: "AWS",
  gcp: "GCP",
  "google cloud": "GCP",
  ml: "Machine Learning",
  "machine learning": "Machine Learning",
  nlp: "NLP",
  golang: "Go",
};

export function normalizeSkill(raw: string): Normalized<string> {
  const steps: string[] = [];
  const cleaned = raw.replace(WHITESPACE, " ").trim();
  if (cleaned !== raw) steps.push("whitespace:collapse");
  const key = cleaned.toLowerCase();
  if (SKILL_ALIASES[key]) {
    steps.push(`skill:alias->${SKILL_ALIASES[key]}`);
    return { value: SKILL_ALIASES[key], steps, valid: true };
  }
  // Title-case fallback only when input has no internal capitals.
  if (cleaned === cleaned.toLowerCase() && cleaned.length > 1) {
    const titled = cleaned[0].toUpperCase() + cleaned.slice(1);
    if (titled !== cleaned) steps.push("case:initial");
    return { value: titled, steps, valid: titled.length > 0 };
  }
  return { value: cleaned, steps, valid: cleaned.length > 0 };
}

/** Normalize a free-form date string into YYYY-MM, or pass "present" through. */
export function normalizeDate(raw: string | undefined): Normalized<string> {
  if (!raw) return { value: null, steps: [], valid: false };
  const steps: string[] = [];
  const v = raw.trim().toLowerCase();
  if (v === "present" || v === "current" || v === "now") {
    steps.push("date:present");
    return { value: "present", steps, valid: true };
  }
  // YYYY-MM or YYYY/MM
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(v);
  if (m) {
    steps.push("date:YYYY-MM");
    return { value: `${m[1]}-${m[2].padStart(2, "0")}`, steps, valid: true };
  }
  // Month YYYY (e.g. "Jan 2023", "January 2023")
  const months: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };
  m = /^([a-z]+)\.?\s+(\d{4})$/.exec(v);
  if (m && months[m[1]]) {
    steps.push("date:Month-YYYY");
    return { value: `${m[2]}-${months[m[1]]}`, steps, valid: true };
  }
  // Bare year
  m = /^(\d{4})$/.exec(v);
  if (m) {
    steps.push("date:YYYY");
    return { value: `${m[1]}-01`, steps, valid: true };
  }
  return { value: null, steps, valid: false };
}
