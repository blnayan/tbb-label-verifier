"use client"

/**
 * Verifications page body: the saved verifications from IndexedDB, grouped
 * by review status — Needs review / Approved / Rejected / All. In-flight
 * uploads are not a status a record can hold, so they don't get a tab:
 * a live strip above the tabs shows what's still verifying and disappears
 * when idle. The page is live: it subscribes to upload and history changes,
 * so results stream in from either upload flow (any tab) without a reload.
 *
 * One consolidated Status column tells the whole story per row: while a
 * record is pending, the rule verdict explains *why* it waits (needs review,
 * unreadable image); once decided, the decision is shown (auto/manual), with
 * an "Override" marker whenever a human contradicted the rules — the
 * audit-critical case. Each row links to the record's own report page
 * (/verifications/[id]), where the decision is made or revisited.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { HistoryIcon, InboxIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReviewStatusBadge } from "@/components/verifier/status"
import {
  clearVerifications,
  listVerifications,
  subscribeToVerifications,
  type VerificationRecord,
} from "@/lib/client/history"
import {
  parseReviewTab,
  reportHref,
  verificationsHref,
  type ReviewTab,
} from "@/lib/client/review-tab"
import {
  listInFlight,
  subscribeToUploads,
  type InFlightUpload,
} from "@/lib/client/uploads"

type TabValue = ReviewTab

const TAB_EMPTY: Record<TabValue, { title: string; description: string }> = {
  pending: {
    title: "Nothing waiting for review",
    description:
      "Ambiguous results — close matches and unreadable images — will queue here for your decision.",
  },
  approved: {
    title: "No approved verifications",
    description:
      "Clean passes are approved automatically, and your manual approvals join them here.",
  },
  rejected: {
    title: "No rejected verifications",
    description:
      "Rule failures are rejected automatically, and your manual rejections join them here.",
  },
  all: {
    title: "No verifications yet",
    description: "Upload a label — single or batch — and it will land here.",
  },
}

const TAB_TABLE: Record<TabValue, { title: string; description: string }> = {
  pending: {
    title: "Waiting on your decision",
    description:
      "Open a report, compare the label against the application, then approve or reject.",
  },
  approved: {
    title: "Approved",
    description:
      "Automatic and manual approvals. Open one to revisit — decisions can be changed.",
  },
  rejected: {
    title: "Rejected",
    description:
      "Automatic and manual rejections. Open one to revisit — decisions can be changed.",
  },
  all: {
    title: "All verifications",
    description: "Everything verified on this device, newest first.",
  },
}

export function ReviewHistory() {
  // null means "still loading from IndexedDB".
  const [records, setRecords] = useState<VerificationRecord[] | null>(null)
  // Module state is empty on the server and after a reload, so the lazy
  // read can never disagree with server-rendered HTML.
  const [inFlight, setInFlight] = useState<InFlightUpload[]>(() =>
    listInFlight()
  )
  // The active tab lives in the URL (?tab=…) so a report page can send the
  // user back to the tab they left from. A fresh visit lands on "All" — the
  // full chronological record — with the "Needs review" badge signaling any
  // waiting queue.
  const tab = parseReviewTab(useSearchParams().get("tab"))

  useEffect(() => {
    listVerifications()
      .then(setRecords)
      .catch(() => {
        setRecords([])
        toast.error("Could not load the verification history.")
      })
  }, [])

  // Live updates: uploads notify instantly; history refreshes are debounced
  // so a draining batch coalesces into one re-read instead of one per label.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribeHistory = subscribeToVerifications(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        listVerifications()
          .then(setRecords)
          .catch(() => {})
      }, 250)
    })
    const unsubscribeUploads = subscribeToUploads(() =>
      setInFlight(listInFlight())
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribeHistory()
      unsubscribeUploads()
    }
  }, [])

  async function clearAll() {
    try {
      await clearVerifications()
      setRecords([])
      toast.success("Verification history cleared.")
    } catch {
      toast.error("Could not clear the history.")
    }
  }

  if (records === null) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading history">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (records.length === 0 && inFlight.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>No verifications yet</EmptyTitle>
          <EmptyDescription>
            Upload a label — single or batch — and it will land here. Clear
            passes and fails are decided automatically; everything else waits
            for your review.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const byTab: Record<TabValue, VerificationRecord[]> = {
    pending: records.filter((r) => r.review.state === "pending"),
    approved: records.filter((r) => r.review.state === "approved"),
    rejected: records.filter((r) => r.review.state === "rejected"),
    all: records,
  }

  return (
    <div className="flex flex-col gap-4">
      <VerifyingStrip uploads={inFlight} />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          // Shallow update: switching tabs filters in place, so it should
          // not re-render the route or grow the browser history.
          window.history.replaceState(
            null,
            "",
            verificationsHref(value as TabValue)
          )
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-11">
            <TabsTrigger value="all" className="px-4 text-base">
              All
              <Badge variant="secondary" className="ml-2">
                {records.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="pending" className="px-4 text-base">
              Needs review
              {byTab.pending.length > 0 && (
                <Badge variant="warning" className="ml-2">
                  {byTab.pending.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" className="px-4 text-base">
              Approved
              <Badge variant="secondary" className="ml-2">
                {byTab.approved.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="rejected" className="px-4 text-base">
              Rejected
              <Badge variant="secondary" className="ml-2">
                {byTab.rejected.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <ClearHistoryButton count={records.length} onClear={clearAll} />
        </div>

        {(Object.keys(byTab) as TabValue[]).map((value) => (
          <TabsContent key={value} value={value}>
            {byTab[value].length === 0 ? (
              <TabEmpty value={value} />
            ) : (
              <RecordsTable
                title={TAB_TABLE[value].title}
                description={TAB_TABLE[value].description}
                records={byTab[value]}
                tab={value}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function TabEmpty({ value }: { value: TabValue }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{TAB_EMPTY[value].title}</EmptyTitle>
        <EmptyDescription>{TAB_EMPTY[value].description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * In-flight uploads are transient status, not a review category, so they
 * get an ambient strip above the tabs instead of a tab of their own. It is
 * visible from any tab while uploads run and gone when the page is idle.
 */
