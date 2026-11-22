// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  A2UI_INPUT_MARKER,
  A2uiInputError,
  createA2uiInputRequest,
  encodeA2uiInputFailure,
  parseA2uiInputRequest,
} from '../vendor/a2ui-form/kernel.js';
import {
  WIDGET_INPUT_MARKER,
  parseWidgetInputRequest,
} from '../src/widget-input-protocol.ts';

const messages = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'form',
      catalogId:
        'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      dataModel: { answer: '' },
    },
  },
];

test('widget and A2UI input prompts are told apart by their markers', () => {
  const a2ui = createA2uiInputRequest(messages, { prompt: 'Answer' });
  const widget =
    WIDGET_INPUT_MARKER +
    JSON.stringify({ model_id: 'model', fields: ['value'], prompt: '' });

  assert.ok(!a2ui.startsWith(WIDGET_INPUT_MARKER));
  assert.ok(!widget.startsWith(A2UI_INPUT_MARKER));
  assert.equal(parseWidgetInputRequest(a2ui), undefined);
  assert.equal(parseA2uiInputRequest(widget), undefined);
  assert.equal(parseA2uiInputRequest('ordinary input'), undefined);
  assert.deepEqual(parseA2uiInputRequest(a2ui)?.submit, ['submit']);
});

test('marked but malformed A2UI prompts are rejected for an invalid_request reply', () => {
  assert.throws(
    () => parseA2uiInputRequest(A2UI_INPUT_MARKER + '{'),
    A2uiInputError
  );
  assert.equal(
    encodeA2uiInputFailure('invalid_request'),
    '{"status":"error","code":"invalid_request"}'
  );
});
