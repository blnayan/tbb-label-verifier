"use client"

/**
 * Full-screen review of one verification: the whole job fits one viewport,
 * no scrolling. The label image sits center stage sized to the screen, the
 * application — what the label must show — on its left, and what was read
 * off the label — each field with its match status — on its right, with
 * Approve/Reject in the header. The page lives outside the dashboard shell
 * because its navbar would only steal height from the image; either panel
 * scrolls internally if it ever runs long, the page itself never does.
 * (Small screens stack the panels and scroll normally — one-screen review
 * is a desktop promise.)
 *
 * The record loads from IndexedDB by id, so the page only works in the
 * browser that verified the label — consistent with history being
 * device-local. A cleared or unknown id gets a friendly dead end.
 *
 * Review runs as a session over the tab the user came from (?tab=…):
 * Back/Next buttons step through that tab's records without deciding, and
 * an approve/reject advances to the next one automatically — computed
 * before the decision lands, so deciding a pending label still leads to
 * the next pending one. When the queue runs dry, the session exits back
 * to the list.
 *
 * A report opened straight from a single upload (?from=upload) is not a
 * session: the back option and the post-decision exit both return to
 * Upload for the next label, and the queue-stepping buttons stay hidden.
 */

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  InfoIcon,
  SearchXIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  FieldStatusBadge,
  OVERALL_DISPLAY,
  OverallBadge,
  ReviewStatusBadge,
} from "@/components/verifier/status"
import { useObjectUrl } from "@/hooks/use-object-url"
import {
  listVerifications,
  reviewVerification,
  subscribeToVerifications,
  type ReviewDecision,
  type VerificationRecord,
} from "@/lib/client/history"
import {
  nextReportHref,
  parseReviewTab,
  previousReportHref,
  verificationsHref,
} from "@/lib/client/review-tab"
import { fieldLabel } from "@/lib/verification/rules"

/** Application | image | on-label — the image gets the widest track. */
const PANES_GRID =
  "grid flex-1 gap-4 lg:min-h-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)]"

/**
 * Stepping between reports remounts the page (the App Router keys pages by
 * their segment), so component state alone would reset to "loading" and
 * flash the skeleton on every Back/Next. The last-loaded list survives here
 * at module scope instead: the next mount paints its record immediately and
 * the IndexedDB re-read refreshes it in the background. Blobs are cheap to
 * hold — they are references, not copies of the image bytes.
 */
let cachedRecords: VerificationRecord[] | undefined

