import { Check, Loader2 } from "lucide-react";
import type { StageEvent, StageName } from "@/lib/pipeline";

const STAGES: { key: StageName; label: string }[] = [
  { key: "parse_csv", label: "Reading CSV" },
  { key: "parse_pdf", label: "Reading Resume PDF" },
  { key: "extract", label: "Extracting fields" },
  { key: "normalize", label: "Normalizing values" },
  { key: "merge", label: "Merging & resolving conflicts" },
  { key: "confidence", label: "Computing confidence" },
  { key: "validate", label: "Validating schema" },
  { key: "project", label: "Generating canonical JSON" },
];

export function PipelineProgress({ stages }: { stages: StageEvent[] }) {
  const status = (s: StageName): "pending" | "active" | "done" => {
    const events = stages.filter((e) => e.stage === s);
    if (events.some((e) => e.status === "done")) return "done";
    if (events.some((e) => e.status === "start")) return "active";
    return "pending";
  };
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8">
      <h2 className="text-sm font-medium">Running pipeline</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Eight deterministic stages. Each one is a pure function over its inputs.
      </p>
      <ol className="mt-6 space-y-2">
        {STAGES.map((s) => {
          const st = status(s.key);
          return (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                st === "active"
                  ? "bg-muted text-foreground"
                  : st === "done"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="grid h-5 w-5 place-items-center">
                {st === "done" ? (
                  <Check className="h-4 w-4 text-foreground" />
                ) : st === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              {s.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
