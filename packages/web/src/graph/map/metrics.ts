/** Geometry of conversation map cards (layout, handles and rendering share these numbers). */
export const MAP_CARD = {
  width: 248,
  /** pad + header + gap + thumbHeight + gap + footer + pad */
  height: 202,
  pad: 10,
  /** Title block (two 16px lines). */
  header: 32,
  gap: 8,
  thumbWidth: 228,
  thumbHeight: 116,
  footer: 18,
} as const;

export const MAP_THUMB_LEFT = MAP_CARD.pad;
export const MAP_THUMB_TOP = MAP_CARD.pad + MAP_CARD.header + MAP_CARD.gap;

export const MAP_LAYOUT_OPTIONS = {
  cardWidth: MAP_CARD.width,
  cardHeight: MAP_CARD.height,
  columnGap: 176,
  rowGap: 32,
} as const;

/** Handle id of the port that sits on a box inside a card's thumbnail. */
export function portId(nodeId: string): string {
  return `n:${nodeId}`;
}
