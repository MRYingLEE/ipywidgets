// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WIDGET_INPUT_MARKER,
  WidgetInputProtocolError,
  encodeWidgetInputFailure,
  encodeWidgetInputState,
  parseWidgetInputRequest,
} from '../src/widget-input-protocol.ts';

const request = (value) => WIDGET_INPUT_MARKER + JSON.stringify(value);
const valid = { model_id: 'model', fields: ['value'], prompt: 'Submit' };
const invalidRequest = (text) =>
  assert.throws(() => parseWidgetInputRequest(text), WidgetInputProtocolError);
const invalidState = (value) =>
  assert.throws(
    () => encodeWidgetInputState(['value'], { value }),
    WidgetInputProtocolError
  );

test('parses only marked, exact requests', () => {
  assert.equal(parseWidgetInputRequest('ordinary input'), undefined);
  assert.deepEqual(parseWidgetInputRequest(request(valid)), valid);
  invalidRequest(WIDGET_INPUT_MARKER + '{');
  invalidRequest(request({ ...valid, extra: true }));
  invalidRequest(request({ ...valid, fields: ['_private'] }));
  invalidRequest(request({ ...valid, fields: ['value\n'] }));
  invalidRequest(request({ ...valid, fields: ['value', 'value'] }));
  invalidRequest(request({ ...valid, fields: [] }));
  invalidRequest(request({ ...valid, fields: Array(33).fill('value') }));
  invalidRequest(request({ ...valid, model_id: '' }));
  invalidRequest(request({ ...valid, model_id: 'é'.repeat(129) }));
  invalidRequest(request({ ...valid, prompt: '\ud800' }));
});

test('rejects duplicate keys including escaped spellings', () => {
  invalidRequest(
    WIDGET_INPUT_MARKER +
      '{"model_id":"x","fields":["value"],"prompt":"a","\\u0070rompt":"b"}'
  );
  invalidRequest(
    WIDGET_INPUT_MARKER +
      '{"model_id":"x","fields":["value"],"prompt":{"x":1,"x":2}}'
  );
});

test('enforces exact request byte bounds including marker', () => {
  const overhead = Buffer.byteLength(request({ ...valid, prompt: '' }));
  const maximum = request({ ...valid, prompt: 'x'.repeat(8192 - overhead) });
  assert.equal(Buffer.byteLength(maximum), 8192);
  assert.equal(parseWidgetInputRequest(maximum).prompt.length, 8192 - overhead);
  invalidRequest(request({ ...valid, prompt: 'x'.repeat(8193 - overhead) }));
});

test('encodes only exact selected fields', () => {
  assert.equal(
    encodeWidgetInputState(['value'], { value: 2 }),
    '{"status":"ok","state":{"value":2}}'
  );
  assert.throws(
    () => encodeWidgetInputState(['value'], {}),
    WidgetInputProtocolError
  );
  assert.throws(
    () => encodeWidgetInputState(['value'], { value: 2, other: 3 }),
    WidgetInputProtocolError
  );
  assert.equal(encodeWidgetInputFailure(), '{"status":"cancelled"}');
  assert.equal(
    encodeWidgetInputFailure('model_unavailable'),
    '{"status":"error","code":"model_unavailable"}'
  );
  assert.throws(
    () => encodeWidgetInputFailure('Bad Code'),
    WidgetInputProtocolError
  );
  assert.throws(
    () => encodeWidgetInputFailure('invalid\n'),
    WidgetInputProtocolError
  );
});

test('rejects unsupported values instead of JSON coercion', () => {
  for (const value of [
    undefined,
    NaN,
    Infinity,
    9007199254740992,
    'IPY_MODEL_child',
    '\ud800',
    new Uint8Array([1]),
    new Date(),
    [undefined],
    Array(1),
    { nested: undefined },
  ]) {
    invalidState(value);
  }
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => 1,
  });
  invalidState(accessor);
  const cyclic = {};
  cyclic.self = cyclic;
  invalidState(cyclic);
  assert.doesNotThrow(() =>
    encodeWidgetInputState(['value'], { value: 9007199254740991 })
  );
});

test('serializes the validated snapshot rather than reading a proxy again', () => {
  const state = new Proxy(
    { value: 2 },
    {
      get(target, key, receiver) {
        return key === 'value'
          ? 'IPY_MODEL_other'
          : Reflect.get(target, key, receiver);
      },
    }
  );
  assert.equal(
    encodeWidgetInputState(['value'], state),
    '{"status":"ok","state":{"value":2}}'
  );
});

test('enforces depth and exact reply byte bounds', () => {
  let value = 0;
  for (let i = 0; i < 15; i++) {
    value = [value];
  }
  assert.doesNotThrow(() => encodeWidgetInputState(['value'], { value }));
  invalidState([value]);
  const overhead = Buffer.byteLength(
    encodeWidgetInputState(['value'], { value: '' })
  );
  const maximum = encodeWidgetInputState(['value'], {
    value: 'x'.repeat(65536 - overhead),
  });
  assert.equal(Buffer.byteLength(maximum), 65536);
  invalidState('x'.repeat(65537 - overhead));
});
