// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Lets node load `src/*.ts` and the widget packages without a bundler; see
// hooks.mjs. Use with `node --import ./test/support/register.mjs`.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
