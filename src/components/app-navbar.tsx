"use client"

/**
 * Top navigation bar. Two destinations: verify new labels, review what has
 * already been verified. The active page is highlighted from the pathname.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HistoryIcon, ShieldCheckIcon, UploadIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  {
    title: "Upload",
    href: "/",
    icon: UploadIcon,
  },
  {
    title: "Verifications",
    href: "/verifications",
    icon: HistoryIcon,
  },
] as const

export function AppNavbar() {
  const pathname = usePathname()

  return (
    <header className="flex shrink-0 items-center gap-4 border-b px-4 py-2.5 sm:gap-6 sm:px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheckIcon aria-hidden className="size-4.5" />
        </div>
        <span className="hidden text-sm font-semibold tracking-tight whitespace-nowrap sm:inline">
          TTB Label Verifier
        </span>
      </div>
      <nav aria-label="Main" className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon aria-hidden className="size-4" />
              {item.title}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
