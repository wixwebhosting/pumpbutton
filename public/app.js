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
const roster = new Map();
let localMuted = false;
let localDeafened = false;
let speakingContext;
const speakingMonitors = new Map();
const speakingMap = new Map();
let callStartAt = null;
let uptimeTimer = null;
let profileRefreshTimer = null;
let discordProfile = null;

const bannedFragments = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'slut', 'whore', 'retard', 'kike', 'spic', 'chink', 'coon'
];

const dom = {
  gate: document.getElementById('gate'),
  usernameInput: document.getElementById('usernameInput'),
  nameHint: document.getElementById('nameHint'),
  discordConnect: document.getElementById('discordConnect'),
  enterBtn: document.getElementById('enterBtn'),
  trenchTopic: document.getElementById('trenchTopic'),
  createBtn: document.getElementById('createTrench'),
  leaveBtn: document.getElementById('leaveRoom'),
  hostStatus: document.getElementById('hostStatus'),
  roomStatus: document.getElementById('roomStatus'),
  callStatus: document.getElementById('callStatus'),
  roomGrid: document.getElementById('roomGrid'),
  liveCount: document.getElementById('liveCount'),
  popCount: document.getElementById('popCount'),
  audioStreams: document.getElementById('audioStreams'),
  participantList: document.getElementById('participantList'),
  profilePanel: document.getElementById('profilePanel'),
  profileName: document.getElementById('profileName'),
  profileTime: document.getElementById('profileTime'),
  profileDiscord: document.getElementById('profileDiscord'),
  profileAvatar: document.getElementById('profileAvatar'),
  closeProfile: document.getElementById('closeProfile')
};

const localAudioPrefs = new Map();
let selectedParticipantId = null;

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

const formatDiscordName = (profile) => {
  if (!profile) return '';
  if (profile.global_name) return profile.global_name;
  if (profile.username) {
    const suffix = profile.discriminator && profile.discriminator !== '0' ? `#${profile.discriminator}` : '';
    return `${profile.username}${suffix}`;
  }
  return 'Discord User';
};

const formatDiscordTag = (discord) => {
  if (!discord) return '';
  if (discord.username) {
    const suffix = discord.discriminator && discord.discriminator !== '0' ? `#${discord.discriminator}` : '';
    return `${discord.username}${suffix}`;
  }
  return discord.global_name || '';
};

const getParticipantDisplayName = (participant) => {
  if (participant?.discord?.global_name) return participant.discord.global_name;
  if (participant?.username) return participant.username;
  return 'Anon';
};

const getSelfParticipant = () => roster.get(clientId) || null;

const roleLabels = {
  host: 'Leader',
  moderator: 'Voice Mod',
  listener: 'Member'
};

const getHostIdFromRoster = () => {
  for (const participant of roster.values()) {
    if (participant.role === 'host') {
      return participant.clientId;
    }
  }
  return null;
};

const setLocalMuted = (muted) => {
  localMuted = muted;
  if (localStream) {
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !localMuted;
    });
  }
};

const setLocalDeafened = (deafened) => {
  localDeafened = deafened;
  applyAudioPrefsToAll();
};

const applySelfVoiceState = () => {
  const self = getSelfParticipant();
  setLocalMuted(!!self?.muted);
  setLocalDeafened(!!self?.deafened);
};

const clearUptimeTimer = () => {
  if (uptimeTimer) {
    clearInterval(uptimeTimer);
    uptimeTimer = null;
  }
};

const clearProfileTimer = () => {
  if (profileRefreshTimer) {
    clearInterval(profileRefreshTimer);
    profileRefreshTimer = null;
  }
};

const formatUptime = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `Uptime: ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `Uptime: ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  return `Uptime: ${hours} hour${hours === 1 ? '' : 's'}`;
};

