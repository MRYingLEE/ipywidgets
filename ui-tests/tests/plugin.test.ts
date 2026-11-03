// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { test } from '@jupyterlab/galata';

import { expect } from '@playwright/test';

test.describe('Widget extension smoke test', () => {
  test('registers and activates the manager plugin', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const id = '@jupyter-widgets/jupyterlab-manager:plugin';
      if (!app.hasPlugin(id)) {
        return { hasPlugin: false, activated: false, error: '' };
      }
      try {
        await app.activatePlugin(id);
        return { hasPlugin: true, activated: true, error: '' };
      } catch (e) {
        return { hasPlugin: true, activated: false, error: `${e}` };
      }
    });
    expect(result.error).toBe('');
    expect(result.hasPlugin).toBe(true);
    expect(result.activated).toBe(true);
  });
});

test.describe('Widget manager provider', () => {
  test.use({ autoGoto: false });
  test('provides the manager for the requesting notebook', async ({
    context,
    tmpPath,
  }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/lab');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    const result = await page.evaluate(async (path) => {
      const app = (window as any).jupyterapp;
      const id = '@jupyter-widgets/jupyterlab-manager:manager-provider';
      await app.activatePlugin(id);

      // Test-only access to the token; consumers import the public token.
      const token = app.pluginRegistry._plugins.get(id).provides;
      const provider = await app.resolveRequiredService(token);

      async function createNotebook(kernelId?: string) {
        const model = await app.commands.execute('docmanager:new-untitled', {
          type: 'notebook',
          path,
        });
        const panel = await app.commands.execute('docmanager:open', {
          path: model.path,
          factory: 'Notebook',
        });
        await panel.context.ready;
        const context = panel.context.sessionContext;
        await context.ready;
        if (kernelId) {
          await context.changeKernel({ id: kernelId });
        } else if (!context.session?.kernel) {
          await context.changeKernel({ name: 'python3' });
        }
        const deadline = Date.now() + 20000;
        while (!provider.getManager(panel) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const manager = provider.getManager(panel);
        if (!manager) {
          throw new Error('Manager was not registered for notebook');
        }
        return { panel, context, manager };
      }

      async function createModels(panel: any, context: any): Promise<string[]> {
        panel.content.activeCell.model.sharedModel.setSource(
          [
            'import ipywidgets as widgets',
            'from IPython.display import display',
            'a = widgets.IntSlider()',
            'b = widgets.IntSlider()',
            'c = widgets.IntSlider()',
            'display(a, a, b)',
          ].join('\n')
        );
        app.shell.activateById(panel.id);
        const ran = await app.commands.execute('notebook:run-cell', {
          semanticWidget: panel.id,
        });
        if (!ran) {
          throw new Error('Could not execute widget cell');
        }
        let output = '';
        const future = context.session.kernel.requestExecute({
          code: 'print("MODEL_IDS=" + a.model_id + "," + b.model_id + "," + c.model_id)',
          allow_stdin: false,
        });
        future.onIOPub = (msg: any) => {
          if (msg.header.msg_type === 'stream') {
            output += msg.content.text;
          }
        };
        const reply = await future.done;
        if (reply.content.status !== 'ok') {
          throw new Error(`Execution failed: ${JSON.stringify(reply.content)}`);
        }
        const match = output.match(
          /MODEL_IDS=([a-f0-9]+),([a-f0-9]+),([a-f0-9]+)/
        );
        if (!match) {
          throw new Error(`Model ids were not printed: ${output}`);
        }
        return match.slice(1);
      }

      const first = await createNotebook();
      const second = await createNotebook();
      const firstIds = await createModels(first.panel, first.context);
      const secondIds = await createModels(second.panel, second.context);
      const sharedClient = await createNotebook(
        first.context.session.kernel.id
      );
      const sameKernelDoesNotGrantView =
        sharedClient.context.session.kernel.id ===
          first.context.session.kernel.id &&
        sharedClient.context.session.kernel.clientId !==
          first.context.session.kernel.clientId &&
        !(await provider.getDisplayedModel(sharedClient.panel, firstIds[0]));
      const deadline = Date.now() + 20000;
      while (
        (first.panel.node.querySelectorAll('.widget-slider').length < 3 ||
          second.panel.node.querySelectorAll('.widget-slider').length < 3) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const viewsDisplayed =
        first.panel.node.querySelectorAll('.widget-slider').length >= 3 &&
        second.panel.node.querySelectorAll('.widget-slider').length >= 3;
      const managersAreSeparate = first.manager !== second.manager;
      const owns = (manager: any, ids: string[]) =>
        ids.every((id) => manager.has_model(id));
      const isolated =
        owns(first.manager, firstIds) &&
        owns(second.manager, secondIds) &&
        secondIds.every((id) => !first.manager.has_model(id)) &&
        firstIds.every((id) => !second.manager.has_model(id));

      app.shell.activateById(first.panel.id);
      let firstModel;
      const displayedDeadline = Date.now() + 10000;
      while (!firstModel && Date.now() < displayedDeadline) {
        firstModel = await provider.getDisplayedModel(first.panel, firstIds[0]);
        if (!firstModel) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const displayedModelMatches =
        firstModel === (await first.manager.get_model(firstIds[0])) &&
        !!(await provider.getDisplayedModel(first.panel, firstIds[1]));
      const undisplayedAndOtherPanelRejected =
        !(await provider.getDisplayedModel(first.panel, firstIds[2])) &&
        !(await provider.getDisplayedModel(first.panel, secondIds[0])) &&
        !(await provider.getDisplayedModel(second.panel, firstIds[0]));
      const renderers: any[] = [];
      for (const cell of first.panel.content.widgets) {
        if (cell.model.type === 'code') {
          for (const output of cell.outputArea.widgets) {
            for (const child of output.children()) {
              if (child.getDisplayedModel?.(first.manager) === firstModel) {
                renderers.push(child);
              }
            }
          }
        }
      }
      if (renderers.length !== 2) {
        throw new Error(`Expected two live views, got ${renderers.length}`);
      }
      renderers[0].node.style.display = 'none';
      const oneHiddenViewStillEligible =
        (await provider.getDisplayedModel(first.panel, firstIds[0])) ===
        firstModel;
      renderers[1].node.style.display = 'none';
      const hiddenViewsRejected = !(await provider.getDisplayedModel(
        first.panel,
        firstIds[0]
      ));
      renderers[0].node.style.display = '';
      renderers[1].node.style.display = '';
      renderers[0].dispose();
      const oneViewStillEligible =
        (await provider.getDisplayedModel(first.panel, firstIds[0])) ===
        firstModel;
      renderers[1].dispose();
      const removedViewsRejected = !(await provider.getDisplayedModel(
        first.panel,
        firstIds[0]
      ));

      await new Promise((resolve) => setTimeout(resolve, 1500));
      await first.context.session.kernel.restart();
      const afterRestart = provider.getManager(first.panel);
      const restartKeepsCorrectKernel =
        !!afterRestart &&
        afterRestart.kernel.id === first.context.session.kernel.id &&
        provider.getManager(second.panel) === second.manager;
      const staleViewRejectedAfterRestart = !(await provider.getDisplayedModel(
        first.panel,
        firstIds[1]
      ));
      first.panel.dispose();
      const disposedHidden = provider.getManager(first.panel) === undefined;
      const secondStillAvailable =
        provider.getManager(second.panel) === second.manager;
      sharedClient.panel.dispose();
      second.panel.dispose();
      return {
        viewsDisplayed,
        managersAreSeparate,
        isolated,
        sameKernelDoesNotGrantView,
        displayedModelMatches,
        undisplayedAndOtherPanelRejected,
        oneHiddenViewStillEligible,
        hiddenViewsRejected,
        oneViewStillEligible,
        removedViewsRejected,
        restartKeepsCorrectKernel,
        staleViewRejectedAfterRestart,
        disposedHidden,
        secondStillAvailable,
      };
    }, tmpPath);

    expect(result).toEqual({
      viewsDisplayed: true,
      managersAreSeparate: true,
      isolated: true,
      sameKernelDoesNotGrantView: true,
      displayedModelMatches: true,
      undisplayedAndOtherPanelRejected: true,
      oneHiddenViewStillEligible: true,
      hiddenViewsRejected: true,
      oneViewStillEligible: true,
      removedViewsRejected: true,
      restartKeepsCorrectKernel: true,
      staleViewRejectedAfterRestart: true,
      disposedHidden: true,
      secondStillAvailable: true,
    });
    expect(errors).toEqual([]);
  });
});
