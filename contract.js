/**
 * @fileoverview General event contract mechanism for the Vanilla SPA event bus.
 *
 * Provides a typed request/response layer over the custom event bus, eliminating
 * boilerplate for each new event namespace. Handles bridge-side listener
 * registration and consumer-side Promise-based request/response pairing via the
 * 4-fold event naming convention.
 *
 * @module event-bus/contract
 */

import { validate } from './validate.js';

/**
 * A single event definition within a contract spec.
 *
 * @typedef {object} EventDef
 * @property {import('./validate.js').Schema} detail - Expected shape of the request detail.
 * @property {string} past - Past-tense event name for the success response
 *   (e.g. `'created'`, `'executed'`). Used as field 2 of the 4-fold response type:
 *   `{namespace}:{past}:{ts}:{hostId}`.
 */

/**
 * The spec passed to {@link defineContract}.
 *
 * @typedef {object} ContractSpec
 * @property {string} namespace - Event namespace prefix (e.g. `'sqlite'`, `'auth'`).
 * @property {Record<string, EventDef>} events - Map of action names to their definitions.
 */

/**
 * Bridge handle returned by {@link BridgeHandle#handle}.
 *
 * @typedef {object} BridgeHandle
 * @property {function(string, function): void} handle - Register a handler for one action.
 */

/**
 * Consumer handle returned by {@link ConsumerHandle#request}.
 *
 * @typedef {object} ConsumerHandle
 * @property {function(string, object): Promise<any>} request - Dispatch a request and await its response.
 */

/**
 * The frozen contract object returned by {@link defineContract}.
 *
 * @typedef {object} Contract
 * @property {function(HTMLElement): BridgeHandle} createBridge - Create a bridge handle for the given host element.
 * @property {function(HTMLElement): ConsumerHandle} createConsumer - Create a consumer handle for the given host element.
 */

/**
 * Define a typed event contract for a given namespace.
 *
 * Returns a frozen `{ createBridge, createConsumer }` object. Typically exposed
 * on `window` via `Object.defineProperty` with `writable: false` after the
 * event bus is ready (see example below).
 *
 * **4-fold naming convention:**
 * ```
 * {namespace}:{action}                          ← request           (2-fold, broadcast)
 * {namespace}:{past}:{timestamp}:{hostId}       ← response success  (4-fold)
 * {namespace}:error:{timestamp}:{hostId}        ← response error    (4-fold, correlated)
 * {namespace}:error                             ← monitoring hook   (2-fold, broadcast)
 * ```
 *
 * **Reserved `detail` fields** — must not appear in any user-defined schema:
 * - `_ts` — injected by `createConsumer` as the pre-dispatch `performance.now()` timestamp
 * - `_hostId` — injected by `createConsumer` as the consumer's `host.dataset.id`
 * - `target` — read by the event bus as an implicit routing context; including it
 *   would silently prevent bridge delivery
 *
 * @param {{ addEventListener: function, removeEventListener: function, dispatchEvent: function }} eventbus
 *   Injected event bus. Must expose `addEventListener`, `removeEventListener`, and `dispatchEvent`.
 *   Injected rather than read from `window` so the contract is portable and independently testable.
 * @param {ContractSpec} spec - Namespace and event definitions.
 * @returns {Readonly<Contract>} Frozen contract object.
 *
 * @example
 * // src/contracts/sqlite-contract.js — dynamically imported after window.eventbus is ready
 * import { defineContract } from '@vanillaspa/event-bus/contract';
 *
 * export const SqliteContract = defineContract(window.eventbus, {
 *     namespace: 'sqlite',
 *     events: {
 *         create: { detail: { name: 'string' }, past: 'created' },
 *     }
 * });
 *
 * @example
 * // src/main.js — expose on window after dynamic import
 * const { SqliteContract } = await import('./contracts/sqlite-contract.js');
 * Object.defineProperty(window, 'SqliteContract', {
 *     value: SqliteContract,   // already frozen by defineContract
 *     writable: false,
 *     configurable: false
 * });
 */
