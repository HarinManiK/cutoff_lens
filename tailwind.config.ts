import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211b",
        moss: "#255947",
        mint: "#dff7eb",
        paper: "#fbfaf6",
        saffron: "#f3a83b",
        coral: "#dd5f54",
      },
      boxShadow: {
        soft: "0 16px 50px rgba(31, 41, 35, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
