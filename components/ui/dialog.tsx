"use client";

import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "./button";

const DialogDepthContext = createContext(0);
const openDialogStack: string[] = [];

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const depth = useContext(DialogDepthContext);
  const reactId = useId();
  const dialogId = `attendsafe-dialog-${reactId.replaceAll(":", "")}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openDialogStack.push(dialogId);

    const focusTimer = window.setTimeout(() => {
      const focusable =
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable?.[0]?.focus();
    });

    const handler = (event: KeyboardEvent) => {
      if (openDialogStack.at(-1) !== dialogId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handler);
      const stackIndex = openDialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dialogId, open]);

  if (!open || typeof document === "undefined") return null;

  const layerClass = depth >= 2 ? "z-[70]" : depth === 1 ? "z-[60]" : "z-50";

  return createPortal(
    <DialogDepthContext.Provider value={depth + 1}>
      <div
        className={`fixed inset-0 flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] min-w-0 items-end justify-center overflow-hidden bg-slate-950/45 p-0 sm:items-center sm:p-4 ${layerClass}`}
        role="presentation"
        data-attendsafe-dialog={dialogId}
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) onClose();
        }}
      >
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className="border-border bg-background flex max-h-[92dvh] w-full max-w-full min-w-0 flex-col overflow-hidden rounded-t-3xl border shadow-2xl sm:max-w-xl sm:rounded-3xl"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 pb-5 sm:px-6 sm:pt-6">
            <div>
              <h2 id={titleId} className="text-xl font-bold tracking-tight">
                {title}
              </h2>
              {description ? (
                <p
                  id={descriptionId}
                  className="text-muted-foreground mt-1 text-sm"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X className="size-5" aria-hidden="true" />
            </Button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:px-6 sm:pb-6">
            {children}
          </div>
        </section>
      </div>
    </DialogDepthContext.Provider>,
    document.body,
  );
}
