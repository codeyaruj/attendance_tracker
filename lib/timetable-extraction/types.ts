import type { NormalizedTimetableDraft } from "@/types";

export const EXTRACTION_LIMITS = {
  maximumFileBytes: 10 * 1024 * 1024,
  maximumPdfPages: 5,
  maximumRenderedDimension: 2_400,
  maximumCanvasPixels: 4_000_000,
  maximumWordsPerPage: 8_000,
  maximumCandidateCells: 350,
  maximumPageDurationMs: 60_000,
  maximumTotalDurationMs: 4 * 60_000,
} as const;

export type TimetableFileKind = "IMAGE" | "PDF";

export type ExtractionStage =
  | "VALIDATING_FILE"
  | "LOADING_PDF"
  | "RENDERING_PAGE"
  | "PREPARING_IMAGE"
  | "FINDING_TIMETABLE"
  | "CORRECTING_PERSPECTIVE"
  | "DETECTING_GRID"
  | "STARTING_OCR"
  | "READING_CELLS"
  | "MATCHING_SUBJECTS"
  | "READING_PAGE"
  | "RECONSTRUCTING_TIMETABLE"
  | "PREPARING_PREVIEW";

export interface ExtractionProgress {
  stage: ExtractionStage;
  progress: number;
  pageIndex?: number;
  pageCount?: number;
  detail?: string;
}

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectedLine {
  orientation: "horizontal" | "vertical";
  coordinate: number;
  start: number;
  end: number;
  thickness: number;
  confidence: number;
}

export interface DetectedRegion {
  id: string;
  kind: "PRIMARY_TIMETABLE" | "LEGEND" | "UNKNOWN_TABLE";
  bounds: BoundingBox;
  horizontalLineCount: number;
  verticalLineCount: number;
  intersectionDensity: number;
  confidence: number;
}

export interface ParsedCellEntry {
  rawText: string;
  subjectCode?: string;
  correctedSubjectCode?: string;
  correctionReason?: string;
  subjectName?: string;
  facultyInitials?: string[];
  facultyNames?: string[];
  room?: string;
  batch?: string;
  group?: string;
  type: "lecture" | "lab" | "project" | "break" | "unknown";
  confidence: number;
}

export interface DetectedCell {
  id: string;
  rowStart: number;
  rowSpan: number;
  columnStart: number;
  columnSpan: number;
  bounds: BoundingBox;
  rawText?: string;
  ocrConfidence?: number;
  structuralConfidence: number;
  entries?: ParsedCellEntry[];
}

export interface LogicalGrid {
  regionId: string;
  rowBoundaries: number[];
  columnBoundaries: number[];
  cells: DetectedCell[];
  confidence: number;
}

export interface ExtractionWarning {
  code:
    | "LOW_RESOLUTION"
    | "PERSPECTIVE_FALLBACK"
    | "BROKEN_GRID"
    | "LOW_OCR"
    | "PARTIAL_RESULT";
  message: string;
  cellId?: string;
}

export interface ExtractionConfidence {
  inputQuality: number;
  tableDetection: number;
  perspectiveCorrection: number;
  gridDetection: number;
  headerParsing: number;
  cellOCR: number;
  legendMapping: number;
  semanticParsing: number;
  overall: number;
  warnings: ExtractionWarning[];
}

export interface PipelineTiming {
  stage: string;
  durationMs: number;
}

export interface PageDiagnostics {
  source: "IMAGE_GRID" | "PDF_POSITIONED_TEXT" | "FULL_OCR_FALLBACK";
  width: number;
  height: number;
  transforms: Array<{
    type: "EXIF_ORIENTATION" | "ROTATION" | "DESKEW" | "CROP" | "PERSPECTIVE";
    description: string;
    confidence: number;
  }>;
  horizontalLines: DetectedLine[];
  verticalLines: DetectedLine[];
  regions: DetectedRegion[];
  grids: LogicalGrid[];
  timings: PipelineTiming[];
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  pageIndex: number;
}

export interface OcrPageResult {
  pageIndex: number;
  text: string;
  confidence: number;
  width: number;
  height: number;
  words: OcrWord[];
  diagnostics?: PageDiagnostics;
  confidenceBreakdown?: ExtractionConfidence;
  previewDataUrl?: string;
}

export interface VisualLine {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  pageIndex: number;
  words: OcrWord[];
}

export interface ExtractedPage {
  pageIndex: number;
  label: string;
  draft: NormalizedTimetableDraft;
  rawTextPreview: string;
  detectedCellCount: number;
  diagnostics?: PageDiagnostics;
  confidence?: ExtractionConfidence;
  previewDataUrl?: string;
}

export interface TimetableExtractionResult {
  pages: ExtractedPage[];
  warnings: string[];
  totalPageCount: number;
}

export type ExtractionErrorCode =
  | "UNSUPPORTED_TYPE"
  | "SPOOFED_FILE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "CORRUPT_IMAGE"
  | "CORRUPT_PDF"
  | "ENCRYPTED_PDF"
  | "PDF_PAGE_LIMIT"
  | "UNSUPPORTED_BROWSER"
  | "PDF_WORKER_FAILURE"
  | "OCR_WORKER_FAILURE"
  | "OCR_MODEL_FAILURE"
  | "PROCESSING_LIMIT"
  | "CANCELLED"
  | "NO_TIMETABLE"
  | "LOW_CONFIDENCE"
  | "ALREADY_RUNNING";

export class TimetableExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TimetableExtractionError";
  }
}

export interface ImageEdits {
  rotation: 0 | 90 | 180 | 270;
  zoom: number;
  crop: { top: number; right: number; bottom: number; left: number };
}

export interface ExtractionOptions {
  timezone: string;
  imageEdits?: ImageEdits;
  signal?: AbortSignal;
  onProgress?: (progress: ExtractionProgress) => void;
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TimetableExtractionError(
      "CANCELLED",
      "Timetable extraction was cancelled.",
    );
  }
}
