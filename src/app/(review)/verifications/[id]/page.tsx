import { ReviewDetail } from "@/components/verifier/review-detail"

export default async function VerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ReviewDetail id={id} />
}
