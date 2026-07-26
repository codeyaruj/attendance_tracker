import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border bg-surface/60 grid min-h-64 place-items-center rounded-2xl border border-dashed p-8 text-center">
      <div className="max-w-sm">
        <span className="bg-primary-soft text-primary mx-auto mb-4 grid size-12 place-items-center rounded-2xl">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <h3 className="font-bold">{title}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {description}
        </p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}
