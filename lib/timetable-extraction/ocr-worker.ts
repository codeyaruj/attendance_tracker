import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  throwIfCancelled,
} from "./types";
import type { ExtractionProgress, OcrPageResult, OcrWord } from "./types";

interface TesseractBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: TesseractBox;
}

interface TesseractBlock {
  paragraphs: Array<{ lines: Array<{ words: TesseractWord[] }> }>;
}

interface TesseractWorkerLike {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(
    image: HTMLCanvasElement,
    options: Record<string, never>,
    output: { text: boolean; blocks: boolean },
  ): Promise<{
    data: { text: string; confidence: number; blocks: TesseractBlock[] | null };
  }>;
  terminate(): Promise<unknown>;
}

export interface OcrWorker {
  recognize(
    canvas: HTMLCanvasElement,
    pageIndex: number,
    pageCount: number,
    signal?: AbortSignal,
  ): Promise<OcrPageResult>;
  recognizeCell?(
    canvas: HTMLCanvasElement,
    pageIndex: number,
    pageCount: number,
    mode: "HEADER" | "BLOCK" | "SPARSE",
    signal?: AbortSignal,
  ): Promise<OcrPageResult>;
  terminate(): Promise<void>;
}

export interface OcrWorkerOptions {
  onProgress?: (progress: ExtractionProgress) => void;
}

function flattenWords(
  blocks: TesseractBlock[] | null,
  pageIndex: number,
): OcrWord[] {
  if (!blocks) return [];
  const words: OcrWord[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          if (words.length >= EXTRACTION_LIMITS.maximumWordsPerPage)
            return words;
          words.push({
            text: word.text,
            confidence: word.confidence,
            bbox: { ...word.bbox },
            pageIndex,
          });
        }
      }
    }
  }
  return words;
}

export async function createLocalOcrWorker(
  options: OcrWorkerOptions = {},
): Promise<OcrWorker> {
  let activePage = 0;
  let activePageCount = 1;
  let worker: TesseractWorkerLike;
  try {
    const tesseract = await import("tesseract.js");
    worker = (await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
      workerPath: "/ocr-assets/worker.min.js",
      corePath: "/ocr-assets/core",
      langPath: "/ocr-assets/lang",
      workerBlobURL: false,
      gzip: true,
      logger(message) {
        options.onProgress?.({
          stage: "READING_PAGE",
          progress: Math.max(0, Math.min(1, message.progress)),
          pageIndex: activePage,
          pageCount: activePageCount,
          detail: message.status,
        });
      },
    })) as TesseractWorkerLike;
  } catch (cause) {
    throw new TimetableExtractionError(
      "OCR_MODEL_FAILURE",
      "The local OCR engine or English model could not be loaded.",
      { cause },
    );
  }

  let terminated = false;
  const terminate = async () => {
    if (terminated) return;
    terminated = true;
    await worker.terminate().catch(() => undefined);
  };

  return {
    async recognize(canvas, pageIndex, pageCount, signal) {
      throwIfCancelled(signal);
      activePage = pageIndex;
      activePageCount = pageCount;
      await worker.setParameters({ tessedit_pageseg_mode: "3" });
      const onAbort = () => void terminate();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            void terminate();
            reject(
              new TimetableExtractionError(
                "PROCESSING_LIMIT",
                `Local OCR took too long on page ${pageIndex + 1}.`,
              ),
            );
          }, EXTRACTION_LIMITS.maximumPageDurationMs);
        });
        const result = await Promise.race([
          worker.recognize(canvas, {}, { text: true, blocks: true }),
          timeoutPromise,
        ]);
        throwIfCancelled(signal);
        return {
          pageIndex,
          text: result.data.text,
          confidence: result.data.confidence,
          width: canvas.width,
          height: canvas.height,
          words: flattenWords(result.data.blocks, pageIndex),
        };
      } catch (cause) {
        if (signal?.aborted) throwIfCancelled(signal);
        if (cause instanceof TimetableExtractionError) throw cause;
        throw new TimetableExtractionError(
          "OCR_WORKER_FAILURE",
          `Local OCR failed while reading page ${pageIndex + 1}.`,
          { cause },
        );
      } finally {
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    async recognizeCell(canvas, pageIndex, pageCount, mode, signal) {
      throwIfCancelled(signal);
      activePage = pageIndex;
      activePageCount = pageCount;
      await worker.setParameters({
        tessedit_pageseg_mode:
          mode === "HEADER" ? "7" : mode === "SPARSE" ? "11" : "6",
      });
      const result = await worker.recognize(
        canvas,
        {},
        { text: true, blocks: true },
      );
      throwIfCancelled(signal);
      return {
        pageIndex,
        text: result.data.text,
        confidence: result.data.confidence,
        width: canvas.width,
        height: canvas.height,
        words: flattenWords(result.data.blocks, pageIndex),
      };
    },
    terminate,
  };
}
