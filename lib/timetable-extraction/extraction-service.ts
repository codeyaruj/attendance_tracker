import {
  validateTimetableFile,
  assertExtractionBrowserSupport,
} from "./file-validation";
import { loadImageToCanvas, type CanvasResource } from "./image-loader";
import { preprocessCanvas } from "./image-preprocessing";
import { createLocalOcrWorker, type OcrWorker } from "./ocr-worker";
import { openLocalPdf, type LocalPdfDocument } from "./pdf-renderer";
import {
  assertUsefulExtraction,
  reconstructTimetablePages,
} from "./timetable-parser";
import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  throwIfCancelled,
  type ExtractionOptions,
  type OcrPageResult,
  type TimetableExtractionResult,
} from "./types";
import { beginCriticalOperation } from "@/lib/pwa/critical-operation";

export interface ExtractionDependencies {
  validateFile: typeof validateTimetableFile;
  assertBrowserSupport: typeof assertExtractionBrowserSupport;
  openPdf: typeof openLocalPdf;
  loadImage: typeof loadImageToCanvas;
  preprocess: typeof preprocessCanvas;
  createOcrWorker: typeof createLocalOcrWorker;
  reconstruct: typeof reconstructTimetablePages;
}

const browserDependencies: ExtractionDependencies = {
  validateFile: validateTimetableFile,
  assertBrowserSupport: assertExtractionBrowserSupport,
  openPdf: openLocalPdf,
  loadImage: loadImageToCanvas,
  preprocess: preprocessCanvas,
  createOcrWorker: createLocalOcrWorker,
  reconstruct: reconstructTimetablePages,
};

export class LocalTimetableExtractionService {
  private running = false;
  private cancellation?: AbortController;
  private worker?: OcrWorker;

  constructor(private readonly dependencies = browserDependencies) {}

  get isRunning(): boolean {
    return this.running;
  }

  async cancel(): Promise<void> {
    this.cancellation?.abort();
    await this.worker?.terminate();
  }

  async extract(
    file: File,
    options: ExtractionOptions,
  ): Promise<TimetableExtractionResult> {
    if (this.running) {
      throw new TimetableExtractionError(
        "ALREADY_RUNNING",
        "A timetable is already being processed. Cancel it before starting another.",
      );
    }
    this.running = true;
    const endCriticalOperation = beginCriticalOperation();
    const controller = new AbortController();
    this.cancellation = controller;
    const cancelFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
    const totalTimer = setTimeout(
      () => controller.abort("total-time-limit"),
      EXTRACTION_LIMITS.maximumTotalDurationMs,
    );
    let pdf: LocalPdfDocument | undefined;
    let canvas: CanvasResource | undefined;
    try {
      options.onProgress?.({ stage: "VALIDATING_FILE", progress: 0.05 });
      this.dependencies.assertBrowserSupport();
      const validated = await this.dependencies.validateFile(file);
      throwIfCancelled(controller.signal);

      let pageCount = 1;
      if (validated.kind === "PDF") {
        options.onProgress?.({ stage: "LOADING_PDF", progress: 0.1 });
        pdf = await this.dependencies.openPdf(file, controller.signal);
        pageCount = pdf.pageCount;
      }
      options.onProgress?.({
        stage: "STARTING_OCR",
        progress: 0.15,
        pageCount,
      });
      this.worker = await this.dependencies.createOcrWorker({
        onProgress: options.onProgress,
      });
      const ocrPages: OcrPageResult[] = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        throwIfCancelled(controller.signal);
        options.onProgress?.({
          stage:
            validated.kind === "PDF" ? "RENDERING_PAGE" : "PREPARING_IMAGE",
          progress: pageIndex / pageCount,
          pageIndex,
          pageCount,
        });
        canvas =
          validated.kind === "PDF"
            ? await pdf!.renderPage(pageIndex, controller.signal)
            : await this.dependencies.loadImage(
                file,
                options.imageEdits,
                controller.signal,
              );
        options.onProgress?.({
          stage: "PREPARING_IMAGE",
          progress: pageIndex / pageCount,
          pageIndex,
          pageCount,
        });
        const prepared = await this.dependencies.preprocess(canvas);
        throwIfCancelled(controller.signal);
        ocrPages.push(
          await this.worker.recognize(
            prepared,
            pageIndex,
            pageCount,
            controller.signal,
          ),
        );
        canvas.cleanup();
        canvas = undefined;
      }

      options.onProgress?.({
        stage: "RECONSTRUCTING_TIMETABLE",
        progress: 0.92,
        pageCount,
      });
      const pages = this.dependencies.reconstruct(ocrPages, options.timezone);
      assertUsefulExtraction(pages);
      options.onProgress?.({
        stage: "PREPARING_PREVIEW",
        progress: 1,
        pageCount,
      });
      return {
        pages,
        totalPageCount: pageCount,
        warnings:
          pages.length < pageCount
            ? [
                `${pageCount - pages.length} ${pageCount - pages.length === 1 ? "page did" : "pages did"} not contain a recognizable timetable.`,
              ]
            : [],
      };
    } catch (cause) {
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "total-time-limit";
        throw new TimetableExtractionError(
          timedOut ? "PROCESSING_LIMIT" : "CANCELLED",
          timedOut
            ? "Local extraction exceeded the four-minute safety limit. Try a smaller or clearer file."
            : "Timetable extraction was cancelled.",
          { cause },
        );
      }
      if (cause instanceof TimetableExtractionError) throw cause;
      throw new TimetableExtractionError(
        "OCR_WORKER_FAILURE",
        "The timetable could not be processed locally. Try a clearer file or enter it manually.",
        { cause },
      );
    } finally {
      clearTimeout(totalTimer);
      canvas?.cleanup();
      await this.worker?.terminate();
      await pdf?.destroy().catch(() => undefined);
      options.signal?.removeEventListener("abort", cancelFromCaller);
      this.worker = undefined;
      this.cancellation = undefined;
      this.running = false;
      endCriticalOperation();
    }
  }
}
