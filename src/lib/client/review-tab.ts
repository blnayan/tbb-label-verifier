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
