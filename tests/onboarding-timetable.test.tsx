import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TimetableConfirmation,
  type ConfirmationSelections,
} from "@/components/onboarding/timetable-confirmation";
import { resolvedOnboardingBatch } from "@/components/onboarding/onboarding";
import {
  createEmptyDraft,
  UploadTimetable,
} from "@/components/onboarding/upload-timetable";
import type { NormalizedTimetableDraft } from "@/types";

function confirmationDraft(): NormalizedTimetableDraft {
  return {
    title: "ECE Semester 5",
    timezone: "Asia/Kolkata",
    days: ["MONDAY", "TUESDAY"],
    timeSlots: [{ startTime: "09:00", endTime: "10:00" }],
    subjects: [
      {
        temporaryId: "core",
        code: "BEC501",
        name: "Digital Signal Processing",
        shortName: "DSP",
        credits: 3,
        classType: "THEORY",
        faculty: [],
        isZeroCredit: false,
        confidence: 1,
      },
      {
        temporaryId: "elective-a",
        name: "CMOS Design",
        shortName: "CMOS",
        credits: 3,
        classType: "THEORY",
        faculty: [],
        isZeroCredit: false,
        confidence: 1,
      },
      {
        temporaryId: "elective-b",
        name: "Optical Communication",
        shortName: "OC",
        credits: 3,
        classType: "THEORY",
        faculty: [],
        isZeroCredit: false,
        confidence: 1,
      },
      {
        temporaryId: "lab",
        name: "DSP Lab",
        shortName: "DSP Lab",
        credits: 1,
        classType: "LAB",
        faculty: [],
        isZeroCredit: false,
        confidence: 1,
      },
    ],
    timetableSlots: [
      {
        temporaryId: "core-slot",
        subjectTemporaryId: "core",
        dayOfWeek: "MONDAY",
        startTime: "09:00",
        endTime: "10:00",
        faculty: [],
        classType: "THEORY",
        batchOptions: [],
        weekPattern: "EVERY_WEEK",
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
      {
        temporaryId: "elective-a-slot",
        subjectTemporaryId: "elective-a",
        dayOfWeek: "TUESDAY",
        startTime: "09:00",
        endTime: "10:00",
        faculty: [],
        classType: "THEORY",
        batchOptions: [],
        electiveGroupId: "elective-one",
        weekPattern: "EVERY_WEEK",
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
      {
        temporaryId: "elective-b-slot",
        subjectTemporaryId: "elective-b",
        dayOfWeek: "TUESDAY",
        startTime: "09:00",
        endTime: "10:00",
        faculty: [],
        classType: "THEORY",
        batchOptions: [],
        electiveGroupId: "elective-one",
        weekPattern: "EVERY_WEEK",
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
      {
        temporaryId: "lab-b1",
        subjectTemporaryId: "lab",
        dayOfWeek: "MONDAY",
        startTime: "14:00",
        endTime: "16:00",
        faculty: [],
        classType: "LAB",
        batchOptions: ["B1"],
        weekPattern: "EVERY_WEEK",
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
      {
        temporaryId: "lab-b2",
        subjectTemporaryId: "lab",
        dayOfWeek: "TUESDAY",
        startTime: "14:00",
        endTime: "16:00",
        faculty: [],
        classType: "LAB",
        batchOptions: ["B2"],
        weekPattern: "EVERY_WEEK",
        confidence: 1,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
    ],
    detectedBatchOptions: ["B1", "B2"],
    detectedElectiveGroups: [
      {
        id: "elective-one",
        name: "Elective I",
        options: [
          { subjectTemporaryId: "elective-a", label: "CMOS Design" },
          {
            subjectTemporaryId: "elective-b",
            label: "Optical Communication",
          },
        ],
        allowMultiple: false,
      },
    ],
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 1,
  };
}

function ConfirmationHarness({
  initial = confirmationDraft(),
  onConfirm = vi.fn(),
}: {
  initial?: NormalizedTimetableDraft;
  onConfirm?: (
    value: NormalizedTimetableDraft,
    selections: ConfirmationSelections,
  ) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimetableConfirmation
      value={value}
      onChange={setValue}
      onBack={vi.fn()}
      onConfirm={onConfirm}
      saving={false}
    />
  );
}

function continueWizard() {
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("timetable confirmation decisions", () => {
  it("does not restore a profile batch after explicit none or unsure choices", () => {
    expect(
      resolvedOnboardingBatch({ batchDecision: "NONE" }, "B1"),
    ).toBeUndefined();
    expect(
      resolvedOnboardingBatch({ batchDecision: "UNSURE" }, "B1"),
    ).toBeUndefined();
    expect(resolvedOnboardingBatch({ batchDecision: "NOT_ASKED" }, "B1")).toBe(
      "B1",
    );
    expect(
      resolvedOnboardingBatch({ batchDecision: "SELECTED", batch: "B2" }, "B1"),
    ).toBe("B2");
  });

  it("keeps batch, elective, and untracked lab alternatives structurally enabled", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationHarness onConfirm={onConfirm} />);

    continueWizard();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "My timetable does not use batches",
      }),
    );
    continueWizard();
    expect(screen.getByRole("radio", { name: "None" })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "I am not sure" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Enter another subject" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    continueWizard();
    continueWizard();
    fireEvent.click(screen.getByTestId("confirm-timetable"));

    expect(onConfirm).toHaveBeenCalledOnce();
    const [savedDraft, selections] = onConfirm.mock.calls[0] as [
      NormalizedTimetableDraft,
      ConfirmationSelections,
    ];
    expect(savedDraft.timetableSlots.every((slot) => slot.isEnabled)).toBe(
      true,
    );
    expect(selections).toMatchObject({
      batchDecision: "NONE",
      batch: undefined,
      electiveSubjectIds: { "elective-one": [] },
    });
    expect(selections.tracked.LAB).toBe(false);
  });

  it("adds and selects a manually entered elective subject", () => {
    render(<ConfirmationHarness />);
    continueWizard();
    fireEvent.click(screen.getByRole("radio", { name: "B1" }));
    continueWizard();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Enter another subject" }),
      { target: { value: "Satellite Communication" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add & select" }));

    expect(
      screen.getByRole("radio", { name: "Satellite Communication" }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("skips batch and elective steps when no alternatives were detected", () => {
    const value = confirmationDraft();
    value.detectedBatchOptions = [];
    value.detectedElectiveGroups = [];
    render(<ConfirmationHarness initial={value} />);

    continueWizard();

    expect(
      screen.getByRole("heading", {
        name: "What should count toward attendance?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Which batch applies to you?"),
    ).not.toBeInTheDocument();
  });

  it("validates mid-semester attendance as whole counts with attended at most held", () => {
    const value = confirmationDraft();
    value.detectedBatchOptions = [];
    value.detectedElectiveGroups = [];
    render(<ConfirmationHarness initial={value} />);
    continueWizard();
    continueWizard();

    const held = screen.getAllByRole("spinbutton", {
      name: "Classes held",
    })[0];
    const attended = screen.getAllByRole("spinbutton", {
      name: "Attended",
    })[0];
    fireEvent.change(held, { target: { value: "1.5" } });
    expect(screen.getByTestId("confirm-timetable")).toBeDisabled();
    fireEvent.change(held, { target: { value: "2" } });
    fireEvent.change(attended, { target: { value: "3" } });
    expect(screen.getByText("Cannot exceed held")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-timetable")).toBeDisabled();
    fireEvent.change(attended, { target: { value: "1" } });
    expect(screen.getByTestId("confirm-timetable")).toBeEnabled();
  });
});

describe("local timetable upload", () => {
  it("preserves a PDF locally when the user skips OCR for manual review", async () => {
    const onReady = vi.fn();
    render(
      <UploadTimetable
        timezone="Asia/Kolkata"
        onBack={vi.fn()}
        onReady={onReady}
      />,
    );
    const file = new File(["%PDF-1.7"], "semester.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("Choose timetable image or PDF"), {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /skip ocr and enter it myself/i }),
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const [value, source] = onReady.mock.calls[0] as [
      ReturnType<typeof createEmptyDraft>,
      { file: File; extractionMessage?: string },
    ];
    expect(value.timetableSlots).toEqual([]);
    expect(source.file).toBe(file);
    expect(source.extractionMessage).toMatch(/local ocr skipped/i);
  });
});
