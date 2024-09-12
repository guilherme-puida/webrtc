import { Application, Router } from "@oak/oak";

type Peer = {
  uid: string;
  ws: WebSocket;
};

type Room = {
  id: string;
  peers: Peer[];
};

const rooms = new Map<string, Room>();

function broadcast(roomId: string, message: string, excludeWs?: WebSocket) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const { ws } of room.peers) {
    if (ws !== excludeWs && ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

const app = new Application();
const router = new Router();

router.get("/ws", (ctx) => {
  const ws = ctx.upgrade();
  let roomId = "";
  let uid = "";

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "join") {
      roomId = data.roomId;
      uid = data.uid;

      const room = rooms.get(roomId) ?? { id: roomId, peers: [] };
      room.peers.push({ uid: data.uid, ws: ws });
      rooms.set(roomId, room);
      broadcast(
        roomId,
        JSON.stringify({ type: "new-peer", uid: data.uid }),
        ws
      );
    } else if (data.type === "chat-message") {
      broadcast(
        roomId,
        JSON.stringify({
          type: "chat-message",
          uid: data.uid,
          message: data.message,
        })
      );
    } else {
      broadcast(roomId, JSON.stringify({ ...data, uid: uid }), ws);
    }
  };

  ws.onclose = () => {
    if (!roomId || !uid) return;

    const room = rooms.get(roomId)!;

    if (!room || !room.peers) {
      console.log("cannot find room", roomId, uid);
    }

    room.peers = room.peers.filter((p) => p.ws !== ws);
    broadcast(roomId, JSON.stringify({ type: "peer-left", uid: uid }));
  };
});

app.use(router.routes());
app.use(router.allowedMethods());
app.use(async (ctx) => {
  await ctx.send({
    root: `${Deno.cwd()}/public/`,
    index: "index.html",
  });
});

await app.listen({
  port: 8000,
  secure: true,
  cert: Deno.readTextFileSync("./tls/cert.pem"),
  key: Deno.readTextFileSync("./tls/key.pem"),
});
