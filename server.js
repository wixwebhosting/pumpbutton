const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map(); // clientId -> { ws, username, ip, roomId }
const rooms = new Map(); // roomId -> { id, topic, hostId, hostName, hostIp, createdAt, participants:Set }

const sendJson = (ws, payload) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const sendToClient = (clientId, payload) => {
  const client = clients.get(clientId);
  if (client) {
    sendJson(client.ws, payload);
  }
};

const broadcastRooms = () => {
  const payload = {
    type: 'rooms',
    rooms: Array.from(rooms.values()).map((room) => ({
      id: room.id,
      topic: room.topic,
      host: room.hostName,
      hostId: room.hostId,
      population: room.participants.size,
      createdAt: room.createdAt
    }))
  };

  const data = JSON.stringify(payload);
  for (const { ws } of clients.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
};

const extractIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const raw = req.socket.remoteAddress || '';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};

const removeClientFromRoom = (clientId) => {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    return;
  }

  room.participants.delete(clientId);
  client.roomId = null;

  if (room.hostId === clientId) {
    for (const participantId of room.participants) {
      const participant = clients.get(participantId);
      if (participant) {
        participant.roomId = null;
        sendToClient(participantId, {
          type: 'room-ended',
          roomId: room.id,
          reason: 'host-left'
        });
      }
    }
    rooms.delete(room.id);
  } else {
    for (const participantId of room.participants) {
      sendToClient(participantId, {
        type: 'participant-left',
        roomId: room.id,
        participantId: clientId
      });
    }
    if (room.participants.size === 0) {
      rooms.delete(room.id);
    }
  }

  broadcastRooms();
};

const handleDisconnect = (clientId) => {
  removeClientFromRoom(clientId);
  clients.delete(clientId);
  broadcastRooms();
};

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  const ip = extractIp(req);

  clients.set(clientId, {
    ws,
    ip,
    username: null,
    roomId: null
  });

  sendJson(ws, { type: 'hello', clientId });
  broadcastRooms();

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    const client = clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'register': {
        const name = (message.username || '').trim();
        client.username = name || `anon-${clientId.slice(0, 4)}`;
        sendJson(ws, { type: 'registered', username: client.username });
        break;
      }
      case 'request-rooms': {
        sendJson(ws, {
          type: 'rooms',
          rooms: Array.from(rooms.values()).map((room) => ({
            id: room.id,
            topic: room.topic,
            host: room.hostName,
            hostId: room.hostId,
            population: room.participants.size,
            createdAt: room.createdAt
          }))
        });
        break;
      }
      case 'create-room': {
        if (client.roomId) {
          sendJson(ws, { type: 'error', message: 'You are already inside a trench.' });
          break;
        }

        const existingForIp = Array.from(rooms.values()).some((room) => room.hostIp === client.ip);
        if (existingForIp) {
          sendJson(ws, { type: 'error', message: 'This IP is already holding a trench.' });
          break;
        }

        const topic = (message.topic || 'Unnamed Trench').slice(0, 60);
        const roomId = uuidv4();
        const room = {
          id: roomId,
          topic,
          hostId: clientId,
          hostName: client.username || 'Unknown Commander',
          hostIp: client.ip,
          createdAt: Date.now(),
          participants: new Set([clientId])
        };

        rooms.set(roomId, room);
        client.roomId = roomId;

        sendJson(ws, {
          type: 'room-created',
          roomId,
          topic,
          hostId: clientId
        });
        broadcastRooms();
        break;
      }
      case 'join-room': {
        if (client.roomId) {
          sendJson(ws, { type: 'error', message: 'Leave your current trench first.' });
          break;
        }

        const room = rooms.get(message.roomId);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'That trench collapsed.' });
          break;
        }

        client.roomId = room.id;
        room.participants.add(clientId);

        const otherParticipants = Array.from(room.participants).filter((id) => id !== clientId);
        sendJson(ws, {
          type: 'joined-room',
          roomId: room.id,
          hostId: room.hostId,
          participants: otherParticipants.map((id) => ({
            clientId: id,
            username: clients.get(id)?.username || 'Ghost'
          }))
        });

        for (const participantId of otherParticipants) {
          sendToClient(participantId, {
            type: 'participant-joined',
            roomId: room.id,
            participantId: clientId,
            username: client.username || 'Anon'
          });
        }

        broadcastRooms();
        break;
      }
      case 'leave-room': {
        removeClientFromRoom(clientId);
        break;
      }
      case 'close-room': {
        const room = rooms.get(client.roomId);
        if (!room || room.hostId !== clientId) {
          sendJson(ws, { type: 'error', message: 'You are not hosting a trench.' });
          break;
        }
        removeClientFromRoom(clientId);
        break;
      }
      case 'signal': {
        const { targetId, data } = message;
        const target = clients.get(targetId);
        if (!target) break;
        if (target.roomId !== client.roomId || !client.roomId) break;
        sendToClient(targetId, {
          type: 'signal',
          from: clientId,
          data,
          roomId: client.roomId
        });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => handleDisconnect(clientId));
  ws.on('error', () => handleDisconnect(clientId));
});

server.listen(PORT, () => {
  console.log(`Trench server running on http://localhost:${PORT}`);
});
