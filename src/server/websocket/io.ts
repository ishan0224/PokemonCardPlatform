import type { Server as IOServer } from "socket.io";

let ioInstance: IOServer | null = null;

export function setIO(io: IOServer): void {
  ioInstance = io;
}

export function getIO(): IOServer {
  if (!ioInstance) {
    throw new Error("Socket.io server is not initialized.");
  }

  return ioInstance;
}
