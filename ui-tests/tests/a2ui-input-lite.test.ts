// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// End-to-end A2UI form input against the built standalone JupyterLite site
// (Pyodide and javascript-kernel). See playwright.widget-input-lite.config.js.

import { expect, test, type Page } from '@playwright/test';

const FIELDS = [
  { name: 'name', required: true },
  { name: 'age', type: 'number' },
  { name: 'level', type: 'choice', options: ['low', 'high'] },
  { name: 'ok', type: 'checkbox' },
];
const EXPECTED = { name: 'Ada', age: 36, level: ['high'], ok: true };

async function openNotebook(page: Page, baseURL: string, kernelName: string) {
  await page.goto(`${baseURL}/lab/index.html`);
  await page.waitForFunction(() => (window as any).jupyterapp?.started);
  await page.evaluate(async (name) => {
    await (window as any).jupyterapp.commands.execute('notebook:create-new', {
      kernelName: name,
    });
  }, kernelName);
  await page.waitForFunction(
    () => {
      const panel = (window as any).jupyterapp.shell.currentWidget;
      return panel?.sessionContext?.session?.kernel?.status === 'idle';
    },
    null,
    { timeout: 180000 }
  );
}

async function startCell(page: Page, source: string) {
  await page.evaluate((source) => {
    const app = (window as any).jupyterapp;
    const panel = app.shell.currentWidget;
    panel.content.activeCell.model.sharedModel.setSource(source);
    (window as any).__a2uiPanel = panel;
    (window as any).__a2uiRun = app.commands.execute('notebook:run-cell');
  }, source);
}

async function cellOutputs(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await (window as any).__a2uiRun;
    return JSON.stringify(
      (window as any).__a2uiPanel.content.activeCell.model.outputs.toJSON()
    );
  });
}

function formTitled(page: Page, title: string) {
  return page
    .locator('.jp-A2uiInput')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

// Fill the "About you" form so that it yields EXPECTED, then submit it.
async function submitAboutYou(page: Page) {
  const form = formTitled(page, 'About you');
  const submit = form.getByRole('button', { name: 'Submit', exact: true });
  await expect(submit).toBeDisabled({ timeout: 180000 });
  await form.getByRole('textbox', { name: 'name' }).fill('Ada');
  await form.getByRole('spinbutton', { name: 'age' }).fill('36');
  await form.getByRole('radio', { name: 'high' }).check();
  await form.getByRole('checkbox', { name: 'ok' }).check();
  await expect(submit).toBeEnabled();
  await submit.click();
}

async function cancelForm(page: Page, title: string) {
  const cancel = formTitled(page, title).getByRole('button', {
    name: 'Cancel',
    exact: true,
  });
  await expect(cancel).toBeVisible({ timeout: 60000 });
  await cancel.click();
}

function expectCompleted(result: string, markers: string[]) {
  for (const marker of markers) {
    expect(result).toContain(marker);
  }
  expect(result).toContain('[A2UI input submitted]');
  expect(result).toContain('[A2UI input cancelled]');
  expect(result).not.toContain('jupyterlite-a2ui-input:v1:');
}

test.describe('A2UI form input in JupyterLite', () => {
  test.skip(
    !process.env.WIDGET_INPUT_LITE,
    'Requires the patched JupyterLite site'
  );
  test.setTimeout(300000);

  for (const kernelName of ['javascript', 'javascript-worker']) {
    test(`submits and cancels an A2UI form with ${kernelName}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openNotebook(page, 'http://127.0.0.1:18964', kernelName);
      await startCell(
        page,
        [
          `const answer = await Jupyter.a2uiFormInput(${JSON.stringify(
            FIELDS
          )}, {title: "About you"});`,
          `const expected = ${JSON.stringify(EXPECTED)};`,
          'if (JSON.stringify(answer) !== JSON.stringify(expected)) throw new Error("Wrong answer: " + JSON.stringify(answer));',
          'console.log("JS_A2UI_SUBMIT_OK");',
          'try {',
          '  await Jupyter.a2ui_form_input([{name: "note"}], {title: "Cancel me"});',
          '  throw new Error("Cancellation not reported");',
          '} catch (e) {',
          '  if (!(e instanceof Jupyter.A2uiInputCancelled)) throw e;',
          '  console.log("JS_A2UI_CANCEL_OK");',
          '}',
        ].join('\n')
      );
      await submitAboutYou(page);
      await cancelForm(page, 'Cancel me');
      expectCompleted(await cellOutputs(page), [
        'JS_A2UI_SUBMIT_OK',
        'JS_A2UI_CANCEL_OK',
      ]);
      expect(errors).toEqual([]);
    });
  }

  for (const [mode, port] of [
    ['service-worker', 18964],
    ['shared-memory', 18965],
  ] as const) {
    test(`submits and cancels an A2UI form with Pyodide ${mode}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openNotebook(page, `http://127.0.0.1:${port}`, 'python');
      await startCell(
        page,
        [
          'import micropip',
          `await micropip.install("http://127.0.0.1:${port}/a2ui_form-0.1.0-py3-none-any.whl")`,
          'import json',
          'from a2ui_form import a2ui_form_input, A2UIInputCancelled',
          `fields = json.loads(${JSON.stringify(JSON.stringify(FIELDS))})`,
          'answer = a2ui_form_input(fields, title="About you")',
          `assert answer == json.loads(${JSON.stringify(
            JSON.stringify(EXPECTED)
          )}), answer`,
          'print("PY_A2UI_SUBMIT_OK")',
          'try:',
          '    a2ui_form_input([{"name": "note"}], title="Cancel me")',
          'except A2UIInputCancelled:',
          '    print("PY_A2UI_CANCEL_OK")',
          'else:',
          '    raise AssertionError("Cancellation not reported")',
        ].join('\n')
      );
      await submitAboutYou(page);
      await cancelForm(page, 'Cancel me');
      expectCompleted(await cellOutputs(page), [
        'PY_A2UI_SUBMIT_OK',
        'PY_A2UI_CANCEL_OK',
      ]);
      expect(errors).toEqual([]);
    });
  }
});
