/**
 * Dashboard shell: fixed sidebar navigation, a slim top bar, and a content
 * area that scrolls internally — the page itself never scrolls.
 */

import { AppSidebar, PageTitle } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <SidebarTrigger />
          {/* The base separator self-stretches; pin the fixed height to the
              row's center so it aligns with the trigger and title midline. */}
          <Separator
            orientation="vertical"
            className="mr-1 h-4! self-center!"
          />
          <PageTitle />
        </header>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
