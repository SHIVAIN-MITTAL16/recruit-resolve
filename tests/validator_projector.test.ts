import { describe, it, expect } from "vitest";
import { validateCanonical } from "@/lib/pipeline/validator";
import { project } from "@/lib/pipeline/projector";
import type { CanonicalCandidate, ResolvedField } from "@/lib/pipeline/types";

const canonical: CanonicalCandidate = {
  fullName: "Aarav Sharma",
  email: "a@b.com",
  phone: "+911234567890",
  country: "India",
  currentCompany: "Stripe",
  currentTitle: "Staff Software Engineer",
  skills: ["Python", "React"],
  experience: [],
  education: [],
};

const prov: Record<string, ResolvedField<unknown>> = Object.fromEntries(
  Object.keys(canonical).map((k) => [
    k,
    { value: null, confidence: 0.9, chosen: null, candidates: [], reason: "test" },
  ]),
);

describe("validator", () => {
  it("accepts a well-formed canonical", () => {
    expect(validateCanonical(canonical).ok).toBe(true);
  });
  it("rejects an invalid email", () => {
    const v = validateCanonical({ ...canonical, email: "not-email" });
    expect(v.ok).toBe(false);
    expect(v.issues.length).toBeGreaterThan(0);
  });
});

describe("projector", () => {
  it("respects includeFields", () => {
    const out = project(canonical, prov, {
      includeFields: ["fullName", "email"],
      excludeFields: [],
      rename: {},
      hideConfidence: true,
      hideProvenance: true,
    });
    expect(Object.keys(out).sort()).toEqual(["email", "fullName"]);
  });
  it("renames keys", () => {
    const out = project(canonical, prov, {
      includeFields: ["fullName"],
      excludeFields: [],
      rename: { fullName: "name" },
      hideConfidence: true,
      hideProvenance: true,
    });
    expect(out.name).toBe("Aarav Sharma");
  });
});
