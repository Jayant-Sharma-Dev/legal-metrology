import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://legal-metrology-orcin.vercel.app"),
  title: "Legal Metrology Field Desk",
  description:
    "AI-assisted packaged commodity inspection. Upload a product label to extract declarations and verify compliance with Legal Metrology (Packaged Commodities) Rules, 2011.",
  openGraph: {
    title: "Legal Metrology Field Desk",
    description:
      "AI-assisted packaged commodity inspection. Upload a product label to extract declarations and verify compliance with Legal Metrology (Packaged Commodities) Rules, 2011.",
    url: "https://legal-metrology-orcin.vercel.app",
    siteName: "Legal Metrology Field Desk",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Legal Metrology Field Desk",
    description:
      "AI-assisted packaged commodity inspection. Upload a product label to extract declarations and verify compliance with Legal Metrology (Packaged Commodities) Rules, 2011.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
