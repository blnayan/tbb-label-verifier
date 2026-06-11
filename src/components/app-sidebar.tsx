"use client"

/**
 * Dashboard navigation. Two destinations: verify new labels, review what has
 * already been verified. The active page is highlighted from the pathname.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HistoryIcon, ShieldCheckIcon, UploadIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export const NAV_ITEMS = [
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

/** Current page name for the top bar, derived from the same nav table. */
export function PageTitle() {
  const pathname = usePathname()
  const active = NAV_ITEMS.find((item) => item.href === pathname)
  return (
    <span className="text-sm font-medium">
      {active?.title ?? "TTB Label Verifier"}
    </span>
  )
}

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon aria-hidden className="size-5" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold tracking-tight">
              TTB Label Verifier
            </span>
            <span className="truncate text-xs text-muted-foreground">
              Compliance Division
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname === item.href}
                  >
                    <item.icon aria-hidden />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          AI reads the label; every pass/fail decision comes from deterministic
          compliance rules.
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
