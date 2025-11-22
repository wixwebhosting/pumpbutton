const socketUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
const SimplePeerCtor = window.SimplePeer;
if (!SimplePeerCtor) {
  throw new Error('SimplePeer failed to load');
}
let socket;
let reconnectTimer;
let username = localStorage.getItem('trenchHandle') || '';
let clientId = null;
let currentRoomId = null;
let currentHostId = null;
let isHost = false;
let localStream;
const peers = new Map();
const audioChips = new Map();

const bannedFragments = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'slut', 'whore', 'retard', 'kike', 'spic', 'chink', 'coon'
];

const dom = {
  gate: document.getElementById('gate'),
  usernameInput: document.getElementById('usernameInput'),
  nameHint: document.getElementById('nameHint'),
  enterBtn: document.getElementById('enterBtn'),
  openCreate: document.getElementById('openCreate'),
  trenchTopic: document.getElementById('trenchTopic'),
  createBtn: document.getElementById('createTrench'),
  endBtn: document.getElementById('endTrench'),
  leaveBtn: document.getElementById('leaveRoom'),
  refreshRooms: document.getElementById('refreshRooms'),
  hostStatus: document.getElementById('hostStatus'),
  roomStatus: document.getElementById('roomStatus'),
  callStatus: document.getElementById('callStatus'),
  roomGrid: document.getElementById('roomGrid'),
  liveCount: document.getElementById('liveCount'),
  popCount: document.getElementById('popCount'),
  audioStreams: document.getElementById('audioStreams')
};

const isNameValid = (value) => {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 16) return false;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  return !bannedFragments.some((fragment) => normalized.includes(fragment));
};

const setHint = (message, isError = false) => {
  dom.nameHint.textContent = message;
  dom.nameHint.style.color = isError ? '#ff5470' : 'rgba(244,244,255,0.7)';
};

const updateHostUi = () => {
  if (isHost && currentRoomId) {
    dom.hostStatus.textContent = 'Broadcasting';
    dom.createBtn.disabled = true;
    dom.endBtn.disabled = false;
    dom.callStatus.textContent = 'Hosting trench';
    dom.leaveBtn.disabled = false;
  } else if (currentRoomId) {
    dom.hostStatus.textContent = 'Joined';
    dom.createBtn.disabled = true;
    dom.endBtn.disabled = true;
    dom.callStatus.textContent = 'Linked';
    dom.leaveBtn.disabled = false;
  } else {
    dom.hostStatus.textContent = 'Idle';
    dom.createBtn.disabled = false;
    dom.endBtn.disabled = true;
    dom.callStatus.textContent = 'Disconnected';
    dom.leaveBtn.disabled = true;
  }
};

const socketReady = () => socket && socket.readyState === WebSocket.OPEN;

const sendMessage = (payload) => {
  if (socketReady()) {
    socket.send(JSON.stringify(payload));
  }
};

const ensureConnection = () => {
  if (socketReady()) return;
  socket = new WebSocket(socketUrl);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    dom.roomStatus.textContent = 'Connected';
    if (username) {
      sendMessage({ type: 'register', username });
    }
    sendMessage({ type: 'request-rooms' });
  });

  socket.addEventListener('message', (event) => handleSocketMessage(event));

  socket.addEventListener('close', () => {
    dom.roomStatus.textContent = 'Reconnecting…';
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    dom.roomStatus.textContent = 'Socket error';
    socket.close();
  });
};

const scheduleReconnect = () => {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => ensureConnection(), 1500);
};

const validateGateInput = () => {
  const value = dom.usernameInput.value;
  if (!value.trim()) {
    setHint('3-16 characters. No slurs, no cowards.');
    dom.enterBtn.disabled = true;
    return;
  }
  if (!isNameValid(value)) {
    setHint('Pick something clean and between 3-16 chars.', true);
    dom.enterBtn.disabled = true;
    return;
  }
  setHint('Calls sign locked. Enter to deploy.');
  dom.enterBtn.disabled = false;
};

