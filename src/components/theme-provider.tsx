"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * Light theme, always. A government compliance tool should look identical
 * on every reviewer's machine — no system detection, no dark mode, no
 * toggle. The provider stays (sonner reads the theme from it); it just
 * never resolves to anything but light.
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      forcedTheme="light"
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