const updateCallStatus = (roleOverride) => {
  const role = roleOverride ?? getSelfParticipant()?.role;
  if (!currentRoomId) {
    clearUptimeTimer();
    dom.callStatus.textContent = 'Disconnected';
    return;
  }

  if (role === 'host') {
    if (!callStartAt) {
      callStartAt = Date.now();
    }

    const applyText = () => {
      const currentRole = getSelfParticipant()?.role;
      if (!currentRoomId || currentRole !== 'host') {
        clearUptimeTimer();
        updateCallStatus();
        return;
      }
      dom.callStatus.textContent = formatUptime(Date.now() - callStartAt);
    };

    applyText();
    if (!uptimeTimer) {
      uptimeTimer = setInterval(applyText, 1000);
    }
    return;
  }

  clearUptimeTimer();
  if (role === 'moderator') {
    dom.callStatus.textContent = 'Modding trench';
  } else {
    dom.callStatus.textContent = 'Linked';
  }
};

const markCallStart = (timestamp, shouldUpdate = true) => {
  callStartAt = typeof timestamp === 'number' ? timestamp : Date.now();
  clearUptimeTimer();
  if (shouldUpdate) {
    updateCallStatus();
  }
};

const describeDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const leftoverSeconds = seconds % 60;
    return leftoverSeconds ? `${minutes}m ${leftoverSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (hours < 24) {
    return leftoverMinutes ? `${hours}h ${leftoverMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours ? `${days}d ${leftoverHours}h` : `${days}d`;
};

const enrichParticipant = (participant) => ({
  ...participant,
  syncedAt: Date.now()
});

const getParticipantLiveSeconds = (participant) => {
  if (!participant) return 0;
  const base = participant.vcSeconds || 0;
  if (!participant.syncedAt || !roster.has(participant.clientId)) return base;
  return base + Math.floor((Date.now() - participant.syncedAt) / 1000);
};

const updateProfileHighlight = () => {
  if (!dom.participantList) return;
  const rows = dom.participantList.querySelectorAll('.participant-row');
  rows.forEach((row) => {
    row.classList.toggle('active', row.dataset.participantId === selectedParticipantId);
  });
};

const refreshProfilePanel = () => {
  if (!dom.profilePanel) return;
  if (!selectedParticipantId) {
    clearProfileTimer();
    dom.profilePanel.classList.remove('visible');
    dom.profilePanel.setAttribute('aria-hidden', 'true');
    updateProfileHighlight();
    return;
  }
  const participant = roster.get(selectedParticipantId);
  if (!participant) {
    selectedParticipantId = null;
    refreshProfilePanel();
    return;
  }
  dom.profilePanel.classList.add('visible');
  dom.profilePanel.setAttribute('aria-hidden', 'false');
  dom.profileName.textContent = getParticipantDisplayName(participant);
  dom.profileTime.textContent = `Total VC: ${describeDuration(getParticipantLiveSeconds(participant))}`;
  if (dom.profileDiscord) {
    if (participant.discord) {
      dom.profileDiscord.textContent = `Discord: ${formatDiscordTag(participant.discord)}`;
      dom.profileDiscord.classList.remove('muted');
    } else {
      dom.profileDiscord.textContent = 'Discord: Not linked';
      dom.profileDiscord.classList.add('muted');
    }
  }
  dom.profileAvatar.textContent = '👤';
  updateProfileHighlight();
  clearProfileTimer();
  profileRefreshTimer = setInterval(() => {
    if (!selectedParticipantId) {
      clearProfileTimer();
      return;
    }
    const current = roster.get(selectedParticipantId);
    if (!current) {
      closeProfilePanel();
      return;
    }
    dom.profileTime.textContent = `Total VC: ${describeDuration(getParticipantLiveSeconds(current))}`;
  }, 1000);
};

const openProfilePanel = (participantId) => {
  selectedParticipantId = participantId;
  refreshProfilePanel();
};

const closeProfilePanel = () => {
  selectedParticipantId = null;
  refreshProfilePanel();
};

const getAudioPrefs = (participantId) => {
  if (!localAudioPrefs.has(participantId)) {
    localAudioPrefs.set(participantId, { volume: 1 });
  }
  return localAudioPrefs.get(participantId);
};

const applyAudioPrefsForPeer = (participantId) => {
  const chip = audioChips.get(participantId);
  if (!chip) return;
  const prefs = getAudioPrefs(participantId);
  chip.audio.volume = prefs.volume ?? 1;
  chip.audio.muted = localDeafened;
};

