import { players } from "./gameState";
import { WebSocket } from "ws";

export function getPlayersInRoom(roomId: string) {
  return Object.values(players).filter(
    (player) => player.roomId === roomId
  );
}

export function broadcastToRoom(

  roomId: string,

  message: string,

  excludePlayerId?: string

) {

  const roomPlayers = getPlayersInRoom(roomId);

  roomPlayers.forEach((player) => {

    if (player.id === excludePlayerId) return;

    const socket = (player as any).socket as WebSocket;

    if (socket?.readyState === WebSocket.OPEN) {

      socket.send(message);

    }

  });

}