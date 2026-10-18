import { invokeHandler, type ApiTransport, type Handlers, type LbcEvents } from '@lbcwallet/services';

type Listener = (payload: unknown) => void;

/** Service events for the UI, delivered in-process. */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<E extends keyof LbcEvents>(event: E, payload: LbcEvents[E]): void {
    for (const l of this.listeners.get(event) ?? []) {
      try {
        // A copy, like the desktop app's IPC: the UI can never mutate service state.
        l(structuredClone(payload));
      } catch (err) {
        console.error(`[events] ${event} listener failed`, err);
      }
    }
  }
}

/**
 * Calls the service handlers directly (the desktop app goes through Electron
 * IPC instead). Results are copied, and each call waits until its changes are
 * saved, so the UI never reports success for data that is only in memory.
 */
export function inAppTransport(handlers: Handlers, bus: EventBus, options: { flush: () => Promise<void>; activity: () => void; log: (message: string) => void }): ApiTransport {
  return {
    invoke: async (channel, args) => {
      const result = await invokeHandler(handlers, channel, structuredClone(args), options.log);
      await options.flush();
      return structuredClone(result);
    },
    subscribe: (event, handler) => bus.on(event, handler),
    activity: () => options.activity(),
  };
}
