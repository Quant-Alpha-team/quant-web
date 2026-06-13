import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quant Alpha Dashboard",
  description: "Quant Alpha web dashboard for strategy monitoring",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