const closeGate = () => {
  dom.gate.style.display = 'none';
};

const openGate = () => {
  dom.gate.style.display = 'flex';
  dom.usernameInput.focus();
};

const hydrateName = () => {
  if (username) {
    dom.usernameInput.value = username;
    dom.enterBtn.disabled = false;
    closeGate();
  } else {
    openGate();
  }
};

const attachStream = (peerId, remoteName, stream) => {
  let chip = audioChips.get(peerId);
  if (!chip) {
    const wrapper = document.createElement('div');
    wrapper.className = 'stream-chip';
    const title = document.createElement('strong');
    title.textContent = remoteName || 'Unknown';
    const sub = document.createElement('span');
    sub.textContent = 'Live audio';
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.controls = true;
    wrapper.append(title, sub, audio);
    dom.audioStreams.appendChild(wrapper);
    chip = { wrapper, title, audio };
    audioChips.set(peerId, chip);
  }
  chip.title.textContent = remoteName || 'Unknown';
  chip.audio.srcObject = stream;
};

const removePeer = (peerId) => {
  const peerEntry = peers.get(peerId);
  if (peerEntry) {
    peerEntry.peer.destroy();
    peers.delete(peerId);
  }
  const chip = audioChips.get(peerId);
  if (chip) {
    chip.audio.srcObject = null;
    chip.wrapper.remove();
    audioChips.delete(peerId);
  }
};

const resetPeers = () => {
  for (const peerId of peers.keys()) {
    removePeer(peerId);
  }
  dom.audioStreams.innerHTML = '';
};

const ensureLocalStream = async () => {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return localStream;
};

const teardownLocalStream = () => {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
};

const createPeer = async (peerId, initiator, remoteName) => {
  if (peers.has(peerId)) return peers.get(peerId).peer;
  const stream = await ensureLocalStream();
  const peer = new SimplePeerCtor({
    initiator,
    trickle: true,
    stream,
    config: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  });

  peer.on('signal', (data) => {
    sendMessage({ type: 'signal', targetId: peerId, data });
  });

  peer.on('stream', (remoteStream) => {
    attachStream(peerId, remoteName, remoteStream);
  });

  peer.on('close', () => removePeer(peerId));
  peer.on('error', () => removePeer(peerId));

  peers.set(peerId, { peer, name: remoteName });
  return peer;
};

const handleRoomsPayload = (rooms) => {
  dom.liveCount.textContent = rooms.length;
  dom.popCount.textContent = rooms.reduce((sum, room) => sum + room.population, 0);

  if (!rooms.length) {
    dom.roomGrid.innerHTML = '<p class="empty">No trenches on radar. Spin one up.</p>';
    return;
  }

  dom.roomGrid.innerHTML = '';
  rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card';
    const heading = document.createElement('h3');
    heading.textContent = room.topic || 'Unnamed Trench';

    const meta = document.createElement('div');
    meta.className = 'room-meta';
    meta.innerHTML = `<span>Host: ${room.host || 'Anon'}</span><span>${room.population} live</span>`;

    const joinBtn = document.createElement('button');
    joinBtn.className = 'ghost';
    joinBtn.textContent = currentRoomId === room.id ? 'Inside' : 'Join';
    joinBtn.disabled = !!currentRoomId;
    joinBtn.addEventListener('click', () => joinRoom(room.id));

    const timestamp = document.createElement('small');
    const minutes = Math.max(1, Math.floor((Date.now() - room.createdAt) / 60000));
    timestamp.textContent = `${minutes}m on-chain`;

    card.append(heading, meta, timestamp, joinBtn);
    dom.roomGrid.appendChild(card);
  });
};

