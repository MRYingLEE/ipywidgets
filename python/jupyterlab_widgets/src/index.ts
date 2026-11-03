// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import WidgetManagerProvider from './plugin';
import * as output from './output';

export default WidgetManagerProvider;

export { registerWidgetManager } from './plugin';

export {
  KernelWidgetManager,
  LabWidgetManager,
  WidgetManager,
} from './manager';

export { WidgetRenderer } from './renderer';

export { IWidgetManagerProvider } from './widget-manager-provider';

export {
  WIDGET_INPUT_MARKER,
  WidgetInputProtocolError,
  parseWidgetInputRequest,
  encodeWidgetInputState,
  encodeWidgetInputFailure,
} from './widget-input-protocol';
export type { IWidgetInputRequest } from './widget-input-protocol';

export { output };