function VerifyingStrip({ uploads }: { uploads: InFlightUpload[] }) {
  if (uploads.length === 0) return null

  const names = uploads.map((u) => u.application.brandName || u.filename)
  const shown = names.slice(0, 3)
  const more = names.length - shown.length

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2.5 text-sm"
    >
      <Spinner className="size-4 shrink-0" />
      <span className="shrink-0 font-medium">
        Verifying {uploads.length} label{uploads.length === 1 ? "" : "s"}…
      </span>
      <span className="truncate text-muted-foreground" title={names.join(", ")}>
        {shown.join(", ")}
        {more > 0 && ` +${more} more`}
      </span>
    </div>
  )
}

function RecordsTable({
  title,
  description,
  records,
  tab,
}: {
  title: string
  description: string
  records: VerificationRecord[]
  tab: TabValue
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Verified</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Report</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatTimestamp(record.createdAt)}
                </TableCell>
                <TableCell className="max-w-56">
                  <LabelCell
                    brandName={record.application.brandName}
                    filename={record.filename}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {record.source === "single" ? "Single" : "Batch"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ReviewStatusBadge record={record} />
                </TableCell>
                <TableCell className="text-right">
                  {/* Fixed width: "Review" and "Revisit" must not produce
                      different button sizes across tabs. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-24"
                    nativeButton={false}
                    render={<Link href={reportHref(record.id, tab)} />}
                  >
                    <SearchIcon data-icon="inline-start" />
                    {record.review.state === "pending" ? "Review" : "Revisit"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ClearHistoryButton({
  count,
  onClear,
}: {
  count: number
  onClear: () => Promise<void>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" disabled={count === 0}>
            <Trash2Icon data-icon="inline-start" />
            Clear history
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear the verification history?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes all {count} saved verification
            {count === 1 ? "" : "s"} — pending and reviewed — including the
            label images. There is no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void onClear()}
          >
            Clear history
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Brand with the filename beneath it; both truncate so the row never
 *  widens the table past its card. */
function LabelCell({
  brandName,
  filename,
}: {
  brandName: string
  filename: string
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-medium" title={brandName}>
        {brandName}
      </span>
      <span
        className="truncate font-mono text-xs text-muted-foreground"
        title={filename}
      >
        {filename}
      </span>
    </div>
  )
}

/** Compact for table rows — the report page shows the full timestamp. */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
