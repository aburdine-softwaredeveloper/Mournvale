import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";
import { broadcastToRoom } from "./roomUtils";

type Player = {
  id: string;
  name: string;
  socket: WebSocket;
  roomId: string;
};

const players = new Map<WebSocket, Player>();

const server = new WebSocketServer({ port: 3000 });

server.on("connection", (socket: WebSocket) => {
  // 🧍 Create player session
  const player: Player = {
    id: randomUUID(),
    name: `Adventurer-${Math.floor(Math.random() * 9999)}`,
    socket,
    roomId: "tavern"
  };

  players.set(socket, player);

  // 👋 Welcome flow
  socket.send("Welcome to Mournvale.");
  socket.send(handleCommand(player.id, "look"));

  // 🌍 ENTER ROOM EVENT (correct place)
  broadcastToRoom(
    player.roomId,
    `👋 ${player.name} enters the room.`,
    player.id
  );

  // 💬 MESSAGE HANDLER (commands only)
  socket.on("message", (msg: RawData) => {
    const text = msg.toString().trim();

    const player = players.get(socket);

    if (!player) return;

    console.log(`[${player.name}]`, text);

    const response = handleCommand(player.id, text);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(response);
    }
  });

  // 🚪 DISCONNECT EVENT
  socket.on("close", () => {
    const player = players.get(socket);

    if (player) {
      broadcastToRoom(
        player.roomId,
        `🚪 ${player.name} leaves the room.`,
        player.id
      );
    }

    players.delete(socket);
  });
});

console.log("Mournvale running on ws://localhost:3000");