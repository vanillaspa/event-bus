export const name = "eventbus";
const channel = new BroadcastChannel();
const contextListeners = new WeakMap(); // context - Map<type, listener[]>

channel.onmessage = ({ data }) => {
    const { type, detail } = data;
    dispatchLocally(new CustomEvent(type, { detail }));
}

channel.onmessageerror = (e) => {
    console.error('eventbus deserialization error:', e);
}

function dispatchLocally(event, context = undefined) {
    if (!context) context = event instanceof CustomEvent ? event.detail?.target : event.target;

    if (context && contextListeners.has(context)) {
        const byType = contextListeners.get(context);
        byType.get(event.type)?.forEach(handler => handler(event));
    } else {
        if (typeof window !== 'undefined') window.dispatchEvent(event);
    }
}

export function addEventListener(type, listener, context = undefined) {
    if (context && typeof context === 'object') { // context is well defined, should be a WebComponent
        if (!contextListeners.has(context)) {
            contextListeners.set(context, new Map());
        }
        const byType = contextListeners.get(context);
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push(listener);
    } else {
        if (context) throw new Error("Syntax error: context must be an object.");
        if (typeof window !== 'undefined') window.addEventListener(type, listener);
    }
}

export function removeEventListener(type, listener, context = undefined) {
    if (context && typeof context === 'object') {
        const byType = contextListeners.get(context);
        if (!byType?.has(type)) return;
        const handlers = byType.get(type)
        const index = handlers.indexOf(listener);
        if (index > -1) handlers.splice(index, 1);
        if (handlers.length === 0) byType.delete(type);
    } else {
        if (typeof window !== 'undefined') window.removeEventListener(type, listener);
    }
}

export function dispatchEvent(event) {
    dispatchLocally(event, context);
    channel.postMessage({
        type: event.type,
        detail: event instanceof CustomEvent ? event.detail : {}
    });
}
