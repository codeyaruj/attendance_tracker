import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TimetableConfirmation,
  type ConfirmationSelections,
} from "@/components/onboarding/timetable-confirmation";
import {
  resolvedOnboardingBatch,
  resolvedOnboardingGroups,
} from "@/components/onboarding/onboarding";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("simplified timetable confirmation", () => {
  it("shows the three student-facing setup steps", () => {
    render(<ConfirmationHarness />);

    const progress = screen.getByRole("list", {
      name: "Timetable setup progress",
    });
    expect(progress).toHaveTextContent("Upload");
    expect(progress).toHaveTextContent("Your classes");
    expect(progress).toHaveTextContent("Review");
    expect(
      screen.queryByText("Uncertain items", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Which classes belong to you?" }),
    ).toBeVisible();
  });

  it("loads legacy singular batch choices while preferring new arrays", () => {
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
    expect(
      resolvedOnboardingGroups(
        { batchDecision: "SELECTED", batch: "B2" },
        "B1",
      ),
    ).toEqual(["B2"]);
    expect(
      resolvedOnboardingGroups(
        {
          selectedGroups: ["C4", "G1"],
          batchDecision: "SELECTED",
          batch: "legacy",
        },
        "B1",
      ),
    ).toEqual(["C4", "G1"]);
  });

  it("selects common classes by default and updates the count immediately", () => {
    render(<ConfirmationHarness />);

    const common = screen.getByRole("checkbox", {
      name: /Digital Signal Processing/,
    });
    expect(common).toBeChecked();
    expect(screen.getByText("3 classes selected")).toBeVisible();
    fireEvent.click(common);
    expect(screen.getByText("2 classes selected")).toBeVisible();
  });

  it("supports multiple and custom groups without replacing selections", () => {
    render(<ConfirmationHarness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "B1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "B2" }));
    expect(screen.getByText("5 classes selected")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add another group" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom group" }), {
      target: { value: "  A   3  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(screen.getByRole("checkbox", { name: "B1" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B2" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "A 3" })).toBeChecked();
  });

  it("passes only selected classes to review and final confirmation", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationHarness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "B1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "B2" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Optical Communication/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));

    expect(
      screen.getByRole("heading", { name: "Review your schedule" }),
    ).toBeVisible();
    expect(screen.queryByText("Form list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-timetable"));

    expect(onConfirm).toHaveBeenCalledOnce();
    const [savedDraft, selections] = onConfirm.mock.calls[0] as [
      NormalizedTimetableDraft,
      ConfirmationSelections,
    ];
    expect(savedDraft.timetableSlots.map((slot) => slot.temporaryId)).toEqual([
      "core-slot",
      "elective-a-slot",
      "lab-b1",
      "lab-b2",
    ]);
    expect(savedDraft.subjects.map((subject) => subject.temporaryId)).toEqual([
      "core",
      "elective-a",
      "lab",
    ]);
    expect(selections).toMatchObject({
      selectedGroups: ["B1", "B2"],
      batchDecision: "SELECTED",
      batch: "B1",
      electiveSubjectIds: { "elective-one": ["elective-a"] },
    });
    expect(selections.tracked.LAB).toBe(true);
  });

  it("goes back to class selection without duplicating classes", () => {
    render(<ConfirmationHarness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "B1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Back to class selection" }),
    );
    expect(
      screen.getByRole("heading", { name: "Which classes belong to you?" }),
    ).toBeVisible();
    expect(screen.getByText("4 classes selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
    expect(screen.getAllByTestId(/^timetable-slot-/)).toHaveLength(4);
  });

  it("lets the student remove a class from the single review editor", () => {
    const onConfirm = vi.fn();
    render(<ConfirmationHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /DSP, Monday, 9:00 AM to 10:00 AM/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove class" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete class" }));
    fireEvent.click(screen.getByTestId("confirm-timetable"));

    const [savedDraft] = onConfirm.mock.calls[0] as [
      NormalizedTimetableDraft,
      ConfirmationSelections,
    ];
    expect(
      savedDraft.timetableSlots.some(
        (slot) => slot.temporaryId === "core-slot",
      ),
    ).toBe(false);
  });

  it("adds a class from the same simplified review editor", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmationHarness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Review schedule" }));
    fireEvent.click(screen.getByTestId("add-class"));
    const dialog = screen.getByRole("dialog", { name: "Add a class" });
    fireEvent.change(within(dialog).getByLabelText("Subject name"), {
      target: { value: "Control Systems" },
    });
    fireEvent.change(within(dialog).getByLabelText("Subject code"), {
      target: { value: "ECE202" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create class" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add a class" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("confirm-timetable"));

    const [savedDraft] = onConfirm.mock.calls[0] as [
      NormalizedTimetableDraft,
      ConfirmationSelections,
    ];
    expect(savedDraft.subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Control Systems", code: "ECE202" }),
      ]),
    );
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