const applyAudioPrefsToAll = () => {
  for (const participantId of audioChips.keys()) {
    applyAudioPrefsForPeer(participantId);
  }
};

const setLocalVolumeForPeer = (participantId, volume) => {
  const prefs = getAudioPrefs(participantId);
  prefs.volume = Math.min(1, Math.max(0, volume));
  applyAudioPrefsForPeer(participantId);
};


const setSpeakingState = (participantId, speaking) => {
  if (!participantId) return;
  if (speakingMap.get(participantId) === speaking) return;
  speakingMap.set(participantId, speaking);
  const row = dom.participantList.querySelector(`[data-participant-id="${participantId}"]`);
  if (row) {
    row.classList.toggle('speaking', speaking);
  }
};

const stopSpeakingMonitor = (participantId) => {
  const monitor = speakingMonitors.get(participantId);
  if (!monitor) return;
  cancelAnimationFrame(monitor.rafId);
  try {
    monitor.source.disconnect();
  } catch (err) {
    /* noop */
  }
  speakingMonitors.delete(participantId);
  setSpeakingState(participantId, false);
};

const stopAllSpeakingMonitors = () => {
  for (const id of speakingMonitors.keys()) {
    stopSpeakingMonitor(id);
  }
  speakingMap.clear();
};

const ensureSpeakingContext = () => {
  if (speakingContext) return speakingContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  speakingContext = new Ctor();
  return speakingContext;
};

const startSpeakingMonitor = (participantId, stream) => {
  const ctx = ensureSpeakingContext();
  if (!ctx || !stream || !stream.getAudioTracks()?.length) return;
  stopSpeakingMonitor(participantId);
  let source;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch (err) {
    return;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const monitor = { source, analyser, rafId: 0 };
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const deviation = data[i] - 128;
      sum += deviation * deviation;
    }
    const rms = Math.sqrt(sum / data.length);
    const speaking = rms > 12;
    setSpeakingState(participantId, speaking);
    monitor.rafId = requestAnimationFrame(tick);
  };
  tick();
  speakingMonitors.set(participantId, monitor);
};

