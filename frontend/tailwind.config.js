/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "#5856D6",
          foreground: "#FFFFFF",
        },
        "primary-light": "#EEEEFF",
        surface: 'hsl(240 11% 96%)',
        'surface-low': 'hsl(240 9% 94%)',
        'surface-container': 'hsl(240 8% 92%)',
        'surface-highest': 'hsl(240 8% 88%)',
        "surface-card": "#FFFFFF",
        "on-surface": "#1A1C1F",
        "on-surface-variant": "#464554",
        "outline-variant": "#C7C4D6",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      boxShadow: {
        'apple-sm':    '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.10)',
        'apple-md':    '0 2px 6px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.14)',
        'apple-float': '0 4px 12px rgba(0,0,0,0.12), 0 16px 48px rgba(0,0,0,0.18)',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "16px",
        "3xl": "24px",
        pill: "9999px",
      },
    },
  },
  plugins: [],
}