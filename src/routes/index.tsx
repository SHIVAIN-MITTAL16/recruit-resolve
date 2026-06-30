import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Upload, FileText, Settings2, Play, Sparkles } from "lucide-react";
import { runPipeline, type StageEvent } from "@/lib/pipeline";
import type { PipelineResult, ProjectionConfig } from "@/lib/pipeline/types";
import { ALL_CANONICAL_FIELDS, DEFAULT_PROJECTION } from "@/lib/pipeline/types";
import { ResultsView } from "@/components/results-view";
import { PipelineProgress } from "@/components/pipeline-progress";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Candidate Data Transformer" },
      {
        name: "description",
        content:
          "Deterministic ETL pipeline: parse, normalize, merge, and validate candidate records from recruiter CSV and resume PDF into a canonical profile with provenance and confidence.",
      },
      { property: "og:title", content: "Candidate Data Transformer" },
      {
        property: "og:description",
        content:
          "Multi-source candidate profile builder with provenance, confidence, and explainable merge decisions.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [csv, setCsv] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [config, setConfig] = useState<ProjectionConfig>(DEFAULT_PROJECTION);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);

  async function onTransform() {
    if (!csv && !pdf) {
      toast.error("Provide at least a CSV or a PDF to transform.");
      return;
    }
    setRunning(true);
    setStages([]);
    setResult(null);
    try {
      const r = await runPipeline(
        { csv: csv ?? undefined, pdf: pdf ?? undefined, config },
        (e) => setStages((prev) => [...prev, e]),
      );
      setResult(r);
      toast.success(
        `Pipeline completed in ${r.report.durationMs} ms · ${r.report.counts.mergeAgreements} agreements · ${r.report.counts.mergeConflicts} conflicts`,
      );
    } catch (e) {
      toast.error(`Pipeline failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  async function loadSamples() {
    try {
      const [csvR, pdfR] = await Promise.all([
        fetch("/samples/recruiter.csv"),
        fetch("/samples/resume_aarav_sharma.pdf"),
      ]);
      const csvBlob = await csvR.blob();
      const pdfBlob = await pdfR.blob();
      setCsv(new File([csvBlob], "recruiter.csv", { type: "text/csv" }));
      setPdf(new File([pdfBlob], "resume_aarav_sharma.pdf", { type: "application/pdf" }));
      toast.success("Loaded sample inputs");
    } catch {
      toast.error("Could not load samples");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-right" />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">Candidate Transformer</h1>
              <p className="text-xs text-muted-foreground">
                Deterministic ETL · provenance · explainable merges
              </p>
            </div>
          </div>
          <button
            onClick={loadSamples}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Load sample inputs →
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {!result && !running && (
          <section className="grid gap-6 md:grid-cols-2">
            <FileCard
              icon={<FileText className="h-5 w-5" />}
              title="Recruiter CSV"
              hint="Structured source · per-column extraction · base confidence 0.95"
              accept=".csv,text/csv"
              file={csv}
              onFile={setCsv}
            />
            <FileCard
              icon={<Upload className="h-5 w-5" />}
              title="Resume PDF"
              hint="Unstructured source · heuristic extraction · base confidence 0.80"
              accept="application/pdf,.pdf"
              file={pdf}
              onFile={setPdf}
            />
            <ConfigCard config={config} onChange={setConfig} />
            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-6">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Play className="h-4 w-4" /> Run transform
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Runs parse → extract → normalize → merge → confidence → validate → project. No
                  data leaves the browser.
                </p>
              </div>
              <button
                onClick={onTransform}
                disabled={!csv && !pdf}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> Transform
              </button>
            </div>
          </section>
        )}

        {running && <PipelineProgress stages={stages} />}

        {result && !running && (
          <ResultsView
            result={result}
            config={config}
            onConfigChange={(c) => {
              setConfig(c);
              // Re-run only projector for instant UI update.
              setResult((prev) =>
                prev
                  ? {
                      ...prev,
                      projection: applyProjection(prev, c),
                    }
                  : prev,
              );
            }}
            onReset={() => {
              setResult(null);
              setStages([]);
            }}
          />
        )}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground">
          Built as an engineering demonstrator. Pipeline runs entirely client-side; outputs are
          deterministic given inputs and config.
        </div>
      </footer>
    </div>
  );
}

function applyProjection(result: PipelineResult, cfg: ProjectionConfig) {
  // Re-use projector pure function.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { project } = require("@/lib/pipeline/projector") as typeof import("@/lib/pipeline/projector");
  return project(result.canonical, result.provenance, cfg);
}

function FileCard({
  icon, title, hint, accept, file, onFile,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  return (
    <label className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-6 transition-colors hover:border-foreground/20">
      <div className="flex items-center gap-2 text-sm font-medium">{icon} {title}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="mt-1 rounded-md border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground transition-colors group-hover:border-foreground/30">
        {file ? (
          <span className="font-medium text-foreground">{file.name}</span>
        ) : (
          "Click to select file"
        )}
      </div>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function ConfigCard({
  config, onChange,
}: { config: ProjectionConfig; onChange: (c: ProjectionConfig) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Settings2 className="h-4 w-4" /> Projection config
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Runtime view config. Canonical model is unchanged.
      </p>
      <div className="mt-4 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Include fields
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_CANONICAL_FIELDS.map((f) => {
            const active =
              config.includeFields.length === 0 || config.includeFields.includes(f);
            return (
              <button
                key={f}
                onClick={() => {
                  const base =
                    config.includeFields.length === 0 ? [...ALL_CANONICAL_FIELDS] : [...config.includeFields];
                  const next = active ? base.filter((x) => x !== f) : [...base, f];
                  onChange({ ...config, includeFields: next });
                }}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-4 pt-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config.hideConfidence}
              onChange={(e) => onChange({ ...config, hideConfidence: e.target.checked })}
            />
            Hide confidence
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config.hideProvenance}
              onChange={(e) => onChange({ ...config, hideProvenance: e.target.checked })}
            />
            Hide provenance
          </label>
        </div>
      </div>
    </div>
  );
}
