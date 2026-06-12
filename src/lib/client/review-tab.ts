/**
 * The verifications page's active tab, carried in the URL (?tab=…) so that
 * opening a report and coming back — via the back link or after an
 * approve/reject — lands on the tab the user left from. "all" is the
 * default and stays out of the URL to keep the bare /verifications
 * address canonical.
 */

export const REVIEW_TABS = ["pending", "approved", "rejected", "all"] as const

export type ReviewTab = (typeof REVIEW_TABS)[number]

/** Tab from a ?tab= param; anything unrecognized lands on All. */
export function parseReviewTab(raw: string | null): ReviewTab {
  return (REVIEW_TABS as readonly (string | null)[]).includes(raw)
    ? (raw as ReviewTab)
    : "all"
}

/** The verifications list, opened on the given tab. */
export function verificationsHref(tab: ReviewTab): string {
  return tab === "all" ? "/verifications" : `/verifications?tab=${tab}`
}

/** A record's report page, remembering which tab it was opened from. */
export function reportHref(id: string, tab: ReviewTab): string {
  const base = `/verifications/${encodeURIComponent(id)}`
  return tab === "all" ? base : `${base}?tab=${tab}`
}

/**
 * A record's report page as opened straight from a single upload (?from=
 * upload): the report's back option returns to Upload for the next label,
 * not to the verifications list, and the queue-stepping controls stay
 * hidden — one fresh upload is not a review session.
 */
export function uploadReportHref(id: string): string {
  return `/verifications/${encodeURIComponent(id)}?from=upload`
}

/** The slice of a verification record that tab navigation needs. */
interface TabRecord {
  id: string
  review: { state: "pending" | "approved" | "rejected" }
}

/**
 * The nearest report on the given tab in the stepped direction, or null at
 * that end of the queue. The scan starts from the current record's position
 * in the *full* list, not the filtered one — so it still works right after
 * a decision moved the current record off its tab, which is exactly when
 * approve/reject wants the answer.
 */
function stepReportHref(
  records: readonly TabRecord[],
  currentId: string,
  tab: ReviewTab,
  step: 1 | -1
): string | null {
  const at = records.findIndex((record) => record.id === currentId)
  if (at === -1) return null
  for (let i = at + step; i >= 0 && i < records.length; i += step) {
    const record = records[i]
    if (tab === "all" || record.review.state === tab) {
      return reportHref(record.id, tab)
    }
  }
  return null
}

/**
 * The report after the current one on the given tab, or null at the end of
 * the queue. Records come newest-first (listVerifications order), so "next"
 * means the next-older record whose state matches the tab.
 */
export function nextReportHref(
  records: readonly TabRecord[],
  currentId: string,
  tab: ReviewTab
): string | null {
  return stepReportHref(records, currentId, tab, 1)
}

/** The report before the current one on the given tab — Next, undone. */
export function previousReportHref(
  records: readonly TabRecord[],
  currentId: string,
  tab: ReviewTab
): string | null {
  return stepReportHref(records, currentId, tab, -1)
}
