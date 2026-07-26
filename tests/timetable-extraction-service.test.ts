import { describe, expect, it, vi } from "vitest";
import {
  LocalTimetableExtractionService,
  TimetableExtractionError,
  type ExtractionDependencies,
  type ExtractedPage,
  type OcrPageResult,
  type OcrWorker,
} from "@/lib/timetable-extraction";

function sourceFile(): File {
  return new File(["%PDF-1.7"], "table.pdf", { type: "application/pdf" });
}

function extractedPage(pageIndex: number): ExtractedPage {
  return {
    pageIndex,
    label: `Page ${pageIndex + 1}`,
    rawTextPreview: "Monday timetable",
    detectedCellCount: 1,
    draft: {
      title: "Imported timetable",
      timezone: "Asia/Kolkata",
      days: ["MONDAY"],
      timeSlots: [{ startTime: "09:00", endTime: "10:00" }],
      subjects: [],
      timetableSlots: [],
      detectedBatchOptions: [],
      detectedElectiveGroups: [],
      ambiguousItems: [],
      warnings: [],
      overallConfidence: 0.9,
    },
  };
}

function dependencies(options: {
  pageCount?: number;
  recognize?: OcrWorker["recognize"];
  openPdfError?: Error;
  positionedText?: OcrPageResult;
}) {
  const cleanup = vi.fn();
  const terminate = vi.fn(async () => undefined);
  const order: string[] = [];
  const worker: OcrWorker = {
    recognize:
      options.recognize ??
      (async (canvas, pageIndex) => {
        order.push(`ocr-${pageIndex}`);
        return {
          pageIndex,
          text: "Monday",
          confidence: 90,
          width: canvas.width,
          height: canvas.height,
          words: [],
        };
      }),
    terminate,
  };
  const values: ExtractionDependencies = {
    validateFile: vi.fn(async (file: File) => ({
      file,
      kind: "PDF" as const,
      mediaType: "application/pdf",
    })),
    assertBrowserSupport: vi.fn(),
    openPdf: vi.fn(async () => {
      if (options.openPdfError) throw options.openPdfError;
      return {
        pageCount: options.pageCount ?? 2,
        ...(options.positionedText
          ? {
              extractPositionedText: vi.fn(async () => options.positionedText),
            }
          : {}),
        async renderPage(pageIndex: number) {
          order.push(`render-${pageIndex}`);
          const canvas = document.createElement("canvas");
          canvas.width = 100;
          canvas.height = 100;
          return { canvas, cleanup };
        },
        destroy: vi.fn(async () => undefined),
      };
    }),
    loadImage: vi.fn(),
    preprocess: vi.fn(async (resource) => resource.canvas),
    createOcrWorker: vi.fn(async () => worker),
    reconstruct: vi.fn((pages: readonly OcrPageResult[]) =>
      pages.map((page) => extractedPage(page.pageIndex)),
    ),
  };
  return { values, cleanup, terminate, order };
}

describe("local extraction service", () => {
  it("reports progress, processes PDF pages sequentially, and cleans resources", async () => {
    const mocks = dependencies({ pageCount: 2 });
    const service = new LocalTimetableExtractionService(mocks.values);
    const progress = vi.fn();
    const result = await service.extract(sourceFile(), {
      timezone: "Asia/Kolkata",
      onProgress: progress,
    });

    expect(result.pages).toHaveLength(2);
    expect(mocks.order).toEqual(["render-0", "ocr-0", "render-1", "ocr-1"]);
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "PREPARING_PREVIEW", progress: 1 }),
    );
  });

  it("cancels active OCR, terminates the worker, and saves no partial result", async () => {
    const mocks = dependencies({
      pageCount: 1,
      recognize: async (_canvas, _page, _count, signal) =>
        await new Promise((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("stopped")),
            {
              once: true,
            },
          );
        }),
    });
    const service = new LocalTimetableExtractionService(mocks.values);
    const pending = service.extract(sourceFile(), { timezone: "Asia/Kolkata" });
    await vi.waitFor(() => expect(mocks.order).toContain("render-0"));
    await service.cancel();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(mocks.terminate).toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalled();
    expect(mocks.values.reconstruct).not.toHaveBeenCalled();
  });

  it("prevents overlapping extraction jobs", async () => {
    const mocks = dependencies({
      pageCount: 1,
      recognize: async (_canvas, _page, _count, signal) =>
        await new Promise((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("stopped")),
            {
              once: true,
            },
          );
        }),
    });
    const service = new LocalTimetableExtractionService(mocks.values);
    const first = service.extract(sourceFile(), { timezone: "Asia/Kolkata" });
    await expect(
      service.extract(sourceFile(), { timezone: "Asia/Kolkata" }),
    ).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
    await service.cancel();
    await expect(first).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("cleans up and exposes a safe error when PDF parsing fails", async () => {
    const mocks = dependencies({
      openPdfError: new TimetableExtractionError(
        "CORRUPT_PDF",
        "The PDF is corrupt or unreadable.",
      ),
    });
    const service = new LocalTimetableExtractionService(mocks.values);
    await expect(
      service.extract(sourceFile(), { timezone: "Asia/Kolkata" }),
    ).rejects.toMatchObject({ code: "CORRUPT_PDF" });
    expect(mocks.values.createOcrWorker).not.toHaveBeenCalled();
  });

  it("uses positioned PDF text without rendering or starting OCR", async () => {
    const positionedText: OcrPageResult = {
      pageIndex: 0,
      text: "Monday 09:00-10:00 BEC501",
      confidence: 99,
      width: 600,
      height: 800,
      words: [],
    };
    const mocks = dependencies({
      pageCount: 1,
      positionedText,
    });
    const service = new LocalTimetableExtractionService(mocks.values);

    await service.extract(sourceFile(), { timezone: "Asia/Kolkata" });

    expect(mocks.order).toEqual([]);
    expect(mocks.values.createOcrWorker).not.toHaveBeenCalled();
    expect(mocks.values.reconstruct).toHaveBeenCalledWith(
      [positionedText],
      "Asia/Kolkata",
    );
  });
});
