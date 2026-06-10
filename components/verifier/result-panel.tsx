/**
 * Field-by-field verification report. Used by the single-label view and the
 * batch detail dialog — the agent sees the same report either way.
 */

import { InfoIcon, TimerIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  FieldStatusBadge,
  OVERALL_DISPLAY,
  OverallBadge,
} from "@/components/verifier/status";
import { fieldLabel } from "@/lib/verification/rules";
import type { VerificationResult } from "@/lib/verification/types";

export function ResultPanel({ result }: { result: VerificationResult }) {
  const overall = OVERALL_DISPLAY[result.overall];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <OverallBadge status={result.overall} />
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <TimerIcon aria-hidden className="size-4" />
          {(result.extractionMs / 1000).toFixed(1)}s
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{overall.summary}</p>

      {result.extraction.imageQualityNotes && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Image quality note</AlertTitle>
          <AlertDescription>
            {result.extraction.imageQualityNotes}
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      <ul className="flex flex-col gap-3">
        {result.fields.map((field) => (
          <li key={field.field} className="flex flex-col gap-1 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{fieldLabel(field.field)}</span>
              <FieldStatusBadge status={field.status} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-muted-foreground">Application</dt>
              <dd className="break-words">{truncate(field.expected)}</dd>
              <dt className="text-muted-foreground">On label</dt>
              <dd className="break-words">
                {field.found === null ? (
                  <span className="text-muted-foreground italic">not found</span>
                ) : (
                  truncate(field.found)
                )}
              </dd>
            </dl>
            {field.note && (
              <p className="text-sm text-muted-foreground">{field.note}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The government warning is ~80 words; keep rows scannable. */
function truncate(text: string, max = 180): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
