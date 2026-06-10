"use client";

/**
 * Batch workflow ("Janet's feature"): a CSV pairs application data with image
 * filenames; the agent drops both in and the queue verifies in parallel —
 * four at a time, each label still inside the ~5 second budget.
 */

import { useEffect, useMemo, useState } from "react";
import {
  FileSpreadsheetIcon,
  FlaskConicalIcon,
  ImagesIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResultPanel } from "@/components/verifier/result-panel";
import { OverallBadge } from "@/components/verifier/status";
import { VerifyError, verifyLabelRequest } from "@/lib/client/api";
import { downscaleImage } from "@/lib/client/downscale";
import { runPool } from "@/lib/client/pool";
import { fetchAsFile, fetchSampleManifest } from "@/lib/client/samples";
import { parseBatchCsv, type BatchRow, type BatchRowError } from "@/lib/verification/batch";
import type { VerificationResult } from "@/lib/verification/types";

/** Keeps a 300-label dump from opening 300 simultaneous requests. */
const CONCURRENCY = 4;

type ItemState =
  | { phase: "queued" }
  | { phase: "missing_image" }
  | { phase: "processing" }
  | { phase: "done"; result: VerificationResult }
  | { phase: "error"; message: string };

interface BatchItem {
  row: BatchRow;
  state: ItemState;
}

