import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="bg-background grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-md">
        <span className="bg-primary-soft text-primary mx-auto grid size-12 place-items-center rounded-2xl">
          <Compass className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-4 text-2xl font-extrabold">
          This page is not on the timetable
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          The route may have moved, but your local attendance records are
          unaffected.
        </p>
        <Link href="/today" className={buttonClassName({ className: "mt-6" })}>
          Go to Today
        </Link>
      </div>
    </main>
  );
}