const renderParticipantList = () => {
  if (!currentRoomId || roster.size === 0) {
    dom.participantList.innerHTML = '<p class="empty">No active trench link.</p>';
    closeProfilePanel();
    return;
  }

  const sorted = Array.from(roster.values()).sort((a, b) => {
    const roleOrder = { host: 0, moderator: 1, listener: 2 };
    const byRole = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
    if (byRole !== 0) return byRole;
    const nameA = getParticipantDisplayName(a).toLowerCase();
    const nameB = getParticipantDisplayName(b).toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  dom.participantList.innerHTML = '';
  sorted.forEach((participant) => {
    const row = document.createElement('div');
    row.className = 'participant-row';
    row.dataset.participantId = participant.clientId;
    row.classList.toggle('speaking', !!speakingMap.get(participant.clientId));
    row.classList.toggle('active', participant.clientId === selectedParticipantId);
    row.tabIndex = 0;

    const head = document.createElement('div');
    head.className = 'participant-head';
    const info = document.createElement('div');
    info.className = 'participant-info';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = '👤';
    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'participant-name';
    const nameSpan = document.createElement('strong');
    nameSpan.textContent = getParticipantDisplayName(participant);
    nameWrapper.appendChild(nameSpan);
    if (participant.discord) {
      const discordSpan = document.createElement('span');
      discordSpan.className = 'discord-tag';
      discordSpan.textContent = formatDiscordTag(participant.discord);
      nameWrapper.appendChild(discordSpan);
    }
    info.append(avatar, nameWrapper);
    const roleBadge = document.createElement('span');
    roleBadge.className = 'role-badge';
    roleBadge.textContent = roleLabels[participant.role] || 'Member';
    head.append(info, roleBadge);

    const statusTags = document.createElement('div');
    statusTags.className = 'status-tags';
    if (participant.muted) {
      const tag = document.createElement('span');
      tag.textContent = 'Muted';
      statusTags.appendChild(tag);
    }
    if (participant.deafened) {
      const tag = document.createElement('span');
      tag.textContent = 'Deafened';
      statusTags.appendChild(tag);
    }
    const actions = document.createElement('div');
    actions.className = 'participant-actions';
    const self = getSelfParticipant();
    const isSelf = participant.clientId === clientId;
    const selfRole = self?.role;
    const canMod = selfRole === 'host' || selfRole === 'moderator';
    const isLeader = selfRole === 'host';

    if (canMod && !isSelf && participant.role !== 'host') {
      const muteBtn = document.createElement('button');
      muteBtn.className = 'ghost';
      muteBtn.textContent = participant.muted ? 'Unmute' : 'Mute';
      muteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        sendMessage({
          type: 'moderation-action',
          targetId: participant.clientId,
          action: participant.muted ? 'unmute' : 'mute'
        });
      });
      actions.appendChild(muteBtn);

      const deafenBtn = document.createElement('button');
      deafenBtn.className = 'ghost';
      deafenBtn.textContent = participant.deafened ? 'Undeafen' : 'Deafen';
      deafenBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        sendMessage({
          type: 'moderation-action',
          targetId: participant.clientId,
          action: participant.deafened ? 'undeafen' : 'deafen'
        });
      });
      actions.appendChild(deafenBtn);
    }

    if (isLeader && !isSelf && participant.role !== 'host') {
      const makeMod = participant.role !== 'moderator';
      const modBtn = document.createElement('button');
      modBtn.className = makeMod ? 'primary' : 'danger';
      modBtn.textContent = makeMod ? 'Give Mod' : 'Remove Mod';
      modBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        sendMessage({ type: 'assign-mod', targetId: participant.clientId, makeModerator: makeMod });
      });
      actions.appendChild(modBtn);
    }

    row.append(head, statusTags);
    if (actions.children.length) {
      row.appendChild(actions);
    }

    if (!isSelf) {
      const prefs = getAudioPrefs(participant.clientId);
      const localControls = document.createElement('div');
      localControls.className = 'local-audio-controls';
      const volumeWrapper = document.createElement('div');
      volumeWrapper.className = 'local-volume';
      const volumeLabel = document.createElement('span');
      volumeLabel.textContent = 'Volume';
      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.min = 0;
      volumeSlider.max = 100;
      volumeSlider.value = Math.round((prefs.volume ?? 1) * 100);
      const stopEvent = (event) => event.stopPropagation();
      volumeSlider.addEventListener('pointerdown', stopEvent);
      volumeSlider.addEventListener('touchstart', stopEvent, { passive: true });
      volumeSlider.addEventListener('click', stopEvent);
      volumeSlider.addEventListener('change', stopEvent);
      volumeSlider.addEventListener('input', (event) => {
        event.stopPropagation();
        setLocalVolumeForPeer(participant.clientId, Number(event.target.value) / 100);
      });
      volumeWrapper.append(volumeLabel, volumeSlider);
      localControls.appendChild(volumeWrapper);
      row.appendChild(localControls);
    }

    row.addEventListener('click', () => {
      openProfilePanel(participant.clientId);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openProfilePanel(participant.clientId);
      }
    });

    dom.participantList.appendChild(row);
  });

  refreshProfilePanel();
};

const syncRoster = (participants = []) => {
  const nextIds = new Set();
  roster.clear();
  participants.forEach((participant) => {
    if (participant?.clientId) {
      roster.set(participant.clientId, enrichParticipant(participant));
      nextIds.add(participant.clientId);
    }
  });
  for (const id of speakingMap.keys()) {
    if (!nextIds.has(id)) {
      setSpeakingState(id, false);
    }
  }
  isHost = getSelfParticipant()?.role === 'host';
  currentHostId = getHostIdFromRoster();
  applySelfVoiceState();
  renderParticipantList();
};

const upsertParticipant = (participant) => {
  if (!participant?.clientId) return;
  roster.set(participant.clientId, enrichParticipant(participant));
  currentHostId = getHostIdFromRoster();
  if (participant.clientId === clientId) {
    isHost = participant.role === 'host';
    applySelfVoiceState();
  }
  renderParticipantList();
};

