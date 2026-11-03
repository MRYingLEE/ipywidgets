// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, test, type Page } from '@playwright/test';

async function openStandaloneNotebook(page: Page, kernelLabel: string) {
  await page.goto('/notebooks/index.html');
  await page.waitForFunction(() => (window as any).jupyterapp?.started);
  const path = await page.evaluate(async () => {
    const contents = (window as any).jupyterapp.serviceManager.contents;
    return (await contents.newUntitled({ type: 'notebook' })).path;
  });
  await page.goto(`/notebooks/index.html?path=${encodeURIComponent(path)}`);
  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await dialog
    .locator('select')
    .selectOption({ label: kernelLabel }, { timeout: 10000 });
  await dialog
    .getByRole('button', { name: 'Select Kernel', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      (window as any).jupyterapp.shell.currentWidget?.sessionContext?.session
        ?.kernel?.status === 'idle',
    null,
    { timeout: 180000 }
  );
}

test.describe('Widget input in JupyterLite', () => {
  test.skip(
    !process.env.WIDGET_INPUT_LITE,
    'Requires the patched JupyterLite site'
  );
  test.setTimeout(240000);

  for (const kernelName of ['javascript', 'javascript-worker']) {
    test(`submits an anywidget snapshot with ${kernelName}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      const workers: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('worker', (worker) => workers.push(worker.url()));
      await page.goto('/lab/index.html');
      await page.waitForFunction(() => (window as any).jupyterapp?.started);
      await page.evaluate(async (name) => {
        const app = (window as any).jupyterapp;
        await app.commands.execute('notebook:create-new', { kernelName: name });
      }, kernelName);
      await page.waitForFunction(() => {
        const panel = (window as any).jupyterapp.shell.currentWidget;
        return panel?.sessionContext?.session?.kernel?.status === 'idle';
      });
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        panel.content.activeCell.model.sharedModel.setSource(
          [
            'const widget = new Jupyter.widgets.AnyWidget({',
            '  _esm: `export default { render({model, el}) {',
            '    const button = document.createElement("button");',
            '    button.textContent = "Change Lite widget";',
            '    button.onclick = () => { model.set("value", 2); model.save_changes(); };',
            '    el.appendChild(button);',
            '  }};`,',
            '  value: 0',
            '});',
            'display(widget);',
            'const snapshot = await Jupyter.widgetInput(widget, {fields: ["value"]});',
            'if (snapshot.value !== 2 || widget.get("value") !== 0) throw new Error("Wrong snapshot");',
            'console.log("JS_SNAPSHOT_OK");',
          ].join('\n')
        );
        (window as any).__litePanel = panel;
        (window as any).__liteRun = app.commands.execute('notebook:run-cell');
      });
      await page.getByRole('button', { name: 'Change Lite widget' }).click({
        timeout: 90000,
      });
      const submit = page.getByRole('button', { name: 'Submit', exact: true });
      await expect(submit).toBeEnabled({ timeout: 30000 });
      const inputGroup = page.getByRole('group', {
        name: 'Submit widget input',
        exact: true,
      });
      await expect(inputGroup).toBeVisible();
      await expect(inputGroup.getByRole('status')).toHaveText(
        'Widget is ready.'
      );
      await submit.click();
      const result = await page.evaluate(async () => {
        await (window as any).__liteRun;
        return JSON.stringify(
          (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
        );
      });
      expect(result).toContain('JS_SNAPSHOT_OK');
      expect(result).toContain('[Widget input submitted]');
      expect(result).not.toContain('jupyterlite-widget-input:v1:');
      if (kernelName === 'javascript-worker') {
        expect(workers.some((url) => url.includes('worker-runtime'))).toBe(
          true
        );
      }
      expect(errors).toEqual([]);
    });

    for (const action of ['cancel', 'interrupt'] as const) {
      test(`${action} releases widget input with ${kernelName}`, async ({
        page,
      }) => {
        await page.goto('/lab/index.html');
        await page.waitForFunction(() => (window as any).jupyterapp?.started);
        await page.evaluate(async (name) => {
          await (window as any).jupyterapp.commands.execute(
            'notebook:create-new',
            {
              kernelName: name,
            }
          );
        }, kernelName);
        await page.waitForFunction(() => {
          const panel = (window as any).jupyterapp.shell.currentWidget;
          return panel?.sessionContext?.session?.kernel?.status === 'idle';
        });
        await page.evaluate((action) => {
          const app = (window as any).jupyterapp;
          const panel = app.shell.currentWidget;
          panel.content.activeCell.model.sharedModel.setSource(
            [
              'const widget = new Jupyter.widgets.IntSlider({value: 0});',
              'display(widget);',
              action === 'cancel'
                ? 'try { await Jupyter.widgetInput(widget, {fields: ["value"]}); } catch (e) { if (!(e instanceof Jupyter.WidgetInputCancelled)) throw e; console.log("JS_CANCEL_OK"); }'
                : 'await Jupyter.widgetInput(widget, {fields: ["value"]});',
            ].join('\n')
          );
          (window as any).__litePanel = panel;
          (window as any).__liteRun = app.commands.execute('notebook:run-cell');
        }, action);
        const cancel = page.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });
        await expect(cancel).toBeVisible({ timeout: 30000 });
        if (action === 'cancel') {
          await cancel.focus();
          await page.keyboard.press('Escape');
        } else {
          await page.evaluate(() =>
            (
              window as any
            ).__litePanel.sessionContext.session.kernel.interrupt()
          );
        }
        const result = await page.evaluate(async () => {
          await (window as any).__liteRun;
          return JSON.stringify(
            (
              window as any
            ).__litePanel.content.activeCell.model.outputs.toJSON()
          );
        });
        expect(result).toContain(
          action === 'cancel' ? 'JS_CANCEL_OK' : 'Execution interrupted'
        );
        expect(result).not.toContain('jupyterlite-widget-input:v1:');
        await expect(cancel).toHaveCount(0, { timeout: 10000 });
      });
    }

    test(`restarts ${kernelName} while widget input is pending`, async ({
      page,
    }) => {
      await page.goto('/lab/index.html');
      await page.waitForFunction(() => (window as any).jupyterapp?.started);
      await page.evaluate(async (name) => {
        await (window as any).jupyterapp.commands.execute(
          'notebook:create-new',
          {
            kernelName: name,
          }
        );
      }, kernelName);
      await page.waitForFunction(() => {
        const panel = (window as any).jupyterapp.shell.currentWidget;
        return panel?.sessionContext?.session?.kernel?.status === 'idle';
      });
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        panel.content.activeCell.model.sharedModel.setSource(
          'const widget = new Jupyter.widgets.IntSlider({value: 0}); display(widget); await Jupyter.widgetInput(widget, {fields: ["value"]});'
        );
        (window as any).__litePanel = panel;
        void app.commands
          .execute('notebook:run-cell', { semanticWidget: panel.id })
          .catch((error: Error) => {
            console.warn('Interrupted notebook execution:', error);
          });
      });
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeVisible({ timeout: 30000 });
      await page.evaluate(() =>
        (window as any).__litePanel.sessionContext.session.kernel.restart()
      );
      await expect(cancel).toHaveCount(0, { timeout: 30000 });
      await page.waitForFunction(
        () =>
          (window as any).__litePanel.sessionContext.session.kernel.status ===
          'idle',
        null,
        { timeout: 30000 }
      );
      const outputs = await page.evaluate(async () => {
        const app = (window as any).jupyterapp;
        const panel = (window as any).__litePanel;
        panel.content.activeCell.model.sharedModel.setSource(
          'console.log("RESTART_OK")'
        );
        await app.commands.execute('notebook:run-cell', {
          semanticWidget: panel.id,
        });
        return JSON.stringify(panel.content.activeCell.model.outputs.toJSON());
      });
      expect(outputs).toContain('RESTART_OK');
    });
  }

  test('does not authorize an undisplayed model in another notebook sharing a kernel', async ({
    page,
  }) => {
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = app.shell.currentWidget;
      first.content.activeCell.model.sharedModel.setSource(
        'var sharedWidget = new Jupyter.widgets.IntSlider({value: 0}); display(sharedWidget);'
      );
      await app.commands.execute('notebook:run-cell');
      (window as any).__liteFirst = first;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    const identities = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = (window as any).__liteFirst;
      const second = app.shell.currentWidget;
      const firstKernel = first.sessionContext.session.kernel;
      await second.sessionContext.changeKernel({ id: firstKernel.id });
      await second.sessionContext.ready;
      const secondKernel = second.sessionContext.session.kernel;
      second.content.activeCell.model.sharedModel.setSource(
        'await Jupyter.widgetInput(sharedWidget, {fields: ["value"]});'
      );
      (window as any).__liteSecond = second;
      (window as any).__liteRun = app.commands.execute('notebook:run-cell');
      return {
        firstKernel: firstKernel.id,
        secondKernel: secondKernel.id,
        firstClient: firstKernel.clientId,
        secondClient: secondKernel.clientId,
      };
    });
    expect(identities.firstKernel).toBe(identities.secondKernel);
    expect(identities.firstClient).not.toBe(identities.secondClient);
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__liteSecond.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(result).toContain('model_unavailable');
    expect(result).toContain('[Widget input failed]');
    expect(result).not.toContain('jupyterlite-widget-input:v1:');
  });

  test('deactivating the bridge cancels a pending widget input', async ({
    page,
  }) => {
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      panel.content.activeCell.model.sharedModel.setSource(
        [
          'const widget = new Jupyter.widgets.IntSlider({value: 0});',
          'display(widget);',
          'try { await Jupyter.widgetInput(widget, {fields: ["value"]}); } catch (e) { if (!(e instanceof Jupyter.WidgetInputCancelled)) throw e; console.log("DEACTIVATE_OK"); }',
        ].join('\n')
      );
      (window as any).__litePanel = panel;
      (window as any).__liteRun = app.commands.execute('notebook:run-cell');
    });
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeVisible({ timeout: 30000 });
    await page.evaluate(() =>
      (window as any).jupyterapp.deactivatePlugin(
        '@jupyter-widgets/jupyterlab-manager:widget-input'
      )
    );
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(result).toContain('DEACTIVATE_OK');
    await expect(cancel).toHaveCount(0, { timeout: 10000 });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const panel = (window as any).__litePanel;
      await app.activatePlugin(
        '@jupyter-widgets/jupyterlab-manager:widget-input'
      );
      panel.content.activeCell.model.sharedModel.setSource(
        'const another = new Jupyter.widgets.IntSlider({value: 1}); display(another); try { await Jupyter.widgetInput(another, {fields: ["value"]}); } catch (e) { if (!(e instanceof Jupyter.WidgetInputCancelled)) throw e; console.log("REACTIVATE_OK"); }'
      );
      (window as any).__liteRun = app.commands.execute('notebook:run-cell', {
        semanticWidget: panel.id,
      });
    });
    await expect(cancel).toBeVisible({ timeout: 30000 });
    await cancel.click();
    const reactivated = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(reactivated).toContain('REACTIVATE_OK');
  });

  test('closing the owning notebook releases its shared kernel', async ({
    page,
  }) => {
    test.setTimeout(45000);
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = app.shell.currentWidget;
      (window as any).__liteFirst = first;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = (window as any).__liteFirst;
      const second = app.shell.currentWidget;
      await second.sessionContext.changeKernel({
        id: first.sessionContext.session.kernel.id,
      });
      (window as any).__liteSecond = second;
      app.shell.activateById(first.id);
      first.content.activeCell.model.sharedModel.setSource(
        'const widget = new Jupyter.widgets.IntSlider({value: 0}); display(widget); await Jupyter.widgetInput(widget, {fields: ["value"]});'
      );
      void app.commands
        .execute('notebook:run-cell', { semanticWidget: first.id })
        .catch((error: Error) => {
          console.warn('Closed notebook execution:', error);
        });
    });
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeVisible({
      timeout: 30000,
    });
    const outputs = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = (window as any).__liteFirst;
      const second = (window as any).__liteSecond;
      first.dispose();
      app.shell.activateById(second.id);
      second.content.activeCell.model.sharedModel.setSource(
        'console.log("AFTER_CLOSE_OK")'
      );
      await Promise.race([
        app.commands.execute('notebook:run-cell', {
          semanticWidget: second.id,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error('Shared kernel remained busy after notebook disposal')
              ),
            5000
          )
        ),
      ]);
      return JSON.stringify(second.content.activeCell.model.outputs.toJSON());
    });
    expect(outputs).toContain('AFTER_CLOSE_OK');
  });

  test('rejects a forged stdin reply from another client socket', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') {
        warnings.push(message.text());
      }
    });
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      (window as any).__liteFirst = app.shell.currentWidget;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
    });
    await page.waitForFunction(() => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    });
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = (window as any).__liteFirst;
      const second = app.shell.currentWidget;
      const firstKernel = first.sessionContext.session.kernel;
      await second.sessionContext.changeKernel({ id: firstKernel.id });
      (window as any).__liteSecond = second;
      firstKernel.anyMessage.connect((_sender: unknown, event: any) => {
        if (
          event.direction === 'recv' &&
          event.msg.header.msg_type === 'input_request'
        ) {
          (window as any).__liteRequest = event.msg;
        }
      });
      first.content.activeCell.model.sharedModel.setSource(
        [
          'const widget = new Jupyter.widgets.IntSlider({value: 0});',
          'display(widget);',
          'const snapshot = await Jupyter.widgetInput(widget, {fields: ["value"]});',
          'if (snapshot.value !== 0) throw new Error("Forged reply was accepted");',
          'console.log("LEGITIMATE_REPLY_OK");',
        ].join('\n')
      );
      (window as any).__liteRun = app.commands.execute('notebook:run-cell', {
        semanticWidget: first.id,
      });
    });
    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submit).toBeEnabled({ timeout: 30000 });
    await page.waitForFunction(() => !!(window as any).__liteRequest);
    await page.evaluate(() => {
      const first = (window as any).__liteFirst.sessionContext.session.kernel;
      const second = (window as any).__liteSecond.sessionContext.session.kernel;
      const originalClientId = second._clientId;
      try {
        second._clientId = first.clientId;
        second.sendInputReply(
          { status: 'ok', value: '{"status":"ok","state":{"value":999}}' },
          (window as any).__liteRequest.header
        );
      } finally {
        second._clientId = originalClientId;
      }
    });
    await expect
      .poll(() => warnings)
      .toContain('Ignoring stdin reply from a different client session');
    await expect(submit).toBeEnabled();
    await submit.click();
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__liteFirst.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(result).toContain('LEGITIMATE_REPLY_OK');
    expect(result).not.toContain('Forged reply was accepted');
  });

  test('rejects another client reply to Pyodide service-worker input', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') {
        warnings.push(message.text());
      }
    });
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('notebook:create-new', {
        kernelName: 'python',
      });
    });
    await page.waitForFunction(
      () =>
        (window as any).jupyterapp.shell.currentWidget?.sessionContext?.session
          ?.kernel?.status === 'idle',
      null,
      { timeout: 180000 }
    );
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      (window as any).__liteFirst = app.shell.currentWidget;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
      const second = app.shell.currentWidget;
      const first = (window as any).__liteFirst;
      await second.sessionContext.changeKernel({
        id: first.sessionContext.session.kernel.id,
      });
      (window as any).__liteSecond = second;
      second.sessionContext.session.kernel.anyMessage.connect(
        (_sender: unknown, event: any) => {
          if (
            event.direction === 'send' &&
            event.msg.header.msg_type === 'input_reply'
          ) {
            (window as any).__liteForgedSent = true;
          }
        }
      );
      first.sessionContext.session.kernel.anyMessage.connect(
        (_sender: unknown, event: any) => {
          if (
            event.direction === 'recv' &&
            event.msg.header.msg_type === 'input_request'
          ) {
            (window as any).__liteRequest = event.msg;
          }
        }
      );
      first.content.activeCell.model.sharedModel.setSource(
        [
          'import piplite',
          'await piplite.install(["ipywidgets"])',
          'import micropip',
          'await micropip.install("http://127.0.0.1:18964/lite_widget_input-0.1.0.dev0-py3-none-any.whl")',
          'import ipywidgets as widgets',
          'from IPython.display import display',
          'from lite_widget_input import widget_input',
          'widget = widgets.IntSlider(value=0)',
          'display(widget)',
          'snapshot = widget_input(widget, fields=["value"])',
          'assert snapshot == {"value": 0}, snapshot',
          'print("PY_LEGITIMATE_REPLY_OK")',
        ].join('\n')
      );
      (window as any).__liteRun = app.commands.execute('notebook:run-cell', {
        semanticWidget: first.id,
      });
    });
    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submit).toBeEnabled({ timeout: 180000 });
    await page.waitForFunction(() => !!(window as any).__liteRequest);
    await page.waitForFunction(
      () =>
        (window as any).__liteSecond.sessionContext.session.kernel
          .connectionStatus === 'connected'
    );
    await page.evaluate(() => {
      const second = (window as any).__liteSecond.sessionContext.session.kernel;
      second.sendInputReply(
        { status: 'ok', value: '{"status":"ok","state":{"value":999}}' },
        (window as any).__liteRequest.header
      );
    });
    await page.waitForFunction(() => (window as any).__liteForgedSent);
    await expect
      .poll(() => warnings)
      .toContain('Ignoring stdin reply from a different input owner');
    await expect(submit).toBeEnabled();
    await submit.click();
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__liteFirst.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(result).toContain('PY_LEGITIMATE_REPLY_OK');
  });

  test('closing the Pyodide input owner releases its shared kernel', async ({
    page,
  }) => {
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('notebook:create-new', {
        kernelName: 'python',
      });
    });
    await page.waitForFunction(
      () =>
        (window as any).jupyterapp.shell.currentWidget?.sessionContext?.session
          ?.kernel?.status === 'idle',
      null,
      { timeout: 180000 }
    );
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      (window as any).__liteFirst = app.shell.currentWidget;
      await app.commands.execute('notebook:create-new', {
        kernelName: 'javascript',
      });
      const first = (window as any).__liteFirst;
      const second = app.shell.currentWidget;
      await second.sessionContext.changeKernel({
        id: first.sessionContext.session.kernel.id,
      });
      (window as any).__liteSecond = second;
      first.content.activeCell.model.sharedModel.setSource(
        [
          'import piplite',
          'await piplite.install(["ipywidgets"])',
          'import micropip',
          'await micropip.install("http://127.0.0.1:18964/lite_widget_input-0.1.0.dev0-py3-none-any.whl")',
          'import ipywidgets as widgets',
          'from IPython.display import display',
          'from lite_widget_input import widget_input',
          'widget = widgets.IntSlider()',
          'display(widget)',
          'widget_input(widget, fields=["value"])',
        ].join('\n')
      );
      void app.commands
        .execute('notebook:run-cell', { semanticWidget: first.id })
        .catch((error: Error) =>
          console.warn('Closed notebook execution:', error)
        );
    });
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeVisible({ timeout: 180000 });
    const result = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = (window as any).__liteFirst;
      const second = (window as any).__liteSecond;
      first.dispose();
      app.shell.activateById(second.id);
      second.content.activeCell.model.sharedModel.setSource(
        'print("PY_AFTER_CLOSE_OK")'
      );
      await Promise.race([
        app.commands.execute('notebook:run-cell', {
          semanticWidget: second.id,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Pyodide kernel remained busy after notebook disposal'
                )
              ),
            10000
          )
        ),
      ]);
      return JSON.stringify(second.content.activeCell.model.outputs.toJSON());
    });
    expect(result).toContain('PY_AFTER_CLOSE_OK');
  });

  for (const kernelLabel of [
    'JavaScript (IFrame)',
    'JavaScript (Web Worker)',
  ]) {
    test(`submits a widget snapshot in standalone Notebook with ${kernelLabel}`, async ({
      page,
    }) => {
      await openStandaloneNotebook(page, kernelLabel);
      await page.evaluate(() => {
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        panel.content.activeCell.model.sharedModel.setSource(
          [
            'const widget = new Jupyter.widgets.IntSlider({value: 0});',
            'display(widget);',
            'const snapshot = await Jupyter.widgetInput(widget, {fields: ["value"]});',
            'if (snapshot.value !== 0) throw new Error("Wrong snapshot");',
            'console.log("STANDALONE_SNAPSHOT_OK");',
          ].join('\n')
        );
        (window as any).__litePanel = panel;
        (window as any).__liteRun = app.commands.execute('notebook:run-cell');
      });
      const submit = page.getByRole('button', { name: 'Submit', exact: true });
      await expect(submit).toBeEnabled({ timeout: 30000 });
      await submit.click();
      const result = await page.evaluate(async () => {
        await (window as any).__liteRun;
        return JSON.stringify(
          (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
        );
      });
      expect(result).toContain('STANDALONE_SNAPSHOT_OK');
    });
  }

  test('submits a Pyodide widget snapshot in standalone Notebook', async ({
    page,
  }) => {
    await openStandaloneNotebook(page, 'Python (Pyodide)');
    await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      const panel = app.shell.currentWidget;
      panel.content.activeCell.model.sharedModel.setSource(
        [
          'import piplite',
          'await piplite.install(["ipywidgets"])',
          'import micropip',
          'await micropip.install("http://127.0.0.1:18964/lite_widget_input-0.1.0.dev0-py3-none-any.whl")',
          'import ipywidgets as widgets',
          'from IPython.display import display',
          'from lite_widget_input import widget_input',
          'widget = widgets.IntSlider(value=0)',
          'display(widget)',
          'assert widget_input(widget, fields=["value"]) == {"value": 0}',
          'print("STANDALONE_PY_SNAPSHOT_OK")',
        ].join('\n')
      );
      (window as any).__litePanel = panel;
      (window as any).__liteRun = app.commands.execute('notebook:run-cell');
    });
    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submit).toBeEnabled({ timeout: 180000 });
    await submit.click();
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return JSON.stringify(
        (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
      );
    });
    expect(result).toContain('STANDALONE_PY_SNAPSHOT_OK');
  });

  for (const [surface, appPath] of [
    ['JupyterLab', '/lab/index.html'],
    ['standalone', '/consoles/index.html'],
  ] as const) {
    for (const kernelName of ['javascript', 'javascript-worker']) {
      test(`submits a widget snapshot from a ${surface} console with ${kernelName}`, async ({
        page,
      }) => {
        test.setTimeout(45000);
        await page.goto(appPath);
        await page.waitForFunction(() => (window as any).jupyterapp?.started);
        await page.evaluate(async (name) => {
          const app = (window as any).jupyterapp;
          const panel = await app.commands.execute('console:create', {
            kernelPreference: { name },
          });
          await panel.sessionContext.ready;
          (window as any).__liteConsole = panel;
        }, kernelName);
        await page.waitForFunction(
          () =>
            (window as any).__liteConsole.sessionContext.session?.kernel
              ?.status === 'idle',
          null,
          { timeout: 30000 }
        );
        await page.evaluate(() => {
          const panel = (window as any).__liteConsole;
          (window as any).__liteRun = panel.console.inject(
            [
              'const widget = new Jupyter.widgets.IntSlider({value: 0});',
              'display(widget);',
              'const snapshot = await Jupyter.widgetInput(widget, {fields: ["value"]});',
              'if (snapshot.value !== 0) throw new Error("Wrong snapshot");',
              'console.log("CONSOLE_SNAPSHOT_OK");',
            ].join('\n')
          );
        });
        const submit = page.getByRole('button', {
          name: 'Submit',
          exact: true,
        });
        await expect(submit).toBeEnabled({ timeout: 10000 });
        await submit.click();
        const result = await page.evaluate(async () => {
          await (window as any).__liteRun;
          return Array.from((window as any).__liteConsole.console.cells)
            .map((cell: any) => JSON.stringify(cell.model.outputs?.toJSON()))
            .join('\n');
        });
        expect(result).toContain('CONSOLE_SNAPSHOT_OK');
      });
    }

    test(`submits and cancels Pyodide widget input from a ${surface} console`, async ({
      page,
    }) => {
      await page.goto(appPath);
      await page.waitForFunction(() => (window as any).jupyterapp?.started);
      await page.evaluate(async () => {
        const app = (window as any).jupyterapp;
        const panel = await app.commands.execute('console:create', {
          kernelPreference: { name: 'python' },
        });
        await panel.sessionContext.ready;
        (window as any).__liteConsole = panel;
      });
      await page.waitForFunction(
        () =>
          (window as any).__liteConsole.sessionContext.session?.kernel
            ?.status === 'idle',
        null,
        { timeout: 180000 }
      );
      await page.evaluate(() => {
        const panel = (window as any).__liteConsole;
        (window as any).__liteRun = panel.console.inject(
          [
            'import piplite',
            'await piplite.install(["ipywidgets"])',
            'import micropip',
            'await micropip.install("http://127.0.0.1:18964/lite_widget_input-0.1.0.dev0-py3-none-any.whl")',
            'import ipywidgets as widgets',
            'from IPython.display import display',
            'from lite_widget_input import widget_input, WidgetInputCancelled',
            'widget = widgets.IntSlider(value=0)',
            'display(widget)',
            'assert widget_input(widget, fields=["value"]) == {"value": 0}',
            'try:',
            '    widget_input(widget, fields=["value"])',
            'except WidgetInputCancelled:',
            '    print("CONSOLE_PY_CANCEL_OK")',
            'else:',
            '    raise AssertionError("Cancellation not reported")',
          ].join('\n')
        );
      });
      const submit = page.getByRole('button', { name: 'Submit', exact: true });
      await expect(submit).toBeEnabled({ timeout: 180000 });
      await submit.click();
      const cancel = page
        .locator('.jp-WidgetInput button:not(:disabled)')
        .filter({ hasText: /^Cancel$/ });
      await expect(cancel).toBeVisible({ timeout: 30000 });
      await cancel.focus();
      await page.keyboard.press('Escape');
      const result = await page.evaluate(async () => {
        await (window as any).__liteRun;
        return Array.from((window as any).__liteConsole.console.cells)
          .map((cell: any) => JSON.stringify(cell.model.outputs?.toJSON()))
          .join('\n');
      });
      expect(result).toContain('CONSOLE_PY_CANCEL_OK');
      expect(result).not.toContain('jupyterlite-widget-input:v1:');
    });
  }

  test('does not authorize a widget displayed only in another shared-kernel console', async ({
    page,
  }) => {
    await page.goto('/lab/index.html');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const first = await app.commands.execute('console:create', {
        kernelPreference: { name: 'javascript' },
      });
      await first.sessionContext.ready;
      await first.console.inject(
        'var sharedWidget = new Jupyter.widgets.IntSlider(); display(sharedWidget);'
      );
      const second = await app.commands.execute('console:create', {
        kernelPreference: { name: 'javascript' },
      });
      await second.sessionContext.ready;
      await second.sessionContext.changeKernel({
        id: first.sessionContext.session.kernel.id,
      });
      (window as any).__liteConsole = second;
      (window as any).__liteRun = second.console.inject(
        'await Jupyter.widgetInput(sharedWidget, {fields:["value"]});'
      );
    });
    const result = await page.evaluate(async () => {
      await (window as any).__liteRun;
      return Array.from((window as any).__liteConsole.console.cells)
        .map((cell: any) => JSON.stringify(cell.model.outputs?.toJSON()))
        .join('\n');
    });
    expect(result).toContain('model_unavailable');
    expect(result).not.toContain('jupyterlite-widget-input:v1:');
  });

  for (const kernelName of ['javascript', 'python']) {
    test(`closing a ${kernelName} console input owner releases its shared kernel`, async ({
      page,
    }) => {
      await page.goto('/lab/index.html');
      await page.waitForFunction(() => (window as any).jupyterapp?.started);
      await page.evaluate(async (name) => {
        const app = (window as any).jupyterapp;
        const first = await app.commands.execute('console:create', {
          kernelPreference: { name },
        });
        await first.sessionContext.ready;
        const second = await app.commands.execute('console:create', {
          kernelPreference: { name: 'javascript' },
        });
        await second.sessionContext.ready;
        await second.sessionContext.changeKernel({
          id: first.sessionContext.session.kernel.id,
        });
        (window as any).__liteFirstConsole = first;
        (window as any).__liteSecondConsole = second;
        app.shell.activateById(first.id);
        void first.console
          .inject(
            name === 'javascript'
              ? 'const widget = new Jupyter.widgets.IntSlider(); display(widget); await Jupyter.widgetInput(widget, {fields:["value"]});'
              : [
                  'import piplite',
                  'await piplite.install(["ipywidgets"])',
                  'import micropip',
                  'await micropip.install("http://127.0.0.1:18964/lite_widget_input-0.1.0.dev0-py3-none-any.whl")',
                  'import ipywidgets as widgets',
                  'from IPython.display import display',
                  'from lite_widget_input import widget_input',
                  'widget = widgets.IntSlider()',
                  'display(widget)',
                  'widget_input(widget, fields=["value"])',
                ].join('\n')
          )
          .catch((error: Error) =>
            console.warn('Closed console execution:', error)
          );
      }, kernelName);
      await expect(
        page.getByRole('button', { name: 'Cancel', exact: true })
      ).toBeVisible({ timeout: 180000 });
      const result = await page.evaluate(async (name) => {
        const first = (window as any).__liteFirstConsole;
        const second = (window as any).__liteSecondConsole;
        first.dispose();
        await Promise.race([
          second.console.inject(
            name === 'javascript'
              ? 'console.log("AFTER_CONSOLE_CLOSE_OK")'
              : 'print("AFTER_CONSOLE_CLOSE_OK")'
          ),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Shared kernel remained busy after console disposal'
                  )
                ),
              5000
            )
          ),
        ]);
        return Array.from(second.console.cells)
          .map((cell: any) => JSON.stringify(cell.model.outputs?.toJSON()))
          .join('\n');
      }, kernelName);
      expect(result).toContain('AFTER_CONSOLE_CLOSE_OK');
    });
  }

  for (const [mode, port, isolated] of [
    ['service-worker', 18964, false],
    ['shared-memory', 18965, true],
  ] as const) {
    test(`submits an anywidget snapshot with Pyodide ${mode}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      const workers: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('worker', (worker) => workers.push(worker.url()));
      await page.goto(`http://127.0.0.1:${port}/lab/index.html`);
      await page.waitForFunction(() => (window as any).jupyterapp?.started);
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(isolated);
      await page.evaluate(async () => {
        await (window as any).jupyterapp.commands.execute(
          'notebook:create-new',
          {
            kernelName: 'python',
          }
        );
      });
      await page.waitForFunction(
        () => {
          const panel = (window as any).jupyterapp.shell.currentWidget;
          return panel?.sessionContext?.session?.kernel?.status === 'idle';
        },
        null,
        { timeout: 180000 }
      );
      await page.evaluate((port) => {
        const app = (window as any).jupyterapp;
        const panel = app.shell.currentWidget;
        panel.content.activeCell.model.sharedModel.setSource(
          [
            'import piplite',
            'await piplite.install(["anywidget", "ipywidgets"])',
            'import micropip',
            `await micropip.install("http://127.0.0.1:${port}/lite_widget_input-0.1.0.dev0-py3-none-any.whl")`,
            'import anywidget, traitlets',
            'from IPython.display import display',
            'from lite_widget_input import widget_input, WidgetInputCancelled',
            'from getpass import getpass',
            'class Counter(anywidget.AnyWidget):',
            '    _esm = """export default { render({model, el}) {',
            '      const button = document.createElement("button");',
            '      button.textContent = "Change Lite widget";',
            '      button.onclick = () => { model.set("value", 2); model.save_changes(); };',
            '      el.appendChild(button);',
            '    }};"""',
            '    value = traitlets.Int(0).tag(sync=True)',
            'widget = Counter()',
            'display(widget)',
            'snapshot = widget_input(widget, fields=["value"])',
            'assert snapshot == {"value": 2}, snapshot',
            'assert widget.value == 0, widget.value',
            'print("PY_SNAPSHOT_OK")',
            'try:',
            '    widget_input(widget, fields=["value"])',
            'except WidgetInputCancelled:',
            '    print("PY_CANCEL_OK")',
            'else:',
            '    raise AssertionError("Cancellation not reported")',
            'assert input("Ordinary:") == "hello"',
            'assert getpass("Password:") == "secret-value"',
            'print("PY_STDIN_OK")',
          ].join('\n')
        );
        (window as any).__litePanel = panel;
        (window as any).__liteRun = app.commands.execute('notebook:run-cell');
      }, port);
      await page.getByRole('button', { name: 'Change Lite widget' }).click({
        timeout: 180000,
      });
      const submit = page.getByRole('button', { name: 'Submit', exact: true });
      await expect(submit).toBeEnabled({ timeout: 30000 });
      await submit.click();
      const cancel = page
        .locator('.jp-WidgetInput button:not(:disabled)')
        .filter({ hasText: /^Cancel$/ });
      await expect(cancel).toBeVisible({ timeout: 30000 });
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Escape');
      const ordinary = page.locator('.jp-Stdin input:not([type="password"])');
      await expect(ordinary).toBeVisible({ timeout: 30000 });
      await ordinary.fill('hello');
      await ordinary.press('Enter');
      const password = page.locator('.jp-Stdin input[type="password"]');
      await expect(password).toBeVisible({ timeout: 30000 });
      await password.fill('secret-value');
      await password.press('Enter');
      const result = await page.evaluate(async () => {
        await (window as any).__liteRun;
        return JSON.stringify(
          (window as any).__litePanel.content.activeCell.model.outputs.toJSON()
        );
      });
      expect(result).toContain('PY_SNAPSHOT_OK');
      expect(result).toContain('PY_CANCEL_OK');
      expect(result).toContain('PY_STDIN_OK');
      expect(result).toContain('[Widget input submitted]');
      expect(result).not.toContain('jupyterlite-widget-input:v1:');
      expect(result).not.toContain('secret-value');
      expect(
        workers.some((url) =>
          url.includes(isolated ? 'coincident.worker' : 'comlink.worker')
        )
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});
