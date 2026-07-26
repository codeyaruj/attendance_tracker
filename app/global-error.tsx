"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-dvh place-items-center bg-[#f6f7f2] p-6 text-center text-[#17211d]">
          <div className="max-w-md rounded-3xl border border-[#dde3de] bg-white p-8">
            <h1 className="text-2xl font-extrabold">
              AttendSafe could not start
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#63716a]">
              Reload the app shell. Browser storage is not cleared by this
              action.
            </p>
            <Button className="mt-6" onClick={reset}>
              Reload AttendSafe
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
