import type { PixelBuffer } from "./image-preprocessing";
import type {
  BoundingBox,
  DetectedCell,
  DetectedLine,
  DetectedRegion,
  LogicalGrid,
  PageDiagnostics,
} from "./types";

interface BinaryImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface TableVisionResult {
  diagnostics: PageDiagnostics;
  primaryGrid?: LogicalGrid;
  legendGrid?: LogicalGrid;
  binary: BinaryImage;
}

export function clusterLineCoordinates(
  values: readonly number[],
  tolerance: number,
): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (const value of sorted.slice(1)) {
    const current = clusters.at(-1)!;
    const average =
      current.reduce((sum, item) => sum + item, 0) / current.length;
    if (Math.abs(value - average) <= tolerance) current.push(value);
    else clusters.push([value]);
  }
  return clusters.map((cluster) =>
    Math.round(cluster.reduce((sum, value) => sum + value, 0) / cluster.length),
  );
}

function grayscale(source: PixelBuffer): Uint8Array {
  const result = new Uint8Array(source.width * source.height);
  let minimum = 255;
  let maximum = 0;
  for (let pixel = 0; pixel < result.length; pixel += 1) {
    const index = pixel * 4;
    const value = Math.round(
      source.data[index] * 0.2126 +
        source.data[index + 1] * 0.7152 +
        source.data[index + 2] * 0.0722,
    );
    result[pixel] = value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = Math.max(24, maximum - minimum);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Math.max(
      0,
      Math.min(255, Math.round(((result[index] - minimum) / range) * 255)),
    );
  }
  return result;
}

function integralImage(
  values: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] =
        integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  return integral;
}

export function adaptiveThreshold(source: PixelBuffer): BinaryImage {
  const grey = grayscale(source);
  const { width, height } = source;
  const result = new Uint8Array(width * height);
  const integral = integralImage(grey, width, height);
  const radius = Math.max(5, Math.round(Math.min(width, height) * 0.012));
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const stride = width + 1;
      const sum =
        integral[(bottom + 1) * stride + right + 1] -
        integral[top * stride + right + 1] -
        integral[(bottom + 1) * stride + left] +
        integral[top * stride + left];
      const average = sum / ((right - left + 1) * (bottom - top + 1));
      result[y * width + x] = grey[y * width + x] < average - 10 ? 1 : 0;
    }
  }
  return { data: result, width, height };
}

function lineRuns(
  binary: BinaryImage,
  orientation: "horizontal" | "vertical",
): DetectedLine[] {
  const { width, height, data } = binary;
  const longDimension = orientation === "horizontal" ? width : height;
  const shortDimension = orientation === "horizontal" ? height : width;
  const minimumRun = Math.max(12, Math.round(longDimension * 0.075));
  const candidates: DetectedLine[] = [];
  for (let short = 0; short < shortDimension; short += 1) {
    let runStart = -1;
    for (let long = 0; long <= longDimension; long += 1) {
      const dark =
        long < longDimension &&
        Boolean(
          data[
            orientation === "horizontal"
              ? short * width + long
              : long * width + short
          ],
        );
      if (dark && runStart < 0) runStart = long;
      if ((!dark || long === longDimension) && runStart >= 0) {
        const length = long - runStart;
        if (length >= minimumRun) {
          candidates.push({
            orientation,
            coordinate: short,
            start: runStart,
            end: long - 1,
            thickness: 1,
            confidence: Math.min(1, length / (longDimension * 0.45)),
          });
        }
        runStart = -1;
      }
    }
  }
  return mergeLineBands(
    candidates,
    Math.max(1, Math.round(shortDimension * 0.003)),
  );
}

export function mergeLineBands(
  lines: readonly DetectedLine[],
  tolerance: number,
): DetectedLine[] {
  const sorted = [...lines].sort((a, b) => a.coordinate - b.coordinate);
  const groups: DetectedLine[][] = [];
  for (const line of sorted) {
    const group = [...groups].reverse().find((candidateGroup) => {
      const coordinateMatches =
        line.coordinate - candidateGroup.at(-1)!.coordinate <= tolerance;
      const rangeMatches =
        line.start <=
          Math.max(...candidateGroup.map((candidate) => candidate.end)) +
            tolerance &&
        line.end >=
          Math.min(...candidateGroup.map((candidate) => candidate.start)) -
            tolerance;
      return coordinateMatches && rangeMatches;
    });
    if (group) group.push(line);
    else groups.push([line]);
  }
  return groups.map((group) => ({
    orientation: group[0].orientation,
    coordinate: Math.round(
      group.reduce((sum, line) => sum + line.coordinate, 0) / group.length,
    ),
    start: Math.min(...group.map((line) => line.start)),
    end: Math.max(...group.map((line) => line.end)),
    thickness: group.at(-1)!.coordinate - group[0].coordinate + 1,
    confidence:
      group.reduce((sum, line) => sum + line.confidence, 0) / group.length,
  }));
}

