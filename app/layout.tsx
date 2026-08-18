import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "House of Pinash — Atelier Studio",
  description: "Model imagery generator for House of Pinash",
  other: {
    "color-scheme": "light",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
