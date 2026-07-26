import { describe, expect, it } from "vitest";

import type { AttendSafeDatabase } from "@/db/database";
import { TABLE_NAMES } from "@/db/schema";
import { exportRecoverableDatabase } from "@/lib/backup/recovery-export";

function databaseWith(
  records: Partial<Record<(typeof TABLE_NAMES)[number], unknown[]>>,
  failing: ReadonlySet<string> = new Set(),
): AttendSafeDatabase {
  return {
    table: (name: string) => ({
      toArray: async () => {
        if (failing.has(name)) throw new Error("synthetic read failure");
        return records[name as keyof typeof records] ?? [];
      },
    }),
  } as unknown as AttendSafeDatabase;
}

describe("raw database recovery export", () => {
  it("exports readable tables, omits source bytes, and labels partial recovery", async () => {
    const database = databaseWith(
      {
        profiles: [{ id: "profile-synthetic", displayName: "Synthetic User" }],
        uploadedTimetableReferences: [
          {
            id: "upload-synthetic",
            blob: new Uint8Array([1, 2, 3]),
            filename: "synthetic.png",
          },
        ],
      },
      new Set(["attendanceRecords"]),
    );
    const result = await exportRecoverableDatabase(database);
    expect(result.partial).toBe(true);
    expect(result.warnings).toContain(
      "Table attendanceRecords could not be read and was omitted.",
    );
    const parsed = JSON.parse(result.json) as {
      format: string;
      databaseVersion: number;
      data: Record<string, Array<Record<string, unknown>>>;
    };
    expect(parsed.format).toBe("attendance-tracker-recovery");
    expect(parsed.databaseVersion).toBe(4);
    expect(parsed.data.uploadedTimetableReferences[0]).not.toHaveProperty(
      "blob",
    );
    expect(parsed.data.uploadedTimetableReferences[0]).toHaveProperty(
      "recoveryWarning",
    );
  });

  it("fails without claiming success when no record can be recovered", async () => {
    await expect(
      exportRecoverableDatabase(databaseWith({})),
    ).rejects.toMatchObject({
      code: "RECOVERY_FAILED",
    });
  });
});
