/**
 * CSS variable token names for the design system.
 * Use getCSSVar() to read resolved values at runtime (e.g. for Plotly chart theming).
 */
export const themeTokens = {
  background: "--background",
  foreground: "--foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  destructive: "--destructive",
  border: "--border",
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
} as const;

export type ThemeToken = keyof typeof themeTokens;

/** Read the resolved CSS variable value for a given token. */
export function getCSSVar(token: ThemeToken): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(themeTokens[token])
    .trim();
}
