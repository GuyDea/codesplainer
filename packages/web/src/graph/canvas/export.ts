/** Export a React Flow diagram (all nodes, not just the visible part) to a PNG / SVG data URL. */
import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';

const EXCLUDED = [
  'react-flow__minimap',
  'react-flow__controls',
  'react-flow__panel',
  'react-flow__node-toolbar',
  'cs-no-export',
];

/** SVG properties that come from CSS classes and must travel with the clone. */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
];

/**
 * html-to-image clones <svg> subtrees verbatim (it only inlines computed styles on the <svg>
 * element itself), so class-based SVG styling would be lost in the image. Temporarily inline the
 * computed values on every SVG child; returns a function that restores the original styles.
 */
function inlineSvgStyles(root: HTMLElement): () => void {
  const restore: (() => void)[] = [];
  for (const el of root.querySelectorAll('svg *')) {
    if (!(el instanceof SVGElement)) continue;
    const computed = getComputedStyle(el);
    const previous = el.getAttribute('style');
    const inline = SVG_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';');
    el.setAttribute('style', previous ? `${previous};${inline}` : inline);
    restore.push(() => {
      if (previous === null) el.removeAttribute('style');
      else el.setAttribute('style', previous);
    });
  }
  return () => {
    for (const fn of restore) fn();
  };
}

/**
 * Render the whole diagram: `bounds` are the flow-space bounds of all nodes
 * (`useReactFlow().getNodesBounds(getNodes())`).
 */
export async function exportFlowImage(
  root: HTMLElement,
  bounds: Rect,
  format: 'png' | 'svg',
  padding = 32,
): Promise<string> {
  const viewport = root.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || bounds.width <= 0 || bounds.height <= 0)
    throw new Error('Nothing to export yet.');
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const vp = getViewportForBounds(bounds, width, height, 1, 1, 0);
  const background = getComputedStyle(root).getPropertyValue('--canvas').trim() || undefined;
  const options = {
    backgroundColor: background,
    width,
    height,
    pixelRatio: 2,
    skipFonts: true,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
    filter: (el: HTMLElement) => !EXCLUDED.some((c) => el.classList?.contains(c)),
  };
  const restore = inlineSvgStyles(viewport);
  try {
    return format === 'svg' ? await toSvg(viewport, options) : await toPng(viewport, options);
  } finally {
    restore();
  }
}
