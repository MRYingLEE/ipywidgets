// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Renders the A2UI surface widget and MIME renderer in jsdom with the real
// form renderer. Run with `--import ./test/support/register.mjs`.
import './support/dom.mjs';

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  A2UI_MIME_TYPE,
  A2uiSurfaceModel,
  A2uiSurfaceView,
  a2uiRendererFactory,
} from '../src/a2ui-surface.ts';

const catalogId =
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

// jsdom replaces the global Event, which Node's BroadcastChannel rejects, so
// the out-of-band channel is replaced with a recorder. The view caches its
// channel on first use, so this must be installed before any test runs.
const outOfBandPosts = [];
globalThis.BroadcastChannel = class {
  constructor(name) {
    this.name = name;
  }

  postMessage(data) {
    if (this.name === 'xeus-x-a2ui-surface') {
      outOfBandPosts.push(data);
    }
  }

  close() {}
};

function button(id, label, name, variant) {
  return [
    {
      id,
      component: 'Button',
      child: `${id}_text`,
      ...(variant ? { variant } : {}),
      action: { event: { name } },
    },
    { id: `${id}_text`, component: 'Text', text: label },
  ];
}

// A name field with Ping (not ending), Cancel and Submit buttons.
const messages = [
  {
    version: '1.0',
    createSurface: { surfaceId: 's', catalogId },
  },
  {
    version: '1.0',
    updateComponents: {
      surfaceId: 's',
      components: [
        { id: 'root', component: 'Column', children: ['name', 'row'] },
        {
          id: 'name',
          component: 'TextField',
          label: 'Name',
          value: { '@path': '/name' },
        },
        { id: 'row', component: 'Row', children: ['ping', 'no', 'ok'] },
        ...button('ping', 'Ping', 'ping'),
        ...button('no', 'Cancel', 'cancel'),
        ...button('ok', 'Submit', 'submit', 'primary'),
      ],
    },
  },
  {
    version: '1.0',
    updateDataModel: { surfaceId: 's', value: { name: '' } },
  },
];

const views = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.remove();
  }
  document.body.replaceChildren();
});

function render(state) {
  const sent = [];
  const comm = {
    comm_id: 'surface',
    on_msg() {},
    on_close() {},
    send(data) {
      sent.push(data.content);
      return 'msg';
    },
  };
  const model = new A2uiSurfaceModel(
    { messages, submit: ['submit'], cancel: ['cancel'], ...state },
    { model_id: 'surface', widget_manager: { callbacks: () => ({}) }, comm }
  );
  const view = new A2uiSurfaceView({ model });
  views.push(view);
  document.body.appendChild(view.el);
  view.render();
  return { model, view, sent };
}

async function waitFor(check) {
  for (let i = 0; i < 200; i++) {
    const value = check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for the surface');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function findButton(root, label) {
  return [...root.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === label
  );
}

function decoded(sent) {
  return sent.map(({ event, reply }) => ({ event, reply: JSON.parse(reply) }));
}

test('reports actions and the ending reply over the comm', async () => {
  const { model, view, sent } = render({ prompt: 'Who are you?' });
  const input = await waitFor(() => view.el.querySelector('input'));
  assert.equal(
    view.el.querySelector('.jp-A2uiSurface-prompt').textContent,
    'Who are you?'
  );

  input.value = 'Ada';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  findButton(view.el, 'Ping').click();
  await waitFor(() => sent.length === 1);
  findButton(view.el, 'Submit').click();
  await waitFor(() => sent.length === 2);

  assert.deepEqual(decoded(sent), [
    {
      event: 'action',
      reply: {
        status: 'ok',
        action: 'ping',
        context: {},
        data: { name: 'Ada' },
      },
    },
    {
      event: 'reply',
      reply: {
        status: 'ok',
        action: 'submit',
        context: {},
        data: { name: 'Ada' },
      },
    },
  ]);

  // The kernel answers with the status; the form is replaced, and disposing
  // it is not reported as a cancellation.
  model.set('status', 'submitted');
  await waitFor(() => view.el.textContent === '[A2UI surface submitted]');
  await settle();
  assert.equal(sent.length, 2);
  assert.equal(view.el.querySelector('input'), null);
});

test('posts each message on the out-of-band channel with its comm id and message id', async () => {
  outOfBandPosts.length = 0;
  const { view, sent } = render({ prompt: 'Who are you?' });
  const input = await waitFor(() => view.el.querySelector('input'));
  input.value = 'Ada';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  findButton(view.el, 'Ping').click();
  await waitFor(() => outOfBandPosts.length === 1);
  findButton(view.el, 'Submit').click();
  await waitFor(() => outOfBandPosts.length === 2);

  assert.deepEqual(
    outOfBandPosts.map(({ commId, content }) => [commId, content.event]),
    [
      ['surface', 'action'],
      ['surface', 'reply'],
    ]
  );
  assert.notEqual(outOfBandPosts[0].content.id, outOfBandPosts[1].content.id);
  assert.deepEqual(
    sent.map((content) => content.id),
    outOfBandPosts.map(({ content }) => content.id)
  );
});

test('cancels on Escape only when cancel actions exist', async () => {
  const outside = [];
  document.body.addEventListener('keydown', (event) => outside.push(event));

  const cancellable = render({});
  const input = await waitFor(() => cancellable.view.el.querySelector('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  await waitFor(() => cancellable.sent.length === 1);
  assert.deepEqual(decoded(cancellable.sent), [
    { event: 'reply', reply: { status: 'cancelled' } },
  ]);

  const displayOnly = render({ submit: [], cancel: [] });
  const field = await waitFor(() => displayOnly.view.el.querySelector('input'));
  field.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  await settle();
  assert.deepEqual(displayOnly.sent, []);
  // Notebook shortcuts never see keys typed in a surface.
  assert.deepEqual(outside, []);
});

test('reports invalid state and remounts once per update', async () => {
  const { model, view, sent } = render({ messages: [{ version: '0.9' }] });
  await waitFor(() => sent.length === 1);
  assert.deepEqual(decoded(sent), [
    { event: 'reply', reply: { status: 'error', code: 'invalid_request' } },
  ]);
  assert.match(view.el.textContent, /^A2UI surface error: /);

  model.set({ messages, prompt: 'Fixed' });
  const input = await waitFor(() => view.el.querySelector('input'));
  assert.equal(view.el.querySelectorAll('input').length, 1);
  assert.equal(
    view.el.querySelector('.jp-A2uiSurface-prompt').textContent,
    'Fixed'
  );

  model.set('prompt', 'Again');
  await waitFor(() => view.el.querySelector('input') !== input);
  await settle();
  assert.equal(sent.length, 1);
});

test('renders the static MIME type without reporting actions', async () => {
  assert.equal(a2uiRendererFactory.safe, true);
  assert.deepEqual(a2uiRendererFactory.mimeTypes, [A2UI_MIME_TYPE]);

  const renderer = a2uiRendererFactory.createRenderer({
    mimeType: A2UI_MIME_TYPE,
  });
  document.body.appendChild(renderer.node);
  await renderer.renderModel({
    data: { [A2UI_MIME_TYPE]: { messages, prompt: 'Static' } },
  });
  await waitFor(() => findButton(renderer.node, 'Submit'));
  assert.equal(
    renderer.node.querySelector('.jp-A2uiSurface-prompt').textContent,
    'Static'
  );
  findButton(renderer.node, 'Submit').click();
  await settle();

  await renderer.renderModel({ data: { [A2UI_MIME_TYPE]: { messages: [] } } });
  assert.match(renderer.node.textContent, /^A2UI surface error: /);
  renderer.dispose();
});
