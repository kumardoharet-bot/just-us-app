const socket = io();

const TURN_USERNAME = 'openrelayproject';
const TURN_PASSWORD = 'openrelayproject';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: TURN_USERNAME, credential: TURN_PASSWORD },
  { urls: 'turn:openrelay.metered.ca:443', username: TURN_USERNAME, credential: TURN_PASSWORD }
];

const $ = (id) => document.getElementById(id);
const els = {
  login: $('login'), name: $('nameInput'), room: $('roomInput'), password: $('passwordInput'), createRoom: $('createRoomBtn'), joinRoom: $('joinRoomBtn'),
  mic: $('micBtn'), cam: $('camBtn'), screen: $('screenBtn'), snap: $('snapBtn'), invite: $('inviteBtn'), chat: $('chatBtn'), leave: $('leaveBtn'), badge: $('badge'),
  roomTitle: $('roomTitle'), status: $('statusText'), inviteText: $('inviteText'), memberCount: $('memberCount'), videoGrid: $('videoGrid'), people: $('peopleList'), recipient: $('recipientSelect'),
  snapUpload: $('snapUploadBtn'), snapInput: $('snapInput'), chatDrawer: $('chatDrawer'), closeChat: $('closeChatBtn'), chatRoomLabel: $('chatRoomLabel'), messages: $('messages'), messageForm: $('messageForm'), messageInput: $('messageInput'),
  snapViewer: $('snapViewer'), snapFrom: $('snapFrom'), snapTimer: $('snapTimer'), snapContent: $('snapContent')
};

let myId = null;
let myName = '';
let currentRoom = '';
let localStream = null;
let screenStream = null;
let micEnabled = false;
let camEnabled = false;
let screenEnabled = false;
let unread = 0;

const peers = new Map(); // peerId -> RTCPeerConnection
const senders = new Map(); // peerId -> { audio, video, screen }
const names = new Map();
const remoteStreams = new Map();

const qs = new URLSearchParams(location.search);
if (qs.get('room')) els.room.value = qs.get('room');
els.name.value = localStorage.getItem('just-us-name') || '';

els.createRoom.onclick = () => {
  els.room.value = `room-${crypto.randomUUID().slice(0, 8)}`;
  if (!els.password.value) els.password.value = crypto.randomUUID().slice(0, 8);
  joinRoom();
};
els.joinRoom.onclick = joinRoom;
els.mic.onclick = toggleMic;
els.cam.onclick = toggleCamera;
els.screen.onclick = toggleScreen;
els.snap.onclick = () => els.snapInput.click();
els.snapUpload.onclick = () => els.snapInput.click();
els.snapInput.onchange = sendSnap;
els.invite.onclick = copyInvite;
els.chat.onclick = () => setChatOpen(!els.chatDrawer.classList.contains('open'));
els.closeChat.onclick = () => setChatOpen(false);
els.leave.onclick = () => location.reload();
els.messageForm.onsubmit = sendChat;

function setStatus(text) { els.status.textContent = text; }
function escapeHtml(text) { return String(text || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function setActive(button, active) { button.classList.toggle('active', active); button.classList.toggle('off', !active); }
function clearEmpty() { const empty = els.videoGrid.querySelector('.empty-state'); if (empty) empty.remove(); }
function showEmpty() { if (!els.videoGrid.querySelector('.video-tile')) els.videoGrid.innerHTML = '<div class="empty-state">Enable camera or screen share to broadcast to everyone.</div>'; }
function inviteUrl() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(currentRoom)}`; }
function setChatOpen(open) { els.chatDrawer.classList.toggle('open', open); if (open) { unread = 0; updateBadge(); setTimeout(() => els.messages.scrollTop = els.messages.scrollHeight, 50); } }
function updateBadge() { els.badge.style.display = unread ? 'grid' : 'none'; els.badge.textContent = unread > 9 ? '9+' : String(unread); }
function initials(name) { return (name || 'Guest').slice(0, 1).toUpperCase(); }

async function joinRoom() {
  myName = els.name.value.trim() || 'Guest';
  const roomId = els.room.value.trim();
  const password = els.password.value;
  if (!roomId || !password) return alert('Room code and password are required.');
  localStorage.setItem('just-us-name', myName);
  socket.emit('join-room', { roomId, name: myName, password }, async (res) => {
    if (!res?.ok) return alert(res?.error || 'Could not join room.');
    myId = res.id;
    currentRoom = roomId;
    els.login.classList.add('hidden');
    els.roomTitle.textContent = roomId;
    els.chatRoomLabel.textContent = roomId;
    els.inviteText.textContent = inviteUrl();
    history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`);
    setStatus('Connected. Turn mic/camera on when ready.');
    addSystem(`Joined ${roomId}.`);
    updatePeople(res.users || [], res.max || 20);
    for (const user of res.existingUsers || []) {
      names.set(user.id, user.name);
      await createPeer(user.id, true);
    }
  });
}

