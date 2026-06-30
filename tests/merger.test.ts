import { describe, it, expect } from "vitest";
import { mergeRecords } from "@/lib/pipeline/merger";
import type { ExtractedRecord } from "@/lib/pipeline/types";

function csvRec(overrides: Partial<ExtractedRecord> = {}): ExtractedRecord {
  return {
    source: "recruiter_csv",
    skills: [],
    experience: [],
    education: [],
    ...overrides,
  };
}
function pdfRec(overrides: Partial<ExtractedRecord> = {}): ExtractedRecord {
  return {
    source: "resume_pdf",
    skills: [],
    experience: [],
    education: [],
    ...overrides,
  };
}

describe("merger", () => {
  it("prefers CSV email on agreement and bumps confidence", () => {
    const m = mergeRecords(
      csvRec({
        email: {
          source: "recruiter_csv",
          value: "a@b.com",
          method: "csv.column:email",
          normalizations: [],
          baseConfidence: 0.98,
        },
      }),
      pdfRec({
        email: {
          source: "resume_pdf",
          value: "a@b.com",
          method: "resume.regex:email",
          normalizations: [],
          baseConfidence: 0.9,
        },
      }),
    );
    expect(m.email.value).toBe("a@b.com");
    expect(m.email.chosen?.source).toBe("recruiter_csv");
    expect(m.email.confidence).toBeGreaterThan(0.98);
  });

  it("flags a conflict and applies penalty", () => {
    const m = mergeRecords(
      csvRec({
        phone: {
          source: "recruiter_csv",
          value: "+11111111111",
          method: "csv.column:phone",
          normalizations: [],
          baseConfidence: 0.95,
        },
      }),
      pdfRec({
        phone: {
          source: "resume_pdf",
          value: "+12222222222",
          method: "resume.regex:phone",
          normalizations: [],
          baseConfidence: 0.85,
        },
      }),
    );
    expect(m.phone.value).toBe("+11111111111");
    expect(m.decisions.find((d) => d.field === "phone")?.kind).toBe("conflict");
    expect(m.phone.confidence).toBeLessThan(0.95);
  });

  it("unions and dedupes skills across sources", () => {
    const m = mergeRecords(
      csvRec({
        skills: [
          {
            source: "recruiter_csv",
            value: "Python",
            method: "csv.column:skills",
            normalizations: [],
            baseConfidence: 0.85,
          },
          {
            source: "recruiter_csv",
            value: "React",
            method: "csv.column:skills",
            normalizations: [],
            baseConfidence: 0.85,
          },
        ],
      }),
      pdfRec({
        skills: [
          {
            source: "resume_pdf",
            value: "Python",
            method: "resume.section:skills",
            normalizations: [],
            baseConfidence: 0.8,
          },
          {
            source: "resume_pdf",
            value: "PostgreSQL",
            method: "resume.section:skills",
            normalizations: [],
            baseConfidence: 0.8,
          },
        ],
      }),
    );
    expect(m.skills.value).toEqual(["PostgreSQL", "Python", "React"]);
    expect(m.duplicateSkillsRemoved).toBe(1);
  });

  it("picks more complete name", () => {
    const m = mergeRecords(
      csvRec({
        fullName: {
          source: "recruiter_csv",
          value: "A Sharma",
          method: "csv",
          normalizations: [],
          baseConfidence: 0.95,
        },
      }),
      pdfRec({
        fullName: {
          source: "resume_pdf",
          value: "Aarav Kumar Sharma",
          method: "resume",
          normalizations: [],
          baseConfidence: 0.8,
        },
      }),
    );
    expect(m.fullName.value).toBe("Aarav Kumar Sharma");
  });
});
