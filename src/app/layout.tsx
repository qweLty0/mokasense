import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MokaSense",
  description:
    "Moka United üye işyerleri için WhatsApp-first yapay zekâ finans asistanı",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
