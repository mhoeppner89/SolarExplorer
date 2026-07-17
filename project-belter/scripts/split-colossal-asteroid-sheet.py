#!/usr/bin/env python3
"""Split a transparent 2x2 asteroid sheet into four square runtime sprites."""

from pathlib import Path
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def keep_largest_component(sprite: Image.Image) -> Image.Image:
    pixels = np.array(sprite)
    mask = pixels[:, :, 3] > 128
    labels, count = ndimage.label(mask)
    if count <= 1:
        return sprite
    component_sizes = np.bincount(labels.ravel())
    component_sizes[0] = 0
    largest = int(component_sizes.argmax())
    keep = ndimage.binary_dilation(labels == largest, iterations=3)
    pixels[~keep, 3] = 0
    return Image.fromarray(pixels, "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--material", required=True)
    args = parser.parse_args()

    sheet = Image.open(args.input).convert("RGBA")
    half_width = sheet.width // 2
    half_height = sheet.height // 2
    boxes = (
        (0, 0, half_width, half_height),
        (half_width, 0, sheet.width, half_height),
        (0, half_height, half_width, sheet.height),
        (half_width, half_height, sheet.width, sheet.height),
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, box in enumerate(boxes):
        sprite = keep_largest_component(sheet.crop(box))
        output = args.output_dir / f"asteroid_{args.material}_{index}_colossal_v1.png"
        sprite.save(output, optimize=True)
        print(f"Wrote {output} ({sprite.width}x{sprite.height})")


if __name__ == "__main__":
    main()
