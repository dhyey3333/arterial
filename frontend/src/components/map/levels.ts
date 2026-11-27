import type { SegmentLevel } from '../../lib/contract';

/** How each congestion level is drawn on every map: the 2D console maps and the 3D forecast time stack. */
export const LEVEL_RGB: Record<SegmentLevel, [number, number, number]> = {
  free: [12, 163, 12],
  moderate: [250, 178, 25],
  heavy: [236, 131, 90],
  severe: [208, 59, 59],
  no_data: [74, 85, 102],
};

/** Width steps double the colour channel, because warning and serious sit close in hue. */
export const LEVEL_WIDTH: Record<SegmentLevel, number> = { no_data: 0.8, free: 1, moderate: 1.25, heavy: 1.55, severe: 1.9 };

export const LEVEL_OPACITY: Record<SegmentLevel, number> = { no_data: 0.7, free: 0.78, moderate: 1, heavy: 1, severe: 1 };

export const levelCss = (l: SegmentLevel) => `rgb(${LEVEL_RGB[l].join(',')})`;
