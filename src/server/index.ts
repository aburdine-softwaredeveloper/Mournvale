import { WebSocketServer, WebSocket, RawData } from "ws";

const server = new WebSocketServer({ port: 3000 });

server.on("connection", (socket: WebSocket) => {
  socket.send("Welcome to Mournvale.");

  socket.on("message", (msg: RawData) => {
    const text = msg.toString();
    console.log("Player:", text);

    server.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });
  });
});

console.log("Mournvale running on ws://localhost:3000");