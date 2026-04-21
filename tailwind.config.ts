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
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        pv: {
          ink: "#f5f5f5",
          parchment: "#030303",
          "parchment-soft": "#0b0b0b",
          accent: {
            DEFAULT: "#2563eb",
            strong: "#1d4ed8",
            foreground: "#ffffff"
          },
          muted: "#a3a3a3",
          border: "#1f1f1f",
          success: "#22c55e",
          warning: "#f59e0b",
          danger: {
            DEFAULT: "#ef4444",
            strong: "#dc2626"
          }
        }
      }
    }
  },
  plugins: []
};

export default config;
