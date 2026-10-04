// Socket.IO connection with a typed promise-based RPC layer.

import { io, type Socket } from 'socket.io-client';
import type { InputCmd } from '../../../shared/physics';
import type {
  ClientToServerEvents,
  ErrorCode,
  RpcName,
  RpcParams,
  RpcResponse,
  RpcResult,
  ServerToClientEvents,
} from '../../../shared/protocol';
import { serverUrl } from './api';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
  }
}

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class Network {
  readonly socket: ClientSocket;
  private reqCounter = 0;
  /** Round trip time estimate in ms. */
  rtt = 80;

  constructor(token: string) {
    const url = serverUrl() || undefined;
    this.socket = io(url as string, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 15000,
    }) as ClientSocket;
  }

  on<E extends keyof ServerToClientEvents>(event: E, fn: ServerToClientEvents[E]): void {
    (this.socket.on as (e: string, f: unknown) => void)(event, fn);
  }

  async rpc<K extends RpcName>(method: K, params: RpcParams<K>, timeoutMs = 12_000): Promise<RpcResult<K>> {
    if (!this.socket.connected) throw new RpcError('Not connected to the server.', 'server_error');
    const id = `${Date.now().toString(36)}-${++this.reqCounter}`;
    const started = performance.now();
    const res = await new Promise<RpcResponse<K>>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'The server did not respond. Please try again.', code: 'server_error' }), timeoutMs);
      this.socket.emit('rpc', { id, method, params }, (r) => {
        clearTimeout(timer);
        resolve(r as RpcResponse<K>);
      });
    });
    this.rtt = this.rtt * 0.8 + (performance.now() - started) * 0.2;
    if (!res.ok) throw new RpcError(res.error, res.code);
    return res.result;
  }

  sendInputs(cmds: InputCmd[]): void {
    if (this.socket.connected && cmds.length > 0) this.socket.emit('input', cmds);
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
