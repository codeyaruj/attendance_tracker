import type { AttendSafeDatabase } from "@/db/database";
import { DATABASE_SCHEMA_VERSION, TABLE_NAMES } from "@/db/schema";
import { BackupError } from "./backup-errors";

export interface RecoveryExportResult {
  json: string;
  partial: boolean;
  warnings: string[];
}

export async function exportRecoverableDatabase(
  database: AttendSafeDatabase,
): Promise<RecoveryExportResult> {
  const data: Record<string, unknown[]> = {};
  const warnings: string[] = [];
  for (const tableName of TABLE_NAMES) {
    try {
      const records = await database.table(tableName).toArray();
      data[tableName] =
        tableName === "uploadedTimetableReferences"
          ? records.map((record) => {
              if (typeof record !== "object" || record === null) return record;
              const copy = { ...record } as Record<string, unknown>;
              delete copy.blob;
              return {
                ...copy,
                recoveryWarning:
                  "Original binary source omitted from raw recovery export.",
              };
            })
          : records;
    } catch {
      data[tableName] = [];
      warnings.push(`Table ${tableName} could not be read and was omitted.`);
    }
  }
  if (Object.values(data).every((records) => records.length === 0)) {
    throw new BackupError(
      "RECOVERY_FAILED",
      "No readable local records could be recovered.",
    );
  }
  const partial = warnings.length > 0;
  return {
    partial,
    warnings,
    json: JSON.stringify(
      {
        format: "attendance-tracker-recovery",
        version: 1,
        partial,
        recoveredAt: new Date().toISOString(),
        databaseVersion: DATABASE_SCHEMA_VERSION,
        warnings,
        data,
      },
      null,
      2,
    ),
  };
}
