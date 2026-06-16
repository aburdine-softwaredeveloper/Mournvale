import { WebSocket } from "ws";

export type Player = {

  id: string;
  name: string;
  socket: WebSocket;
  roomId: string;

};

export type Room = {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>;
};

export type Direction = "north" | "south" | "east" | "west";

export const rooms: Record<string, Room> = {
  tavern: {
    id: "tavern",
    name: "The Broken Lantern",
    description:
      "A dimly lit tavern filled with the smell of ale and wet wood.",
    exits: {
      north: "street"
    }
  },

  street: {
    id: "street",
    name: "Cobblestone Street",
    description:
      "A narrow street outside the tavern. Lanterns flicker in the fog.",
    exits: {
      south: "tavern"
    }
  }
};

export const players = new Map<WebSocket, Player>();

export function getPlayerById(playerId: string) {
  for (const player of players.values()) {
    if (player.id === playerId) return player;
  }
  return undefined;
}