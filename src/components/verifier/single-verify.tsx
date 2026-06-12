"use client"

/**
 * Single-label upload: the agent keys in what the application says, adds the
 * label image, and uploads. The form locks while the label verifies, and the
 * record's report page opens automatically when the verdict lands — a single
 * upload flows straight into review. (Batch uploads stay fire-and-forget:
 * their results collect on the Verifications page.)
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConicalIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ImageDrop } from "@/components/verifier/image-drop"
import { OVERALL_DISPLAY } from "@/components/verifier/status"
import { VerifyError, verifyLabelRequest } from "@/lib/client/api"
import { downscaleImage } from "@/lib/client/downscale"
import { saveVerification } from "@/lib/client/history"
import { uploadReportHref } from "@/lib/client/review-tab"
import {
  fetchAsFile,
  fetchSampleManifest,
  type SampleLabel,
} from "@/lib/client/samples"
import { finishUpload, startUpload } from "@/lib/client/uploads"
import type {
  ApplicationData,
  VerificationResult,
} from "@/lib/verification/types"

interface FormState {
  brandName: string
  classType: string
  alcoholPercent: string
  netContents: string
  bottlerNameAddress: string
  imported: boolean
  countryOfOrigin: string
}

const EMPTY_FORM: FormState = {
  brandName: "",
  classType: "",
  alcoholPercent: "",
  netContents: "",
  bottlerNameAddress: "",
  imported: false,
  countryOfOrigin: "",
}

export function SingleVerify() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [samples, setSamples] = useState<SampleLabel[]>([])
  const [sampleId, setSampleId] = useState<string | null>(null)
  // Locks the form from upload until the report page takes over (or the
  // verification fails and hands the form back).
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    fetchSampleManifest()
      .then((manifest) => setSamples(manifest.singles))
      .catch(() => {
        /* samples are a convenience — the app works without them */
      })
  }, [])

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function loadSample(id: string) {
    const sample = samples.find((s) => s.id === id)
    if (!sample) return
    setSampleId(id)
    setForm({
      brandName: sample.application.brandName,
      classType: sample.application.classType,
      alcoholPercent: String(sample.application.alcoholPercent),
      netContents: sample.application.netContents,
      bottlerNameAddress: sample.application.bottlerNameAddress,
      imported: Boolean(sample.application.countryOfOrigin),
      countryOfOrigin: sample.application.countryOfOrigin ?? "",
    })
    try {
      setFile(await fetchAsFile(sample.image))
    } catch {
      toast.error("Could not load the sample image.")
    }
  }

  function announceVerdict(filename: string, verification: VerificationResult) {
    const display = OVERALL_DISPLAY[verification.overall]
    if (verification.overall === "pass") {
      toast.success(`${filename}: ${display.label}, auto-approved.`)
    } else if (verification.overall === "fail") {
      toast.error(`${filename}: ${display.label}, auto-rejected.`)
    } else {
      toast.warning(`${filename}: ${display.label}, queued for your review.`)
    }
  }

  /** Verifies and saves; resolves to the saved record's id, null on failure. */
  async function runVerification(
    file: File,
    application: ApplicationData
  ): Promise<string | null> {
    // Tracked as an in-flight upload so the Verifications page still shows
    // it under "Verifying" if the user wanders off mid-verification.
    const uploadId = startUpload({
      source: "single",
      filename: file.name,
      application,
    })
    try {
      const upload = await downscaleImage(file)
      const verification = await verifyLabelRequest(application, upload)
      try {
        const saved = await saveVerification({
          source: "single",
          filename: file.name,
          application,
          result: verification,
          image: upload,
        })
        announceVerdict(file.name, verification)
        return saved.id
      } catch {
        // The verdict must not vanish just because storage failed.
        toast.error(
          `${file.name}: verified (${OVERALL_DISPLAY[verification.overall].label}) but the result could not be saved to Verifications.`
        )
        return null
      }
    } catch (error) {
      const message =
        error instanceof VerifyError
          ? error.message
          : "Something went wrong while verifying the label."
      toast.error(`${file.name}: ${message}`)
      return null
    } finally {
      finishUpload(uploadId)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      toast.error("Add a label image first.")
      return
    }
    const application: ApplicationData = {
      brandName: form.brandName,
      classType: form.classType,
      alcoholPercent: Number(form.alcoholPercent.replace(/%$/, "")),
      netContents: form.netContents,
      bottlerNameAddress: form.bottlerNameAddress.trim(),
      countryOfOrigin: form.imported
        ? form.countryOfOrigin.trim() || undefined
        : undefined,
    }
    setVerifying(true)
    const savedId = await runVerification(file, application)
    if (savedId === null) {
      // Verification or storage failed (already toasted) — hand the form
      // back untouched so the agent can retry.
      setVerifying(false)
      return
    }
    // Straight into review. The form stays locked until the report page
    // takes over, and is cleared for the next label behind the navigation.
    reset()
    router.push(uploadReportHref(savedId))
  }

  function reset() {
    setForm(EMPTY_FORM)
    setFile(null)
    setSampleId(null)
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>Application details</CardTitle>
          <CardDescription>
            Enter the values from the COLA application, then add the label
            image. The report opens as soon as the verification finishes.
          </CardDescription>
          {samples.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <FlaskConicalIcon
                aria-hidden
                className="size-4 text-muted-foreground"
              />
              <Select
                items={Object.fromEntries(samples.map((s) => [s.id, s.name]))}
                value={sampleId}
                onValueChange={(value) => {
                  if (typeof value === "string") void loadSample(value)
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Load a sample label"
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
            {/* Two columns on wide screens — application fields beside the
                label image — so the whole form fits without scrolling. */}
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="brandName">Brand name</FieldLabel>
                  <Input
                    id="brandName"
                    value={form.brandName}
                    onChange={(e) => set("brandName")(e.target.value)}
                    placeholder="OLD TOM DISTILLERY"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="classType">
                    Class / type designation
                  </FieldLabel>
                  <Input
                    id="classType"
                    value={form.classType}
                    onChange={(e) => set("classType")(e.target.value)}
                    placeholder="Kentucky Straight Bourbon Whiskey"
                    required
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="alcoholPercent">
                      Alcohol content
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="alcoholPercent"
                        value={form.alcoholPercent}
                        onChange={(e) => set("alcoholPercent")(e.target.value)}
                        placeholder="45"
                        inputMode="decimal"
                        required
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
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="bottlerNameAddress">
                    Bottler / producer name &amp; address
                  </FieldLabel>
                  <Input
                    id="bottlerNameAddress"
                    value={form.bottlerNameAddress}
                    onChange={(e) => set("bottlerNameAddress")(e.target.value)}
                    placeholder="Old Tom Distillery, Bardstown, KY"
                    required
                  />
                  <FieldDescription>
                    Checked against the label&rsquo;s &ldquo;Bottled by&rdquo; /
                    &ldquo;Imported by&rdquo; statement.
                  </FieldDescription>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="imported">Product origin</FieldLabel>
                    <Select
                      items={{
                        domestic: "Domestic (U.S.)",
                        imported: "Imported",
                      }}
                      value={form.imported ? "imported" : "domestic"}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          imported: value === "imported",
                          countryOfOrigin:
                            value === "imported" ? prev.countryOfOrigin : "",
                        }))
                      }
                    >
                      <SelectTrigger id="imported" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="domestic">
                          Domestic (U.S.)
                        </SelectItem>
                        <SelectItem value="imported">Imported</SelectItem>
                      </SelectContent>
                    </Select>
                    {!form.imported && (
                      <FieldDescription>
                        Imports must show a country of origin statement on the
                        label.
                      </FieldDescription>
                    )}
                  </Field>
                  {form.imported && (
                    <Field>
                      <FieldLabel htmlFor="countryOfOrigin">
                        Country of origin
                      </FieldLabel>
                      <Input
                        id="countryOfOrigin"
                        value={form.countryOfOrigin}
                        onChange={(e) => set("countryOfOrigin")(e.target.value)}
                        placeholder="France"
                        required
                      />
                      <FieldDescription>
                        The label must name this country (e.g. &ldquo;Product of
                        France&rdquo;).
                      </FieldDescription>
                    </Field>
                  )}
                </div>
              </FieldGroup>
              <div className="flex flex-col gap-6 lg:min-h-0">
                <Field className="flex-1 lg:min-h-0">
                  <FieldLabel>Label image</FieldLabel>
                  {/* On wide screens the drop zone fills this box absolutely,
                      so the image never dictates the form's height — the
                      preview letterboxes inside whatever space the fields
                      leave it. */}
                  <div className="relative flex-1 lg:min-h-72">
                    <ImageDrop
                      file={file}
                      onFileChange={setFile}
                      className="lg:absolute lg:inset-0"
                    />
                  </div>
                  <FieldDescription>
                    The government warning is checked automatically. It must
                    match the required text word for word.
                  </FieldDescription>
                </Field>
                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    size="lg"
                    className="flex-1"
                    disabled={verifying}
                  >
                    {verifying ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <UploadIcon data-icon="inline-start" />
                    )}
                    {verifying ? "Verifying…" : "Upload"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={verifying}
                    onClick={reset}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
