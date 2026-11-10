// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ConsolePanel } from '@jupyterlab/console';
import { NotebookPanel } from '@jupyterlab/notebook';
import { IStdin, Stdin } from '@jupyterlab/outputarea';
import { ContentFactoryWithFooter } from 'jupyterlab-cell-input-footer';

import { createWidgetInputStdin } from './widget-input';

/**
 * Notebook content factory that routes widget-input stdin requests to the
 * widget-input bridge and falls back to the default stdin otherwise.
 */
export class NotebookWidgetInputContentFactory extends NotebookPanel.ContentFactory {
  createStdin(options: Stdin.IOptions): IStdin {
    return createWidgetInputStdin(options) ?? super.createStdin(options);
  }
}

export class NotebookWidgetInputFooterContentFactory extends ContentFactoryWithFooter {
  createStdin(options: Stdin.IOptions): IStdin {
    return createWidgetInputStdin(options) ?? super.createStdin(options);
  }
}

/**
 * Console content factory that routes widget-input stdin requests to the
 * widget-input bridge and falls back to the default stdin otherwise.
 */
export class ConsoleWidgetInputContentFactory extends ConsolePanel.ContentFactory {
  createStdin(options: Stdin.IOptions): IStdin {
    return createWidgetInputStdin(options) ?? super.createStdin(options);
  }
}
