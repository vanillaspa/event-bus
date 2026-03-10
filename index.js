export const name = "eventbus";
const worker = new ServiceWorker(new URL('./eventbusWorker.js', import.meta.url), { type: 'module' });
worker.port.start();

const contextListeners = new WeakMap(); // WeakMap to store listeners per object. Keep it private unless you know what you do.

worker.port.onmessage = ({ data }) => {
    const { type, detail } = data;
    dispatchEvent(new CustomEvent(type, { detail }));
}

worker.port.onmessageerror = (e) => {
    console.error('eventbus deserialization error:', e);
}

export function addEventListener(type, listener, context = undefined) {
    if (context && typeof context === 'object') { // context is well defined, should be a WebComponent
        if (!contextListeners.has(context)) { // context is yet unknown to the listeners
            contextListeners.set(context, new Map()); // will be stored here
        }
        const byType = contextListeners.get(context);
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push(listener);
    } else {
        if (context) throw new Error("Syntax error: context must be an object.");
        window.addEventListener(type, listener);
    }

    worker.port.postMessage({ action: 'addEventListener', type });
}

export function removeEventListener(type, listener, context = undefined, options) {
    if (context && typeof context === 'object') {
        const byType = contextListeners.get(context);
        if (!byType?.has(type)) return;

        const handlers = byType.get(type)
        const index = handlers.indexOf(listener);
        if (index > -1) handlers.splice(index, 1);
        if (handlers.length === 0) {
            byType.delete(type);
            worker.port.postMessage({ action: 'removeEventListener', type });
        }
    } else {
        window.removeEventListener(type, listener);
        worker.port.postMessage({ action: 'removeEventListener', type });
    }
}

export function dispatchEvent(event) {
    const context = event instanceof CustomEvent ? event.detail?.target : event.target;
    if (context && contextListeners.has(context)) {
        const byType = contextListeners.get(context);
        byType.get(event.type)?.forEach(handler => handler(event));
    } else {
        if (typeof window !== 'undefined') window.dispatchEvent(event);
        worker.port.postMessage({
            action: 'dispatchEvent',
            type: event.type,
            detail: event instanceof CustomEvent ? event.detail : {}
        });
    }
}