function connectedRowGroups(
  lines: readonly DetectedLine[],
  vertical: readonly DetectedLine[],
): DetectedLine[][] {
  const groups: DetectedLine[][] = [];
  for (const line of [...lines].sort((a, b) => a.coordinate - b.coordinate)) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const bridged =
      previous &&
      vertical.some(
        (candidate) =>
          candidate.start <= previous.coordinate + 2 &&
          candidate.end >= line.coordinate - 2,
      );
    if (group && bridged) group.push(line);
    else groups.push([line]);
  }
  return groups;
}

function regionCandidates(
  horizontal: readonly DetectedLine[],
  vertical: readonly DetectedLine[],
  width: number,
  height: number,
): DetectedRegion[] {
  const rowGroups = connectedRowGroups(horizontal, vertical);
  const candidates: DetectedRegion[] = [];
  for (const rows of rowGroups) {
    if (rows.length < 3) continue;
    const y0 = rows[0].coordinate;
    const y1 = rows.at(-1)!.coordinate;
    const columns = vertical.filter(
      (line) =>
        line.start <= y0 + (y1 - y0) * 0.2 && line.end >= y1 - (y1 - y0) * 0.2,
    );
    if (columns.length < 3) continue;
    const x0 = Math.min(...columns.map((line) => line.coordinate));
    const x1 = Math.max(...columns.map((line) => line.coordinate));
    const area = ((x1 - x0) * (y1 - y0)) / (width * height);
    const intersections = rows.length * columns.length;
    const density = Math.min(1, intersections / 60);
    const regularity =
      boundaryRegularity(rows.map((line) => line.coordinate)) *
      boundaryRegularity(columns.map((line) => line.coordinate));
    candidates.push({
      id: `region_${candidates.length + 1}`,
      kind: "UNKNOWN_TABLE",
      bounds: { x0, y0, x1, y1 },
      horizontalLineCount: rows.length,
      verticalLineCount: columns.length,
      intersectionDensity: density,
      confidence: Math.min(1, area * 1.5 + density * 0.35 + regularity * 0.3),
    });
  }
  const sorted = candidates.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (b.bounds.x1 - b.bounds.x0) * (b.bounds.y1 - b.bounds.y0) -
        (a.bounds.x1 - a.bounds.x0) * (a.bounds.y1 - a.bounds.y0),
  );
  return sorted.map((region, index) => ({
    ...region,
    kind:
      index === 0
        ? "PRIMARY_TIMETABLE"
        : index === 1
          ? "LEGEND"
          : "UNKNOWN_TABLE",
  }));
}

function boundaryRegularity(boundaries: readonly number[]): number {
  if (boundaries.length < 3) return 0;
  const gaps = boundaries
    .slice(1)
    .map((value, index) => value - boundaries[index]);
  const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const deviation =
    gaps.reduce((sum, value) => sum + Math.abs(value - average), 0) /
    gaps.length;
  return Math.max(0, 1 - deviation / Math.max(1, average));
}

function boundaryPresent(
  binary: BinaryImage,
  orientation: "vertical" | "horizontal",
  coordinate: number,
  start: number,
  end: number,
): number {
  let hits = 0;
  let samples = 0;
  const radius = 2;
  for (let position = start; position <= end; position += 1) {
    samples += 1;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const x = orientation === "vertical" ? coordinate + offset : position;
      const y = orientation === "vertical" ? position : coordinate + offset;
      if (
        x >= 0 &&
        y >= 0 &&
        x < binary.width &&
        y < binary.height &&
        binary.data[y * binary.width + x]
      ) {
        hits += 1;
        break;
      }
    }
  }
  return hits / Math.max(1, samples);
}

