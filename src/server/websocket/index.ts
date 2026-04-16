import type { Server as HttpServer } from "http";
import { Server as IOServer } from "socket.io";
import { setIO } from "./io";

export function createSocketServer(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.on("join-room", (room: string) => {
      if (typeof room === "string" && room.length > 0) {
        socket.join(room);
      }
    });

    socket.on("leave-room", (room: string) => {
      if (typeof room === "string" && room.length > 0) {
        socket.leave(room);
      }
    });

    socket.on("ping", () => {
      socket.emit("pong", { ts: Date.now() });
    });
  });

  setIO(io);
  return io;
}
