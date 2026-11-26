// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// A2UI surfaces shared by enriched display and enriched input:
// - `A2uiSurfaceRenderer` renders the static `application/vnd.a2ui.surface.v1+json`
//   MIME type; it needs no kernel.
// - `A2uiSurfaceModel`/`A2uiSurfaceView` form the `@jupyter-widgets/a2ui`
//   widget. It reports actions to the kernel over the widget comm, which is
//   what asynchronous A2UI input waits on.
// - The stdin A2UI input (a2ui-input.ts) loads the same renderer.

import { DOMWidgetModel, DOMWidgetView } from '@jupyter-widgets/base';
import type { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';

import { A2uiInputError } from '../vendor/a2ui-form/kernel.js';
import type { A2uiFormHandle } from '../vendor/a2ui-form/form.js';
import {
  A2UI_MIME_TYPE,
  A2UI_WIDGET_MODULE,
  A2UI_WIDGET_VERSION,
  type IA2uiSurfaceMessage,
  type IA2uiSurfaceSpec,
  type A2uiSurfaceStatus,
  parseA2uiSurface,
  surfaceAction,
  surfaceReply,
  surfaceSummary,
} from './a2ui-surface-protocol';

export * from './a2ui-surface-protocol';

/**
 * The kernel listens on this channel so a reply or action reaches the
 * surface while a cell is still running. See the kernel bridge in xeus-x.
 */
const OUT_OF_BAND_CHANNEL = 'xeus-x-a2ui-surface';
let outOfBandChannel: BroadcastChannel | undefined;

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function postOutOfBand(commId: string, content: IA2uiSurfaceMessage): void {
  if (typeof BroadcastChannel !== 'function') {
    return;
  }
  if (!outOfBandChannel) {
    outOfBandChannel = new BroadcastChannel(OUT_OF_BAND_CHANNEL);
  }
  outOfBandChannel.postMessage({ commId, content });
}

type A2uiRendererModule = typeof import('../vendor/a2ui-form/form.js');

let rendererModule: Promise<A2uiRendererModule> | undefined;

/** Load the A2UI renderer (React and the basic catalog) once, on first use. */
export function loadA2uiRenderer(): Promise<A2uiRendererModule> {
  if (!rendererModule) {
    rendererModule = import('../vendor/a2ui-form/form.js');
    // Allow a retry after a failed chunk load.
    rendererModule.catch(() => (rendererModule = undefined));
  }
  return rendererModule;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Keep notebook command-mode shortcuts away from the surface's controls.
function stopPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

/**
 * Fill `host` with the prompt, a status line and the form container of a
 * surface.
 */
function layout(
  host: HTMLElement,
  prompt: string
): { status: HTMLElement; form: HTMLElement } {
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', prompt || 'A2UI surface');
  const status = document.createElement('p');
  status.className = 'jp-A2uiSurface-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading…';
  const form = document.createElement('div');
  const children: HTMLElement[] = [status, form];
  if (prompt) {
    const text = document.createElement('p');
    text.className = 'jp-A2uiSurface-prompt';
    text.textContent = prompt;
    children.unshift(text);
  }
  host.replaceChildren(...children);
  return { status, form };
}

function showMessage(host: HTMLElement, text: string): void {
  const message = document.createElement('p');
  message.className = 'jp-A2uiSurface-status';
  message.setAttribute('role', 'status');
  message.textContent = text;
  host.replaceChildren(message);
}

/** Renderer of the static A2UI MIME type. Actions are not reported. */
export class A2uiSurfaceRenderer
  extends Widget
  implements IRenderMime.IRenderer
{
  constructor(options: IRenderMime.IRendererOptions) {
    super();
    this._mimeType = options.mimeType;
    this.addClass('jp-A2uiSurface');
    this.node.addEventListener('keydown', stopPropagation);
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const generation = ++this._generation;
    this._unmount();
    let spec: IA2uiSurfaceSpec;
    try {
      spec = parseA2uiSurface(model.data[this._mimeType]);
    } catch (error) {
      showMessage(this.node, `A2UI surface error: ${describeError(error)}`);
      return;
    }
    const { status, form } = layout(this.node, spec.prompt);
    let renderer: A2uiRendererModule;
    try {
      renderer = await loadA2uiRenderer();
    } catch (error) {
      status.textContent = `A2UI surface error: ${describeError(error)}`;
      return;
    }
    if (generation !== this._generation || this.isDisposed) {
      return;
    }
    status.textContent = '';
    status.hidden = true;
    const handle = renderer.mountA2uiForm(form, spec.messages);
    this._handle = handle;
    // The form shows render errors itself.
    handle.result.catch(() => undefined);
  }

  dispose(): void {
    if (!this.isDisposed) {
      this._generation++;
      this._unmount();
      this.node.removeEventListener('keydown', stopPropagation);
    }
    super.dispose();
  }

  private _unmount(): void {
    this._handle?.dispose();
    this._handle = undefined;
  }

  private readonly _mimeType: string;
  private _generation = 0;
  private _handle: A2uiFormHandle | undefined;
}

/** Renderer factory of the static A2UI MIME type. */
export const a2uiRendererFactory: IRenderMime.IRendererFactory = {
  // The content is declarative and its markdown is sanitized.
  safe: true,
  mimeTypes: [A2UI_MIME_TYPE],
  defaultRank: 50,
  createRenderer: (options) => new A2uiSurfaceRenderer(options),
};

/**
 * Model of an interactive surface. The kernel owns every field: it sets
 * `status` once a reply has ended the surface.
 */
export class A2uiSurfaceModel extends DOMWidgetModel {
  defaults(): Backbone.ObjectHash {
    return {
      ...super.defaults(),
      _model_name: 'A2uiSurfaceModel',
      _model_module: A2UI_WIDGET_MODULE,
      _model_module_version: A2UI_WIDGET_VERSION,
      _view_name: 'A2uiSurfaceView',
      _view_module: A2UI_WIDGET_MODULE,
      _view_module_version: A2UI_WIDGET_VERSION,
      messages: [],
      submit: [],
      cancel: [],
      prompt: '',
      status: '',
    };
  }
}

/**
 * View of an interactive surface. It sends `{event: 'reply', reply}` when a
 * submit or cancel action ends the surface and `{event: 'action', reply}` for
 * other actions; `reply` uses the stdin A2UI reply format. Every view of an
 * ended surface shows its status instead.
 */
export class A2uiSurfaceView extends DOMWidgetView {
  render(): void {
    super.render();
    this.el.classList.add('jp-A2uiSurface');
    this.el.addEventListener('keydown', this._onKeyDown);
    this.listenTo(
      this.model,
      'change:messages change:submit change:cancel change:prompt change:status',
      this._scheduleUpdate
    );
    void this._update();
  }

  remove(): this {
    this._generation++;
    this._unmount();
    this.el.removeEventListener('keydown', this._onKeyDown);
    return super.remove();
  }

  // Several fields can change in one update message; mount once.
  private _scheduleUpdate(): void {
    if (!this._updateScheduled) {
      this._updateScheduled = true;
      queueMicrotask(() => {
        this._updateScheduled = false;
        void this._update();
      });
    }
  }

  private async _update(): Promise<void> {
    const generation = ++this._generation;
    this._unmount();
    const ended = this.model.get('status') as A2uiSurfaceStatus;
    if (ended) {
      showMessage(this.el, surfaceSummary(ended));
      return;
    }
    let spec: IA2uiSurfaceSpec;
    try {
      spec = parseA2uiSurface({
        messages: this.model.get('messages'),
        submit: this.model.get('submit'),
        cancel: this.model.get('cancel'),
        prompt: this.model.get('prompt'),
      });
    } catch (error) {
      showMessage(this.el, `A2UI surface error: ${describeError(error)}`);
      this._send(surfaceReply({ status: 'failed', code: 'invalid_request' }));
      return;
    }
    const { status, form } = layout(this.el, spec.prompt);
    let renderer: A2uiRendererModule;
    try {
      renderer = await loadA2uiRenderer();
    } catch (error) {
      console.error('Could not load the A2UI renderer:', error);
      if (generation === this._generation) {
        status.textContent = `A2UI surface error: ${describeError(error)}`;
        this._send(surfaceReply({ status: 'failed', code: 'render_failed' }));
      }
      return;
    }
    if (generation !== this._generation) {
      return;
    }
    status.textContent = '';
    status.hidden = true;
    const ends = new Set([...spec.submit, ...spec.cancel]);
    const handle = renderer.mountA2uiForm(form, spec.messages, {
      submit: spec.submit,
      cancel: spec.cancel,
      onAction: (action) => {
        if (ends.has(action.name)) {
          return;
        }
        try {
          this._send(surfaceAction(action));
        } catch (error) {
          console.error('Could not report the A2UI action:', error);
        }
      },
    });
    this._handle = handle;
    this._cancel = spec.cancel.length ? () => handle.cancel() : undefined;
    handle.result.then(
      (outcome) => {
        // A remount or removal disposes the form, which cancels it; that is
        // not the user's answer.
        if (generation === this._generation) {
          this._sendEncoded(() => surfaceReply(outcome));
        }
      },
      (error) => {
        console.error('Could not render the A2UI surface:', error);
        if (generation === this._generation) {
          this._send(surfaceReply({ status: 'failed', code: 'render_failed' }));
        }
      }
    );
  }

  private _onKeyDown = (event: KeyboardEvent): void => {
    stopPropagation(event);
    if (event.key === 'Escape' && this._cancel) {
      event.preventDefault();
      this._cancel();
    }
  };

  private _sendEncoded(encode: () => IA2uiSurfaceMessage): void {
    let message: IA2uiSurfaceMessage;
    try {
      message = encode();
    } catch (error) {
      if (!(error instanceof A2uiInputError)) {
        throw error;
      }
      console.error('Could not encode the A2UI surface data:', error);
      message = surfaceReply({ status: 'failed', code: 'invalid_state' });
    }
    this._send(message);
  }

  private _send(message: IA2uiSurfaceMessage): void {
    const stamped: IA2uiSurfaceMessage = { ...message, id: newMessageId() };
    this.send({ ...stamped });
    postOutOfBand(this.model.model_id, stamped);
  }

  private _unmount(): void {
    this._cancel = undefined;
    this._handle?.dispose();
    this._handle = undefined;
  }

  private _generation = 0;
  private _updateScheduled = false;
  private _handle: A2uiFormHandle | undefined;
  private _cancel: (() => void) | undefined;
}
