const roomName = document.getElementById("room-name")!;
const roomDescription = document.getElementById("room-description")!;
const messageLog = document.getElementById("message-log")!;
const commandInput = document.getElementById(
    "command-input"
) as HTMLInputElement;

const socket = new WebSocket("ws://localhost:3000");

socket.addEventListener("open", () => {
    addMessage("Connected to Mournvale.", "system");
});

socket.addEventListener("close", () => {
    addMessage("Disconnected from server.", "error");
});

socket.addEventListener("message", (event) => {
    handleServerMessage(event.data);
});

commandInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;

    const command = commandInput.value.trim();

    if (!command) return;

    socket.send(command);

    commandInput.value = "";
});

function addMessage(
    text: string,
    cssClass: string = "message"
) {
    const div = document.createElement("div");

    div.className = `message ${cssClass}`;
    div.textContent = text;

    messageLog.appendChild(div);

    messageLog.scrollTop = messageLog.scrollHeight;
}

function handleServerMessage(raw: string) {
    const msg = JSON.parse(raw);

    switch (msg.type) {
        case "system":
            addMessage(msg.message, "system");
            break;

        case "room":
            roomName.textContent = msg.name;
            roomDescription.textContent = msg.description;
            break;
    }
}