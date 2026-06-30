import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeCountry,
  normalizeSkill,
  normalizeDate,
} from "@/lib/pipeline/normalizer";

describe("normalizer", () => {
  it("lowercases and validates email", () => {
    expect(normalizeEmail(" Alice@Example.COM ").value).toBe("alice@example.com");
    expect(normalizeEmail("not-an-email").valid).toBe(false);
  });

  it("parses phone in E.164", () => {
    const n = normalizePhone("(415) 555-0142", "US");
    expect(n.valid).toBe(true);
    expect(n.value?.startsWith("+1")).toBe(true);
    expect(normalizePhone("invalid").valid).toBe(false);
  });

  it("title-cases all-lower names", () => {
    expect(normalizeName("priya patel").value).toBe("Priya Patel");
  });

  it("canonicalizes country aliases", () => {
    expect(normalizeCountry("usa").value).toBe("United States");
    expect(normalizeCountry("Bharat").value).toBe("India");
  });

  it("aliases common skill names", () => {
    expect(normalizeSkill("py").value).toBe("Python");
    expect(normalizeSkill("k8s").value).toBe("Kubernetes");
    expect(normalizeSkill("postgresql").value).toBe("PostgreSQL");
  });

  it("normalizes free-form dates", () => {
    expect(normalizeDate("Jan 2023").value).toBe("2023-01");
    expect(normalizeDate("2023/3").value).toBe("2023-03");
    expect(normalizeDate("present").value).toBe("present");
    expect(normalizeDate("garbage").valid).toBe(false);
  });
});