const removeParticipantFromRoster = (participantId) => {
  roster.delete(participantId);
  currentHostId = getHostIdFromRoster();
  setSpeakingState(participantId, false);
  renderParticipantList();
  updateHostUi();
  if (selectedParticipantId === participantId) {
    closeProfilePanel();
  }
};

const updateHostUi = () => {
  const selfRole = getSelfParticipant()?.role;
  const inTrench = Boolean(currentRoomId);
  document.body.classList.toggle('in-trench', inTrench);

  if (inTrench) {
    dom.createBtn.disabled = true;
    dom.leaveBtn.disabled = false;

    if (selfRole === 'host') {
      dom.hostStatus.textContent = 'Leading';
    } else if (selfRole === 'moderator') {
      dom.hostStatus.textContent = 'Voice Moderator';
    } else {
      dom.hostStatus.textContent = 'Linked';
    }
  } else {
    dom.hostStatus.textContent = 'Idle';
    dom.createBtn.disabled = false;
    dom.leaveBtn.disabled = true;
  }

  updateCallStatus(selfRole);
};

const socketReady = () => socket && socket.readyState === WebSocket.OPEN;

const sendMessage = (payload) => {
  if (socketReady()) {
    socket.send(JSON.stringify(payload));
  }
};

const maybeRegisterHandle = () => {
  if (username && socketReady()) {
    sendMessage({ type: 'register', username });
  }
};

const applyDiscordState = () => {
  if (!dom.discordConnect) return;
  if (discordProfile) {
    const displayName = formatDiscordName(discordProfile);
    username = displayName;
    dom.usernameInput.value = displayName;
    dom.usernameInput.disabled = true;
    dom.discordConnect.textContent = `Linked as ${displayName}`;
    dom.discordConnect.classList.add('linked');
    dom.discordConnect.disabled = true;
    dom.enterBtn.disabled = false;
    setHint('Discord handle linked. Hit Enter to deploy.');
    localStorage.setItem('trenchHandle', username);
    maybeRegisterHandle();
  } else {
    dom.usernameInput.disabled = false;
    dom.discordConnect.textContent = 'Connect Discord';
    dom.discordConnect.classList.remove('linked');
    dom.discordConnect.disabled = false;
    validateGateInput();
  }
};

const fetchDiscordProfile = async () => {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) {
      discordProfile = null;
      applyDiscordState();
      return;
    }
    const data = await response.json();
    discordProfile = data.discord || null;
    applyDiscordState();
  } catch (err) {
    discordProfile = null;
    applyDiscordState();
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
  if (dom.usernameInput.disabled) {
    setHint('Discord handle linked. Hit Enter to deploy.');
    dom.enterBtn.disabled = false;
    return;
  }
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
    audio.controls = false;
    audio.style.display = 'none';
    audio.setAttribute('aria-hidden', 'true');
    wrapper.append(title, sub, audio);
    dom.audioStreams.appendChild(wrapper);
    chip = { wrapper, title, audio };
    audioChips.set(peerId, chip);
  }
  chip.title.textContent = remoteName || 'Unknown';
  chip.audio.srcObject = stream;
  getAudioPrefs(peerId);
  applyAudioPrefsForPeer(peerId);
  startSpeakingMonitor(peerId, stream);
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
  stopSpeakingMonitor(peerId);
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
  setLocalMuted(localMuted);
  if (clientId) {
    startSpeakingMonitor(clientId, localStream);
  }
  return localStream;
};

