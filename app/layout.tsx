import type { Metadata, Viewport } from "next";
import { AppProviders } from "@/components/app/providers";
import "./globals.css";

function configuredSiteUrl(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) {
    return process.env.NODE_ENV === "development"
      ? new URL("http://localhost:3000")
      : undefined;
  }
  try {
    const url = new URL(configured);
    if (
      (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

const siteUrl = configuredSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "AttendSafe — Know what you can skip",
    template: "%s · AttendSafe",
  },
  description:
    "A private, local-first attendance tracker that shows which upcoming classes you can safely skip.",
  applicationName: "AttendSafe",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AttendSafe",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
    shortcut: "/icons/favicon-32.png",
  },
  openGraph: {
    title: "AttendSafe — Know what you can skip",
    description:
      "Private, local-first attendance tracking with exact skip planning.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1730,
        height: 909,
        alt: "AttendSafe weekly attendance planner with a protective check-mark shield",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AttendSafe — Know what you can skip",
    description:
      "Private, local-first attendance tracking with exact skip planning.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#111815" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
