import type { LineTransport, SocketEndpoint } from '@lbcwallet/core';
import type { LbcNativePlugin, SocketEvent } from './native';

interface Route {
  line(line: string): void;
  close(error?: Error): void;
}

/**
 * Newline-delimited sockets through the native plugin. One listener receives
 * every socket's events and routes them by id; events that arrive before the
 * JavaScript side knows the id are held briefly.
 */
export class NativeSockets {
  private routes = new Map<string, Route>();
  private early = new Map<string, SocketEvent[]>();
  private listening: Promise<unknown> | null = null;

  constructor(private readonly plugin: LbcNativePlugin) {}

  private listen(): Promise<unknown> {
    this.listening ??= this.plugin.addListener('socket', (e) => this.dispatch(e));
    return this.listening;
  }

  private dispatch(e: SocketEvent): void {
    const route = this.routes.get(e.id);
    if (!route) {
      const held = this.early.get(e.id) ?? [];
      if (held.length < 1000) held.push(e);
      this.early.set(e.id, held);
      return;
    }
    if (e.type === 'line' && e.line !== undefined) route.line(e.line);
    else if (e.type === 'close') route.close(e.error ? new Error(e.error) : undefined);
  }

  transport(endpoint: SocketEndpoint, timeoutMs: number): LineTransport {
    let id: string | null = null;
    let closed = false;
    let onLine: (line: string) => void = () => {};
    let onClose: (error?: Error) => void = () => {};
    const finish = (error?: Error) => {
      if (closed) return;
      closed = true;
      if (id) this.routes.delete(id);
      onClose(error);
    };
    return {
      connect: async () => {
        await this.listen();
        const r = await this.plugin.socketConnect({ host: endpoint.host, port: endpoint.port, tls: !!endpoint.tls, timeoutMs });
        id = r.id;
        this.routes.set(id, { line: (l) => !closed && onLine(l), close: finish });
        const held = this.early.get(id);
        this.early.delete(id);
        for (const e of held ?? []) this.dispatch(e);
      },
      send: (line) => {
        if (!id || closed) return;
        this.plugin.socketWrite({ id, data: `${line}\n` }).catch((err: unknown) => {
          finish(err instanceof Error ? err : new Error(String(err)));
        });
      },
      close: () => {
        if (!id || closed) return;
        const sid = id;
        closed = true;
        this.routes.delete(sid);
        void this.plugin.socketClose({ id: sid }).catch(() => undefined);
      },
      onLine: (h) => {
        onLine = h;
      },
      onClose: (h) => {
        onClose = h;
      },
    };
  }
}
