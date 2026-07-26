"use client";

import {
  FileImage,
  FileText,
  Keyboard,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  LocalTimetableExtractionService,
  TimetableExtractionError,
  mergeExtractedPages,
  validateBasicFile,
  type ExtractionProgress as ProgressState,
  type ImageEdits,
  type TimetableExtractionResult,
} from "@/lib/timetable-extraction";
import { cn } from "@/lib/utils";
import type { NormalizedTimetableDraft } from "@/types";
import { ExtractionError } from "./extraction-error";
import { ExtractionPreview } from "./extraction-preview";
import { ExtractionProgress } from "./extraction-progress";
import { DEFAULT_IMAGE_EDITS, ImageAdjustments } from "./image-adjustments";

type UploadMode = "SELECT" | "READY" | "PROCESSING" | "PREVIEW" | "ERROR";

export function createEmptyDraft(
  timezone = "Asia/Kolkata",
): NormalizedTimetableDraft {
  return {
    title: "My timetable",
    timezone,
    days: [],
    timeSlots: [],
    subjects: [],
    timetableSlots: [],
    detectedBatchOptions: [],
    detectedElectiveGroups: [],
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 0,
  };
}

export function TimetableFileUpload({
  timezone,
  onBack,
  onReady,
}: {
  timezone: string;
  onBack: () => void;
  onReady: (
    draft: NormalizedTimetableDraft,
    source: {
      file: File;
      edits: ImageEdits;
      previewUrl: string;
      extractionMessage?: string;
    },
  ) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const serviceRef = useRef<LocalTimetableExtractionService>(
    new LocalTimetableExtractionService(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<UploadMode>("SELECT");
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [edits, setEdits] = useState<ImageEdits>(DEFAULT_IMAGE_EDITS);
  const [progress, setProgress] = useState<ProgressState>({
    stage: "VALIDATING_FILE",
    progress: 0,
  });
  const [result, setResult] = useState<TimetableExtractionResult>();
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(
    () => () => {
      abortRef.current?.abort();
      void serviceRef.current.cancel();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const chooseFile = useCallback(
    (nextFile?: File) => {
      if (!nextFile) return;
      try {
        validateBasicFile(nextFile);
      } catch (cause) {
        setErrorMessage(
          cause instanceof Error
            ? cause.message
            : "This file cannot be processed.",
        );
        setMode("ERROR");
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(nextFile);
      setPreviewUrl(URL.createObjectURL(nextFile));
      setEdits(DEFAULT_IMAGE_EDITS);
      setResult(undefined);
      setErrorMessage("");
      setMode("READY");
    },
    [previewUrl],
  );

  const reset = async () => {
    abortRef.current?.abort();
    await serviceRef.current.cancel();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (inputRef.current) inputRef.current.value = "";
    setFile(undefined);
    setPreviewUrl("");
    setResult(undefined);
    setErrorMessage("");
    setMode("SELECT");
  };

  const extract = async () => {
    if (!file || mode === "PROCESSING") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setMode("PROCESSING");
    setProgress({ stage: "VALIDATING_FILE", progress: 0 });
    try {
      const nextResult = await serviceRef.current.extract(file, {
        timezone,
        imageEdits: edits,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult(nextResult);
      setMode("PREVIEW");
    } catch (cause) {
      if (
        cause instanceof TimetableExtractionError &&
        cause.code === "CANCELLED"
      ) {
        toast.info("Local timetable extraction cancelled");
        setMode("READY");
      } else {
        setErrorMessage(
          cause instanceof Error
            ? cause.message
            : "The timetable could not be processed locally.",
        );
        setMode("ERROR");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const continueManually = () => {
    if (!file || !previewUrl) {
      onBack();
      return;
    }
    onReady(createEmptyDraft(timezone), {
      file,
      edits,
      previewUrl,
      extractionMessage:
        "Local OCR skipped. Review and enter the timetable manually.",
    });
  };

  if (mode === "PROCESSING") {
    return (
      <ExtractionProgress
        value={progress}
        onCancel={() => {
          abortRef.current?.abort();
          void serviceRef.current.cancel();
        }}
      />
    );
  }

  if (mode === "PREVIEW" && result && file) {
    return (
      <ExtractionPreview
        result={result}
        onCancel={() => setMode("READY")}
        onContinue={(pages) =>
          onReady(mergeExtractedPages(pages, timezone), {
            file,
            edits,
            previewUrl,
            extractionMessage:
              "Extracted locally in this browser with Tesseract OCR.",
          })
        }
      />
    );
  }

  if (mode === "ERROR") {
    return (
      <ExtractionError
        message={errorMessage}
        onRetry={() => void reset()}
        onManual={continueManually}
      />
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-primary text-xs font-bold tracking-[0.16em] uppercase">
            Local timetable import
          </p>
          <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Read your schedule on this device
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            OCR accuracy varies, so every result opens in an editable review
            before anything is saved.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(event.dataTransfer.files[0]);
          }}
          className={cn(
            "border-border bg-surface focus-visible:ring-primary grid min-h-[400px] place-items-center rounded-3xl border-2 border-dashed p-8 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none",
            dragging && "border-primary bg-primary-soft",
          )}
        >
          <div className="max-w-md">
            <span className="bg-primary-soft text-primary mx-auto grid size-16 place-items-center rounded-2xl">
              <Upload className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-xl font-extrabold">
              Drop your timetable here
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              PNG, JPEG, WebP, or PDF · up to 10 MB · PDFs up to 5 pages
            </p>
            <span className="bg-primary text-primary-foreground mt-6 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold">
              Choose file or camera
            </span>
          </div>
        </button>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <Card className="overflow-hidden">
            <div className="flex min-h-[440px] items-center justify-center overflow-hidden bg-[#e8ebe7] p-6 dark:bg-[#0d1210]">
              {file.type === "application/pdf" ? (
                <object
                  data={previewUrl}
                  type="application/pdf"
                  className="h-[560px] w-full rounded-xl bg-white"
                  aria-label="Timetable PDF preview"
                >
                  <FileText className="text-primary size-10" />
                  <p>
                    PDF preview is unavailable, but local extraction can
                    continue.
                  </p>
                </object>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Uploaded timetable preview"
                  className="max-h-[580px] max-w-full object-contain shadow-xl transition-transform"
                  style={{
                    transform: `rotate(${edits.rotation}deg) scale(${edits.zoom})`,
                    clipPath: `inset(${edits.crop.top}% ${edits.crop.right}% ${edits.crop.bottom}% ${edits.crop.left}%)`,
                  }}
                />
              )}
            </div>
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t p-3">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {file.type === "application/pdf" ? (
                  <FileText className="text-primary size-4 shrink-0" />
                ) : (
                  <FileImage className="text-primary size-4 shrink-0" />
                )}
                <span className="truncate font-semibold">{file.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </Button>
            </div>
          </Card>

          <div className="grid content-start gap-4">
            {file.type !== "application/pdf" ? (
              <ImageAdjustments value={edits} onChange={setEdits} />
            ) : null}
            <Card className="border-primary/20 bg-primary-soft text-primary p-4 text-sm">
              <div className="flex gap-3">
                <LockKeyhole className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-extrabold">Processed locally</p>
                  <p className="mt-1 leading-5 opacity-85">
                    The file, rendered pages, and OCR text stay in this browser
                    and are not uploaded to a server.
                  </p>
                </div>
              </div>
            </Card>
            <Button
              size="lg"
              onClick={() => void extract()}
              className="w-full"
              data-testid="extract-timetable"
            >
              <ScanSearch className="size-5" /> Read locally & review
            </Button>
            <Button variant="ghost" onClick={continueManually}>
              <Keyboard className="size-4" /> Skip OCR and enter it myself
            </Button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
        aria-label="Choose timetable image or PDF"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <ShieldCheck className="text-primary size-5" /> No API keys or paid
          services
        </div>
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <LockKeyhole className="text-primary size-5" /> Nothing uploaded
          during OCR
        </div>
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <ScanSearch className="text-primary size-5" /> Review required before
          saving
        </div>
      </div>
    </div>
  );
}

export type { ImageEdits };