export function ReviewDetail({ id }: { id: string }) {
  const router = useRouter()
  const params = useSearchParams()
  // The list page tags report links with the tab they came from (?tab=…),
  // so the back link, the Next button, and the post-decision redirect all
  // work the tab the user left, not "All". A single upload tags its report
  // ?from=upload instead — its exits lead back to Upload.
  const tab = parseReviewTab(params.get("tab"))
  const fromUpload = params.get("from") === "upload"
  const backHref = fromUpload ? "/" : verificationsHref(tab)
  const backLabel = fromUpload ? "Upload" : "Verifications"
  // The whole history loads, not just the one record: the review session
  // needs the list to know which report comes next on this tab.
  // undefined = still loading from IndexedDB (first visit this session).
  const [records, setRecords] = useState<VerificationRecord[] | undefined>(
    cachedRecords
  )
  // A decision in flight freezes the page on its pre-decision snapshot.
  // Saving the decision triggers the live re-read, which would otherwise
  // flip the badge and drop a button on a page the user is about to leave —
  // a flash of layout shift right before the next report appears. Keyed to
  // the record so it can never freeze a different report.
  const [decidingRecord, setDecidingRecord] =
    useState<VerificationRecord | null>(null)
  const deciding = decidingRecord?.id === id
  // null = no such record (cleared, or another device's history).
  const liveRecord =
    records === undefined
      ? undefined
      : (records.find((r) => r.id === id) ?? null)
  const record = deciding ? decidingRecord : liveRecord
  const nextHref =
    records && !fromUpload ? nextReportHref(records, id, tab) : null
  const prevHref =
    records && !fromUpload ? previousReportHref(records, id, tab) : null
  const imageUrl = useObjectUrl(record?.image ?? null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listVerifications()
        .then((found) => {
          cachedRecords = found
          if (!cancelled) setRecords(found)
        })
        .catch(() => {
          if (!cancelled) {
            setRecords([])
            toast.error("Could not load the verification.")
          }
        })
    void load()
    // Stay live: a decision in another tab (or a cleared history) shows here.
    const unsubscribe = subscribeToVerifications(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function decide(target: VerificationRecord, decision: ReviewDecision) {
    setDecidingRecord(target)
    // Where to go after: settled from the pre-decision list, because the
    // decision itself may move this record off the current tab.
    const onwardHref = nextHref ?? backHref
    try {
      await reviewVerification(target.id, decision)
      toast.success(
        decision === "approved"
          ? `${target.application.brandName} approved.`
          : `${target.application.brandName} rejected.`
      )
      router.push(onwardHref)
    } catch {
      toast.error("Could not save the review decision.")
      setDecidingRecord(null)
    }
  }

  if (record === undefined) {
    return (
      <div
        className="flex h-dvh flex-col gap-4 p-4"
        aria-label="Loading verification"
      >
        <Skeleton className="h-12 w-full shrink-0" />
        <div className={PANES_GRID}>
          <Skeleton className="h-full min-h-48" />
          <Skeleton className="h-full min-h-48" />
          <Skeleton className="h-full min-h-48" />
        </div>
      </div>
    )
  }

  if (record === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Verification not found</EmptyTitle>
            <EmptyDescription>
              It may have been cleared, or it was verified in a different
              browser. History stays on the device that did the work.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={backHref} />}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Back to {backLabel.toLowerCase()}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const { application, result } = record
  const overall = OVERALL_DISPLAY[result.overall]

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4 lg:h-dvh">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href={backHref}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            {backLabel}
          </Link>
          {/* The base separator self-stretches; pin the fixed height to the
              row's center so it aligns with the link and title midline. */}
          <Separator orientation="vertical" className="h-8! self-center!" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {application.brandName}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {record.filename}, verified{" "}
              {formatFullTimestamp(record.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ReviewStatusBadge record={record} />
          {record.review.state !== "rejected" && (
            <Button
              variant="destructive"
              disabled={deciding}
              onClick={() => void decide(record, "rejected")}
            >
              <XCircleIcon data-icon="inline-start" />
              Reject
            </Button>
          )}
          {record.review.state !== "approved" && (
            <Button
              variant="success"
              disabled={deciding}
              onClick={() => void decide(record, "approved")}
            >
              <CheckCircle2Icon data-icon="inline-start" />
              Approve
            </Button>
          )}
          {/* Step through this tab's records without deciding; disabled
              (not hidden) at either end of the queue so the header keeps
              its shape on the first and last record. From an upload there
              is no queue — the pair disappears entirely. */}
          {!fromUpload && (
            <>
              <StepButton href={prevHref} disabled={deciding}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </StepButton>
              <StepButton href={nextHref} disabled={deciding}>
                Next
                <ArrowRightIcon data-icon="inline-end" />
              </StepButton>
            </>
          )}
        </div>
      </header>

      <div className={PANES_GRID}>
        <Card className="lg:max-h-full lg:min-h-0 lg:self-start lg:overflow-hidden">
          <CardHeader>
            <CardTitle>Application</CardTitle>
            <CardDescription>
              What the COLA application says the label must show.
            </CardDescription>
          </CardHeader>
          <CardContent className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <dl className="flex flex-col gap-3">
              {/* Includes the statutory government warning — not application
                  data, but a reviewer comparing a defective print against the
                  required wording wants both in view. */}
              {result.fields.map((field) => (
                <div key={field.field} className="flex flex-col gap-0.5">
                  <dt className="text-sm font-medium text-muted-foreground">
                    {fieldLabel(field.field)}
                  </dt>
                  <dd className="text-sm break-words">
                    {/* 27 CFR 16.22(b): the words "GOVERNMENT WARNING" (not
                        the colon) must appear in capitals and bold type —
                        present the required text the way the label must. */}
                    {field.expected.startsWith("GOVERNMENT WARNING") ? (
                      <>
                        <strong>GOVERNMENT WARNING</strong>
                        {field.expected.slice("GOVERNMENT WARNING".length)}
                      </>
                    ) : (
                      field.expected
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {imageUrl && (
          <figure className="h-[60vh] lg:h-auto lg:min-h-0">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              title="The label as verified. Click to open it full size."
              className="block h-full w-full"
            >
              {/* object URL — next/image can't optimize blob: URLs */}
              <Image
                src={imageUrl}
                alt="Verified label image"
                width={1200}
                height={1600}
                unoptimized
                className="h-full w-full object-contain"
              />
            </a>
          </figure>
        )}

        <Card className="lg:max-h-full lg:min-h-0 lg:self-start lg:overflow-hidden">
          <CardHeader>
            <CardTitle>On label</CardTitle>
            <CardDescription>
              What the AI read off the image. It only does the reading: every
              pass or fail below comes from the compliance rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
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

            {/* Only the field list scrolls — verdict, summary, and notes
                above the line stay in view. */}
            <ul className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {result.fields.map((field) => (
                <li
                  key={field.field}
                  className="flex flex-col gap-1.5 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {fieldLabel(field.field)}
                    </span>
                    <FieldStatusBadge status={field.status} />
                  </div>
                  <p className="text-sm break-words">
                    {field.found === null ? (
                      <span className="text-muted-foreground italic">
                        not found
                      </span>
                    ) : field.field === "governmentWarning" &&
                      result.extraction.governmentWarning.headingAppearsBold &&
                      /^government warning/i.test(field.found) ? (
                      // Mirror the type weight the model reported, so the
                      // transcription reads the way the label prints it.
                      <>
                        <strong>
                          {field.found.slice(0, "GOVERNMENT WARNING".length)}
                        </strong>
                        {field.found.slice("GOVERNMENT WARNING".length)}
                      </>
                    ) : (
                      field.found
                    )}
                  </p>
                  {field.note && (
                    <p className="text-sm text-muted-foreground">
                      {field.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** A queue-stepping link styled as a button; a dead end renders disabled. */
function StepButton({
  href,
  disabled,
  children,
}: {
  href: string | null
  disabled: boolean
  children: React.ReactNode
}) {
  if (href === null || disabled) {
    return (
      <Button variant="outline" disabled>
        {children}
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  )
}

function formatFullTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
