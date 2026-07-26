import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import { DatabaseRecoveryState } from "@/components/attendance/data-state";
import { attendSafeRepository } from "@/db";

afterEach(() => vi.restoreAllMocks());

describe("database recovery UI", () => {
  it("does not reset automatically and retries without deleting data", async () => {
    const retry = vi
      .spyOn(attendSafeRepository, "retryDatabase")
      .mockResolvedValue({ status: "READY" });
    const reset = vi.spyOn(attendSafeRepository, "resetCorruptDatabase");
    const onRetry = vi.fn();
    render(<DatabaseRecoveryState onRetry={onRetry} />);
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it("requires RESET before calling the destructive recovery helper", async () => {
    const reset = vi
      .spyOn(attendSafeRepository, "resetCorruptDatabase")
      .mockResolvedValue();
    const onResetComplete = vi.fn();
    render(<DatabaseRecoveryState onResetComplete={onResetComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset database" }));
    const confirm = screen.getByRole("button", {
      name: "Delete all local data",
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type "RESET"/), {
      target: { value: "RESET" },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(reset).toHaveBeenCalledWith("RESET"));
    expect(onResetComplete).toHaveBeenCalledOnce();
  });

  it("labels a failed-table recovery export as partial", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    vi.spyOn(attendSafeRepository, "exportRecoverableData").mockResolvedValue({
      json: "{}",
      partial: true,
      warnings: ["subjects could not be read"],
    });
    render(
      <>
        <DatabaseRecoveryState />
        <Toaster />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export recoverable data" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Partial recovery file downloaded/i),
      ).toBeVisible(),
    );
  });
});
