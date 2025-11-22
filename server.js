const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;
const app = express();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1441821231270596638';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'Pa4RER_9j8Chiae-AW2VoDMFO-QrJCn_';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://trenchvc-production.up.railway.app/discord/callback';
const DISCORD_SCOPE = 'identify';
const DISCORD_STATE_TTL = 1000 * 60 * 5;
const SESSION_TTL = 1000 * 60 * 60 * 24;

const discordStates = new Map();
const sessionStore = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me', (req, res) => {
  const session = getSessionFromRequest(req);
  res.json({ discord: session?.discord || null });
});

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(500).send('Discord auth is not configured.');
  }
  cleanupDiscordStates();
  const state = uuidv4();
  discordStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: DISCORD_SCOPE,
    state
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/discord/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return res.status(400).send(errorDescription || 'Discord authorization failed.');
  }
  if (!code || !state) {
    return res.status(400).send('Missing authorization details.');
  }

  cleanupDiscordStates();
  if (!discordStates.has(state)) {
    return res.status(400).send('Authorization state expired.');
  }
  discordStates.delete(state);

  try {
    const tokenPayload = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI
    }).toString();

    const tokenResponse = await requestJson('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenPayload)
      },
      body: tokenPayload
    });

    if (tokenResponse.status >= 400 || !tokenResponse.body?.access_token) {
      return res.status(400).send('Failed to exchange Discord token.');
    }

    const { access_token: accessToken, token_type: tokenType } = tokenResponse.body;
    const profileResponse = await requestJson('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `${tokenType || 'Bearer'} ${accessToken}`
      }
    });

    if (profileResponse.status >= 400 || !profileResponse.body?.id) {
      return res.status(400).send('Failed to fetch Discord profile.');
    }

    const sessionId = uuidv4();
    const discordProfile = {
      id: profileResponse.body.id,
      username: profileResponse.body.username,
      discriminator: profileResponse.body.discriminator,
      global_name: profileResponse.body.global_name
    };
    sessionStore.set(sessionId, {
      discord: discordProfile,
      createdAt: Date.now()
    });
    setSessionCookie(res, sessionId);
    res.redirect('/');
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.status(500).send('Discord authentication failed.');
  }
});

app.use((req, res, next) => {
  req.session = getSessionFromRequest(req);
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map(); // clientId -> { ws, username, ip, roomId, joinedAt, totalVcMs, discord }
const rooms = new Map(); // roomId -> { id, topic, hostId, hostName, hostIp, createdAt, participants: Map<id, meta> }

const buildParticipantSnapshot = (room, participantId) => {
  const meta = room.participants.get(participantId);
  const participant = clients.get(participantId);
  if (!meta || !participant) return null;
  return {
    clientId: participantId,
    username: participant.username || 'Ghost',
    role: meta.role,
    muted: !!meta.muted,
    deafened: !!meta.deafened,
    vcSeconds: Math.floor(((participant.totalVcMs || 0) + (participant.joinedAt ? Date.now() - participant.joinedAt : 0)) / 1000),
    discord: participant.discord || null
  };
};

const buildRoomSnapshot = (room) => ({
  id: room.id,
  topic: room.topic,
  host: room.hostName,
  hostId: room.hostId,
  population: room.participants.size,
  createdAt: room.createdAt,
  participants: Array.from(room.participants.keys())
    .map((participantId) => buildParticipantSnapshot(room, participantId))
    .filter(Boolean)
});

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
    rooms: Array.from(rooms.values()).map((room) => buildRoomSnapshot(room))
  };

  const data = JSON.stringify(payload);
  for (const { ws } of clients.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
};

const httpsRequest = (urlString, { method = 'GET', headers = {}, body } = {}) => {
  const target = new URL(urlString);
  const options = {
    method,
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode || 500, body: data });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
};

