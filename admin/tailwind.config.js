import animate from "tailwindcss-animate";
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Тёмный sidebar
        sidebar: {
          DEFAULT: "#1e293b", // slate-800
          hover: "#273449", // slate-800 lighten
          active: "#5C2A2A", // бренд burgundy
          border: "#334155", // slate-700
          muted: "#94a3b8", // slate-400
        },
        // Акцент — burgundy магазина
        brand: {
          DEFAULT: "#5C2A2A",
          light: "#7a3a3a",
          contrast: "#F5EDE0",
        },
        // Фон рабочей области
        canvas: "#f8fafc", // slate-50
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [animate],
};
