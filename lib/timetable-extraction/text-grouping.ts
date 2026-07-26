import {
  EXTRACTION_LIMITS,
  type BoundingBox,
  type OcrWord,
  type VisualLine,
} from "./types";

function centerY(box: BoundingBox): number {
  return (box.y0 + box.y1) / 2;
}

function intersectionOverUnion(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(left.x1, right.x1) - Math.max(left.x0, right.x0),
  );
  const height = Math.max(
    0,
    Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0),
  );
  const intersection = width * height;
  const leftArea =
    Math.max(0, left.x1 - left.x0) * Math.max(0, left.y1 - left.y0);
  const rightArea =
    Math.max(0, right.x1 - right.x0) * Math.max(0, right.y1 - right.y0);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

export function normalizeOcrWords(words: readonly OcrWord[]): OcrWord[] {
  const retained: OcrWord[] = [];
  for (const word of words) {
    const text = word.text.replace(/\s+/g, " ").trim();
    if (!text || word.confidence < 20) continue;
    if (
      retained.some(
        (existing) =>
          existing.text.toLowerCase() === text.toLowerCase() &&
          intersectionOverUnion(existing.bbox, word.bbox) > 0.75,
      )
    ) {
      continue;
    }
    retained.push({ ...word, text });
    if (retained.length >= EXTRACTION_LIMITS.maximumWordsPerPage) break;
  }
  return retained;
}

function lineFromWords(words: OcrWord[]): VisualLine {
  const sorted = [...words].sort((left, right) => left.bbox.x0 - right.bbox.x0);
  return {
    text: sorted.map((word) => word.text).join(" "),
    confidence:
      sorted.reduce((total, word) => total + word.confidence, 0) /
      sorted.length,
    bbox: {
      x0: Math.min(...sorted.map((word) => word.bbox.x0)),
      y0: Math.min(...sorted.map((word) => word.bbox.y0)),
      x1: Math.max(...sorted.map((word) => word.bbox.x1)),
      y1: Math.max(...sorted.map((word) => word.bbox.y1)),
    },
    pageIndex: sorted[0].pageIndex,
    words: sorted,
  };
}

export function groupWordsIntoLines(words: readonly OcrWord[]): VisualLine[] {
  const normalized = normalizeOcrWords(words).sort(
    (left, right) =>
      centerY(left.bbox) - centerY(right.bbox) || left.bbox.x0 - right.bbox.x0,
  );
  const heights = normalized
    .map((word) => word.bbox.y1 - word.bbox.y0)
    .filter((height) => height > 0)
    .sort((left, right) => left - right);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const tolerance = Math.max(4, medianHeight * 0.55);
  const buckets: Array<{ words: OcrWord[]; center: number }> = [];
  for (const word of normalized) {
    const match = buckets.find(
      (bucket) => Math.abs(bucket.center - centerY(word.bbox)) <= tolerance,
    );
    if (match) {
      match.center =
        (match.center * match.words.length + centerY(word.bbox)) /
        (match.words.length + 1);
      match.words.push(word);
    } else {
      buckets.push({ words: [word], center: centerY(word.bbox) });
    }
  }
  return buckets
    .map((bucket) => lineFromWords(bucket.words))
    .sort((left, right) => left.bbox.y0 - right.bbox.y0);
}
