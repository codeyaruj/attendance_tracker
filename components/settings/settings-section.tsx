import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-24 overflow-hidden">
      <div className="border-border flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-3">
          <span className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-lg font-extrabold tracking-tight">
              {title}
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">
              {description}
            </p>
          </div>
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </Card>
  );
}
