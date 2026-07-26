export type BackupErrorCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "READ_FAILED"
  | "INVALID_JSON"
  | "LIMIT_EXCEEDED"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "MIGRATION_FAILED"
  | "SCHEMA_INVALID"
  | "REFERENCE_INVALID"
  | "DUPLICATE_ID"
  | "CONFLICT_DETECTED"
  | "IMPORT_CANCELLED"
  | "TRANSACTION_FAILED"
  | "DATABASE_UNAVAILABLE"
  | "RECOVERY_FAILED";

export interface BackupDiagnostic {
  path?: string;
  details?: string;
}

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly diagnostic: BackupDiagnostic = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackupError";
  }
}

export function safeBackupError(cause: unknown): BackupError {
  if (cause instanceof BackupError) return cause;
  return new BackupError(
    "SCHEMA_INVALID",
    "The backup contains invalid or incompatible data.",
    {},
    { cause },
  );
}
