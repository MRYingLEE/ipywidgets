// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { test } from '@jupyterlab/galata';
import { expect } from '@playwright/test';

test.describe('Widget input', () => {
  test.use({ autoGoto: false });

  test('submits anywidget frontend state and preserves ordinary stdin', async ({
    context,
    tmpPath,
  }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/lab');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async (path) => {
      const app = (window as any).jupyterapp;
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
      if (!context.session?.kernel) {
        await context.changeKernel({ name: 'python3' });
      }
      panel.content.activeCell.model.sharedModel.setSource(
        [
          'import anywidget, traitlets',
          'from IPython.display import display',
          'from lite_widget_input import widget_input',
          'from getpass import getpass',
          'class Counter(anywidget.AnyWidget):',
          '    _esm = """',
          '    function render({model, el}) {',
          '      const button = document.createElement("button");',
          '      button.textContent = "Change widget value";',
          '      button.addEventListener("click", () => { model.set("value", 2); model.save_changes(); });',
          '      el.appendChild(button);',
          '    }',
          '    export default {render};',
          '    """',
          '    value = traitlets.Int(0).tag(sync=True)',
          'widget = Counter()',
          'display(widget)',
          'snapshot = widget_input(widget, fields=["value"], prompt="Confirm widget")',
          'assert snapshot == {"value": 2}, snapshot',
          'print("SNAPSHOT_OK")',
          'plain = input("Ordinary:")',
          'secret = getpass("Password:")',
          'assert plain == "hello" and secret == "secret-value"',
          'print("INPUT_OK")',
        ].join('\n')
      );
      app.shell.activateById(panel.id);
      (window as any).__widgetInputPanel = panel;
      (window as any).__widgetInputRun = app.commands.execute(
        'notebook:run-cell',
        { semanticWidget: panel.id }
      );
    }, tmpPath);

    const widgetButton = page.getByRole('button', {
      name: 'Change widget value',
    });
    await expect(widgetButton).toBeVisible({ timeout: 15000 });
    await widgetButton.click();
    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submit).toBeEnabled({ timeout: 15000 });
    await submit.focus();
    await page.keyboard.press('Enter');
    const ordinary = page.locator('.jp-OutputArea input:not([type="password"])');
    await ordinary.fill('hello');
    await ordinary.press('Enter');
    const password = page.locator('.jp-OutputArea input[type="password"]');
    await password.fill('secret-value');
    await password.press('Enter');
    const result = await page.evaluate(async () => {
      const ran = await (window as any).__widgetInputRun;
      const panel = (window as any).__widgetInputPanel;
      return {
        ran,
        outputs: JSON.stringify(panel.content.activeCell.model.outputs.toJSON()),
      };
    });
    expect(result.ran).toBe(true);
    expect(result.outputs).toContain('[Widget input submitted]');
    expect(result.outputs).toContain('SNAPSHOT_OK');
    expect(result.outputs).toContain('INPUT_OK');
    expect(result.outputs).not.toContain('secret-value');
    expect(result.outputs).not.toContain('jupyterlite-widget-input:v1:');
    expect(result.outputs).not.toContain('\\"value\\":2');
    expect(errors).toEqual([]);
  });

  test('handles keyboard cancellation and invalid or missing models', async ({
    context,
    tmpPath,
  }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/lab');
    await page.waitForFunction(() => (window as any).jupyterapp?.started);
    await page.evaluate(async (path) => {
      const app = (window as any).jupyterapp;
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
      if (!context.session?.kernel) {
        await context.changeKernel({ name: 'python3' });
      }
      panel.content.activeCell.model.sharedModel.setSource(
        [
          'import json, ipywidgets as widgets',
          'from IPython.display import display',
          'from lite_widget_input import widget_input, WidgetInputCancelled',
          'widget = widgets.IntSlider()',
          'display(widget)',
          'try:',
          '    widget_input(widget, fields=["value"])',
          'except WidgetInputCancelled:',
          '    print("CANCEL_OK")',
          'else:',
          '    raise AssertionError("Cancellation was not reported")',
          'marker = "jupyterlite-widget-input:v1:"',
          'bad = json.loads(input(marker + "{"))',
          'assert bad == {"status": "error", "code": "invalid_request"}, bad',
          'print("INVALID_OK")',
          'missing = json.loads(input(marker + json.dumps({"model_id":"not-present", "fields":["value"], "prompt":"Missing"})))',
          'assert missing == {"status": "error", "code": "model_unavailable"}, missing',
          'print("MISSING_OK")',
        ].join('\n')
      );
      app.shell.activateById(panel.id);
      (window as any).__widgetInputPanel = panel;
      (window as any).__widgetInputRun = app.commands.execute(
        'notebook:run-cell',
        { semanticWidget: panel.id }
      );
    }, tmpPath);

    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeVisible({ timeout: 15000 });
    await cancel.focus();
    await page.keyboard.press('Escape');
    const result = await page.evaluate(async () => {
      const ran = await (window as any).__widgetInputRun;
      const panel = (window as any).__widgetInputPanel;
      return {
        ran,
        outputs: JSON.stringify(panel.content.activeCell.model.outputs.toJSON()),
      };
    });
    expect(result.ran).toBe(true);
    expect(result.outputs).toContain('[Widget input cancelled]');
    expect(result.outputs).toContain('CANCEL_OK');
    expect(result.outputs).toContain('INVALID_OK');
    expect(result.outputs).toContain('MISSING_OK');
    expect(result.outputs).not.toContain('jupyterlite-widget-input:v1:');
    expect(errors).toEqual([]);
  });
});
