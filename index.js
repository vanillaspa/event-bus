/**
 * @fileoverview Memory-safe, context-scoped custom event bus.
 *
 * Listeners are keyed by a `context` value (typically a host `HTMLElement`).
 * When a context is garbage-collected its listeners are silently dropped —
 * no manual cleanup required for GC'd elements.
 *
 * **Auto-cleanup:** The first time a listener is registered for an
 * `HTMLElement` context, the bus attaches a native `component:disconnected`
 * listener directly on that element. When the web-components package fires
 * that event in `disconnectedCallback`, all event bus listeners for the
 * context are removed automatically. No manual cleanup needed.
 *
 * Exposed on `window.eventbus` (frozen) by `main.js` after import.
 *
 * @module event-bus
 */

/** @type {'eventbus'} */
export const name = 'eventbus';

/** @type {WeakMap<object, Map<string, Function[]>>} context → (type → listeners[]) */
const contextListeners = new WeakMap();

/** @type {WeakSet<object>} Tracks contexts that already have auto-cleanup registered. */
const autoCleanup = new WeakSet();

/** @type {Map<string, Set<WeakRef<object>>>} type → Set of weak refs to registered contexts */
const typeIndex = new Map();

/**
 * Register a listener for `type` events scoped to `context`.
 *
 * Multiple listeners for the same type on the same context are allowed and
 * fire in registration order. Re-registering the same context for a type it
 * already has listeners on is safe — the context's `WeakRef` is only added
 * once to `typeIndex`.
 *
 * @param {string} type - Event type string (e.g. `'sqlite:statement'`).
 * @param {function(Event): void} listener - Handler to invoke on dispatch.
 * @param {object} context - Scoping key, typically the component's host `HTMLElement`.
 */
export function addEventListener(type, listener, context) {
    if (!contextListeners.has(context)) { // first seen
        contextListeners.set(context, new Map());
        if (context instanceof HTMLElement && !autoCleanup.has(context)) {
            autoCleanup.add(context);
            context.addEventListener('component:disconnected', () => removeAllEventListeners(context), { once: true });
        }
    }
    const byType = contextListeners.get(context);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(listener);

    if (!typeIndex.has(type)) typeIndex.set(type, new Set());
    const refs = typeIndex.get(type);
    const alreadyRegistered = [...refs].some(ref => ref.deref() === context);
    if (!alreadyRegistered) refs.add(new WeakRef(context));
}

/**
 * Remove a previously registered listener.
 *
 * If removing the last listener for `type` on `context`, the context's
 * `WeakRef` is also pruned from `typeIndex`. No-ops silently if the
 * listener or context is not found.
 *
 * @param {string} type - Event type string.
 * @param {function(Event): void} listener - The exact listener reference to remove.
 * @param {object} context - The context the listener was registered under.
 */
export function removeEventListener(type, listener, context) {
    const byType = contextListeners.get(context);
    if (!byType?.has(type)) return;

    const handlers = byType.get(type);
    const index = handlers.indexOf(listener);
    if (index > -1) handlers.splice(index, 1);

    if (handlers.length === 0) {
        byType.delete(type);
        const refs = typeIndex.get(type);
        if (refs) {
            for (const ref of refs) {
                if (ref.deref() === context) {
                    refs.delete(ref);
                    break;
                }
            }
        }
    }
}

/**
 * Remove all listeners registered under `context`, across all event types.
 *
 * Call this in a component's `disconnectedCallback` to promptly release
 * all handlers without waiting for GC.
 *
 * @param {object} context - The context whose listeners should all be removed.
 */
export function removeAllEventListeners(context) {
    contextListeners.delete(context);
    for (const refs of typeIndex.values()) {
        for (const ref of refs) {
            if (ref.deref() === context) {
                refs.delete(ref);
                break;
            }
        }
    }
}

/**
 * Dispatch `event` to all matching listeners.
 *
 * **Routing:** If `context` is provided, only listeners registered under that
 * exact context receive the event. If `context` is omitted (or falsy), the bus
 * falls back to `event.detail?.target` (for `CustomEvent`) or `event.target` as
 * an implicit context. If that is also absent the event is delivered to **all**
 * registered listeners for its type (true broadcast).
 *
 * Dead `WeakRef`s encountered during dispatch are pruned on the fly.
 *
 * @param {Event|CustomEvent} event - The event to dispatch.
 * @param {object} [context] - Optional explicit routing context.
 */
export function dispatchEvent(event, context = undefined) {
    if (!context) context = event instanceof CustomEvent ? event.detail?.target : event.target;

    const refs = typeIndex.get(event.type);
    if (refs) {
        for (const ref of refs) {
            const ctx = ref.deref();
            if (!ctx) { refs.delete(ref); continue; }
            if (context && ctx !== context) continue;
            contextListeners.get(ctx)?.get(event.type)?.forEach(handler => handler(event));
        }
    }
}
