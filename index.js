export const name = 'eventbus';

const contextListeners = new WeakMap(); // context -> Map<type, listener[]>
const typeIndex = new Map();            // type -> Set<WeakRef<context>>

export function addEventListener(type, listener, context) {
    if (!contextListeners.has(context)) { // first seen
        contextListeners.set(context, new Map());
    }
    const byType = contextListeners.get(context);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(listener);

    if (!typeIndex.has(type)) typeIndex.set(type, new Set());
    typeIndex.get(type).add(new WeakRef(context));
}

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

export function dispatchEvent(event, context = undefined) {
    if (!context) context = event instanceof CustomEvent ? event.detail?.target : event.target;

    if (context && contextListeners.has(context)) {
        const byType = contextListeners.get(context);
        byType.get(event.type)?.forEach(handler => handler(event));
    }

    const refs = typeIndex.get(event.type);
    if (refs) {
        for (const ref of refs) {
            const ctx = ref.deref();
            if (!ctx) { refs.delete(ref); continue; }
            contextListeners.get(ctx)?.get(event.type)?.forEach(handler => handler(event));
        }
    }
}
