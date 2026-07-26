"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  ScanLine,
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
  const [diagnosticPage, setDiagnosticPage] = useState<number>();
  const selectedPages = useMemo(
    () => result.pages.filter((page) => selected.has(page.pageIndex)),
    [result.pages, selected],
  );
  const lowConfidence = selectedPages.reduce(
    (total, page) => total + page.draft.ambiguousItems.length,
    0,
  );
  const exportDiagnostics = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            result.pages,
            (key, value) => (key === "previewDataUrl" ? undefined : value),
            2,
          ),
        ],
        {
          type: "application/json",
        },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "attendsafe-extraction-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="mx-auto grid w-full max-w-4xl gap-5"
      data-testid="extraction-preview"
    >
      <div>
        <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
          Local table extraction complete
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
            <div key={page.pageIndex}>
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
                      {page.confidence ? (
                        <Badge
                          tone={
                            page.confidence.overall >= 0.72 ? "safe" : "caution"
                          }
                        >
                          {Math.round(page.confidence.overall * 100)}%
                          confidence
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-5">
                      {page.rawTextPreview || "No readable text preview"}
                    </p>
                    {page.diagnostics ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() =>
                          setDiagnosticPage((current) =>
                            current === page.pageIndex
                              ? undefined
                              : page.pageIndex,
                          )
                        }
                      >
                        <ScanLine className="size-4" />
                        {diagnosticPage === page.pageIndex
                          ? "Hide diagnostics"
                          : "Inspect detection"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {diagnosticPage === page.pageIndex && page.diagnostics ? (
                  <div className="border-border mt-4 grid gap-4 border-t pt-4 md:grid-cols-2">
                    <div className="bg-muted relative overflow-hidden rounded-xl">
                      {page.previewDataUrl ? (
                        // The data URL is generated locally and never uploaded.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={page.previewDataUrl}
                          alt={`Detected table regions on ${page.label}`}
                          className="h-auto w-full"
                        />
                      ) : (
                        <p className="text-muted-foreground p-4 text-xs">
                          Image preview is unavailable for this page.
                        </p>
                      )}
                      <svg
                        viewBox={`0 0 ${page.diagnostics.width} ${page.diagnostics.height}`}
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        aria-hidden="true"
                      >
                        {page.diagnostics.grids.flatMap((grid) =>
                          grid.cells.map((cell) => (
                            <rect
                              key={cell.id}
                              x={cell.bounds.x0}
                              y={cell.bounds.y0}
                              width={cell.bounds.x1 - cell.bounds.x0}
                              height={cell.bounds.y1 - cell.bounds.y0}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="text-primary"
                            />
                          )),
                        )}
                      </svg>
                    </div>
                    <div className="text-muted-foreground text-xs leading-5">
                      <p>
                        Source:{" "}
                        {page.diagnostics.source
                          .replaceAll("_", " ")
                          .toLowerCase()}
                      </p>
                      <p>
                        {page.diagnostics.regions.length} table region(s),{" "}
                        {page.diagnostics.grids.reduce(
                          (sum, grid) => sum + grid.cells.length,
                          0,
                        )}{" "}
                        logical cells
                      </p>
                      {page.confidence ? (
                        <dl className="mt-2 grid grid-cols-2 gap-x-3">
                          <dt>Grid</dt>
                          <dd>
                            {Math.round(page.confidence.gridDetection * 100)}%
                          </dd>
                          <dt>Headers</dt>
                          <dd>
                            {Math.round(page.confidence.headerParsing * 100)}%
                          </dd>
                          <dt>Cell OCR</dt>
                          <dd>{Math.round(page.confidence.cellOCR * 100)}%</dd>
                          <dt>Semantics</dt>
                          <dd>
                            {Math.round(page.confidence.semanticParsing * 100)}%
                          </dd>
                        </dl>
                      ) : null}
                      {page.diagnostics.timings.length ? (
                        <p className="mt-2">
                          Vision time:{" "}
                          {Math.round(
                            page.diagnostics.timings.reduce(
                              (sum, timing) => sum + timing.durationMs,
                              0,
                            ),
                          )}
                          ms
                        </p>
                      ) : null}
                      <details className="mt-2">
                        <summary className="text-foreground cursor-pointer font-semibold">
                          Raw cell OCR
                        </summary>
                        <ul className="mt-1 max-h-36 overflow-auto">
                          {page.diagnostics.grids
                            .flatMap((grid) => grid.cells)
                            .filter((cell) => cell.rawText)
                            .map((cell) => (
                              <li key={cell.id}>
                                {cell.id}: {cell.rawText} (
                                {Math.round(cell.ocrConfidence ?? 0)}%)
                              </li>
                            ))}
                        </ul>
                      </details>
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>
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
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onCancel}>
            <X className="size-4" /> Cancel without saving
          </Button>
          <Button variant="outline" onClick={exportDiagnostics}>
            <Download className="size-4" /> Export diagnostics
          </Button>
        </div>
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
