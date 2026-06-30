import { useState } from "react";
import { ArrowLeft, Copy, Download } from "lucide-react";
import type { PipelineResult, ProjectionConfig } from "@/lib/pipeline/types";
import { toast } from "sonner";

type Tab = "overview" | "decisions" | "provenance" | "json" | "report";

export function ResultsView({
  result, config, onConfigChange, onReset,
}: {
  result: PipelineResult;
  config: ProjectionConfig;
  onConfigChange: (c: ProjectionConfig) => void;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "decisions", label: "Merge decisions" },
    { id: "provenance", label: "Provenance" },
    { id: "json", label: "Canonical JSON" },
    { id: "report", label: "Engineering report" },
  ];
  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> New transform
        </button>
        <div className="text-xs text-muted-foreground">
          {result.report.durationMs} ms · {result.report.counts.fieldsExtracted} fields extracted ·{" "}
          {result.report.counts.mergeAgreements} agreements ·{" "}
          {result.report.counts.mergeConflicts} conflicts
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex gap-1 border-b border-border px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-3 py-3 text-sm transition-colors ${
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 bg-foreground" />
              )}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === "overview" && <Overview result={result} />}
          {tab === "decisions" && <Decisions result={result} />}
          {tab === "provenance" && <Provenance result={result} />}
          {tab === "json" && (
            <JsonView result={result} config={config} onConfigChange={onConfigChange} />
          )}
          {tab === "report" && <Report result={result} />}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function Overview({ result }: { result: PipelineResult }) {
  const c = result.canonical;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{c.fullName}</h2>
        <p className="text-sm text-muted-foreground">
          {[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || "No current role"}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Email" value={c.email} />
        <Stat label="Phone" value={c.phone} />
        <Stat label="Country" value={c.country} />
        <Stat label="Skills" value={c.skills.length > 0 ? c.skills.join(", ") : null} />
        <Stat
          label="Experience"
          value={
            c.experience.length > 0
              ? `${c.experience.length} role${c.experience.length > 1 ? "s" : ""}`
              : null
          }
        />
        <Stat
          label="Education"
          value={
            c.education.length > 0
              ? c.education.map((e) => e.institution).join(" · ")
              : null
          }
        />
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function kindBadge(kind: string) {
  const map: Record<string, string> = {
    agreement: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    conflict: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    "single-source": "bg-muted text-muted-foreground",
    union: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[kind] ?? "bg-muted"}`}>
      {kind}
    </span>
  );
}

function Decisions({ result }: { result: PipelineResult }) {
  return (
    <div className="space-y-3">
      {result.decisions.map((d, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{d.field}</span>
              {kindBadge(d.kind)}
            </div>
            <ConfidenceBar value={d.confidence} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {d.inputs.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No evidence from any source
              </div>
            )}
            {d.inputs.map((inp, j) => (
              <div
                key={j}
                className={`rounded-md border p-3 text-xs ${
                  d.selected.source === inp.source
                    ? "border-foreground/30 bg-muted/40"
                    : "border-border"
                }`}
              >
                <div className="font-medium text-muted-foreground">{inp.source}</div>
                <div className="mt-1 break-words font-mono text-foreground">
                  {formatVal(inp.value)}
                </div>
                {inp.raw && inp.raw !== String(inp.value) && (
                  <div className="mt-1 text-muted-foreground">raw: {inp.raw}</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">→ {d.reason}</div>
        </div>
      ))}
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function Provenance({ result }: { result: PipelineResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Field</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 pr-4 font-medium">Method</th>
            <th className="py-2 pr-4 font-medium">Normalizations</th>
            <th className="py-2 pr-4 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(result.provenance).map(([field, prov]) => (
            <tr key={field} className="border-b border-border last:border-0">
              <td className="py-3 pr-4 font-medium">{field}</td>
              <td className="py-3 pr-4 text-muted-foreground">
                {prov.chosen?.source ?? <span className="italic">—</span>}
              </td>
              <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                {prov.chosen?.method ?? "—"}
              </td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">
                {prov.chosen?.normalizations.join(", ") || "—"}
              </td>
              <td className="py-3 pr-4">
                <ConfidenceBar value={prov.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonView({
  result, config, onConfigChange,
}: {
  result: PipelineResult;
  config: ProjectionConfig;
  onConfigChange: (c: ProjectionConfig) => void;
}) {
  const json = JSON.stringify(result.projection, null, 2);
  function copy() {
    navigator.clipboard.writeText(json);
    toast.success("Copied to clipboard");
  }
  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.canonical.fullName.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.hideConfidence}
            onChange={(e) => onConfigChange({ ...config, hideConfidence: e.target.checked })}
          />
          Hide confidence
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={config.hideProvenance}
            onChange={(e) => onConfigChange({ ...config, hideProvenance: e.target.checked })}
          />
          Hide provenance
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" /> Download JSON
          </button>
        </div>
      </div>
      <pre className="max-h-[600px] overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed">
        <code>{json}</code>
      </pre>
    </div>
  );
}

function Report({ result }: { result: PipelineResult }) {
  const r = result.report;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duration" value={`${r.durationMs} ms`} />
        <Stat
          label="CSV rows"
          value={r.inputs.csv.provided ? `${r.inputs.csv.rows} (${r.inputs.csv.bytes}B)` : null}
        />
        <Stat
          label="PDF pages"
          value={r.inputs.pdf.provided ? `${r.inputs.pdf.pages} (${r.inputs.pdf.bytes}B)` : null}
        />
        <Stat label="Validation" value={r.validation.ok ? "passed" : "failed"} />
        <Stat label="Fields extracted" value={r.counts.fieldsExtracted} />
        <Stat label="Normalizations applied" value={r.counts.fieldsNormalized} />
        <Stat label="Duplicate skills removed" value={r.counts.duplicateSkillsRemoved} />
        <Stat
          label="Merge decisions"
          value={`${r.counts.mergeAgreements} agreements · ${r.counts.mergeConflicts} conflicts`}
        />
      </div>

      <Section title="Warnings" empty="No warnings">
        {r.warnings.map((w, i) => (
          <div key={i} className="font-mono text-xs text-muted-foreground">
            {w}
          </div>
        ))}
      </Section>

      <Section title="Invalid emails" empty="None">
        {r.invalid.emails.map((e, i) => (
          <div key={i} className="font-mono text-xs">{e}</div>
        ))}
      </Section>
      <Section title="Invalid phones" empty="None">
        {r.invalid.phones.map((p, i) => (
          <div key={i} className="font-mono text-xs">{p}</div>
        ))}
      </Section>

      {!r.validation.ok && (
        <Section title="Validation issues" empty="None">
          {r.validation.issues.map((i, idx) => (
            <div key={idx} className="font-mono text-xs text-amber-600">{i}</div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title, empty, children,
}: { title: string; empty: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-1 rounded-md border border-border p-3">
        {arr.length === 0 ? (
          <div className="text-xs text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
