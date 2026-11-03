// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import type { CodeConsole, ConsolePanel } from '@jupyterlab/console';
import type { Notebook, NotebookPanel } from '@jupyterlab/notebook';
import type { DOMWidgetModel } from '@jupyter-widgets/base';
import { Token } from '@lumino/coreutils';

import type { LabWidgetManager } from './manager';
import type { WidgetRenderer } from './renderer';

/**
 * Access the widget manager associated with a particular notebook or console.
 *
 * A manager alone does not establish that a model is displayed in a panel or
 * that a client is authorized to read it. Callers must check those separately.
 */
export interface IWidgetManagerProvider {
  getManager(panel: NotebookPanel | ConsolePanel): LabWidgetManager | undefined;

  /**
   * Find a live model with an attached, visible view in the given panel.
   * This is not sufficient to authorize a request from a particular client.
   */
  getDisplayedModel(
    panel: NotebookPanel | ConsolePanel,
    modelId: string
  ): Promise<DOMWidgetModel | undefined>;
}

export const IWidgetManagerProvider = new Token<IWidgetManagerProvider>(
  '@jupyter-widgets/jupyterlab-manager:IWidgetManagerProvider'
);

/** @internal */
export class WidgetManagerProvider implements IWidgetManagerProvider {
  getManager(
    panel: NotebookPanel | ConsolePanel
  ): LabWidgetManager | undefined {
    const isConsole = 'console' in panel;
    const content = isConsole ? panel.console : panel.content;
    const sessionContext = isConsole
      ? panel.console.sessionContext
      : panel.context.sessionContext;
    const kernel = sessionContext.session?.kernel;
    const manager = this._registrations.get(content)?.manager;

    if (
      panel.isDisposed ||
      content.isDisposed ||
      !kernel ||
      kernel.isDisposed ||
      !manager ||
      manager.isDisposed ||
      manager.kernel?.id !== kernel.id
    ) {
      return undefined;
    }
    return manager;
  }

  async getDisplayedModel(
    panel: NotebookPanel | ConsolePanel,
    modelId: string
  ): Promise<DOMWidgetModel | undefined> {
    const manager = this.getManager(panel);
    const content = 'console' in panel ? panel.console : panel.content;
    const registration = this._registrations.get(content);
    if (!manager || !registration || !manager.has_model(modelId)) {
      return undefined;
    }
    for (const renderer of registration.renderers()) {
      const model = renderer.getDisplayedModel(manager);
      if (model?.model_id !== modelId) {
        continue;
      }
      const registeredModel = await manager.get_model(modelId);
      if (
        registeredModel === model &&
        manager.has_model(modelId) &&
        this.getManager(panel) === manager &&
        this._registrations.get(content) === registration &&
        renderer.getDisplayedModel(manager) === model
      ) {
        return model;
      }
    }
    return undefined;
  }

  register(
    content: Notebook | CodeConsole,
    manager: LabWidgetManager,
    renderers: () => Iterable<WidgetRenderer> = () => []
  ): void {
    this._registrations.set(content, { manager, renderers });
  }

  unregister(content: Notebook | CodeConsole, manager: LabWidgetManager): void {
    if (this._registrations.get(content)?.manager === manager) {
      this._registrations.delete(content);
    }
  }

  private _registrations = new WeakMap<
    Notebook | CodeConsole,
    { manager: LabWidgetManager; renderers: () => Iterable<WidgetRenderer> }
  >();
}
