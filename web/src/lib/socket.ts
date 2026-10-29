import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, DeviceInfo, ServerToClientEvents } from '@tsds/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function connectSocket(token: string, device?: DeviceInfo): AppSocket {
  socket?.disconnect();
  socket = io(window.location.origin, {
    auth: { token, device },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
