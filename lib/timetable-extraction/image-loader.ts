import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  throwIfCancelled,
  type ImageEdits,
} from "./types";

export interface CanvasResource {
  canvas: HTMLCanvasElement;
  cleanup(): void;
}

function safeDimensions(width: number, height: number): [number, number] {
  const dimensionScale = Math.min(
    1,
    EXTRACTION_LIMITS.maximumRenderedDimension / Math.max(width, height),
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(EXTRACTION_LIMITS.maximumCanvasPixels / (width * height)),
  );
  const scale = Math.min(dimensionScale, pixelScale);
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

async function decodeImage(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image decoding failed"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadImageToCanvas(
  file: File,
  edits: ImageEdits | undefined,
  signal?: AbortSignal,
): Promise<CanvasResource> {
  throwIfCancelled(signal);
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch (cause) {
    throw new TimetableExtractionError(
      "CORRUPT_IMAGE",
      "The image could not be decoded. Try another copy or format.",
      { cause },
    );
  }
  let canvas: HTMLCanvasElement | undefined;
  try {
    throwIfCancelled(signal);
    const sourceWidth =
      "naturalWidth" in source ? source.naturalWidth : source.width;
    const sourceHeight =
      "naturalHeight" in source ? source.naturalHeight : source.height;
    const crop = edits?.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const cropX = Math.round(sourceWidth * (crop.left / 100));
    const cropY = Math.round(sourceHeight * (crop.top / 100));
    const cropWidth = Math.max(
      1,
      Math.round(sourceWidth * (1 - (crop.left + crop.right) / 100)),
    );
    const cropHeight = Math.max(
      1,
      Math.round(sourceHeight * (1 - (crop.top + crop.bottom) / 100)),
    );
    const rotated = edits?.rotation === 90 || edits?.rotation === 270;
    const [safeWidth, safeHeight] = safeDimensions(
      rotated ? cropHeight : cropWidth,
      rotated ? cropWidth : cropHeight,
    );
    canvas = document.createElement("canvas");
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new TimetableExtractionError(
        "UNSUPPORTED_BROWSER",
        "The browser could not prepare an image canvas for OCR.",
      );
    }
    const outputCropWidth = rotated ? safeHeight : safeWidth;
    const outputCropHeight = rotated ? safeWidth : safeHeight;
    context.translate(safeWidth / 2, safeHeight / 2);
    context.rotate(((edits?.rotation ?? 0) * Math.PI) / 180);
    context.drawImage(
      source,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      -outputCropWidth / 2,
      -outputCropHeight / 2,
      outputCropWidth,
      outputCropHeight,
    );
    const prepared = canvas;
    canvas = undefined;
    return {
      canvas: prepared,
      cleanup() {
        prepared.width = 0;
        prepared.height = 0;
      },
    };
  } finally {
    if ("close" in source) source.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
