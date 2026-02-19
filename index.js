export const name = "eventbus"; // The module name, can be made globally available via the window object, which should be on top.
const listeners = new WeakMap(); // WeakMap to store listeners per object. Keep it private unless you know what you do.
// Should auto-cleanup listeners when object is GC'd
// This module implements EventTarget.
export function addEventListener(type, listener, context = undefined) { // (TODO check integration into options)
    if (context && typeof context === 'object') { // context is well defined, should be a WebComponent
        if (!listeners.has(context)) { // context is yet unknown to the listeners
            listeners.set(context, new Map()); // will be stored here
        }
        const contextListeners = listeners.get(context);
        if (!contextListeners.has(type)) { // type is not yet registered
            contextListeners.set(type, []);
        } // next push the handler to the WeakMap for the given context
        contextListeners.get(type).push(listener);
    } else { // default
        if (context) { // illegal context
            throw new Error("Syntax error.");
        }
        window.addEventListener(type, listener);
    }
}

export function removeEventListener(type, listener, context = undefined) {
    if (context && typeof context === 'object') {
        const contextListeners = listeners.get(context);
        if (contextListeners && contextListeners.has(type)) {
            const handlers = contextListeners.get(type);
            const index = handlers.indexOf(listener);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    } else { // default
        window.removeEventListener(type);
    }
}

export function dispatchEvent(event, context = undefined) {
    if (!context) {
        if (event instanceof CustomEvent) {
            context = event.detail.target;
        } else {
            context = event.target;
        }
    }
    if (context && listeners.has(context)) {
        const contextListeners = listeners.get(context);
        if (contextListeners.has(event.type)) { // Call context-specific listeners
            contextListeners.get(event.type).forEach(handler => handler(event));
        }
    } else { // default
        window.dispatchEvent(event);
    }
}
