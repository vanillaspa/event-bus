/**
 * @fileoverview Shape validation for event contract detail objects.
 * @module validate
 */

/**
 * Supported type strings for field validation.
 * - `'string'`  — `typeof value === 'string'`
 * - `'number'`  — `typeof value === 'number'`
 * - `'boolean'` — `typeof value === 'boolean'`
 * - `'array'`   — `Array.isArray(value)`
 * - `'object'`  — plain object (explicitly excludes arrays)
 * - `'any'`     — any non-null, non-undefined value
 *
 * @typedef {'string'|'number'|'boolean'|'array'|'object'|'any'} FieldType
 */

/**
 * A schema mapping field names to their expected types.
 *
 * @typedef {Record<string, FieldType>} Schema
 */

/**
 * Validates an event detail object against a schema.
 *
 * Emits `console.warn` for each violation but never throws — a malformed
 * event is warned about and still dispatched. On the bridge side the caller
 * uses the return value to decide whether to call the handler or dispatch an
 * immediate error.
 *
 * @param {Schema} schema - Expected shape of the detail object.
 * @param {unknown} detail - The detail object received from the event.
 * @param {string} eventType - Full event type string, used in warning messages (e.g. `'sqlite:statement'`).
 * @returns {boolean} `true` if every field passes; `false` if any violation was found.
 *
 * @example
 * const ok = validate({ sql: 'string', name: 'string' }, event.detail, 'sqlite:query');
 * if (!ok) return; // skip handler
 */
export function validate(schema, detail, eventType) {
    if (detail == null || typeof detail !== 'object') {
        console.warn(`[event-contract] ${eventType}: detail must be a plain object, got ${detail === null ? 'null' : typeof detail}`);
        return false;
    }

    let valid = true;

    for (const [key, type] of Object.entries(schema)) {
        if (!(key in detail)) {
            console.warn(`[event-contract] ${eventType}: missing field "${key}"`);
            valid = false; continue;
        }

        const value = detail[key];

        if (value == null) {
            console.warn(`[event-contract] ${eventType}: "${key}" is ${value === null ? 'null' : 'undefined'}, expected ${type}`);
            valid = false; continue;
        }

        if (type === 'array') {
            if (!Array.isArray(value)) {
                console.warn(`[event-contract] ${eventType}: "${key}" expected array, got ${typeof value}`);
                valid = false;
            }
        } else if (type === 'object') {
            if (typeof value !== 'object' || Array.isArray(value)) {
                console.warn(`[event-contract] ${eventType}: "${key}" expected plain object, got ${Array.isArray(value) ? 'array' : typeof value}`);
                valid = false;
            }
        } else if (type !== 'any') {
            if (typeof value !== type) {
                console.warn(`[event-contract] ${eventType}: "${key}" expected ${type}, got ${typeof value}`);
                valid = false;
            }
        }
    }

    return valid;
}