export function reconstructCells(
  binary: BinaryImage,
  region: DetectedRegion,
  horizontalLines: readonly DetectedLine[],
  verticalLines: readonly DetectedLine[],
): LogicalGrid | undefined {
  const rows = clusterLineCoordinates(
    horizontalLines
      .filter(
        (line) =>
          line.coordinate >= region.bounds.y0 &&
          line.coordinate <= region.bounds.y1,
      )
      .map((line) => line.coordinate),
    3,
  );
  const columns = clusterLineCoordinates(
    verticalLines
      .filter(
        (line) =>
          line.coordinate >= region.bounds.x0 &&
          line.coordinate <= region.bounds.x1,
      )
      .map((line) => line.coordinate),
    3,
  );
  if (rows.length < 3 || columns.length < 3) return undefined;
  const cells: DetectedCell[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    let column = 0;
    while (column < columns.length - 1) {
      let columnSpan = 1;
      while (column + columnSpan < columns.length - 1) {
        const separator = columns[column + columnSpan];
        const continuity = boundaryPresent(
          binary,
          "vertical",
          separator,
          rows[row] + 2,
          rows[row + 1] - 2,
        );
        if (continuity >= 0.55) break;
        columnSpan += 1;
      }
      cells.push({
        id: `${region.id}_r${row}_c${column}`,
        rowStart: row,
        rowSpan: 1,
        columnStart: column,
        columnSpan,
        bounds: {
          x0: columns[column],
          y0: rows[row],
          x1: columns[column + columnSpan],
          y1: rows[row + 1],
        },
        structuralConfidence: columnSpan > 1 ? 0.78 : 0.9,
      });
      column += columnSpan;
    }
  }
  const verticallyMerged: DetectedCell[] = [];
  const consumed = new Set<string>();
  for (const cell of cells) {
    if (consumed.has(cell.id)) continue;
    let rowSpan = 1;
    let next = cells.find(
      (candidate) =>
        candidate.rowStart === cell.rowStart + rowSpan &&
        candidate.columnStart === cell.columnStart &&
        candidate.columnSpan === cell.columnSpan,
    );
    while (next) {
      const separator = rows[cell.rowStart + rowSpan];
      const continuity = boundaryPresent(
        binary,
        "horizontal",
        separator,
        columns[cell.columnStart] + 2,
        columns[cell.columnStart + cell.columnSpan] - 2,
      );
      if (continuity >= 0.55) break;
      consumed.add(next.id);
      rowSpan += 1;
      next = cells.find(
        (candidate) =>
          candidate.rowStart === cell.rowStart + rowSpan &&
          candidate.columnStart === cell.columnStart &&
          candidate.columnSpan === cell.columnSpan,
      );
    }
    verticallyMerged.push({
      ...cell,
      rowSpan,
      bounds: {
        ...cell.bounds,
        y1: rows[cell.rowStart + rowSpan],
      },
      structuralConfidence:
        rowSpan > 1
          ? Math.min(cell.structuralConfidence, 0.78)
          : cell.structuralConfidence,
    });
  }
  return {
    regionId: region.id,
    rowBoundaries: rows,
    columnBoundaries: columns,
    cells: verticallyMerged,
    confidence: Math.min(
      1,
      (boundaryRegularity(rows) +
        boundaryRegularity(columns) +
        region.confidence) /
        3,
    ),
  };
}

export function analyzeTableImage(source: PixelBuffer): TableVisionResult {
  const started = performance.now();
  const binary = adaptiveThreshold(source);
  const thresholded = performance.now();
  const horizontalLines = lineRuns(binary, "horizontal");
  const verticalLines = lineRuns(binary, "vertical");
  const linesDetected = performance.now();
  const regions = regionCandidates(
    horizontalLines,
    verticalLines,
    source.width,
    source.height,
  );
  const primary = regions.find((region) => region.kind === "PRIMARY_TIMETABLE");
  const legend = regions.find((region) => region.kind === "LEGEND");
  const primaryGrid = primary
    ? reconstructCells(binary, primary, horizontalLines, verticalLines)
    : undefined;
  const legendGrid = legend
    ? reconstructCells(binary, legend, horizontalLines, verticalLines)
    : undefined;
  const completed = performance.now();
  return {
    binary,
    primaryGrid,
    legendGrid,
    diagnostics: {
      source: "IMAGE_GRID",
      width: source.width,
      height: source.height,
      transforms: [
        {
          type: "EXIF_ORIENTATION",
          description:
            "Browser image decoding applied embedded orientation metadata.",
          confidence: 0.95,
        },
        {
          type: "PERSPECTIVE",
          description: primary
            ? "Outer grid quadrilateral was evaluated; axis-aligned crop retained because no safer warp was established."
            : "No reliable quadrilateral was found; full-image fallback retained.",
          confidence: primary?.confidence ?? 0.2,
        },
      ],
      horizontalLines,
      verticalLines,
      regions,
      grids: [primaryGrid, legendGrid].filter((grid): grid is LogicalGrid =>
        Boolean(grid),
      ),
      timings: [
        { stage: "adaptive-threshold", durationMs: thresholded - started },
        { stage: "line-detection", durationMs: linesDetected - thresholded },
        { stage: "grid-reconstruction", durationMs: completed - linesDetected },
      ],
    },
  };
}

export function canvasPixelBuffer(canvas: HTMLCanvasElement): PixelBuffer {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas pixels are unavailable");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: image.width, height: image.height };
}

export function cropCellCanvas(
  source: HTMLCanvasElement,
  bounds: BoundingBox,
): HTMLCanvasElement {
  const marginX = Math.max(1, Math.round((bounds.x1 - bounds.x0) * 0.035));
  const marginY = Math.max(1, Math.round((bounds.y1 - bounds.y0) * 0.06));
  const sx = Math.max(0, Math.round(bounds.x0 + marginX));
  const sy = Math.max(0, Math.round(bounds.y0 + marginY));
  const sw = Math.max(1, Math.round(bounds.x1 - bounds.x0 - marginX * 2));
  const sh = Math.max(1, Math.round(bounds.y1 - bounds.y0 - marginY * 2));
  const scale = Math.min(3, Math.max(1, 72 / Math.max(1, sh)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cell canvas is unavailable");
  context.imageSmoothingEnabled = true;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
