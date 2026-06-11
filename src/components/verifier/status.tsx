/**
 * Status display vocabulary shared by single and batch views.
 *
 * Every status pairs an icon with a plain-English label — color is never the
 * only signal, both for accessibility and for agents skimming a long batch.
 */

import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleHelpIcon,
  ImageOffIcon,
  MinusCircleIcon,
  SearchXIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { VerificationRecord } from "@/lib/client/history"
import type { FieldStatus, OverallStatus } from "@/lib/verification/types"

type BadgeVariant = "success" | "warning" | "destructive" | "secondary"

export const OVERALL_DISPLAY: Record<
  OverallStatus,
  { label: string; variant: BadgeVariant; icon: LucideIcon; summary: string }
> = {
  pass: {
    label: "Pass",
    variant: "success",
    icon: CheckCircle2Icon,
    summary: "Everything on the label matches the application.",
  },
  needs_review: {
    label: "Needs review",
    variant: "warning",
    icon: CircleHelpIcon,
    summary:
      "Close matches or advisories found — please review the notes below.",
  },
  fail: {
    label: "Issues found",
    variant: "destructive",
    icon: XCircleIcon,
    summary: "At least one required element is wrong or missing.",
  },
  unreadable: {
    label: "Can't read label",
    variant: "secondary",
    icon: ImageOffIcon,
    summary: "The image can't be verified — request a clearer photograph.",
  },
}

export const FIELD_DISPLAY: Record<
  FieldStatus,
  { label: string; variant: BadgeVariant; icon: LucideIcon }
> = {
  match: { label: "Match", variant: "success", icon: CheckCircle2Icon },
  close_match: {
    label: "Close match",
    variant: "warning",
    icon: CircleAlertIcon,
  },
  mismatch: { label: "Mismatch", variant: "destructive", icon: XCircleIcon },
  not_found: { label: "Not found", variant: "destructive", icon: SearchXIcon },
  not_checked: {
    label: "Not checked",
    variant: "secondary",
    icon: MinusCircleIcon,
  },
}

export function OverallBadge({ status }: { status: OverallStatus }) {
  const display = OVERALL_DISPLAY[status]
  const Icon = display.icon
  return (
    <Badge variant={display.variant} className="h-7 px-3 text-sm">
      <Icon data-icon="inline-start" />
      {display.label}
    </Badge>
  )
}

export function FieldStatusBadge({ status }: { status: FieldStatus }) {
  const display = FIELD_DISPLAY[status]
  const Icon = display.icon
  return (
    <Badge variant={display.variant}>
      <Icon data-icon="inline-start" />
      {display.label}
    </Badge>
  )
}

/**
 * The consolidated review status of a record. Pending records show the rule
 * verdict — it is the reason they wait (needs review vs. unreadable image).
 * Decided records show the decision and how it was made, with an Override
 * marker when a manual decision contradicts what the rules concluded.
 */
export function ReviewStatusBadge({ record }: { record: VerificationRecord }) {
  const { review, result } = record
  if (review.state === "pending") {
    return <OverallBadge status={result.overall} />
  }

  const auto = review.mode === "auto"
  const approved = review.state === "approved"
  const Icon = auto ? ZapIcon : approved ? CheckCircle2Icon : XCircleIcon
  const overrode =
    !auto &&
    ((approved && result.overall === "fail") ||
      (!approved && result.overall === "pass"))

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={approved ? "success" : "destructive"}>
        <Icon data-icon="inline-start" />
        {auto
          ? approved
            ? "Auto-approved"
            : "Auto-rejected"
          : approved
            ? "Approved"
            : "Rejected"}
      </Badge>
      {overrode && (
        <Badge variant="outline" title="A reviewer overrode the rule verdict">
          Override
        </Badge>
      )}
    </span>
  )
}