async function copyInvite() {
  if (!currentRoom) return alert('Join or create a room first.');
  await navigator.clipboard.writeText(inviteUrl());
  alert('Invite copied. Your friend opens the link and enters the password.');
}

function updatePeople(users, max) {
  els.memberCount.textContent = `${users.length} / ${max}`;
  els.people.innerHTML = '';
  els.recipient.innerHTML = '<option value="all">Everyone</option>';
  for (const u of users) {
    names.set(u.id, u.name);
    const li = document.createElement('li');
    li.innerHTML = `<span><i class="dot"></i>${escapeHtml(u.name)}${u.id === myId ? ' (you)' : ''}</span><span>${u.id === myId ? 'you' : 'online'}</span>`;
    els.people.appendChild(li);
    if (u.id !== myId) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      els.recipient.appendChild(opt);
    }
  }
}

const cameraConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
};

async function ensureLocalStream() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    renderTile('local-camera', localStream, 'You', true, 'camera');
    await syncTracksToPeers();
  }
  return localStream;
}

async function toggleMic() {
  try {
    await ensureLocalStream();
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    setActive(els.mic, micEnabled);
    setStatus(micEnabled ? 'Microphone on.' : 'Microphone off.');
  } catch { alert('Microphone permission blocked or unavailable. Use HTTPS on phone.'); }
}

async function toggleCamera() {
  try {
    await ensureLocalStream();
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    setActive(els.cam, camEnabled);
    const tile = $('tile-local-camera');
    if (tile) tile.classList.toggle('camera-off', !camEnabled);
    setStatus(camEnabled ? 'Camera on.' : 'Camera off.');
  } catch { alert('Camera permission blocked or unavailable. Use HTTPS on phone.'); }
}

async function toggleScreen() {
  if (screenEnabled) return stopScreen();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    screenEnabled = true;
    setActive(els.screen, true);
    renderTile('local-screen', screenStream, 'You · screen', true, 'screen');
    await syncTracksToPeers();
    const track = screenStream.getVideoTracks()[0];
    if (track) track.onended = stopScreen;
    setStatus('Screen sharing to everyone.');
  } catch { alert('Screen share was cancelled or blocked.'); }
}

async function stopScreen() {
  screenEnabled = false;
  setActive(els.screen, false);
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;
  const tile = $('tile-local-screen');
  if (tile) tile.remove();
  await syncTracksToPeers();
  showEmpty();
  setStatus('Screen share stopped.');
}

async function syncTracksToPeers() {
  for (const [peerId, pc] of peers) await syncTracks(peerId, pc);
}

async function syncTracks(peerId, pc) {
  let pack = senders.get(peerId);
  if (!pack) { pack = {}; senders.set(peerId, pack); }

  const audioTrack = localStream?.getAudioTracks()[0] || null;
  const videoTrack = localStream?.getVideoTracks()[0] || null;
  const screenVideoTrack = screenStream?.getVideoTracks()[0] || null;
  const screenAudioTrack = screenStream?.getAudioTracks()[0] || null;

  pack.audio = await replaceOrAdd(pc, pack.audio, audioTrack, localStream);
  pack.video = await replaceOrAdd(pc, pack.video, videoTrack, localStream);
  pack.screen = await replaceOrAdd(pc, pack.screen, screenVideoTrack, screenStream);
  pack.screenAudio = await replaceOrAdd(pc, pack.screenAudio, screenAudioTrack, screenStream);
}

async function replaceOrAdd(pc, sender, track, stream) {
  if (sender) {
    try { await sender.replaceTrack(track); } catch {}
    return sender;
  }
  if (track && stream) return pc.addTrack(track, stream);
  return null;
}

async function createPeer(peerId, initiator) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(peerId, pc);
  await syncTracks(peerId, pc);

  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { to: peerId, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (!stream) return;
    const kind = stream.getVideoTracks().some(t => /screen|display/i.test(t.label)) ? 'screen' : 'camera';
    remoteStreams.set(`${peerId}-${stream.id}`, stream);
    renderTile(`${peerId}-${stream.id}`, stream, `${names.get(peerId) || 'Participant'}${kind === 'screen' ? ' · screen' : ''}`, false, kind);
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) setStatus('A participant connection changed. If video fails, TURN server may be needed.');
  };
  pc.onnegotiationneeded = async () => {
    if (!initiator) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: peerId, data: { description: pc.localDescription } });
    } catch {}
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, data: { description: pc.localDescription } });
  }
  return pc;
}

