import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExtractionPreview } from "@/components/timetable-import/extraction-preview";
import { ExtractionProgress } from "@/components/timetable-import/extraction-progress";
import { TimetableFileUpload } from "@/components/timetable-import/timetable-file-upload";
import { ExtractionError } from "@/components/timetable-import/extraction-error";
import type { TimetableExtractionResult } from "@/lib/timetable-extraction";

const result: TimetableExtractionResult = {
  totalPageCount: 2,
  warnings: ["One page needs attention."],
  pages: [0, 1].map((pageIndex) => ({
    pageIndex,
    label: `Page ${pageIndex + 1}`,
    rawTextPreview: "Monday 09:00 Signals",
    detectedCellCount: 1,
    draft: {
      title: "Imported",
      timezone: "Asia/Kolkata",
      days: ["MONDAY"],
      timeSlots: [{ startTime: "09:00", endTime: "10:00" }],
      subjects: [],
      timetableSlots: [],
      detectedBatchOptions: [],
      detectedElectiveGroups: [],
      ambiguousItems:
        pageIndex === 0
          ? [
              {
                id: "review",
                field: "cell",
                possibleValues: ["Signals"],
                sourceDescription: "Page 1",
                confidence: 0.5,
              },
            ]
          : [],
      warnings: [],
      overallConfidence: 0.8,
    },
  })),
};

describe("local extraction UI", () => {
  it("shows meaningful progress and supports cancellation", () => {
    const onCancel = vi.fn();
    render(
      <ExtractionProgress
        value={{
          stage: "READING_PAGE",
          progress: 0.42,
          pageIndex: 0,
          pageCount: 2,
        }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Reading timetable/)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    fireEvent.click(screen.getByTestId("cancel-extraction"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows low-confidence warnings, page selection, continue, and cancel-without-save", () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    render(
      <ExtractionPreview
        result={result}
        onContinue={onContinue}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/1 low-confidence cell/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Import Page 1"));
    fireEvent.click(screen.getByTestId("review-extracted-timetable"));
    expect(onContinue).toHaveBeenCalledWith([result.pages[1]]);
    fireEvent.click(
      screen.getByRole("button", { name: /cancel without saving/i }),
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("rejects unsupported uploads and keeps manual entry visible", () => {
    render(
      <TimetableFileUpload
        timezone="Asia/Kolkata"
        onBack={vi.fn()}
        onReady={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Choose timetable image or PDF"), {
      target: {
        files: [new File(["gif"], "table.gif", { type: "image/gif" })],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /PNG, JPEG, WebP, or PDF/,
    );
    expect(
      screen.getByRole("button", { name: /enter timetable manually/i }),
    ).toBeVisible();
  });

  it("allows a valid file to bypass OCR without saving anything", () => {
    const onReady = vi.fn();
    render(
      <TimetableFileUpload
        timezone="Asia/Kolkata"
        onBack={vi.fn()}
        onReady={onReady}
      />,
    );
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "table.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(screen.getByLabelText("Choose timetable image or PDF"), {
      target: { files: [file] },
    });
    expect(screen.getByText(/Local by default/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /skip ocr and enter it myself/i }),
    );
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ timetableSlots: [] }),
      expect.objectContaining({ file }),
    );
  });

  it("requires fresh consent and sends nothing when the AI dialog is cancelled", () => {
    const onAi = vi.fn(async () => undefined);
    render(
      <ExtractionError
        message="The structure was unreliable."
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onAi={onAi}
        aiAvailable
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use AI to Read Schedule" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Use AI to read this schedule?" }),
    ).toBeVisible();
    expect(screen.getByText(/attendance history, percentages/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAi).not.toHaveBeenCalled();
  });

  it("submits exactly once after explicit AI consent", () => {
    const onAi = vi.fn(async () => undefined);
    render(
      <ExtractionError
        message="The structure was unreliable."
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onAi={onAi}
        aiAvailable
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use AI to Read Schedule" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with AI" }));
    expect(onAi).toHaveBeenCalledOnce();
  });

  it("restores retry and manual actions after a retryable AI failure", () => {
    const onAi = vi.fn(async () => undefined);
    const view = render(
      <ExtractionError
        message="The structure was unreliable."
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onAi={onAi}
        aiAvailable
        aiBusy
        aiError="Gemini is temporarily busy. Please wait a moment and try again."
      />,
    );
    expect(
      screen.getByRole("button", { name: "Reading schedule with AI…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Enter timetable manually" }),
    ).toBeEnabled();

    view.rerender(
      <ExtractionError
        message="The structure was unreliable."
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onAi={onAi}
        aiAvailable
        aiError="Gemini is temporarily busy. Please wait a moment and try again."
      />,
    );
    expect(screen.getByRole("button", { name: "Try AI again" })).toBeEnabled();
    expect(screen.getByText(/Gemini is temporarily busy/)).toBeVisible();
  });

  it("keeps local alternatives available while AI is offline", () => {
    render(
      <ExtractionError
        message="The structure was unreliable."
        onRetry={vi.fn()}
        onManual={vi.fn()}
        onAi={vi.fn(async () => undefined)}
        aiAvailable={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "AI requires internet" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Try another file" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Enter timetable manually" }),
    ).toBeEnabled();
  });
});