const teardownLocalStream = () => {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  stopSpeakingMonitor(clientId);
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
    meta.innerHTML = `<span>Leader: ${room.host || 'Anon'}</span><span>${room.population} live</span>`;

    const rosterPreview = document.createElement('div');
    rosterPreview.className = 'room-roster';
    const participants = room.participants || [];
    if (participants.length) {
      participants.slice(0, 4).forEach((participant) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        const suffix = participant.role === 'host' ? ' • Lead' : participant.role === 'moderator' ? ' • Mod' : '';
        chip.textContent = `${getParticipantDisplayName(participant)}${suffix}`;
        rosterPreview.appendChild(chip);
      });
      if (participants.length > 4) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = `+${participants.length - 4} more`;
        rosterPreview.appendChild(chip);
      }
    } else {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'Silent trench';
      rosterPreview.appendChild(chip);
    }

    const joinBtn = document.createElement('button');
    joinBtn.className = 'ghost room-button';
    joinBtn.textContent = currentRoomId === room.id ? 'Inside' : 'Join';
    joinBtn.disabled = !!currentRoomId;
    joinBtn.addEventListener('click', () => joinRoom(room.id));

    const timestamp = document.createElement('small');
    const minutes = Math.max(1, Math.floor((Date.now() - room.createdAt) / 60000));
    timestamp.textContent = `created ${minutes}m ago`;

    card.append(heading, meta, rosterPreview, timestamp, joinBtn);
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
      if (localStream) {
        startSpeakingMonitor(clientId, localStream);
      }
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
      markCallStart(data.createdAt, false);
      syncRoster(data.participants || []);
      updateHostUi();
      dom.roomStatus.textContent = 'Trench live';
      break;
    case 'joined-room':
      currentRoomId = data.roomId;
      currentHostId = data.hostId;
      markCallStart(data.createdAt, false);
      syncRoster(data.participants || []);
      data.participants?.forEach(async (participant) => {
        if (participant.clientId === clientId) return;
        await createPeer(participant.clientId, true, participant.username);
      });
      updateHostUi();
      dom.roomStatus.textContent = 'Linked';
      break;
    case 'participant-joined':
      if (currentRoomId && data.roomId === currentRoomId && data.participant?.clientId) {
        upsertParticipant(data.participant);
        createPeer(data.participant.clientId, false, data.participant.username);
      }
      break;
    case 'participant-left':
      removePeer(data.participantId);
      removeParticipantFromRoster(data.participantId);
      break;
    case 'room-ended':
      if (currentRoomId === data.roomId) {
        resetSession('Leader left the trench.');
      }
      break;
    case 'participant-updated':
      if (currentRoomId && data.roomId === currentRoomId) {
        upsertParticipant(data.participant);
        updateHostUi();
      }
      break;
    case 'signal':
      {
        const entry = peers.get(data.from);
        if (entry) {
          entry.peer.signal(data.data);
        } else {
          const remote = roster.get(data.from);
          const remoteName = remote ? getParticipantDisplayName(remote) : 'Unknown';
          createPeer(data.from, false, remoteName).then((peer) => peer.signal(data.data));
        }
      }
      break;
    case 'moderation':
      if (data.action === 'mute') setLocalMuted(true);
      if (data.action === 'unmute') setLocalMuted(false);
      if (data.action === 'deafen') {
        setLocalDeafened(true);
        setLocalMuted(true);
      }
      if (data.action === 'undeafen') {
        setLocalDeafened(false);
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
  callStartAt = null;
  clearUptimeTimer();
  closeProfilePanel();
  localAudioPrefs.clear();
  roster.clear();
  dom.participantList.innerHTML = '<p class="empty">No active trench link.</p>';
  setLocalMuted(false);
  setLocalDeafened(false);
  stopAllSpeakingMonitors();
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
  sendMessage({ type: 'leave-room' });
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

  if (dom.discordConnect) {
    dom.discordConnect.addEventListener('click', () => {
      window.location.href = '/auth/discord';
    });
  }

  dom.createBtn.addEventListener('click', createRoom);
  dom.leaveBtn.addEventListener('click', leaveRoom);

  if (dom.closeProfile) {
    dom.closeProfile.addEventListener('click', (event) => {
      event.preventDefault();
      closeProfilePanel();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (currentRoomId) {
      sendMessage({ type: 'leave-room' });
    }
  });
};

const init = () => {
  hydrateName();
  validateGateInput();
  bindEvents();
  ensureConnection();
  fetchDiscordProfile();
  maybeRegisterHandle();
};

init();
