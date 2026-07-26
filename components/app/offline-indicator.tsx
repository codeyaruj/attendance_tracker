"use client";

import { CloudOff, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online ? (
    <Badge tone="safe" className="gap-1.5">
      <Wifi className="size-3.5" aria-hidden="true" />
      Saved locally
    </Badge>
  ) : (
    <Badge tone="caution" className="gap-1.5">
      <CloudOff className="size-3.5" aria-hidden="true" />
      Offline · changes stay here
    </Badge>
  );
}
