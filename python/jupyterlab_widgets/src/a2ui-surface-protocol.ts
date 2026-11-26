// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Data rules shared by the A2UI display renderer, the A2UI surface widget and
// the stdin A2UI input. Free of DOM code so it can be tested in Node.

import {
  A2uiInputError,
  createA2uiInputRequest,
  encodeA2uiInputFailure,
  encodeA2uiInputResult,
  parseA2uiInputRequest,
} from '../vendor/a2ui-form/kernel.js';
import type { JsonObject } from '../vendor/a2ui-form/kernel.js';

/** MIME type of a static surface: `{"messages": [...], "prompt"?: string}`. */
export const A2UI_MIME_TYPE = 'application/vnd.a2ui.surface.v1+json';

/** Widget module of the interactive surface (`A2uiSurfaceModel/View`). */
export const A2UI_WIDGET_MODULE = '@jupyter-widgets/a2ui';
export const A2UI_WIDGET_VERSION = '1.0.0';

/** Lifecycle of an interactive surface; set by the kernel. */
export type A2uiSurfaceStatus =
  | ''
  | 'submitted'
  | 'cancelled'
  | 'failed'
  | 'closed';

/** A validated surface: what every renderer mounts. */
export interface IA2uiSurfaceSpec {
  messages: JsonObject[];
  submit: string[];
  cancel: string[];
  prompt: string;
}

/** Custom message from a surface view to the kernel. */
export interface IA2uiSurfaceMessage {
  event: 'reply' | 'action';
  reply: string;
  /** Unique per message, so a copy sent over two channels is handled once. */
  id?: string;
}

/**
 * Validate a surface with the stdin protocol's rules: one surface created by
 * the first message, A2UI v1.0 operations, and the same limits. Unlike stdin
 * input, a display-only surface may have no submit action.
 */
export function parseA2uiSurface(value: unknown): IA2uiSurfaceSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new A2uiInputError('An A2UI surface must be an object');
  }
  const {
    messages,
    submit = [],
    cancel = [],
    prompt = '',
  } = value as Record<string, unknown>;
  if (!Array.isArray(messages)) {
    throw new A2uiInputError('messages must be an array');
  }
  if (!Array.isArray(submit) || !Array.isArray(cancel)) {
    throw new A2uiInputError('submit and cancel must be arrays');
  }
  // The request format needs a submit action; borrow an unused one.
  const placeholder = cancel.includes('submit') ? 'a2ui.display' : 'submit';
  const request = parseA2uiInputRequest(
    createA2uiInputRequest(messages, {
      prompt: prompt as string,
      submit: submit.length ? (submit as string[]) : [placeholder],
      cancel: cancel as string[],
    })
  );
  if (!request) {
    throw new A2uiInputError('Invalid A2UI surface');
  }
  return {
    messages: request.messages,
    submit: submit.length ? request.submit : [],
    cancel: request.cancel,
    prompt: request.prompt,
  };
}

/** Message reporting how a surface ended: a submit, cancel or failure. */
export function surfaceReply(
  outcome:
    | {
        status: 'submitted';
        action: string;
        context: JsonObject;
        data: JsonObject;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; code: string }
): IA2uiSurfaceMessage {
  if (outcome.status === 'submitted') {
    const { action, context, data } = outcome;
    return {
      event: 'reply',
      reply: encodeA2uiInputResult({ action, context, data }),
    };
  }
  return {
    event: 'reply',
    reply:
      outcome.status === 'failed'
        ? encodeA2uiInputFailure(outcome.code)
        : encodeA2uiInputFailure(),
  };
}

/** Message reporting an action that does not end the surface. */
export function surfaceAction(action: {
  name: string;
  context: JsonObject;
  data: JsonObject;
}): IA2uiSurfaceMessage {
  return {
    event: 'action',
    reply: encodeA2uiInputResult({
      action: action.name,
      context: action.context,
      data: action.data,
    }),
  };
}

/** Text shown in place of an ended surface. */
export function surfaceSummary(status: A2uiSurfaceStatus): string {
  return status ? `[A2UI surface ${status}]` : '';
}
