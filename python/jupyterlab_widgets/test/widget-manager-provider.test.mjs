// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WidgetManagerProvider } from '../src/widget-manager-provider.ts';

function notebook(kernelId) {
  const kernel = { id: kernelId, isDisposed: false };
  const content = { isDisposed: false };
  return {
    isDisposed: false,
    content,
    context: { sessionContext: { session: { kernel } } },
  };
}

function consolePanel(kernelId) {
  return {
    isDisposed: false,
    console: {
      isDisposed: false,
      sessionContext: {
        session: { kernel: { id: kernelId, isDisposed: false } },
      },
    },
  };
}

function manager(kernelId) {
  const models = new Map();
  return {
    isDisposed: false,
    kernel: { id: kernelId },
    models,
    has_model: (id) => models.has(id),
    get_model: async (id) => models.get(id),
  };
}

test('looks up managers by panel and verifies the current kernel', () => {
  const provider = new WidgetManagerProvider();
  const first = notebook('first');
  const second = notebook('second');
  const firstManager = manager('first');
  const secondManager = manager('second');
  provider.register(first.content, firstManager);
  provider.register(second.content, secondManager);

  assert.equal(provider.getManager(first), firstManager);
  assert.equal(provider.getManager(second), secondManager);
  first.context.sessionContext.session.kernel.id = 'second';
  assert.equal(provider.getManager(first), undefined);
  assert.equal(provider.getManager(second), secondManager);
  first.context.sessionContext.session.kernel.id = 'first';
  assert.equal(provider.getManager(first), firstManager);
});

test('rejects disposed panels, content, kernels, and managers', () => {
  const provider = new WidgetManagerProvider();
  const panel = notebook('kernel');
  const modelManager = manager('kernel');
  provider.register(panel.content, modelManager);
  assert.equal(provider.getManager(panel), modelManager);

  for (const resource of [
    panel,
    panel.content,
    panel.context.sessionContext.session.kernel,
    modelManager,
  ]) {
    resource.isDisposed = true;
    assert.equal(provider.getManager(panel), undefined);
    resource.isDisposed = false;
  }
  panel.context.sessionContext.session = null;
  assert.equal(provider.getManager(panel), undefined);
});

test('supports console panels and does not unregister a replacement manager', () => {
  const provider = new WidgetManagerProvider();
  const panel = consolePanel('kernel');
  const original = manager('kernel');
  const replacement = manager('kernel');
  provider.register(panel.console, original);
  assert.equal(provider.getManager(panel), original);
  provider.register(panel.console, replacement);
  provider.unregister(panel.console, original);
  assert.equal(provider.getManager(panel), replacement);
  provider.unregister(panel.console, replacement);
  assert.equal(provider.getManager(panel), undefined);
});

test('keeps panels on the same kernel distinct', () => {
  const provider = new WidgetManagerProvider();
  const first = notebook('kernel');
  const second = notebook('kernel');
  const shared = manager('kernel');
  provider.register(first.content, shared);
  assert.equal(provider.getManager(first), shared);
  assert.equal(provider.getManager(second), undefined);
  provider.register(second.content, shared);
  provider.unregister(first.content, shared);
  assert.equal(provider.getManager(first), undefined);
  assert.equal(provider.getManager(second), shared);
});

test('requires a live matching view in the requesting panel', async () => {
  const provider = new WidgetManagerProvider();
  const first = notebook('kernel');
  const second = notebook('kernel');
  const shared = manager('kernel');
  const displayed = { model_id: 'displayed', comm_live: true };
  const undisplayed = { model_id: 'undisplayed', comm_live: true };
  shared.models.set(displayed.model_id, displayed);
  shared.models.set(undisplayed.model_id, undisplayed);
  let visible = true;
  const renderer = {
    getDisplayedModel: (candidate) =>
      visible && candidate === shared ? displayed : undefined,
  };
  provider.register(first.content, shared, () => [renderer]);
  provider.register(second.content, shared, () => []);

  assert.equal(await provider.getDisplayedModel(first, 'displayed'), displayed);
  assert.equal(
    await provider.getDisplayedModel(first, 'undisplayed'),
    undefined
  );
  assert.equal(
    await provider.getDisplayedModel(second, 'displayed'),
    undefined
  );
  visible = false;
  assert.equal(await provider.getDisplayedModel(first, 'displayed'), undefined);
  visible = true;
  shared.models.set('displayed', { model_id: 'displayed', comm_live: true });
  assert.equal(await provider.getDisplayedModel(first, 'displayed'), undefined);
});

test('rechecks view and registration after asynchronous model lookup', async () => {
  const provider = new WidgetManagerProvider();
  const panel = notebook('kernel');
  const shared = manager('kernel');
  const model = { model_id: 'displayed', comm_live: true };
  shared.models.set(model.model_id, model);
  let visible = true;
  const renderer = {
    getDisplayedModel: () => (visible ? model : undefined),
  };
  provider.register(panel.content, shared, () => [renderer]);

  let resolve;
  shared.get_model = () => new Promise((done) => (resolve = done));
  const hiddenDuringLookup = provider.getDisplayedModel(panel, model.model_id);
  visible = false;
  resolve(model);
  assert.equal(await hiddenDuringLookup, undefined);

  visible = true;
  const unregisteredDuringLookup = provider.getDisplayedModel(
    panel,
    model.model_id
  );
  provider.unregister(panel.content, shared);
  resolve(model);
  assert.equal(await unregisteredDuringLookup, undefined);

  provider.register(panel.content, shared, () => [renderer]);
  const removedDuringLookup = provider.getDisplayedModel(panel, model.model_id);
  shared.models.delete(model.model_id);
  resolve(model);
  assert.equal(await removedDuringLookup, undefined);
});