const requestJson = async (url, options) => {
  const response = await httpsRequest(url, options);
  let parsed;
  try {
    parsed = response.body ? JSON.parse(response.body) : {};
  } catch (err) {
    parsed = null;
  }
  return { status: response.status, body: parsed }; 
};

const parseCookies = (cookieHeader = '') => {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, value] = part.trim().split('=');
    if (key) {
      acc[key] = decodeURIComponent(value || '');
    }
    return acc;
  }, {});
};

const cleanupDiscordStates = () => {
  const now = Date.now();
  for (const [state, createdAt] of discordStates.entries()) {
    if (now - createdAt > DISCORD_STATE_TTL) {
      discordStates.delete(state);
    }
  }
};

const cleanupSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      sessionStore.delete(sessionId);
    }
  }
};

const setSessionCookie = (res, sessionId) => {
  res.setHeader(
    'Set-Cookie',
    `discord_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  );
};

const getSessionFromCookies = (cookieHeader = '') => {
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies.discord_session;
  if (!sessionId) return null;
  cleanupSessions();
  const session = sessionStore.get(sessionId);
  if (!session) return null;
  return session;
};

const getSessionFromRequest = (req) => getSessionFromCookies(req.headers.cookie || '');

const extractIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const raw = req.socket.remoteAddress || '';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};

const broadcastToRoom = (room, payload) => {
  for (const participantId of room.participants.keys()) {
    sendToClient(participantId, payload);
  }
};

const finalizeVcTime = (client) => {
  if (!client || !client.joinedAt) return;
  const elapsed = Date.now() - client.joinedAt;
  if (elapsed > 0) {
    client.totalVcMs = (client.totalVcMs || 0) + elapsed;
  }
  client.joinedAt = null;
};

const pickSuccessor = (room) => {
  if (!room || room.participants.size === 0) return null;
  let nextModerator = null;
  const pool = [];
  for (const [participantId, meta] of room.participants.entries()) {
    if (!nextModerator && meta.role === 'moderator') {
      nextModerator = participantId;
    }
    pool.push(participantId);
  }
  if (nextModerator) return nextModerator;
  if (!pool.length) return null;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
};

const disbandRoom = (room, reason = 'disbanded') => {
  if (!room) return;
  const participantIds = Array.from(room.participants.keys());
  for (const participantId of participantIds) {
    const participant = clients.get(participantId);
    if (participant) {
      finalizeVcTime(participant);
      participant.roomId = null;
    }
    sendToClient(participantId, {
      type: 'room-ended',
      roomId: room.id,
      reason
    });
  }
  rooms.delete(room.id);
};

const removeClientFromRoom = (clientId) => {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    return;
  }

  const wasHost = room.hostId === clientId;
  finalizeVcTime(client);
  room.participants.delete(clientId);
  client.roomId = null;

  for (const participantId of room.participants.keys()) {
    sendToClient(participantId, {
      type: 'participant-left',
      roomId: room.id,
      participantId: clientId
    });
  }

  if (wasHost) {
    if (room.participants.size === 0) {
      rooms.delete(room.id);
    } else {
      const successorId = pickSuccessor(room);
      if (!successorId) {
        disbandRoom(room, 'leader-missing');
      } else {
        const successorMeta = room.participants.get(successorId);
        if (successorMeta) {
          successorMeta.role = 'host';
        }
        const successorClient = clients.get(successorId);
        room.hostId = successorId;
        room.hostName = successorClient?.username || 'Unknown Leader';
        room.hostIp = successorClient?.ip || room.hostIp;
        broadcastToRoom(room, {
          type: 'participant-updated',
          roomId: room.id,
          participant: buildParticipantSnapshot(room, successorId)
        });
      }
    }
  } else if (room.participants.size === 0) {
    rooms.delete(room.id);
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
  const session = getSessionFromCookies(req.headers.cookie || '');

  clients.set(clientId, {
    ws,
    ip,
    username: null,
    roomId: null,
    joinedAt: null,
    totalVcMs: 0,
    discord: session?.discord || null
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
        client.username = name || client.discord?.global_name || client.discord?.username || `anon-${clientId.slice(0, 4)}`;
        sendJson(ws, { type: 'registered', username: client.username });
        break;
      }
      case 'request-rooms': {
        sendJson(ws, {
          type: 'rooms',
          rooms: Array.from(rooms.values()).map((room) => buildRoomSnapshot(room))
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
          hostName: client.username || 'Unknown Leader',
          hostIp: client.ip,
          createdAt: Date.now(),
          participants: new Map([
            [clientId, { role: 'host', muted: false, deafened: false }]
          ])
        };

        rooms.set(roomId, room);
        client.roomId = roomId;
        client.joinedAt = Date.now();

        sendJson(ws, {
          type: 'room-created',
          roomId,
          topic,
          hostId: clientId,
          createdAt: room.createdAt,
          participants: buildRoomSnapshot(room).participants
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
        client.joinedAt = Date.now();
        room.participants.set(clientId, { role: 'listener', muted: false, deafened: false });

        sendJson(ws, {
          type: 'joined-room',
          roomId: room.id,
          hostId: room.hostId,
          createdAt: room.createdAt,
          participants: buildRoomSnapshot(room).participants
        });

        for (const participantId of room.participants.keys()) {
          if (participantId === clientId) continue;
          sendToClient(participantId, {
            type: 'participant-joined',
            roomId: room.id,
            participant: buildParticipantSnapshot(room, clientId)
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
          sendJson(ws, { type: 'error', message: 'You are not leading a trench.' });
          break;
        }
        disbandRoom(room, 'leader-closed');
        broadcastRooms();
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
      case 'assign-mod': {
        const room = rooms.get(client.roomId);
        if (!room || room.hostId !== clientId) {
          sendJson(ws, { type: 'error', message: 'Only leaders can assign moderators.' });
          break;
        }
        const { targetId, makeModerator } = message;
        if (!room.participants.has(targetId) || targetId === clientId) {
          sendJson(ws, { type: 'error', message: 'Invalid target for moderator role.' });
          break;
        }
        const targetMeta = room.participants.get(targetId);
        targetMeta.role = makeModerator ? 'moderator' : 'listener';
        broadcastToRoom(room, {
          type: 'participant-updated',
          roomId: room.id,
          participant: buildParticipantSnapshot(room, targetId)
        });
        broadcastRooms();
        break;
      }
      case 'moderation-action': {
        const room = rooms.get(client.roomId);
        if (!room || !room.participants.has(clientId)) break;
        const actorMeta = room.participants.get(clientId);
        const isLeader = room.hostId === clientId;
        const isModerator = actorMeta?.role === 'moderator';
        if (!isLeader && !isModerator) {
          sendJson(ws, { type: 'error', message: 'You lack trench mod permissions.' });
          break;
        }

        const { targetId, action } = message;
        if (!room.participants.has(targetId)) {
          sendJson(ws, { type: 'error', message: 'Target not found in trench.' });
          break;
        }
        if (targetId === room.hostId && !isLeader) {
          sendJson(ws, { type: 'error', message: 'You cannot moderate the leader.' });
          break;
        }

        const validActions = ['mute', 'unmute', 'deafen', 'undeafen'];
        if (!validActions.includes(action)) break;

        const targetMeta = room.participants.get(targetId);
        if (action === 'mute') targetMeta.muted = true;
        if (action === 'unmute') targetMeta.muted = false;
        if (action === 'deafen') {
          targetMeta.deafened = true;
          targetMeta.muted = true;
        }
        if (action === 'undeafen') {
          targetMeta.deafened = false;
        }

        sendToClient(targetId, {
          type: 'moderation',
          action
        });

        broadcastToRoom(room, {
          type: 'participant-updated',
          roomId: room.id,
          participant: buildParticipantSnapshot(room, targetId)
        });
        broadcastRooms();
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
