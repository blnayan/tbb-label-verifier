"use client";

/**
 * Single-label workflow: the agent keys in what the application says, adds
 * the label image, and gets a field-by-field report. One obvious action.
 */

import { useEffect, useState } from "react";
import { FlaskConicalIcon, RotateCcwIcon, ScanSearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ImageDrop } from "@/components/verifier/image-drop";
import { ResultPanel } from "@/components/verifier/result-panel";
import { VerifyError, verifyLabelRequest } from "@/lib/client/api";
import { downscaleImage } from "@/lib/client/downscale";
import {
  fetchAsFile,
  fetchSampleManifest,
  type SampleLabel,
} from "@/lib/client/samples";
import type { VerificationResult } from "@/lib/verification/types";

interface FormState {
  brandName: string;
  classType: string;
  alcoholPercent: string;
  netContents: string;
}

const EMPTY_FORM: FormState = {
  brandName: "",
  classType: "",
  alcoholPercent: "",
  netContents: "",
};

export function SingleVerify() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [samples, setSamples] = useState<SampleLabel[]>([]);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    fetchSampleManifest()
      .then((manifest) => setSamples(manifest.singles))
      .catch(() => {
        /* samples are a convenience — the app works without them */
      });
  }, []);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function loadSample(id: string) {
    const sample = samples.find((s) => s.id === id);
    if (!sample) return;
    setSampleId(id);
    setResult(null);
    setForm({
      brandName: sample.application.brandName,
      classType: sample.application.classType,
      alcoholPercent: String(sample.application.alcoholPercent),
      netContents: sample.application.netContents,
    });
    try {
      setFile(await fetchAsFile(sample.image));
    } catch {
      toast.error("Could not load the sample image.");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      toast.error("Add a label image first.");
      return;
    }
    setPending(true);
    setResult(null);
    try {
      const upload = await downscaleImage(file);
      const verification = await verifyLabelRequest(
        {
          brandName: form.brandName,
          classType: form.classType,
          alcoholPercent: Number(form.alcoholPercent.replace(/%$/, "")),
          netContents: form.netContents,
        },
        upload,
      );
      setResult(verification);
    } catch (error) {
      const message =
        error instanceof VerifyError
          ? error.message
          : "Something went wrong while verifying the label.";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setForm(EMPTY_FORM);
    setFile(null);
    setResult(null);
    setSampleId(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Application details</CardTitle>
          <CardDescription>
            Enter the values from the COLA application, then add the label
            image.
          </CardDescription>
          {samples.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <FlaskConicalIcon aria-hidden className="size-4 text-muted-foreground" />
              <Select
                value={sampleId}
                onValueChange={(value) => {
                  if (typeof value === "string") void loadSample(value);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Load a sample label"
                  disabled={pending}
                >
                  <SelectValue placeholder="Try a sample label…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {samples.map((sample) => (
                      <SelectItem key={sample.id} value={sample.id}>
                        {sample.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="brandName">Brand name</FieldLabel>
                <Input
                  id="brandName"
                  value={form.brandName}
                  onChange={(e) => set("brandName")(e.target.value)}
                  placeholder="OLD TOM DISTILLERY"
                  required
                  disabled={pending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="classType">Class / type designation</FieldLabel>
                <Input
                  id="classType"
                  value={form.classType}
                  onChange={(e) => set("classType")(e.target.value)}
                  placeholder="Kentucky Straight Bourbon Whiskey"
                  required
                  disabled={pending}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="alcoholPercent">Alcohol content</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="alcoholPercent"
                      value={form.alcoholPercent}
                      onChange={(e) => set("alcoholPercent")(e.target.value)}
                      placeholder="45"
                      inputMode="decimal"
                      required
                      disabled={pending}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>% Alc./Vol.</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="netContents">Net contents</FieldLabel>
                  <Input
                    id="netContents"
                    value={form.netContents}
                    onChange={(e) => set("netContents")(e.target.value)}
                    placeholder="750 mL"
                    required
                    disabled={pending}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel>Label image</FieldLabel>
                <ImageDrop file={file} onFileChange={setFile} disabled={pending} />
                <FieldDescription>
                  The government warning is checked automatically — it must
                  match the required text word-for-word.
                </FieldDescription>
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" size="lg" disabled={pending} className="flex-1">
                  {pending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ScanSearchIcon data-icon="inline-start" />
                  )}
                  {pending ? "Checking label…" : "Verify label"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={reset}
                  disabled={pending}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Clear
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verification report</CardTitle>
          <CardDescription>
            Each required label element, checked against the application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending ? (
            <div className="flex flex-col gap-3" aria-label="Checking the label">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : result ? (
            <ResultPanel result={result} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScanSearchIcon />
                </EmptyMedia>
                <EmptyTitle>No label checked yet</EmptyTitle>
                <EmptyDescription>
                  Fill in the application details, add the label image, and
                  select “Verify label”. Results arrive in a few seconds.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
