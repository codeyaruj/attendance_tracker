"use client";

import { History, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { RecentAction } from "@/types/domain";

export function RecentActionsCard({
  actions,
  undoingId,
  onUndo,
}: {
  actions: readonly RecentAction[];
  undoingId?: string;
  onUndo: (action: RecentAction) => Promise<void>;
}) {
  const active = actions
    .filter((action) => !action.undoneAt && action.undoPayload)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  if (active.length === 0) return null;

  return (
    <Card className="p-4 sm:p-5" data-testid="recent-actions">
      <div className="flex items-center gap-2">
        <History className="text-primary size-5" aria-hidden="true" />
        <h2 className="font-display text-lg font-extrabold">Recent changes</h2>
      </div>
      <ul className="divide-border mt-3 divide-y">
        {active.map((action) => (
          <li
            key={action.id}
            className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {action.description}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {new Intl.DateTimeFormat(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(action.createdAt))}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={undoingId === action.id}
              onClick={() => void onUndo(action)}
              data-testid={`undo-${action.id}`}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {undoingId === action.id ? "Undoing…" : "Undo"}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
