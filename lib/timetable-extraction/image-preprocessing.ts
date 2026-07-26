import type { CanvasResource } from "./image-loader";

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PreprocessingOptions {
  contrast?: number;
  threshold?: number;
  sharpen?: boolean;
}

export function transformPixels(
  source: PixelBuffer,
  options: PreprocessingOptions = {},
): PixelBuffer {
  const output = new Uint8ClampedArray(source.data);
  const contrast = options.contrast ?? 1.28;
  const threshold = options.threshold;
  for (let index = 0; index < output.length; index += 4) {
    const grey =
      output[index] * 0.2126 +
      output[index + 1] * 0.7152 +
      output[index + 2] * 0.0722;
    let value = Math.max(0, Math.min(255, (grey - 128) * contrast + 128));
    if (threshold !== undefined) value = value >= threshold ? 255 : 0;
    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
  }

  if (options.sharpen !== false && source.width > 2 && source.height > 2) {
    const greyCopy = new Uint8ClampedArray(output);
    for (let y = 1; y < source.height - 1; y += 1) {
      for (let x = 1; x < source.width - 1; x += 1) {
        const index = (y * source.width + x) * 4;
        const value = Math.max(
          0,
          Math.min(
            255,
            greyCopy[index] * 5 -
              greyCopy[index - 4] -
              greyCopy[index + 4] -
              greyCopy[index - source.width * 4] -
              greyCopy[index + source.width * 4],
          ),
        );
        output[index] = value;
        output[index + 1] = value;
        output[index + 2] = value;
      }
    }
  }
  return { data: output, width: source.width, height: source.height };
}

export async function preprocessCanvas(
  resource: CanvasResource,
  options?: PreprocessingOptions,
): Promise<HTMLCanvasElement> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const context = resource.canvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("Canvas preprocessing is unavailable");
  const image = context.getImageData(
    0,
    0,
    resource.canvas.width,
    resource.canvas.height,
  );
  const transformed = transformPixels(image, options);
  const browserPixels = new Uint8ClampedArray(transformed.data.length);
  browserPixels.set(transformed.data);
  context.putImageData(
    new ImageData(browserPixels, transformed.width, transformed.height),
    0,
    0,
  );
  return resource.canvas;
}
