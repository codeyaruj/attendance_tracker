"use client";

import { Crop, RefreshCcw, RotateCw, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import type { ImageEdits } from "@/lib/timetable-extraction";

export const DEFAULT_IMAGE_EDITS: ImageEdits = {
  rotation: 0,
  zoom: 1,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
};

export function ImageAdjustments({
  value,
  onChange,
}: {
  value: ImageEdits;
  onChange: (value: ImageEdits) => void;
}) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-extrabold">
        <Crop className="text-primary size-5" /> Prepare image
      </h2>
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() =>
            onChange({
              ...value,
              rotation: ((value.rotation + 90) % 360) as ImageEdits["rotation"],
            })
          }
        >
          <RotateCw className="size-4" /> Rotate
        </Button>
        <Button variant="ghost" onClick={() => onChange(DEFAULT_IMAGE_EDITS)}>
          <RefreshCcw className="size-4" /> Reset
        </Button>
      </div>
      <label className="text-muted-foreground mt-4 grid gap-2 text-xs font-bold tracking-wider uppercase">
        <span className="flex justify-between">
          <span className="flex items-center gap-1">
            <ZoomIn className="size-4" /> Preview zoom
          </span>
          {Math.round(value.zoom * 100)}%
        </span>
        <Input
          type="range"
          min="0.7"
          max="1.8"
          step="0.05"
          value={value.zoom}
          onChange={(event) =>
            onChange({ ...value, zoom: Number(event.target.value) })
          }
          className="accent-primary min-h-7 p-0"
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {(["top", "right", "bottom", "left"] as const).map((edge) => (
          <label
            key={edge}
            className="text-muted-foreground grid gap-1 text-xs font-semibold capitalize"
          >
            Crop {edge} · {value.crop[edge]}%
            <Input
              type="range"
              min="0"
              max="25"
              step="1"
              value={value.crop[edge]}
              onChange={(event) =>
                onChange({
                  ...value,
                  crop: { ...value.crop, [edge]: Number(event.target.value) },
                })
              }
              className="accent-primary min-h-7 p-0"
            />
          </label>
        ))}
      </div>
    </Card>
  );
}
