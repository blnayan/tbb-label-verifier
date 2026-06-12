import { Suspense } from "react"

import { ReviewHistory } from "@/components/verifier/review-history"

export default function VerificationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Verifications</h1>
        <p className="text-sm text-muted-foreground">
          Clear passes and fails are decided automatically; ambiguous labels
          wait for your decision. Open a report to compare the application
          against the label side by side — every decision can be revisited.
        </p>
      </header>
      {/* ReviewHistory reads the active tab from ?tab=, and useSearchParams
          needs a Suspense boundary on a statically prerendered page. The
          component renders its own skeleton, so no fallback is needed. */}
      <Suspense>
        <ReviewHistory />
      </Suspense>
    </div>
  )
}
