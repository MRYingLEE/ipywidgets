// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  A2uiInputCancelled,
  A2uiInputError,
  a2uiForm,
  decodeA2uiInputReply,
} from '../vendor/a2ui-form/kernel.js';
import {
  parseA2uiSurface,
  surfaceAction,
  surfaceReply,
  surfaceSummary,
} from '../src/a2ui-surface-protocol.ts';

const messages = a2uiForm([{ name: 'city', label: 'City' }]);

test('accepts display-only and interactive surfaces', () => {
  assert.deepEqual(parseA2uiSurface({ messages }), {
    messages,
    submit: [],
    cancel: [],
    prompt: '',
  });
  assert.deepEqual(
    parseA2uiSurface({
      messages,
      submit: ['submit'],
      cancel: ['submit2'],
      prompt: 'Where?',
    }),
    { messages, submit: ['submit'], cancel: ['submit2'], prompt: 'Where?' }
  );
  // The placeholder submit action must not clash with a cancel action.
  assert.deepEqual(parseA2uiSurface({ messages, cancel: ['submit'] }).cancel, [
    'submit',
  ]);
});

test('rejects surfaces the input protocol rejects', () => {
  for (const value of [
    null,
    [],
    { messages: 'x' },
    { messages: [] },
    { messages: [{ version: '0.9' }] },
    { messages, submit: ['bad name'] },
    { messages, submit: ['a'], cancel: ['a'] },
    { messages, prompt: 3 },
  ]) {
    assert.throws(() => parseA2uiSurface(value), A2uiInputError);
  }
});

test('encodes replies and actions in the stdin reply format', () => {
  const submitted = surfaceReply({
    status: 'submitted',
    action: 'submit',
    context: {},
    data: { city: 'Oslo' },
  });
  assert.equal(submitted.event, 'reply');
  assert.deepEqual(decodeA2uiInputReply(submitted.reply, ['submit']), {
    action: 'submit',
    context: {},
    data: { city: 'Oslo' },
  });
  assert.throws(
    () =>
      decodeA2uiInputReply(surfaceReply({ status: 'cancelled' }).reply, [
        'submit',
      ]),
    A2uiInputCancelled
  );
  assert.throws(
    () =>
      decodeA2uiInputReply(
        surfaceReply({ status: 'failed', code: 'render_failed' }).reply,
        ['submit']
      ),
    /render_failed/
  );
  const action = surfaceAction({
    name: 'refresh',
    context: { a: 1 },
    data: {},
  });
  assert.equal(action.event, 'action');
  assert.deepEqual(decodeA2uiInputReply(action.reply, ['refresh']), {
    action: 'refresh',
    context: { a: 1 },
    data: {},
  });
  assert.equal(surfaceSummary(''), '');
  assert.equal(surfaceSummary('submitted'), '[A2UI surface submitted]');
});
