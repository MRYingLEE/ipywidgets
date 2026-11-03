// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/** The provisional widget-input protocol marker. */
export const WIDGET_INPUT_MARKER = 'jupyterlite-widget-input:v1:';

const MAX_REQUEST_BYTES = 8192;
const MAX_REPLY_BYTES = 65536;
const MAX_MODEL_ID_BYTES = 256;
const MAX_FIELDS = 32;
const MAX_DEPTH = 16;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,127}(?![\s\S])/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}(?![\s\S])/;

/** A validated widget-input request. */
export interface IWidgetInputRequest {
  model_id: string;
  fields: string[];
  prompt: string;
}

/** An invalid or unsupported widget-input protocol value. */
export class WidgetInputProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetInputProtocolError';
  }
}

function utf8Size(value: string): number {
  if (value.length > MAX_REPLY_BYTES) {
    throw new WidgetInputProtocolError('Value is too large');
  }
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new WidgetInputProtocolError('Invalid Unicode');
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new WidgetInputProtocolError('Invalid Unicode');
    }
  }
  return new TextEncoder().encode(value).length;
}

function fieldsAreValid(fields: unknown): fields is string[] {
  return (
    Array.isArray(fields) &&
    fields.length >= 1 &&
    fields.length <= MAX_FIELDS &&
    fields.every((field) => typeof field === 'string' && FIELD.test(field)) &&
    new Set(fields).size === fields.length
  );
}

/**
 * JSON.parse accepts duplicate keys, so check the already-valid JSON text for
 * duplicates before trusting the resulting object.
 */
function rejectDuplicateKeys(text: string): void {
  const stack: Array<{ keys: Set<string>; expectingKey: boolean } | null> = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      while (++i < text.length) {
        if (text[i] === '\\') {
          i++;
        } else if (text[i] === '"') {
          break;
        }
      }
      const object = stack[stack.length - 1];
      if (object?.expectingKey) {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (object.keys.has(key)) {
          throw new WidgetInputProtocolError('Duplicate JSON key');
        }
        object.keys.add(key);
        object.expectingKey = false;
      }
    } else if (char === '{') {
      stack.push({ keys: new Set(), expectingKey: true });
    } else if (char === '[') {
      stack.push(null);
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',') {
      const object = stack[stack.length - 1];
      if (object) {
        object.expectingKey = true;
      }
    }
  }
}

/**
 * Parse a marked request. Unmarked prompts return undefined so normal stdin
 * can fall through; marked but malformed prompts throw.
 */
export function parseWidgetInputRequest(
  prompt: string
): IWidgetInputRequest | undefined {
  if (!prompt.startsWith(WIDGET_INPUT_MARKER)) {
    return undefined;
  }
  if (utf8Size(prompt) > MAX_REQUEST_BYTES) {
    throw new WidgetInputProtocolError('Request is too large');
  }
  const json = prompt.slice(WIDGET_INPUT_MARKER.length);
  let request: unknown;
  try {
    request = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WidgetInputProtocolError('Invalid JSON request');
    }
    throw error;
  }
  rejectDuplicateKeys(json);
  if (
    request === null ||
    typeof request !== 'object' ||
    Array.isArray(request)
  ) {
    throw new WidgetInputProtocolError('Invalid request envelope');
  }
  const record = request as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3 ||
    !keys.includes('model_id') ||
    !keys.includes('fields') ||
    !keys.includes('prompt') ||
    typeof record.model_id !== 'string' ||
    !record.model_id ||
    utf8Size(record.model_id) > MAX_MODEL_ID_BYTES ||
    typeof record.prompt !== 'string' ||
    !fieldsAreValid(record.fields)
  ) {
    throw new WidgetInputProtocolError('Invalid request envelope');
  }
  utf8Size(record.prompt);
  return {
    model_id: record.model_id,
    fields: record.fields,
    prompt: record.prompt,
  };
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function copyValidatedValue(
  value: unknown,
  depth: number,
  budget: { size: number }
): JsonValue {
  const account = (size: number) => {
    budget.size += size;
    if (budget.size > MAX_REPLY_BYTES) {
      throw new WidgetInputProtocolError('Reply is too large');
    }
  };
  if (depth > MAX_DEPTH) {
    throw new WidgetInputProtocolError('State is nested too deeply');
  }
  if (value === null || typeof value === 'boolean') {
    account(1);
    return value;
  }
  if (typeof value === 'string') {
    account(utf8Size(value) + 2);
    if (value.startsWith('IPY_MODEL_')) {
      throw new WidgetInputProtocolError('Widget references are not supported');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new WidgetInputProtocolError('Unsupported number');
    }
    account(1);
    return value;
  }
  if (typeof value !== 'object') {
    throw new WidgetInputProtocolError('Unsupported value');
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new WidgetInputProtocolError('Unsupported symbol property');
  }
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_REPLY_BYTES
    ) {
      throw new WidgetInputProtocolError('Unsupported array length');
    }
    account(2 + Math.max(0, length - 1));
    if (Object.getOwnPropertyNames(value).length !== length + 1) {
      throw new WidgetInputProtocolError('Unsupported array properties');
    }
    const result: JsonValue[] = [];
    Object.setPrototypeOf(result, null);
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new WidgetInputProtocolError('Unsupported array element');
      }
      result[i] = copyValidatedValue(descriptor.value, depth + 1, budget);
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WidgetInputProtocolError('Unsupported object');
  }
  account(2);
  const result: { [key: string]: JsonValue } = Object.create(null);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value)
  )) {
    account(utf8Size(key) + 3);
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new WidgetInputProtocolError('Unsupported object property');
    }
    result[key] = copyValidatedValue(descriptor.value, depth + 1, budget);
  }
  return result;
}

/** Serialize exactly the selected state fields for a successful reply. */
export function encodeWidgetInputState(
  fields: readonly string[],
  state: Record<string, unknown>
): string {
  if (!fieldsAreValid(fields) || state === null || typeof state !== 'object') {
    throw new WidgetInputProtocolError('Invalid state');
  }
  const safeState = copyValidatedValue(state, 0, { size: 0 });
  if (
    safeState === null ||
    typeof safeState !== 'object' ||
    Array.isArray(safeState)
  ) {
    throw new WidgetInputProtocolError('Invalid state');
  }
  const keys = Object.keys(safeState);
  if (
    keys.length !== fields.length ||
    fields.some(
      (field) => !Object.prototype.hasOwnProperty.call(safeState, field)
    )
  ) {
    throw new WidgetInputProtocolError('State fields do not match request');
  }
  const reply = `{"status":"ok","state":${JSON.stringify(safeState)}}`;
  if (utf8Size(reply) > MAX_REPLY_BYTES) {
    throw new WidgetInputProtocolError('Reply is too large');
  }
  return reply;
}

/** Serialize a cancellation or a bounded, machine-readable error. */
export function encodeWidgetInputFailure(code?: string): string {
  if (code === undefined) {
    return '{"status":"cancelled"}';
  }
  if (!ERROR_CODE.test(code)) {
    throw new WidgetInputProtocolError('Invalid error code');
  }
  return `{"status":"error","code":"${code}"}`;
}
