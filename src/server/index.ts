import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";

type Player = {
  id: string;
  name: string;
  socket: WebSocket;
  roomId: string;
};

const players = new Map<WebSocket, Player>();

const server = new WebSocketServer({ port: 3000 });

server.on("connection", (socket: WebSocket) => {
  const player: Player = {
    id: randomUUID(),
    name: `Adventurer-${Math.floor(Math.random() * 9999)}`,
    socket,
    roomId: "tavern"
  };

  players.set(socket, player);

  socket.send("Welcome to Mournvale.");

  // Optional: initial look (now handled via command system)
  socket.send(handleCommand(player.id, "look"));

  socket.on("message", (msg: RawData) => {
    const text = msg.toString().trim();
    const player = players.get(socket);

    if (!player) return;

    console.log(`[${player.name}]`, text);

    // 👉 ALL logic delegated to command system
    const response = handleCommand(player.id, text);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(response);
    }
  });

  socket.on("close", () => {
    players.delete(socket);
  });
});

console.log("Mournvale running on ws://localhost:3000");