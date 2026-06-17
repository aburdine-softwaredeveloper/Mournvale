import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";
import { broadcastToRoom } from "./roomUtils";
import { players, Player } from "./gameState";

type ServerMessage =
  | { type: "system"; message: string }
  | { type: "room"; name: string; description: string }
  | { type: "chat"; message: string };

function send(socket: WebSocket, data: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

const server = new WebSocketServer({ port: 3000 });

server.on("connection", (socket: WebSocket) => {
  const player: Player = {
    id: randomUUID(),
    name: `Adventurer-${Math.floor(Math.random() * 9999)}`,
    socket,
    roomId: "tavern"
  };

  players.set(socket, player);

  send(socket, {
    type: "system",
    message: "Welcome to Mournvale."
  });

  send(socket, {
    type: "room",
    name: "Mournvale",
    description: handleCommand(player.id, "look")
  });

  broadcastToRoom(
    player.roomId,
    `👋 ${player.name} enters the room.`,
    player.id
  );

  socket.on("message", (msg: RawData) => {
    const text = msg.toString().trim();
    const currentPlayer = players.get(socket);
    if (!currentPlayer) return;

    console.log(`[${currentPlayer.name}]`, text);

    const response = handleCommand(currentPlayer.id, text);

    send(socket, {
      type: "system",
      message: response
    });
  });

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