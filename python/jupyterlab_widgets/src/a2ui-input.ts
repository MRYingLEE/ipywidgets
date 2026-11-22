// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ISessionContext } from '@jupyterlab/apputils';
import { CodeCell } from '@jupyterlab/cells';
import { IStdin, OutputArea, Stdin } from '@jupyterlab/outputarea';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';
import { PromiseDelegate } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';

import {
  A2uiInputError,
  encodeA2uiInputFailure,
  encodeA2uiInputResult,
} from '../vendor/a2ui-form/kernel.js';
import type { A2uiInputRequest } from '../vendor/a2ui-form/kernel.js';
import type { A2uiFormHandle } from '../vendor/a2ui-form/form.js';

export {
  A2UI_INPUT_MARKER,
  A2uiInputError,
  encodeA2uiInputFailure,
  parseA2uiInputRequest,
} from '../vendor/a2ui-form/kernel.js';
export type { A2uiInputRequest } from '../vendor/a2ui-form/kernel.js';

/**
 * Stdin widget for `jupyterlite-a2ui-input:v1:` requests. It renders the
 * request's A2UI messages inline and replies when the form raises one of the
 * requested submit or cancel actions.
 */
export class A2uiInput extends Widget implements IStdin {
  constructor(
    private readonly _cell: CodeCell,
    private readonly _output: OutputArea,
    private readonly _session: ISessionContext,
    private readonly _kernel: Kernel.IKernelConnection,
    private readonly _options: Stdin.IOptions,
    private readonly _request: A2uiInputRequest,
    private readonly _trans: TranslationBundle
  ) {
    super();
    this.addClass('jp-A2uiInput');
    this.node.setAttribute('role', 'group');
    this.node.setAttribute(
      'aria-label',
      _request.prompt || _trans.__('A2UI form input')
    );
    if (_request.prompt) {
      const prompt = document.createElement('p');
      prompt.textContent = _request.prompt;
      this.node.append(prompt);
    }
    this._status = document.createElement('p');
    this._status.setAttribute('role', 'status');
    this._status.textContent = _trans.__('Loading the form…');
    this._form = document.createElement('div');
    // OutputArea calls focus() on the first <input> of a stdin widget after the reply; a hidden one makes that a no-op.
    const sentinel = document.createElement('input');
    sentinel.type = 'hidden';
    this.node.append(sentinel, this._status, this._form);
    this.node.addEventListener('keydown', this._onKeyDown);
    _session.disposed.connect(this._onOwnerDisposed, this);
    _session.kernelChanged.connect(this._onKernelChanged, this);
    _kernel.statusChanged.connect(this._onStatusChanged, this);
    void _options.future.done.then(
      () => this._close(),
      (error) => {
        console.warn('A2UI input execution ended:', error);
        this._close();
      }
    );
    void this._mount();
  }

  get value(): Promise<string> {
    return this._value.promise;
  }

  dispose(): void {
    if (!this.isDisposed) {
      this._cancelOnDisposal();
    }
    super.dispose();
  }

  private async _mount(): Promise<void> {
    let handle: A2uiFormHandle;
    try {
      const { mountA2uiForm } = await import('../vendor/a2ui-form/form.js');
      if (this._settled) {
        return;
      }
      handle = mountA2uiForm(this._form, this._request.messages, {
        submit: this._request.submit,
        cancel: this._request.cancel,
      });
    } catch (error) {
      console.error('Could not load the A2UI form:', error);
      this._fail('render_failed');
      return;
    }
    this._handle = handle;
    this._status.textContent = '';
    this._status.hidden = true;
    let outcome: Awaited<A2uiFormHandle['result']>;
    try {
      outcome = await handle.result;
    } catch (error) {
      console.error('Could not render the A2UI form:', error);
      this._fail('render_failed');
      return;
    }
    if (outcome.status !== 'submitted') {
      this._cancel();
      return;
    }
    let value: string;
    try {
      value = encodeA2uiInputResult(outcome);
    } catch (error) {
      if (!(error instanceof A2uiInputError)) {
        throw error;
      }
      console.error('Could not encode the A2UI form data:', error);
      this._fail('invalid_state');
      return;
    }
    this._reply(value, this._trans.__('[A2UI input submitted]'));
  }

