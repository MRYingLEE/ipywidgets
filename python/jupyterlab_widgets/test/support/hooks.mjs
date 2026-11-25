// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Module resolution of the webpack build, for node tests:
// - try `.ts`, `.js` and `/index.js` for extensionless imports;
// - expose the named exports of CommonJS `backbone`, which node cannot detect.
const backboneShim = new URL('./backbone.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'backbone' && context.parentURL !== backboneShim) {
    return { url: backboneShim, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' &&
      error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT'
    ) {
      throw error;
    }
    for (const suffix of ['.ts', '.js', '/index.js']) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        // Try the next suffix.
      }
    }
    throw error;
  }
}
