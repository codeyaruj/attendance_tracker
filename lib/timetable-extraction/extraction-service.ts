import {
  validateTimetableFile,
  assertExtractionBrowserSupport,
} from "./file-validation";
import { loadImageToCanvas, type CanvasResource } from "./image-loader";
import { preprocessCanvas } from "./image-preprocessing";
import { createLocalOcrWorker, type OcrWorker } from "./ocr-worker";
import { openLocalPdf, type LocalPdfDocument } from "./pdf-renderer";
import {
  analyzeTableImage,
  canvasPixelBuffer,
  cropCellCanvas,
  type TableVisionResult,
} from "./table-vision";
import { calculateExtractionConfidence } from "./semantic-parsing";
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
  analyze?: typeof analyzeTableImage;
}

const browserDependencies: ExtractionDependencies = {
  validateFile: validateTimetableFile,
  assertBrowserSupport: assertExtractionBrowserSupport,
  openPdf: openLocalPdf,
  loadImage: loadImageToCanvas,
  preprocess: preprocessCanvas,
  createOcrWorker: createLocalOcrWorker,
  reconstruct: reconstructTimetablePages,
  analyze: analyzeTableImage,
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
      const ocrPages: OcrPageResult[] = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        throwIfCancelled(controller.signal);
        if (validated.kind === "PDF" && pdf?.extractPositionedText) {
          options.onProgress?.({
            stage: "FINDING_TIMETABLE",
            progress: pageIndex / pageCount,
            pageIndex,
            pageCount,
            detail: "Checking the PDF text layer before using OCR.",
          });
          const positioned = await pdf.extractPositionedText(
            pageIndex,
            controller.signal,
          );
          if (positioned) {
            ocrPages.push(positioned);
            continue;
          }
        }
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
        let previewDataUrl: string | undefined;
        if (!navigator.userAgent.includes("jsdom")) {
          try {
            previewDataUrl = canvas.canvas.toDataURL("image/jpeg", 0.72);
          } catch {
            // Diagnostics remain useful when a browser cannot serialize a canvas.
          }
        }
        let vision: TableVisionResult | undefined;
        if (this.dependencies.analyze) {
          options.onProgress?.({
            stage: "FINDING_TIMETABLE",
            progress: (pageIndex + 0.15) / pageCount,
            pageIndex,
            pageCount,
          });
          try {
            vision = this.dependencies.analyze(
              canvasPixelBuffer(canvas.canvas),
            );
          } catch {
            vision = undefined;
          }
        }
        options.onProgress?.({
          stage: "DETECTING_GRID",
          progress: (pageIndex + 0.25) / pageCount,
          pageIndex,
          pageCount,
          detail: vision?.primaryGrid
            ? `Detected ${vision.primaryGrid.cells.length} logical cells.`
            : "No reliable grid found; preparing full-page OCR fallback.",
        });
        if (vision?.primaryGrid) {
          if (!this.worker) {
            options.onProgress?.({
              stage: "STARTING_OCR",
              progress: (pageIndex + 0.3) / pageCount,
              pageIndex,
              pageCount,
            });
            this.worker = await this.dependencies.createOcrWorker({
              onProgress: options.onProgress,
            });
          }
          const candidateCells = vision.diagnostics.grids
            .flatMap((grid) => grid.cells)
            .slice(0, EXTRACTION_LIMITS.maximumCandidateCells);
          const texts: string[] = [];
          const words: OcrPageResult["words"] = [];
          for (
            let cellIndex = 0;
            cellIndex < candidateCells.length;
            cellIndex += 1
          ) {
            throwIfCancelled(controller.signal);
            const cell = candidateCells[cellIndex];
            options.onProgress?.({
              stage: "READING_CELLS",
              progress:
                (pageIndex + cellIndex / Math.max(1, candidateCells.length)) /
                pageCount,
              pageIndex,
              pageCount,
              detail: `Reading cell ${cellIndex + 1} of ${candidateCells.length}.`,
            });
            const cellCanvas = cropCellCanvas(canvas.canvas, cell.bounds);
            try {
              const result = this.worker.recognizeCell
                ? await this.worker.recognizeCell(
                    cellCanvas,
                    pageIndex,
                    pageCount,
                    cell.rowStart === 0 || cell.columnStart === 0
                      ? "HEADER"
                      : "BLOCK",
                    controller.signal,
                  )
                : await this.worker.recognize(
                    cellCanvas,
                    pageIndex,
                    pageCount,
                    controller.signal,
                  );
              cell.rawText = result.text.trim();
              cell.ocrConfidence = result.confidence;
              if (cell.rawText) {
                texts.push(cell.rawText);
                words.push({
                  text: cell.rawText,
                  confidence: result.confidence,
                  bbox: cell.bounds,
                  pageIndex,
                });
              }
            } finally {
              cellCanvas.width = 0;
              cellCanvas.height = 0;
            }
          }
          const averageOcr =
            candidateCells.reduce(
              (sum, cell) => sum + (cell.ocrConfidence ?? 0),
              0,
            ) / Math.max(1, candidateCells.length);
          const warnings = [];
          if (Math.min(canvas.canvas.width, canvas.canvas.height) < 700) {
            warnings.push({
              code: "LOW_RESOLUTION" as const,
              message:
                "This image is low resolution; verify small cell text carefully.",
            });
          }
          ocrPages.push({
            pageIndex,
            text: texts.join("\n"),
            confidence: averageOcr,
            width: canvas.canvas.width,
            height: canvas.canvas.height,
            words,
            diagnostics: vision.diagnostics,
            confidenceBreakdown: calculateExtractionConfidence({
              inputQuality: Math.min(
                1,
                Math.min(canvas.canvas.width, canvas.canvas.height) / 900,
              ),
              tableDetection: vision.diagnostics.regions[0]?.confidence ?? 0.4,
              perspectiveCorrection:
                vision.diagnostics.transforms.find(
                  (transform) => transform.type === "PERSPECTIVE",
                )?.confidence ?? 0.4,
              gridDetection: vision.primaryGrid.confidence,
              headerParsing: 0.5,
              cellOCR: averageOcr / 100,
              legendMapping: vision.legendGrid ? 0.8 : 0.4,
              semanticParsing: 0.5,
              warnings,
            }),
            previewDataUrl,
          });
          canvas.cleanup();
          canvas = undefined;
          continue;
        }
        options.onProgress?.({
          stage: "PREPARING_IMAGE",
          progress: pageIndex / pageCount,
          pageIndex,
          pageCount,
        });
        const prepared = await this.dependencies.preprocess(canvas);
        throwIfCancelled(controller.signal);
        if (!this.worker) {
          options.onProgress?.({
            stage: "STARTING_OCR",
            progress: (pageIndex + 0.35) / pageCount,
            pageIndex,
            pageCount,
          });
          this.worker = await this.dependencies.createOcrWorker({
            onProgress: options.onProgress,
          });
        }
        const fallback = await this.worker.recognize(
          prepared,
          pageIndex,
          pageCount,
          controller.signal,
        );
        fallback.previewDataUrl = previewDataUrl;
        fallback.diagnostics = vision?.diagnostics
          ? { ...vision.diagnostics, source: "FULL_OCR_FALLBACK" }
          : {
              source: "FULL_OCR_FALLBACK",
              width: fallback.width,
              height: fallback.height,
              transforms: [],
              horizontalLines: [],
              verticalLines: [],
              regions: [],
              grids: [],
              timings: [],
            };
        ocrPages.push(fallback);
        canvas.cleanup();
        canvas = undefined;
      }

      options.onProgress?.({
        stage: "MATCHING_SUBJECTS",
        progress: 0.89,
        pageCount,
        detail: "Matching headers, subject codes, legends, and merged spans.",
      });
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
        warnings: [
          ...pages.flatMap(
            (page) =>
              page.confidence?.warnings.map((warning) => warning.message) ?? [],
          ),
          ...(pages.length < pageCount
            ? [
                `${pageCount - pages.length} ${pageCount - pages.length === 1 ? "page did" : "pages did"} not contain a recognizable timetable.`,
              ]
            : []),
        ],
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