export function defineContract(eventbus, spec) {
    const { namespace, events } = spec;

    /**
     * Assert that `host` is a connected `HTMLElement` with `dataset.id` set.
     * Throws if called before `connectedCallback`.
     *
     * @param {HTMLElement} host
     * @throws {Error} If `host` is not an `HTMLElement` or `host.dataset.id` is absent.
     */
    function assertHost(host) {
        if (!(host instanceof HTMLElement)) throw new Error(`[event-contract] host must be an HTMLElement`);
        if (!host.dataset.id) throw new Error(`[event-contract] host.dataset.id is absent — call createBridge/createConsumer after connectedCallback`);
    }

    /**
     * Create a bridge handle for the given host element.
     *
     * The bridge listens for request events on its own host context and dispatches
     * correlated 4-fold response or error events as true broadcasts (no context
     * argument), so only the originating consumer's pre-registered listener fires.
     *
     * @param {HTMLElement} host - The bridge component's host element. Must have `dataset.id` set.
     * @returns {Readonly<BridgeHandle>} Frozen bridge handle.
     * @throws {Error} If `host` is not a connected `HTMLElement`.
     */
    function createBridge(host) {
        assertHost(host);

        /**
         * Register an async handler for one action.
         *
         * The handler receives a copy of `event.detail` with `_ts` and `_hostId`
         * stripped — those fields are internal routing fields and must not reach
         * application logic. On success, dispatches
         * `{namespace}:{past}:{_ts}:{_hostId}` as a broadcast. On failure (thrown
         * error or validation failure), dispatches both the correlated 4-fold error
         * `{namespace}:error:{_ts}:{_hostId}` and the 2-fold monitoring broadcast
         * `{namespace}:error`. The 4-fold error is guaranteed to fire first.
         *
         * @param {string} action - Action name matching a key in `spec.events`.
         * @param {function(object): Promise<any>} fn
         *   Handler called with the validated detail object (minus `_ts`/`_hostId`).
         *   Its resolved value becomes `event.detail.result` in the success response.
         * @throws {Error} If `action` is not defined in the spec.
         */
        function handle(action, fn) {
            const eventDef = events[action];
            if (!eventDef) throw new Error(`[event-contract] unknown action "${action}" in namespace "${namespace}"`);

            const requestType = `${namespace}:${action}`;

            eventbus.addEventListener(requestType, async (event) => {
                const { _ts, _hostId, ...detail } = event.detail ?? {};

                if (!_ts || !_hostId) {
                    console.warn(`[event-contract] ${requestType}: missing _ts or _hostId — was this dispatched via createConsumer?`);
                    return;
                }

                const successType = `${namespace}:${eventDef.past}:${_ts}:${_hostId}`;
                const errorType   = `${namespace}:error:${_ts}:${_hostId}`;
                const monitorType = `${namespace}:error`;

                const isValid = validate(eventDef.detail, detail, requestType);
                if (!isValid) {
                    eventbus.dispatchEvent(new CustomEvent(errorType,   { detail: { error: 'Validation failed — see console warnings', action, eventType: requestType } }));
                    eventbus.dispatchEvent(new CustomEvent(monitorType, { detail: { error: 'Validation failed — see console warnings', action, eventType: requestType } }));
                    return;
                }

                try {
                    const result = await fn(detail);
                    eventbus.dispatchEvent(new CustomEvent(successType, { detail: { result } }));
                } catch (err) {
                    eventbus.dispatchEvent(new CustomEvent(errorType,   { detail: { error: err.message, action, eventType: requestType } }));
                    eventbus.dispatchEvent(new CustomEvent(monitorType, { detail: { error: err.message, action, eventType: requestType } }));
                }
            }, host);
        }

        return Object.freeze({ handle });
    }

    /**
     * Create a consumer handle for the given host element.
     *
     * The consumer injects `_ts` (`performance.now()` sampled before dispatch) and
     * `_hostId` (`host.dataset.id`) into the request detail so the bridge can echo
     * them back in the 4-fold response event name. Listeners are registered before
     * dispatch, which is safe because bridge handlers are `async` — they suspend at
     * their first `await`, so the response always arrives after `dispatchEvent` returns.
     *
     * @param {HTMLElement} host - The consumer component's host element. Must have `dataset.id` set.
     * @returns {Readonly<ConsumerHandle>} Frozen consumer handle.
     * @throws {Error} If `host` is not a connected `HTMLElement`.
     */
    function createConsumer(host) {
        assertHost(host);

        /**
         * Dispatch a request and return a Promise that settles with the response.
         *
         * Validates `detail` against the spec schema (warnings only — does not throw
         * on the consumer side). Resolves with `event.detail.result` on success;
         * rejects with an `Error` containing the bridge's error message on failure.
         * Cleans up both response listeners on settle.
         *
         * **No timeout is defined.** If the bridge never responds the Promise hangs
         * indefinitely — callers are responsible for applying their own timeout.
         *
         * @param {string} action - Action name matching a key in `spec.events`.
         * @param {object} detail - Request detail (must satisfy the schema declared in the spec).
         * @returns {Promise<any>} Resolves with the result returned by the bridge handler.
         * @throws {Error} If `action` is not defined in the spec (synchronous throw, before the Promise).
         *
         * @example
         * const consumer = SqliteContract.createConsumer(shadowDocument.host);
         * const rows = await consumer.request('statement', { sql: 'SELECT * FROM items WHERE id=$1', values: [id], name: 'mydb' });
         */
        function request(action, detail) {
            const eventDef = events[action];
            if (!eventDef) throw new Error(`[event-contract] unknown action "${action}" in namespace "${namespace}"`);

            validate(eventDef.detail, detail, `${namespace}:${action}`);

            const hostId      = host.dataset.id;
            const ts          = performance.now();
            const successType = `${namespace}:${eventDef.past}:${ts}:${hostId}`;
            const errorType   = `${namespace}:error:${ts}:${hostId}`;

            return new Promise((resolve, reject) => {
                function onSuccess(e) {
                    cleanup();
                    resolve(e.detail.result);
                }
                function onError(e) {
                    cleanup();
                    reject(new Error(e.detail.error));
                }
                function cleanup() {
                    eventbus.removeEventListener(successType, onSuccess, host);
                    eventbus.removeEventListener(errorType,   onError,   host);
                }

                // Register before dispatch — bridge handler is async so response
                // always arrives after dispatchEvent returns.
                eventbus.addEventListener(successType, onSuccess, host);
                eventbus.addEventListener(errorType,   onError,   host);

                eventbus.dispatchEvent(
                    new CustomEvent(`${namespace}:${action}`, {
                        detail: { ...detail, _ts: ts, _hostId: hostId }
                    })
                    // no context argument → true broadcast; no detail.target → no implicit routing
                );
            });
        }

        return Object.freeze({ request });
    }

    return Object.freeze({ createBridge, createConsumer });
}
