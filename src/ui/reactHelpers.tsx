import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Convert declarative TSX into an escaped, static HTML representation.
 * React escapes text and attribute values, so workbook content is never
 * interpreted as raw HTML by our view components.
 */
export function render2Mkup(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

/**
 * Turn a TSX tree into real browser nodes. This intentionally does not
 * attach React event handlers: the TrackerView class binds the listeners
 * after each render, preserving existing spreadsheet editing behaviour.
 */
export function render2Frag(node: ReactNode): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = render2Mkup(node);
  return template.content.cloneNode(true) as DocumentFragment;
}

/** Replace previous content without concatenating HTML markup in callers. */
export function replaceChildrenWithReact(target: Element, node: ReactNode): void {
  target.replaceChildren(render2Frag(node));
}

/** Wait for one or more browser paint cycles when positioning overlays. */
export async function waitForDomPaint(cycles = 2): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
