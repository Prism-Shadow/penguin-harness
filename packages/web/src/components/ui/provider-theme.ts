/**
 * Soft visual accents shared by the provider logo tile and Models group header.
 *
 * Logo backgrounds deliberately use translucent recognizable accent hues instead of fully
 * saturated brand swatches. Header gradients reuse the same visual family with two solid color
 * stops; styles.css controls their light/dark opacity so dense model lists remain easy to scan.
 */
export interface ProviderTheme {
  fg: string;
  fgDark: string;
  gradientFrom: string;
  gradientTo: string;
}

const QWEN_THEME: ProviderTheme = {
  fg: "#5b43bc",
  fgDark: "#c5b8ff",
  gradientFrom: "#7c5cff",
  gradientTo: "#38bdf8",
};

export const PROVIDER_THEMES: Readonly<Record<string, ProviderTheme>> = {
  deepseek: {
    fg: "#3852c7",
    fgDark: "#aeb9ff",
    gradientFrom: "#4d6bfe",
    gradientTo: "#91a0ff",
  },
  openrouter: {
    fg: "#4f46b8",
    fgDark: "#b8b9ff",
    gradientFrom: "#6366f1",
    gradientTo: "#b473ff",
  },
  fireworks: {
    fg: "#b8321b",
    fgDark: "#ff9f8c",
    gradientFrom: "#ff5b40",
    gradientTo: "#ffb46e",
  },
  siliconflow: {
    fg: "#0f766e",
    fgDark: "#78ded2",
    gradientFrom: "#14b8a6",
    gradientTo: "#44d3b4",
  },
  "qwen-token-plan": QWEN_THEME,
  "qwen-pay-as-you-go": QWEN_THEME,
  google: {
    fg: "#1967d2",
    fgDark: "#8ab4f8",
    gradientFrom: "#4285f4",
    gradientTo: "#9867ff",
  },
  anthropic: {
    fg: "#9f4d32",
    fgDark: "#f0a184",
    gradientFrom: "#d97757",
    gradientTo: "#f4a66f",
  },
  openai: {
    fg: "#08785f",
    fgDark: "#72d6b9",
    gradientFrom: "#10a37f",
    gradientTo: "#5eead4",
  },
  zhipu: {
    fg: "#3150ad",
    fgDark: "#9eb2ff",
    gradientFrom: "#3959d6",
    gradientTo: "#5ea5fa",
  },
  moonshot: {
    fg: "#334155",
    fgDark: "#c5d2e3",
    gradientFrom: "#475569",
    gradientTo: "#7da0dc",
  },
  custom: {
    fg: "#475569",
    fgDark: "#cbd5e1",
    gradientFrom: "#64748b",
    gradientTo: "#94a3b8",
  },
};

export function providerTheme(provider: string): ProviderTheme | undefined {
  return PROVIDER_THEMES[provider];
}
