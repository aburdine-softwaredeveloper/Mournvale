import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";
import { broadcastToRoom } from "./roomUtils";
import { players, Player } from "./gameState";

const server = new WebSocketServer({ port: 3000 });

server.on("connection", (socket: WebSocket) => {
  // 🧍 Create player (runtime object)
  const player: Player = {
    id: randomUUID(),
    name: `Adventurer-${Math.floor(Math.random() * 9999)}`,
    socket, // ✅ REQUIRED (you were missing this earlier)
    roomId: "tavern"
  };

  // store in global state (single source of truth)
  players.set(socket, player);

  // 👋 Welcome flow
  socket.send("Welcome to Mournvale.");

  // initial room description
  socket.send(handleCommand(player.id, "look"));

  // 🌍 enter room broadcast
  broadcastToRoom(
    player.roomId,
    `👋 ${player.name} enters the room.`,
    player.id
  );

  // 💬 message handler (commands only)
  socket.on("message", (msg: RawData) => {
    const text = msg.toString().trim();

    // ⚠️ IMPORTANT: DO NOT shadow outer `player`
    const currentPlayer = players.get(socket);

    if (!currentPlayer) return;

    console.log(`[${currentPlayer.name}]`, text);

    const response = handleCommand(currentPlayer.id, text);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(response);
    }
  });

  // 🚪 disconnect handler
  socket.on("close", () => {
    const currentPlayer = players.get(socket);

    if (currentPlayer) {
      broadcastToRoom(
        currentPlayer.roomId,
        `🚪 ${currentPlayer.name} leaves the room.`,
        currentPlayer.id
      );

      players.delete(socket);
    }
  });
});

console.log("Mournvale running on ws://localhost:3000");