// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// A jsdom window as the global DOM. Import it before any module that uses
// the DOM at load time.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', {
  pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = dom.window[key];
    } catch {
      // Skip read-only globals.
    }
  }
}
// Node has its own event classes; DOM code needs jsdom's.
for (const key of ['Event', 'CustomEvent', 'EventTarget']) {
  globalThis[key] = dom.window[key];
}
// Lumino extends DragEvent, which jsdom lacks.
globalThis.DragEvent ??= class DragEvent extends dom.window.MouseEvent {};
