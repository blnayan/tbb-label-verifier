import { ShieldCheckIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchVerify } from "@/components/verifier/batch-verify";
import { SingleVerify } from "@/components/verifier/single-verify";

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheckIcon aria-hidden className="size-6" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold tracking-tight">
            TTB Label Verifier
          </h1>
          <p className="text-sm text-muted-foreground">
            Check a label against its application in seconds.
          </p>
        </div>
      </header>

      <main>
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
      </main>

      <footer className="mt-auto border-t pt-4 text-sm text-muted-foreground">
        Prototype for the TTB Compliance Division. AI reads the label; every
        pass/fail decision comes from deterministic compliance rules.
      </footer>
    </div>
  );
}
