// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { CodeCell } from '@jupyterlab/cells';
import { IConsoleTracker, ConsolePanel } from '@jupyterlab/console';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IStdin, OutputArea, Stdin } from '@jupyterlab/outputarea';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle,
} from '@jupyterlab/translation';
import { PromiseDelegate } from '@lumino/coreutils';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';

import { DOMWidgetModel } from '@jupyter-widgets/base';

import { IWidgetManagerProvider } from './widget-manager-provider';
import {
  IWidgetInputRequest,
  WidgetInputProtocolError,
  encodeWidgetInputFailure,
  encodeWidgetInputState,
  parseWidgetInputRequest,
} from './widget-input-protocol';

type StdinHandler = (
  output: OutputArea,
  request: KernelMessage.IInputRequestMsg,
  options: Stdin.IOptions
) => IStdin | undefined;

type OutputAreaWithHandlers = typeof OutputArea & {
  registerStdinHandler(handler: StdinHandler): IDisposable;
};

function supportsHandlers(
  outputArea: typeof OutputArea
): outputArea is OutputAreaWithHandlers {
  return (
    'registerStdinHandler' in outputArea &&
    typeof outputArea.registerStdinHandler === 'function'
  );
}

function sessionContext(panel: NotebookPanel | ConsolePanel) {
  return 'console' in panel
    ? panel.console.sessionContext
    : panel.context.sessionContext;
}

/**
 * Register the widget-input handler when the host exposes the
 * composable stdin seam. Returns undefined on hosts without that seam.
 */
export function registerWidgetInput(
  tracker: INotebookTracker | null,
  consoleTracker: IConsoleTracker | null,
  provider: IWidgetManagerProvider,
  translator: ITranslator | null
): IDisposable | undefined {
  if (!supportsHandlers(OutputArea)) {
    return undefined;
  }
  const trans = (translator ?? nullTranslator).load('jupyterlab');
  const activeInputs = new Set<WidgetInput>();
  const registration = OutputArea.registerStdinHandler(
    (output, message, options) => {
      if (message.content.password) {
        return undefined;
      }

      let request: IWidgetInputRequest | undefined;
      try {
        request = parseWidgetInputRequest(message.content.prompt);
      } catch (error) {
        if (!(error instanceof WidgetInputProtocolError)) {
          throw error;
        }
        return new WidgetInputError(options, 'invalid_request', trans);
      }
      if (!request) {
        return undefined;
      }

      const owners: (NotebookPanel | ConsolePanel)[] = [];
      tracker?.forEach((panel) => {
        if (
          panel.content.widgets.some(
            (cell) => cell instanceof CodeCell && cell.outputArea === output
          )
        ) {
          owners.push(panel);
        }
      });
      consoleTracker?.forEach((panel) => {
        if (
          Array.from(panel.console.cells).some(
            (cell) => cell instanceof CodeCell && cell.outputArea === output
          )
        ) {
          owners.push(panel);
        }
      });
      const panel = owners.length === 1 ? owners[0] : undefined;
      const kernel = panel && sessionContext(panel).session?.kernel;
      const header = options.future.msg.header;
      if (
        !panel ||
        !kernel ||
        panel.isDisposed ||
        kernel.isDisposed ||
        output.future !== options.future ||
        header.msg_type !== 'execute_request' ||
        message.parent_header.msg_id !== header.msg_id ||
        message.parent_header.session !== header.session ||
        header.session !== kernel.clientId
      ) {
        return new WidgetInputError(options, 'owner_unavailable', trans);
      }
      const input = new WidgetInput(
        output,
        panel,
        kernel,
        options,
        provider,
        request,
        trans
      );
      activeInputs.add(input);
      input.disposed.connect(() => activeInputs.delete(input));
      return input;
    }
  );
  return new DisposableDelegate(() => {
    registration.dispose();
    for (const input of activeInputs) {
      input.dispose();
    }
    activeInputs.clear();
  });
}

class WidgetInputError extends Widget implements IStdin {
  constructor(options: Stdin.IOptions, code: string, trans: TranslationBundle) {
    super();
    this.node.textContent = trans.__('Widget input could not be started.');
    queueMicrotask(() => {
      try {
        options.future.sendInputReply(
          { status: 'ok', value: encodeWidgetInputFailure(code) },
          options.parent_header
        );
      } catch (error) {
        console.error('Could not send widget input error:', error);
      } finally {
        this._value.resolve(trans.__('[Widget input failed]'));
      }
    });
  }

  get value(): Promise<string> {
    return this._value.promise;
  }

  private _value = new PromiseDelegate<string>();
}

