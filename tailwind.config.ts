import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      colors: {
        pv: {
          // Legacy aliases (kept until R15 sweep so existing JSX compiles).
          // Remapped to the new dark palette — ink reads as text, parchment as surface.
          ink: "#f4f4f5",
          parchment: "#0a0a0a",
          "parchment-soft": "#111114",
          accent: {
            DEFAULT: "#ef4444",
            strong: "#dc2626",
            foreground: "#ffffff"
          },
          border: "#2a2a30",
          success: "#10b981",
          warning: "#f59e0b",
          danger: {
            DEFAULT: "#ef4444",
            strong: "#dc2626"
          },
          muted: "#8b94a3",

          // NEW tokens — mirror demo/assets/styles.css
          surface: "#0a0a0a",
          "surface-2": "#111114",
          "surface-3": "#17171b",
          "surface-4": "#1e1e23",
          line: "#2a2a30",
          "line-strong": "#3a3a42",
          text: "#f4f4f5",
          "muted-2": "#5f6876",
          gold: "#ffea9b",
          "gold-soft": "rgba(255, 234, 155, 0.08)",
          good: "#10b981",
          "good-soft": "rgba(16, 185, 129, 0.12)",
          warn: "#f59e0b",
          info: "#38bdf8",
          // rarity scale
          "r-common": "#9aa3b2",
          "r-uncommon": "#10b981",
          "r-rare": "#38bdf8",
          "r-holo": "#a78bfa",
          "r-ultra": "#f472b6",
          "r-chase": "#ffea9b"
        }
      },
      fontSize: {
        "pv-meta": ["11px", { lineHeight: "1.55" }],
        "pv-body": ["14px", { lineHeight: "1.55" }],
        "pv-h3": ["16px", { lineHeight: "1.4", letterSpacing: "-0.005em", fontWeight: "800" }],
        "pv-h2": ["22px", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "800" }],
        "pv-h1": ["32px", { lineHeight: "1.1", letterSpacing: "-0.015em", fontWeight: "900" }],
        "pv-display": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "900" }]
      },
      borderRadius: {
        "pv-sm": "8px",
        pv: "12px",
        "pv-lg": "16px",
        "pv-xl": "20px"
      },
      boxShadow: {
        "pv-ultra": "0 0 48px rgba(244, 114, 182, 0.15)",
        "pv-chase": "0 0 48px rgba(255, 234, 155, 0.18)",
        "pv-holo": "0 0 32px rgba(167, 139, 250, 0.15)",
        "pv-card": "0 20px 40px -28px rgba(0, 0, 0, 0.6)"
      },
      keyframes: {
        "pv-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" }
        }
      },
      animation: {
        "pv-pulse": "pv-pulse 1.6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
