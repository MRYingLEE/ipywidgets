/**
 * The A2UI input protocol (v1): a kernel sends A2UI v1.0 messages through a
 * Jupyter stdin request, and the frontend replies with the action that ended
 * the form and the surface data model. This module has no dependencies so it
 * can be copied into kernels that cannot import the rendering bundle.
 */
export declare const A2UI_INPUT_MARKER = "jupyterlite-a2ui-input:v1:";
export declare const A2UI_INPUT_LIMITS: Readonly<{
    requestBytes: 262144;
    replyBytes: 65536;
    messages: 256;
    actions: 16;
    requestDepth: 32;
    replyDepth: 16;
}>;
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
/** A validated A2UI input request. */
export interface A2uiInputRequest {
    messages: JsonObject[];
    prompt: string;
    submit: string[];
    cancel: string[];
}
export interface A2uiInputRequestOptions {
    /** Accessible label shown with the form. */
    prompt?: string;
    /** Action names that submit the form. Defaults to `['submit']`. */
    submit?: readonly string[];
    /** Action names that cancel the form. Defaults to `['cancel']`. */
    cancel?: readonly string[];
}
/** The submitted form: the ending action and the surface data model. */
export interface A2uiInputResult {
    action: string;
    context: JsonObject;
    data: JsonObject;
}
/** An A2UI input request or reply was invalid or could not be completed. */
export declare class A2uiInputError extends Error {
    constructor(message: string);
}
/** The user cancelled the A2UI input form. */
export declare class A2uiInputCancelled extends A2uiInputError {
    constructor(message?: string);
}
export declare function utf8Size(value: string): number;
/**
 * Copy a value as plain JSON. Object properties that are `undefined` are
 * dropped, as `JSON.stringify` would; anything else that JSON cannot
 * represent exactly is rejected.
 */
export declare function copyJson(value: unknown, maxDepth: number, depth?: number): JsonValue;
/** Build a marked request for the frontend (kernel side). */
export declare function createA2uiInputRequest(messages: readonly unknown[], options?: A2uiInputRequestOptions): string;
/**
 * Parse a marked request (frontend side). Unmarked prompts return undefined
 * so normal stdin can handle them; marked but malformed prompts throw.
 */
export declare function parseA2uiInputRequest(prompt: string): A2uiInputRequest | undefined;
/** Serialize a submitted form (frontend side). */
export declare function encodeA2uiInputResult(result: A2uiInputResult): string;
/** Serialize a cancellation or a bounded, machine-readable error. */
export declare function encodeA2uiInputFailure(code?: string): string;
/**
 * Decode a reply (kernel side). Throws `A2uiInputCancelled` on cancellation
 * and `A2uiInputError` on errors or when the action is not a submit action.
 */
export declare function decodeA2uiInputReply(raw: string, submit: readonly string[]): A2uiInputResult;
