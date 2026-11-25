// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { createRequire } from 'node:module';

const Backbone = createRequire(import.meta.url)('backbone');

export const { View, Model, Collection, Events, Router, History, history } =
  Backbone;
export default Backbone;
