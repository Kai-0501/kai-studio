import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kai Studio",
  description: "A private local AI workspace built for Gemma.",
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
