import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  throwIfCancelled,
} from "./types";
import type { CanvasResource } from "./image-loader";

interface PdfViewport {
  width: number;
  height: number;
}

export interface LocalPdfDocument {
  readonly pageCount: number;
  renderPage(pageIndex: number, signal?: AbortSignal): Promise<CanvasResource>;
  destroy(): Promise<void>;
}

export function assertPdfPageCount(pageCount: number): void {
  if (pageCount > EXTRACTION_LIMITS.maximumPdfPages) {
    throw new TimetableExtractionError(
      "PDF_PAGE_LIMIT",
      `This PDF has ${pageCount} pages. Choose a timetable with no more than 5 pages.`,
    );
  }
  if (pageCount < 1) {
    throw new TimetableExtractionError(
      "CORRUPT_PDF",
      "The PDF does not contain any readable pages.",
    );
  }
}

export function classifyPdfError(cause: unknown): TimetableExtractionError {
  const name =
    typeof cause === "object" && cause !== null && "name" in cause
      ? String(Reflect.get(cause, "name"))
      : "";
  if (name === "PasswordException") {
    return new TimetableExtractionError(
      "ENCRYPTED_PDF",
      "Password-protected PDFs cannot be processed locally. Remove the password and try again.",
      { cause },
    );
  }
  return new TimetableExtractionError(
    "CORRUPT_PDF",
    "The PDF is corrupt or unreadable. Try exporting it again.",
    { cause },
  );
}

function renderScale(viewport: PdfViewport): number {
  const dimensionScale =
    EXTRACTION_LIMITS.maximumRenderedDimension /
    Math.max(viewport.width, viewport.height);
  const pixelScale = Math.sqrt(
    EXTRACTION_LIMITS.maximumCanvasPixels / (viewport.width * viewport.height),
  );
  return Math.max(0.5, Math.min(2, dimensionScale, pixelScale));
}

export async function openLocalPdf(
  file: File,
  signal?: AbortSignal,
): Promise<LocalPdfDocument> {
  throwIfCancelled(signal);
  let destroyLoadingTask: (() => Promise<void>) | undefined;
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/ocr-assets/pdf.worker.min.mjs";
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfCancelled(signal);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: true,
      stopAtErrors: true,
      maxImageSize: EXTRACTION_LIMITS.maximumCanvasPixels,
    });
    destroyLoadingTask = () => loadingTask.destroy();
    const document = await loadingTask.promise;
    try {
      assertPdfPageCount(document.numPages);
    } catch (cause) {
      await loadingTask.destroy();
      throw cause;
    }
    return {
      pageCount: document.numPages,
      async renderPage(pageIndex, pageSignal) {
        throwIfCancelled(pageSignal);
        const page = await document.getPage(pageIndex + 1);
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: renderScale(baseViewport) });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          page.cleanup();
          throw new TimetableExtractionError(
            "PDF_WORKER_FAILURE",
            "The browser could not create a canvas for this PDF page.",
          );
        }
        const task = page.render({ canvas, canvasContext: context, viewport });
        const cancel = () => task.cancel();
        pageSignal?.addEventListener("abort", cancel, { once: true });
        try {
          await task.promise;
          throwIfCancelled(pageSignal);
          return {
            canvas,
            cleanup() {
              page.cleanup();
              canvas.width = 0;
              canvas.height = 0;
            },
          };
        } catch (cause) {
          page.cleanup();
          canvas.width = 0;
          canvas.height = 0;
          if (pageSignal?.aborted) throwIfCancelled(pageSignal);
          throw new TimetableExtractionError(
            "PDF_WORKER_FAILURE",
            `Page ${pageIndex + 1} could not be rendered locally.`,
            { cause },
          );
        } finally {
          pageSignal?.removeEventListener("abort", cancel);
        }
      },
      async destroy() {
        await document.cleanup();
        await loadingTask.destroy();
      },
    };
  } catch (cause) {
    if (cause instanceof TimetableExtractionError) throw cause;
    if (signal?.aborted) throwIfCancelled(signal);
    await destroyLoadingTask?.().catch(() => undefined);
    throw classifyPdfError(cause);
  }
}