class WidgetInput extends Widget implements IStdin {
  constructor(
    private readonly _output: OutputArea,
    private readonly _panel: NotebookPanel | ConsolePanel,
    private readonly _kernel: Kernel.IKernelConnection,
    private readonly _options: Stdin.IOptions,
    private readonly _provider: IWidgetManagerProvider,
    private readonly _request: IWidgetInputRequest,
    private readonly _trans: TranslationBundle
  ) {
    super();
    this.addClass('jp-WidgetInput');
    this.node.setAttribute('role', 'group');
    this.node.setAttribute(
      'aria-label',
      _request.prompt || _trans.__('Widget input')
    );
    const prompt = document.createElement('p');
    prompt.textContent = _request.prompt;
    this._status = document.createElement('p');
    this._status.setAttribute('role', 'status');
    this._status.textContent = _trans.__('Waiting for the widget to appear…');
    this._submit = document.createElement('button');
    this._submit.type = 'button';
    this._submit.textContent = _trans.__('Submit');
    this._submit.disabled = true;
    this._cancel = document.createElement('button');
    this._cancel.type = 'button';
    this._cancel.textContent = _trans.__('Cancel');
    this.node.append(prompt, this._status, this._submit, this._cancel);
    this._submit.addEventListener('click', this._onSubmit);
    this._cancel.addEventListener('click', this._onCancel);
    this.node.addEventListener('keydown', this._onKeyDown);
    _panel.disposed.connect(this._onOwnerDisposed, this);
    sessionContext(_panel).kernelChanged.connect(this._onKernelChanged, this);
    _kernel.statusChanged.connect(this._onStatusChanged, this);
    void _options.future.done.then(
      () => this._close(),
      (error) => {
        console.warn('Widget input execution ended:', error);
        this._close();
      }
    );
    this._deadline = window.setTimeout(
      () => this._fail('model_unavailable'),
      10000
    );
    window.setTimeout(() => {
      if (!this.isDisposed && this.isAttached) {
        this._cancel.focus();
      }
    }, 0);
    void this._findModel();
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

  private _isCurrent(): boolean {
    const context = sessionContext(this._panel);
    return (
      !this._panel.isDisposed &&
      !this._output.isDisposed &&
      !this._kernel.isDisposed &&
      context.session?.kernel === this._kernel &&
      this._output.future === this._options.future &&
      !this._options.future.isDisposed
    );
  }

  private async _findModel(): Promise<void> {
    if (this._settled) {
      return;
    }
    if (!this._isCurrent()) {
      this._close();
      return;
    }
    try {
      const model = await this._provider.getDisplayedModel(
        this._panel,
        this._request.model_id
      );
      if (this._settled) {
        return;
      }
      if (!this._isCurrent()) {
        this._close();
      } else if (model) {
        this._model = model;
        window.clearTimeout(this._deadline);
        this._status.textContent = this._trans.__('Widget is ready.');
        this._submit.disabled = false;
        if (this.node.contains(document.activeElement)) {
          this._submit.focus();
        }
      } else {
        this._poll = window.setTimeout(() => void this._findModel(), 100);
      }
    } catch (error) {
      console.error('Could not find displayed widget:', error);
      this._fail('model_unavailable');
    }
  }

  private _onSubmit = (): void => {
    if (this._settled || this._submit.disabled) {
      return;
    }
    this._submit.disabled = true;
    this._deadline = window.setTimeout(
      () => this._fail('model_unavailable'),
      10000
    );
    void this._submitSnapshot();
  };

  private async _submitSnapshot(): Promise<void> {
    if (!this._isCurrent()) {
      this._close();
      return;
    }
    try {
      const model = await this._provider.getDisplayedModel(
        this._panel,
        this._request.model_id
      );
      if (this._settled) {
        return;
      }
      if (!this._isCurrent()) {
        this._close();
      } else if (!model || model !== this._model) {
        this._fail('model_unavailable');
      } else {
        const state: Record<string, unknown> = Object.create(null);
        for (const field of this._request.fields) {
          state[field] = model.get(field);
        }
        this._reply(
          encodeWidgetInputState(this._request.fields, state),
          this._trans.__('[Widget input submitted]')
        );
      }
    } catch (error) {
      console.error('Could not submit widget input:', error);
      this._fail(
        error instanceof WidgetInputProtocolError
          ? 'invalid_state'
          : 'model_unavailable'
      );
    }
  }

  private _onCancel = (): void => {
    this._reply(
      encodeWidgetInputFailure(),
      this._trans.__('[Widget input cancelled]')
    );
  };

  private _onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
      event.stopPropagation();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this._onCancel();
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
      encodeWidgetInputFailure(code),
      this._trans.__('[Widget input failed]')
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
      this._value.resolve(summary);
    } catch (error) {
      console.error('Could not send widget input reply:', error);
      this._value.resolve(this._trans.__('[Widget input failed]'));
    }
  }

  private _cancelOnDisposal(): void {
    if (
      !this._settled &&
      !this._kernel.isDisposed &&
      sessionContext(this._panel).session?.kernel === this._kernel &&
      this._output.future === this._options.future &&
      !this._options.future.isDisposed
    ) {
      try {
        this._options.future.sendInputReply(
          { status: 'ok', value: encodeWidgetInputFailure() },
          this._options.parent_header
        );
      } catch (error) {
        console.error('Could not cancel widget input:', error);
      }
    }
    this._close();
  }

  private _close(): void {
    if (!this._settled) {
      this._settled = true;
      this._cleanup();
      this._value.resolve(this._trans.__('[Widget input closed]'));
    }
  }

  private _cleanup(): void {
    window.clearTimeout(this._deadline);
    window.clearTimeout(this._poll);
    this._panel.disposed.disconnect(this._onOwnerDisposed, this);
    sessionContext(this._panel).kernelChanged.disconnect(
      this._onKernelChanged,
      this
    );
    this._kernel.statusChanged.disconnect(this._onStatusChanged, this);
    this._submit.removeEventListener('click', this._onSubmit);
    this._cancel.removeEventListener('click', this._onCancel);
    this.node.removeEventListener('keydown', this._onKeyDown);
    this._submit.disabled = true;
    this._cancel.disabled = true;
  }

  private _value = new PromiseDelegate<string>();
  private _status: HTMLParagraphElement;
  private _submit: HTMLButtonElement;
  private _cancel: HTMLButtonElement;
  private _model: DOMWidgetModel | undefined;
  private _deadline = 0;
  private _poll = 0;
  private _settled = false;
}
