import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BatchVerify } from "@/components/verifier/batch-verify"
import { SingleVerify } from "@/components/verifier/single-verify"

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Upload</h1>
        <p className="text-sm text-muted-foreground">
          Upload a label with its application data. Results land on the
          Verifications page — clear passes and fails are decided
          automatically, everything else queues for your review.
        </p>
      </header>

      <Tabs defaultValue="single" className="gap-6">
        <TabsList className="h-11">
          <TabsTrigger value="single" className="px-6 text-base">
            Single label
          </TabsTrigger>
          <TabsTrigger value="batch" className="px-6 text-base">
            Batch upload
          </TabsTrigger>
        </TabsList>
        <TabsContent value="single">
          <SingleVerify />
        </TabsContent>
        <TabsContent value="batch">
          <BatchVerify />
        </TabsContent>
      </Tabs>
    </div>
  )
}
