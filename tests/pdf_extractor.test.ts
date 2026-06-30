import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractFromPdf } from "@/lib/pipeline/extractor";
import { parsePdf } from "@/lib/pipeline/parser";

async function extractSample(fileName: string) {
  const bytes = await readFile(`public/samples/${fileName}`);
  const parsed = await parsePdf(new File([bytes], fileName, { type: "application/pdf" }));
  const extracted = extractFromPdf(parsed);
  expect(extracted.record).not.toBeNull();
  return extracted.record!;
}

describe("PDF parser and extractor samples", () => {
  it("extracts Aarav Sharma", async () => {
    const record = await extractSample("resume_aarav_sharma.pdf");

    expect(record.fullName?.value).toBe("Aarav Sharma");
    expect(record.email?.value).toBe("aarav.sharma@example.com");
    expect(record.phone?.value).toBe("+919876543210");
    expect(record.currentCompany?.value).toBe("Stripe");
    expect(record.currentTitle?.value).toBe("Staff Software Engineer");
    expect(record.skills.map((s) => s.value)).toEqual([
      "Python",
      "TypeScript",
      "React",
      "Node.js",
      "PostgreSQL",
      "Kubernetes",
      "AWS",
      "Machine Learning",
      "NLP",
    ]);
    expect(record.experience.map((e) => e.value)).toEqual([
      {
        company: "Stripe",
        title: "Staff Software Engineer",
        startDate: "2023-01",
        endDate: "present",
      },
      {
        company: "Razorpay",
        title: "Senior Software Engineer",
        startDate: "2020-08",
        endDate: "2022-12",
      },
      { company: "Flipkart", title: "Software Engineer", startDate: "2018-07", endDate: "2020-07" },
    ]);
    expect(record.education.map((e) => e.value)).toEqual([
      {
        institution: "Indian Institute of Technology, Bombay",
        degree: "BTech",
        field: "Computer Science",
        endDate: "2018-01",
      },
    ]);
  });

  it("extracts Rohit Verma", async () => {
    const record = await extractSample("resume_rohit_verma.pdf");

    expect(record.fullName?.value).toBe("Rohit Verma");
    expect(record.email?.value).toBe("rohit.verma@gmail.com");
    expect(record.phone?.value).toBe("+919876543210");
    expect(record.currentCompany?.value).toBe("Amazon");
    expect(record.currentTitle?.value).toBe("Backend Engineer");
    expect(record.skills.map((s) => s.value)).toEqual([
      "Node.js",
      "Express",
      "MongoDB",
      "AWS",
      "Docker",
    ]);
    expect(record.experience.map((e) => e.value)).toEqual([
      { company: "Amazon", title: "Backend Engineer", startDate: "2021-01", endDate: "present" },
    ]);
    expect(record.education.map((e) => e.value)).toEqual([
      {
        institution: "NIT Warangal",
        degree: "BTech",
        field: "Information Technology",
        endDate: "2021-01",
      },
    ]);
  });

  it("extracts Priya Singh", async () => {
    const record = await extractSample("resume_priya_singh.pdf");

    expect(record.fullName?.value).toBe("Priya Singh");
    expect(record.email?.value).toBe("priya@mail.com");
    expect(record.phone?.value).toBe("+919876543210");
    expect(record.currentCompany?.value).toBe("Adobe");
    expect(record.currentTitle?.value).toBe("Frontend Engineer");
    expect(record.skills.map((s) => s.value)).toEqual([
      "React",
      "TypeScript",
      "JavaScript",
      "HTML",
      "CSS",
    ]);
    expect(record.experience.map((e) => e.value)).toEqual([
      { company: "Adobe", title: "Frontend Engineer", startDate: "2022-06", endDate: "present" },
    ]);
    expect(record.education.map((e) => e.value)).toEqual([
      {
        institution: "IIIT Delhi",
        degree: "BTech",
        field: "Computer Science",
        endDate: "2022-01",
      },
    ]);
  });

  it("extracts Ananya Gupta", async () => {
    const record = await extractSample("resume_ananya_gupta.pdf");

    expect(record.fullName?.value).toBe("Ananya Gupta");
    expect(record.email?.value).toBe("ananya.gupta@google.com");
    expect(record.phone?.value).toBe("+919123456789");
    expect(record.currentCompany?.value).toBe("Microsoft");
    expect(record.currentTitle?.value).toBe("Senior Software Engineer");
    expect(record.skills.map((s) => s.value)).toEqual([
      "Python",
      "Java",
      "Docker",
      "Azure",
      "Kubernetes",
    ]);
    expect(record.experience.map((e) => e.value)).toEqual([
      {
        company: "Microsoft",
        title: "Senior Software Engineer",
        startDate: "2023-02",
        endDate: "present",
      },
    ]);
    expect(record.education.map((e) => e.value)).toEqual([
      {
        institution: "Delhi Technological University",
        degree: "BTech",
        field: "Computer Science",
        endDate: "2020-01",
      },
    ]);
  });
});