const handleSocketMessage = (event) => {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch (err) {
    return;
  }

  switch (data.type) {
    case 'hello':
      clientId = data.clientId;
      break;
    case 'registered':
      username = data.username;
      localStorage.setItem('trenchHandle', username);
      closeGate();
      break;
    case 'rooms':
      handleRoomsPayload(data.rooms || []);
      break;
    case 'room-created':
      currentRoomId = data.roomId;
      currentHostId = data.hostId;
      isHost = data.hostId === clientId;
      updateHostUi();
      break;
    case 'joined-room':
      currentRoomId = data.roomId;
      currentHostId = data.hostId;
      isHost = data.hostId === clientId;
      data.participants?.forEach(async (participant) => {
        await createPeer(participant.clientId, true, participant.username);
      });
      updateHostUi();
      break;
    case 'participant-joined':
      if (currentRoomId && data.roomId === currentRoomId) {
        createPeer(data.participantId, false, data.username);
      }
      break;
    case 'participant-left':
      removePeer(data.participantId);
      break;
    case 'room-ended':
      if (currentRoomId === data.roomId) {
        resetSession('Host left the trench.');
      }
      break;
    case 'signal':
      {
        const entry = peers.get(data.from);
        if (entry) {
          entry.peer.signal(data.data);
        } else {
          createPeer(data.from, false, 'Unknown').then((peer) => peer.signal(data.data));
        }
      }
      break;
    case 'error':
      dom.roomStatus.textContent = data.message;
      break;
    default:
      break;
  }
};

const resetSession = (message) => {
  currentRoomId = null;
  currentHostId = null;
  isHost = false;
  resetPeers();
  teardownLocalStream();
  updateHostUi();
  dom.roomStatus.textContent = message || 'Idle';
};

const createRoom = async () => {
  if (!socketReady()) return;
  try {
    await ensureLocalStream();
  } catch (err) {
    dom.roomStatus.textContent = 'Microphone blocked';
    return;
  }
  const topic = dom.trenchTopic.value.trim() || 'Unnamed Trench';
  sendMessage({ type: 'create-room', topic });
  dom.roomStatus.textContent = 'Forging trench…';
};

const leaveRoom = () => {
  if (!currentRoomId) return;
  if (isHost) {
    sendMessage({ type: 'close-room' });
  } else {
    sendMessage({ type: 'leave-room' });
  }
  resetSession('Exited trench.');
};

const joinRoom = async (roomId) => {
  if (!socketReady() || currentRoomId) return;
  try {
    await ensureLocalStream();
  } catch (err) {
    dom.roomStatus.textContent = 'Microphone blocked';
    return;
  }
  sendMessage({ type: 'join-room', roomId });
  dom.roomStatus.textContent = 'Linking…';
};

const bindEvents = () => {
  dom.usernameInput.addEventListener('input', validateGateInput);
  dom.enterBtn.addEventListener('click', () => {
    const value = dom.usernameInput.value.trim();
    if (!isNameValid(value)) return;
    username = value;
    localStorage.setItem('trenchHandle', username);
    if (socketReady()) {
      sendMessage({ type: 'register', username });
    }
  });

  dom.openCreate.addEventListener('click', () => {
    dom.trenchTopic.focus();
  });

  dom.createBtn.addEventListener('click', createRoom);
  dom.endBtn.addEventListener('click', () => {
    if (isHost) {
      sendMessage({ type: 'close-room' });
      resetSession('Closed trench');
    }
  });

  dom.leaveBtn.addEventListener('click', leaveRoom);
  dom.refreshRooms.addEventListener('click', () => sendMessage({ type: 'request-rooms' }));

  window.addEventListener('beforeunload', () => {
    if (currentRoomId) {
      sendMessage({ type: isHost ? 'close-room' : 'leave-room' });
    }
  });
};

const init = () => {
  hydrateName();
  validateGateInput();
  bindEvents();
  ensureConnection();

  if (username && socketReady()) {
    sendMessage({ type: 'register', username });
  }
};

init();
