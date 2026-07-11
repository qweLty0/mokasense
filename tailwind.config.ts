import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // WhatsApp arayüz tonları (P3'te sohbet ekranında kullanılacak)
        whatsapp: {
          bg: "#ECE5DD",
          bubble: "#DCF8C6",
          header: "#075E54",
          accent: "#25D366",
        },
        // Moka marka tonu (yönetici paneli için)
        moka: {
          DEFAULT: "#6B3FA0",
          dark: "#4A2A73",
        },
      },
    },
  },
  plugins: [],
};

export default config;
