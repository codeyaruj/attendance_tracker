"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ExtractedPage,
  TimetableExtractionResult,
} from "@/lib/timetable-extraction";

export function ExtractionPreview({
  result,
  onContinue,
  onCancel,
}: {
  result: TimetableExtractionResult;
  onContinue: (pages: ExtractedPage[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(result.pages.map((page) => page.pageIndex)),
  );
  const selectedPages = useMemo(
    () => result.pages.filter((page) => selected.has(page.pageIndex)),
    [result.pages, selected],
  );
  const lowConfidence = selectedPages.reduce(
    (total, page) => total + page.draft.ambiguousItems.length,
    0,
  );

  return (
    <div
      className="mx-auto grid w-full max-w-4xl gap-5"
      data-testid="extraction-preview"
    >
      <div>
        <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
          Local OCR complete
        </p>
        <h2 className="font-display mt-1 text-3xl font-extrabold tracking-tight">
          Choose what to review
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Select the detected PDF pages or tables to import. Every slot remains
          editable before saving.
        </p>
      </div>

      {result.warnings.map((warning) => (
        <div
          key={warning}
          className="bg-warning-soft text-warning-strong flex gap-2 rounded-xl p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {warning}
        </div>
      ))}

      <div className="grid gap-3">
        {result.pages.map((page) => {
          const checked = selected.has(page.pageIndex);
          return (
            <label key={page.pageIndex} className="cursor-pointer">
              <Card
                className={checked ? "border-primary/50 p-4" : "p-4 opacity-75"}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(page.pageIndex))
                          next.delete(page.pageIndex);
                        else next.add(page.pageIndex);
                        return next;
                      })
                    }
                    className="accent-primary mt-1 size-4"
                    aria-label={`Import ${page.label}`}
                  />
                  <FileText
                    className="text-primary mt-0.5 size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{page.label}</h3>
                      <Badge tone="neutral">
                        {page.detectedCellCount} detected cells
                      </Badge>
                      {page.draft.ambiguousItems.length ? (
                        <Badge tone="caution">
                          {page.draft.ambiguousItems.length} need review
                        </Badge>
                      ) : (
                        <Badge tone="safe">Clear structure</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-5">
                      {page.rawTextPreview || "No readable text preview"}
                    </p>
                  </div>
                </div>
              </Card>
            </label>
          );
        })}
      </div>

      <Card className="bg-primary-soft text-primary flex items-start gap-3 p-4 text-sm">
        {lowConfidence ? (
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
        )}
        <p>
          {lowConfidence
            ? `${lowConfidence} low-confidence ${lowConfidence === 1 ? "cell is" : "cells are"} highlighted for required review.`
            : "A timetable structure was found. Verify names, times, rooms, faculty, and batches before confirming."}
        </p>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onCancel}>
          <X className="size-4" /> Cancel without saving
        </Button>
        <Button
          size="lg"
          disabled={selectedPages.length === 0}
          onClick={() => onContinue(selectedPages)}
          data-testid="review-extracted-timetable"
        >
          Continue to editable review <ArrowRight className="size-5" />
        </Button>
      </div>
    </div>
  );
}