function renderTile(id, stream, label, local, type = 'camera') {
  clearEmpty();
  const tileId = `tile-${css(id)}`;
  let tile = $(tileId);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = tileId;
    tile.className = `video-tile ${type}`;
    tile.innerHTML = `<video autoplay playsinline ${local ? 'muted' : ''}></video><div class="name-tag"></div><div class="tile-controls"><button data-act="mute">◎</button><button data-act="pin">□</button><button data-act="full">⛶</button></div>`;
    els.videoGrid.appendChild(tile);
    tile.querySelector('[data-act="mute"]').onclick = () => { const v = tile.querySelector('video'); v.muted = !v.muted; };
    tile.querySelector('[data-act="pin"]').onclick = () => tile.classList.toggle('pinned');
    tile.querySelector('[data-act="full"]').onclick = () => tile.requestFullscreen?.();
  }
  tile.className = `video-tile ${type}`;
  tile.querySelector('video').srcObject = stream;
  tile.querySelector('video').muted = Boolean(local);
  tile.querySelector('.name-tag').textContent = label;
}

function css(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function removePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();
  peers.delete(peerId);
  senders.delete(peerId);
  [...document.querySelectorAll(`[id^="tile-${css(peerId)}"]`)].forEach(x => x.remove());
  showEmpty();
}

function sendChat(e) {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text || !currentRoom) return;
  socket.emit('chat', { text, to: els.recipient.value });
  els.messageInput.value = '';
}

function addSystem(text) { addMessage({ system: true, text, time: Date.now() }); }
function addMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.system ? 'system' : ''} ${msg.id === myId ? 'me' : ''}`;
  if (msg.system) div.textContent = msg.text;
  else {
    const tag = msg.private ? 'Private' : 'Room';
    const time = new Date(msg.time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${escapeHtml(msg.text)}<small>${escapeHtml(msg.name)} · ${time} · ${tag}</small>`;
  }
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  if (!msg.system && msg.id !== myId && !els.chatDrawer.classList.contains('open')) { unread++; updateBadge(); }
}

function sendSnap() {
  const file = els.snapInput.files?.[0];
  els.snapInput.value = '';
  if (!file || !currentRoom) return;
  if (!/^image\//.test(file.type) && !/^video\//.test(file.type) && !/^audio\//.test(file.type)) return alert('Send image, video or audio only.');
  if (file.size > 35 * 1024 * 1024) return alert('Max snap size is 35 MB.');
  const reader = new FileReader();
  reader.onload = () => socket.emit('snap', { fileName: file.name, fileType: file.type, fileSize: file.size, data: reader.result, to: els.recipient.value, ttl: 8 });
  reader.readAsDataURL(file);
}

let snapTimerInterval = null;
function showSnap(snap) {
  els.snapViewer.classList.remove('hidden');
  els.snapFrom.textContent = `${snap.name || 'Someone'} sent ${snap.private ? 'a private snap' : 'a snap'}`;
  let html = '';
  if (snap.fileType.startsWith('image/')) html = `<img src="${snap.data}" alt="snap">`;
  else if (snap.fileType.startsWith('video/')) html = `<video src="${snap.data}" autoplay controls playsinline></video>`;
  else if (snap.fileType.startsWith('audio/')) html = `<audio src="${snap.data}" autoplay controls></audio>`;
  els.snapContent.innerHTML = html;
  let left = Number(snap.ttl || 8);
  clearInterval(snapTimerInterval);
  els.snapTimer.textContent = `${left}s`;
  snapTimerInterval = setInterval(() => {
    left--;
    els.snapTimer.textContent = `${left}s`;
    if (left <= 0) {
      clearInterval(snapTimerInterval);
      els.snapContent.innerHTML = '';
      els.snapViewer.classList.add('hidden');
    }
  }, 1000);
}

socket.on('room-users', ({ users, max }) => updatePeople(users, max));
socket.on('peer-joined', async (user) => { names.set(user.id, user.name); addSystem(`${user.name} joined.`); await createPeer(user.id, false); });
socket.on('peer-left', ({ id, name }) => { addSystem(`${name || 'Someone'} left.`); removePeer(id); });
socket.on('chat', addMessage);
socket.on('snap', showSnap);
socket.on('signal', async ({ from, data }) => {
  const pc = await createPeer(from, false);
  try {
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate);
    }
  } catch (e) { console.warn(e); }
});

window.addEventListener('beforeunload', () => {
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
});
