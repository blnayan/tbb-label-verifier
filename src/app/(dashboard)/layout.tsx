/**
 * Dashboard shell: a top navigation bar and a content area that scrolls
 * internally — the page itself never scrolls.
 */

import { AppNavbar } from "@/components/app-navbar"

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <AppNavbar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          {children}
        </div>
      </div>
    </div>
  )
}