export function BatchVerify() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [csvErrors, setCsvErrors] = useState<BatchRowError[]>([]);
  const [images, setImages] = useState<Map<string, File>>(new Map());
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [sampleAvailable, setSampleAvailable] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  useEffect(() => {
    fetchSampleManifest()
      .then((m) => setSampleAvailable(m.batch.images.length > 0))
      .catch(() => {});
  }, []);

  const ready = useMemo(
    () => items.filter((i) => i.state.phase === "queued").length,
    [items],
  );

  function attachImages(rows: BatchRow[], files: Map<string, File>): BatchItem[] {
    return rows.map((row) => ({
      row,
      state: files.has(row.filename)
        ? { phase: "queued" }
        : { phase: "missing_image" },
    }));
  }

  async function onCsvChosen(file: File | undefined | null) {
    if (!file) return;
    const { rows, errors } = parseBatchCsv(await file.text());
    setCsvErrors(errors);
    setItems(attachImages(rows, images));
    setCompleted(0);
    if (rows.length === 0 && errors.length > 0) {
      toast.error(errors[0].message);
    }
  }

  function onImagesChosen(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = new Map(images);
    for (const file of Array.from(list)) next.set(file.name, file);
    setImages(next);
    setItems((current) =>
      attachImages(
        current.map((i) => i.row),
        next,
      ),
    );
  }

  async function loadSampleBatch() {
    setLoadingSample(true);
    try {
      const manifest = await fetchSampleManifest();
      const [csvFile, ...imageFiles] = await Promise.all([
        fetchAsFile(manifest.batch.csv),
        ...manifest.batch.images.map((url) => fetchAsFile(url)),
      ]);
      const next = new Map<string, File>();
      for (const file of imageFiles) next.set(file.name, file);
      setImages(next);
      const { rows, errors } = parseBatchCsv(await csvFile.text());
      setCsvErrors(errors);
      setItems(attachImages(rows, next));
      setCompleted(0);
    } catch {
      toast.error("Could not load the sample batch.");
    } finally {
      setLoadingSample(false);
    }
  }

  async function run() {
    const queue = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.state.phase === "queued");
    if (queue.length === 0) return;

    setRunning(true);
    setCompleted(0);
    setItems((current) =>
      current.map((item) =>
        item.state.phase === "queued"
          ? { ...item, state: { phase: "processing" } }
          : item,
      ),
    );

    await runPool(
      queue,
      async ({ item, index }) => {
        let state: ItemState;
        try {
          const original = images.get(item.row.filename);
          if (!original) throw new VerifyError("Image file not found.");
          const upload = await downscaleImage(original);
          const result = await verifyLabelRequest(item.row.application, upload);
          state = { phase: "done", result };
        } catch (error) {
          state = {
            phase: "error",
            message:
              error instanceof Error ? error.message : "Verification failed.",
          };
        }
        setItems((current) =>
          current.map((it, i) => (i === index ? { ...it, state } : it)),
        );
      },
      CONCURRENCY,
      (done) => setCompleted(done),
    );

    setRunning(false);
  }

  function reset() {
    setItems([]);
    setCsvErrors([]);
    setImages(new Map());
    setCompleted(0);
    setDetailIndex(null);
  }

  const total = items.filter(
    (i) => i.state.phase !== "missing_image",
  ).length;
  const detail = detailIndex !== null ? items[detailIndex] : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Batch upload</CardTitle>
          <CardDescription>
            Upload a CSV of application data plus the label images it refers
            to. Columns: filename, brandName, classType, alcoholPercent,
            netContents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="batch-csv">Application data (CSV)</FieldLabel>
              <label
                htmlFor="batch-csv"
                className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed p-4 hover:bg-accent/50"
              >
                <FileSpreadsheetIcon aria-hidden className="size-5 text-muted-foreground" />
                <span className="text-sm">Choose a CSV file</span>
              </label>
              <input
                id="batch-csv"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={running}
                onChange={(e) => void onCsvChosen(e.target.files?.[0])}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="batch-images">Label images</FieldLabel>
              <label
                htmlFor="batch-images"
                className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed p-4 hover:bg-accent/50"
              >
                <ImagesIcon aria-hidden className="size-5 text-muted-foreground" />
                <span className="text-sm">
                  {images.size > 0
                    ? `${images.size} image${images.size === 1 ? "" : "s"} added`
                    : "Choose image files (multi-select)"}
                </span>
              </label>
              <input
                id="batch-images"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="sr-only"
                disabled={running}
                onChange={(e) => onImagesChosen(e.target.files)}
              />
              <FieldDescription>
                Filenames must match the CSV&apos;s filename column.
              </FieldDescription>
            </Field>
          </div>

          {csvErrors.length > 0 && items.length > 0 && (
            <Alert variant="warning">
              <AlertTitle>
                {csvErrors.length} CSV row{csvErrors.length === 1 ? "" : "s"} skipped
              </AlertTitle>
              <AlertDescription>
                <ul>
                  {csvErrors.slice(0, 5).map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                  {csvErrors.length > 5 && <li>…and {csvErrors.length - 5} more.</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => void run()} disabled={running || ready === 0}>
              {running ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {running
                ? `Checking ${completed} of ${total}…`
                : `Verify ${ready > 0 ? ready : ""} label${ready === 1 ? "" : "s"}`}
            </Button>
            <Button variant="outline" size="lg" onClick={reset} disabled={running}>
              <RotateCcwIcon data-icon="inline-start" />
              Clear
            </Button>
            {sampleAvailable && items.length === 0 && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => void loadSampleBatch()}
                disabled={loadingSample}
              >
                {loadingSample ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FlaskConicalIcon data-icon="inline-start" />
                )}
                Load sample batch
              </Button>
            )}
            {running && total > 0 && (
              <div className="min-w-48 flex-1">
                <Progress value={(completed / total) * 100} aria-label="Batch progress" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSpreadsheetIcon />
            </EmptyMedia>
            <EmptyTitle>No batch loaded</EmptyTitle>
            <EmptyDescription>
              Add a CSV and its label images — or load the sample batch to see
              how it works.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
            <CardDescription>
              Select a row to see its full verification report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Image</TableHead>
                  <TableHead>Brand name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={`${item.row.filename}-${index}`}>
                    <TableCell className="font-mono text-xs">
                      {item.row.filename}
                    </TableCell>
                    <TableCell>{item.row.application.brandName}</TableCell>
                    <TableCell>
                      <ItemStatus state={item.state} />
                    </TableCell>
                    <TableCell className="text-right">
                      {item.state.phase === "done" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailIndex(index)}
                        >
                          <SearchIcon data-icon="inline-start" />
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => !open && setDetailIndex(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.row.application.brandName ?? "Verification report"}
            </DialogTitle>
            <DialogDescription>{detail?.row.filename}</DialogDescription>
          </DialogHeader>
          {detail?.state.phase === "done" && (
            <ResultPanel result={detail.state.result} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemStatus({ state }: { state: ItemState }) {
  switch (state.phase) {
    case "queued":
      return <span className="text-sm text-muted-foreground">Queued</span>;
    case "missing_image":
      return (
        <span className="text-sm text-destructive">Image file not uploaded</span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Checking…
        </span>
      );
    case "done":
      return <OverallBadge status={state.result.overall} />;
    case "error":
      return <span className="text-sm text-destructive">{state.message}</span>;
  }
}
