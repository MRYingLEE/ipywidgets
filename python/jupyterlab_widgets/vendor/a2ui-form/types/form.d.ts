import { type JsonObject } from './protocol.js';
/** An action raised by a mounted form, with a snapshot of its data model. */
export interface A2uiFormAction {
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    context: JsonObject;
    data: JsonObject;
}
/** How a mounted form ended. */
export type A2uiFormOutcome = {
    status: 'submitted';
    action: string;
    context: JsonObject;
    data: JsonObject;
} | {
    status: 'cancelled';
    action?: string;
};
export interface MountA2uiFormOptions {
    /** Action names that end the form as submitted. */
    submit?: readonly string[];
    /** Action names that end the form as cancelled. */
    cancel?: readonly string[];
    /** Called for every action, including the ones that end the form. */
    onAction?: (action: A2uiFormAction) => void;
    /** Catalogs to render with. Defaults to the A2UI v1.0 basic catalog. */
    catalogs?: unknown[];
}
export interface A2uiFormHandle {
    /**
     * Settles when a submit or cancel action is raised, or `cancel()` is
     * called. Rejects with `A2uiInputError` if the messages cannot be rendered.
     */
    readonly result: Promise<A2uiFormOutcome>;
    /** Snapshot of the surface data model. */
    data(): JsonObject;
    /** End the form as cancelled, unless it has already ended. */
    cancel(): void;
    /** Unmount the form. Pending results are cancelled. */
    dispose(): void;
}
/**
 * Render one A2UI surface from `messages` into `element`. The messages must
 * create exactly one surface; it is the form whose data model is returned.
 */
export declare function mountA2uiForm(element: HTMLElement, messages: readonly unknown[], options?: MountA2uiFormOptions): A2uiFormHandle;
