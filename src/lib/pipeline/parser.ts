/**
 * Pure I/O layer. Reads CSV and PDF bytes into neutral structures.
 * Never interprets fields — that's the extractor's job.
 */
import Papa from "papaparse";
import { extractText, getDocumentProxy } from "unpdf";

export interface CsvParseResult {
  rows: Record<string, string>[];
  headers: string[];
  warnings: string[];
  bytes: number;
}

export interface PdfParseResult {
  text: string;
  pages: number;
  warnings: string[];
  bytes: number;
}

/** Parse a recruiter CSV. Tolerates BOM, mixed quoting, and trailing commas. */
export async function parseCsv(file: File): Promise<CsvParseResult> {
  const text = await file.text();
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      warnings.push(`csv:${err.code}@row${err.row ?? "?"}:${err.message}`);
    }
  }
  return {
    rows: parsed.data.filter((r) => Object.values(r).some((v) => v && v.length > 0)),
    headers: parsed.meta.fields ?? [],
    warnings,
    bytes: file.size,
  };
}

/** Parse a resume PDF into raw text. Page count is reported for the report. */
export async function parsePdf(file: File): Promise<PdfParseResult> {
  const warnings: string[] = [];
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join("\n") : text;
    if (!joined || joined.trim().length === 0) {
      warnings.push("pdf:empty-text-layer (scanned PDF or unsupported encoding)");
    }
    return { text: joined ?? "", pages: totalPages ?? 0, warnings, bytes: file.size };
  } catch (e) {
    warnings.push(`pdf:parse-failed:${(e as Error).message}`);
    return { text: "", pages: 0, warnings, bytes: file.size };
  }
}
