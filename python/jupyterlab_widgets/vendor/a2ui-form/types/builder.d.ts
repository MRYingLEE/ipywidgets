/**
 * A small form builder that turns a list of field specifications into one
 * A2UI v1.0 `createSurface` message for the basic catalog. The Python, R and
 * JavaScript kernel helpers implement the same mapping; the shared fixture in
 * `tests/fixtures/form-builder.json` pins it.
 */
import { type JsonObject, type JsonValue } from './protocol.js';
export declare const BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
export declare const FIELD_TYPES: readonly ["text", "longText", "password", "number", "checkbox", "choice", "multiChoice", "slider", "date", "time", "datetime"];
export type A2uiFieldType = (typeof FIELD_TYPES)[number];
export interface A2uiChoiceOption {
    label: string;
    value: string;
}
export interface A2uiFormField {
    name: string;
    type?: A2uiFieldType;
    label?: string;
    value?: JsonValue;
    placeholder?: string;
    options?: Array<string | A2uiChoiceOption>;
    min?: number;
    max?: number;
    steps?: number;
    required?: boolean;
}
export interface A2uiFormOptions {
    title?: string;
    surfaceId?: string;
    submitLabel?: string;
    /** Label of the cancel button; `null` leaves the button out. */
    cancelLabel?: string | null;
    submitAction?: string;
    cancelAction?: string;
}
export interface A2uiFormInputOptions extends A2uiFormOptions {
    /** Accessible label shown with the form. */
    prompt?: string;
}
/** Build an A2UI v1.0 message list for a simple form. */
export declare function a2uiForm(fields: readonly A2uiFormField[], options?: A2uiFormOptions): JsonObject[];
/**
 * Convert `number` fields, which A2UI text fields store as strings, to numbers.
 * Empty values become `null`; text that is not a number raises an error.
 */
export declare function coerceA2uiFormData(fields: readonly A2uiFormField[], data: JsonObject): JsonObject;
/** Build the marked stdin prompt that shows `a2uiForm(fields, options)`. */
export declare function createA2uiFormInputRequest(fields: readonly A2uiFormField[], options?: A2uiFormInputOptions): string;
/** Decode the reply to `createA2uiFormInputRequest` into coerced form data. */
export declare function decodeA2uiFormInputReply(fields: readonly A2uiFormField[], raw: string, options?: A2uiFormInputOptions): JsonObject;
