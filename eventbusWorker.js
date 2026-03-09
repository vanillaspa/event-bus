const listeners = new Map();

onconnect = function ({ ports }) {
    const port = ports[0];

    port.onmessage = ({ data }) => {
        const { action, type, detail } = data;
        switch (action) {
            case 'addEventListener':
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(port);
                break;
            case 'removeEventListener':
                listeners.get(type)?.delete(port);
                break;
            case 'dispatchEvent':
                listeners.get(type)?.forEach(p => {
                    if (p !== port) p.postMessage({ type, detail });
                });
                break;
        }
    };

    port.onmessageerror = () => {
        for (const ports of listeners.values()) {
            ports.delete(port);
        }
    };

    port.start();
} 