  private _isCurrent(): boolean {
    return (
      !this._session.isDisposed &&
      !this._output.isDisposed &&
      !this._kernel.isDisposed &&
      this._session.session?.kernel === this._kernel &&
      this._output.future === this._options.future &&
      !this._options.future.isDisposed
    );
  }

  private _cancel(): void {
    this._reply(
      encodeA2uiInputFailure(),
      this._trans.__('[A2UI input cancelled]')
    );
  }

  private _onKeyDown = (event: KeyboardEvent): void => {
    // Keep notebook command-mode shortcuts away from the form controls.
    event.stopPropagation();
    if (event.key === 'Escape' && this._request.cancel.length) {
      event.preventDefault();
      this._cancel();
    }
  };

  private _onOwnerDisposed(): void {
    this._cancelOnDisposal();
  }

  private _onKernelChanged(): void {
    this._close();
  }

  private _onStatusChanged(
    _kernel: Kernel.IKernelConnection,
    status: KernelMessage.Status
  ): void {
    if (
      status === 'restarting' ||
      status === 'dead' ||
      status === 'autorestarting'
    ) {
      this._close();
    }
  }

  private _fail(code: string): void {
    this._reply(
      encodeA2uiInputFailure(code),
      this._trans.__('[A2UI input failed]')
    );
  }

  private _reply(value: string, summary: string): void {
    if (this._settled) {
      return;
    }
    if (!this._isCurrent()) {
      this._close();
      return;
    }
    this._settled = true;
    this._cleanup();
    try {
      this._options.future.sendInputReply(
        { status: 'ok', value },
        this._options.parent_header
      );
      this._finish(summary);
    } catch (error) {
      console.error('Could not send A2UI input reply:', error);
      this._finish(this._trans.__('[A2UI input failed]'));
    }
  }

  /**
   * Resolve the stdin value so the output area echoes the summary. If the
   * output area now belongs to a newer future, stay pending: the echo would
   * otherwise land in that execution's output.
   */
  private _finish(summary: string): void {
    if (this._output.future !== this._options.future) {
      return;
    }
    if (this.node.contains(document.activeElement)) {
      this._cell.editor?.focus();
    }
    this._value.resolve(summary);
  }

  private _cancelOnDisposal(): void {
    if (
      !this._settled &&
      !this._kernel.isDisposed &&
      this._session.session?.kernel === this._kernel &&
      this._output.future === this._options.future &&
      !this._options.future.isDisposed
    ) {
      try {
        this._options.future.sendInputReply(
          { status: 'ok', value: encodeA2uiInputFailure() },
          this._options.parent_header
        );
      } catch (error) {
        console.error('Could not cancel A2UI input:', error);
      }
    }
    this._close();
  }

  private _close(): void {
    if (!this._settled) {
      this._settled = true;
      this._cleanup();
      this._finish(this._trans.__('[A2UI input closed]'));
    }
  }

  private _cleanup(): void {
    this._session.disposed.disconnect(this._onOwnerDisposed, this);
    this._session.kernelChanged.disconnect(this._onKernelChanged, this);
    this._kernel.statusChanged.disconnect(this._onStatusChanged, this);
    this.node.removeEventListener('keydown', this._onKeyDown);
    // The form's own outcome is ignored once settled; unmount it.
    this._handle?.dispose();
    this._handle = undefined;
  }

  private _value = new PromiseDelegate<string>();
  private _status: HTMLParagraphElement;
  private _form: HTMLDivElement;
  private _handle: A2uiFormHandle | undefined;
  private _settled = false;
}
