"use client";

import {
  FileImage,
  FileText,
  Camera,
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
import {
  aiTimetableToDraft,
  requestAiTimetable,
  type LocalExtractionHints,
} from "@/lib/ai-timetable";
import { evaluateLocalExtraction } from "@/lib/timetable-extraction";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const serviceRef = useRef<LocalTimetableExtractionService>(
    new LocalTimetableExtractionService(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiRequestActiveRef = useRef(false);
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
  const [localHints, setLocalHints] = useState<LocalExtractionHints>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      aiAbortRef.current?.abort();
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
      setLocalHints(undefined);
      setAiError("");
      setErrorMessage("");
      setMode("READY");
    },
    [previewUrl],
  );

  const reset = async () => {
    abortRef.current?.abort();
    aiAbortRef.current?.abort();
    await serviceRef.current.cancel();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    setFile(undefined);
    setPreviewUrl("");
    setResult(undefined);
    setLocalHints(undefined);
    setAiError("");
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
      const outcome = evaluateLocalExtraction(nextResult);
      if (outcome.status === "success") {
        setResult(nextResult);
        setMode("PREVIEW");
      } else {
        setLocalHints(outcome.hints);
        setErrorMessage(
          "AttendSafe could not reliably detect the timetable structure. You can try another image, enter the schedule manually, or use AI to analyse this image online.",
        );
        setMode("ERROR");
      }
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
        setLocalHints({
          warnings: [
            cause instanceof Error ? cause.message : "Local extraction failed.",
          ],
        });
        setMode("ERROR");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const extractWithAi = async () => {
    if (!file || aiBusy || aiRequestActiveRef.current || !online) return;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    aiRequestActiveRef.current = true;
    setAiBusy(true);
    setAiError("");
    try {
      const timetable = await requestAiTimetable(
        file,
        localHints,
        controller.signal,
      );
      onReady(aiTimetableToDraft(timetable, timezone), {
        file,
        edits,
        previewUrl,
        extractionMessage:
          "AI-assisted extraction. Review each class carefully before saving.",
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setAiError(
          cause instanceof Error
            ? cause.message
            : "AI schedule analysis is temporarily unavailable.",
        );
      }
    } finally {
      if (aiAbortRef.current === controller) aiAbortRef.current = null;
      aiRequestActiveRef.current = false;
      setAiBusy(false);
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
              "Extracted locally with table detection, positioned PDF text, and Tesseract cell OCR.",
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
        onAi={
          file && file.type !== "application/pdf" ? extractWithAi : undefined
        }
        aiAvailable={online}
        aiBusy={aiBusy}
        aiError={aiError}
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
            Table detection and OCR are probabilistic, so every result opens in
            an editable review before anything is saved.
          </p>
        </div>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>

      {!file ? (
        <div
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
            "border-border bg-surface grid min-h-[320px] place-items-center rounded-3xl border-2 border-dashed p-5 text-center transition-colors sm:min-h-[400px] sm:p-8",
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
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Button size="lg" onClick={() => cameraInputRef.current?.click()}>
                <Camera className="size-5" /> Take timetable photo
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-5" /> Choose image or PDF
              </Button>
            </div>
          </div>
        </div>
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
                onClick={() => fileInputRef.current?.click()}
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
                  <p className="font-extrabold">Local by default</p>
                  <p className="mt-1 leading-5 opacity-85">
                    The file, rendered pages, detected structure, and OCR text
                    stay in this browser unless local extraction fails and you
                    explicitly consent to AI assistance.
                  </p>
                </div>
              </div>
            </Card>
            <Card className="border-info-strong/20 bg-info-soft text-info-strong p-4 text-sm leading-5">
              The first timetable scan requires an internet connection to
              download the self-hosted OCR engine. Later scans can work offline
              after those files are cached successfully.
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
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
        aria-label="Take timetable photo"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
        aria-label="Choose timetable image or PDF"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <ShieldCheck className="text-primary size-5" /> Local extraction is
          always attempted first
        </div>
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <LockKeyhole className="text-primary size-5" /> AI upload requires
          explicit consent
        </div>
        <div className="bg-surface flex items-center gap-3 rounded-2xl p-4 text-sm">
          <ScanSearch className="text-primary size-5" /> Structural detection +
          review before saving
        </div>
      </div>
    </div>
  );
}

export type { ImageEdits };
