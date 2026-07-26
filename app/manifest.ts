import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AttendSafe — Personal Attendance Tracker",
    short_name: "AttendSafe",
    description:
      "Track attendance locally and plan exactly which classes are safe to skip.",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#176b52",
    orientation: "any",
    categories: ["education", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Mark today",
        short_name: "Today",
        url: "/today/",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Plan a skip",
        short_name: "Skip Planner",
        url: "/skip-planner/",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
