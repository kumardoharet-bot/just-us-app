const socket = io();
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const els = {
  login: document.getElementById('loginScreen'), name: document.getElementById('nameInput'), room: document.getElementById('roomInput'), password: document.getElementById('passwordInput'), roomLabelInput: document.getElementById('roomLabelInput'),
  createRoom: document.getElementById('createRoomBtn'), joinRoom: document.getElementById('joinRoomBtn'), copyInvite: document.getElementById('copyInviteBtn'), invite: document.getElementById('inviteText'),
  profileName: document.getElementById('profileName'), myAvatar: document.getElementById('myAvatar'), status: document.getElementById('statusText'), roomTitle: document.getElementById('roomTitle'), roomLabel: document.getElementById('roomLabel'), chatRoomLabel: document.getElementById('chatRoomLabel'),
  memberCount: document.getElementById('memberCount'), people: document.getElementById('peopleList'), videos: document.getElementById('videos'), recipient: document.getElementById('recipientSelect'),
  notify: document.getElementById('notifyBtn'), camera: document.getElementById('cameraBtn'), screen: document.getElementById('screenBtn'), videoToggle: document.getElementById('videoToggleBtn'), mute: document.getElementById('muteBtn'), stopMedia: document.getElementById('stopMediaBtn'), speaker: document.getElementById('speakerBtn'), leave: document.getElementById('leaveBtn'),
  messages: document.getElementById('messages'), messageForm: document.getElementById('messageForm'), messageInput: document.getElementById('messageInput'), fileBtn: document.getElementById('fileBtn'), fileInput: document.getElementById('fileInput'), encryptToggle: document.getElementById('encryptToggle'), secret: document.getElementById('secretInput'),
  watchInput: document.getElementById('watchInput'), loadWatch: document.getElementById('loadWatchBtn'), watchArea: document.getElementById('watchArea'),
  chatToggle: document.getElementById('chatToggle'), chatClose: document.getElementById('chatClose'), chatDrawer: document.getElementById('chatDrawer'), chatBadge: document.getElementById('chatBadge')
};

let myId = null, currentRoom = '', muted = false, videoOff = false, unreadMessages = 0;
let cameraStream = null, screenStream = null, mixedScreenStream = null;
let cameraTrackIds = new Set(), screenTrackIds = new Set();
const peers = new Map(), names = new Map();

const urlRoom = new URLSearchParams(location.search).get('room');
els.name.value = localStorage.getItem('just-us-name') || '';
if (urlRoom) { els.room.value = urlRoom; els.room.readOnly = true; els.roomLabelInput.textContent = 'Room from invite link'; els.createRoom.style.display = 'none'; }

els.createRoom.onclick = () => { els.room.value = 'room-' + crypto.randomUUID().slice(0, 8); if (!els.password.value) els.password.value = crypto.randomUUID().slice(0, 8); joinRoom(); };
els.joinRoom.onclick = joinRoom;
els.copyInvite.onclick = copyInvite;
els.notify.onclick = enableNotifications;
els.camera.onclick = startCamera;
els.screen.onclick = shareScreen;
els.videoToggle.onclick = toggleVideo;
els.mute.onclick = toggleMute;
els.stopMedia.onclick = stopAllMedia;
els.speaker.onclick = enableRemoteAudio;
els.leave.onclick = () => location.reload();
els.loadWatch.onclick = shareWatchLink;
els.messageForm.onsubmit = sendMessage;
els.fileBtn.onclick = () => els.fileInput.click();
els.fileInput.onchange = shareFiles;
els.chatToggle.onclick = () => setChatOpen(!els.chatDrawer.classList.contains('open'));
els.chatClose.onclick = () => setChatOpen(false);

function setStatus(text) { els.status.textContent = text; }
function initials(name) { return (name || 'ME').split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase(); }
function escapeHtml(text) { return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function setInvite(roomId) { const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`; els.invite.textContent = url; history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`); }
function notify(title, body) { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); }
function setChatOpen(open) { els.chatDrawer.classList.toggle('open', open); if (open) { unreadMessages = 0; updateChatBadge(); setTimeout(() => els.messages.scrollTop = els.messages.scrollHeight, 40); } }
function updateChatBadge() { els.chatBadge.textContent = unreadMessages > 9 ? '9+' : String(unreadMessages); els.chatBadge.style.display = unreadMessages > 0 ? 'grid' : 'none'; }
function bumpUnread() { if (!els.chatDrawer.classList.contains('open')) { unreadMessages++; updateChatBadge(); } }
function getRecipientName(id) { return id === 'all' ? 'Everyone' : (names.get(id) || 'Private'); }

function addMessage({ id, name, text, time, system, private: isPrivate, encrypted }) {
  const div = document.createElement('div');
  div.className = 'message' + (id && id === myId ? ' me' : '') + (system ? ' system' : '') + (isPrivate || encrypted ? ' private' : '');
  const when = new Date(time || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const tag = encrypted ? 'Encrypted private' : isPrivate ? 'Private' : 'Room';
  div.innerHTML = system ? escapeHtml(text) : `${escapeHtml(text)}<small>${escapeHtml(name || 'Guest')} · ${when} · ${tag}</small>`;
  els.messages.appendChild(div); els.messages.scrollTop = els.messages.scrollHeight;
  if (!system && id !== myId) { notify(name || 'New message', text); bumpUnread(); }
}
function addSystem(text) { addMessage({ text, system:true, time:Date.now() }); }

function addFileMessage({ id, name, fileName, fileType, fileSize, data, time, private: isPrivate }) {
  const div = document.createElement('div');
  div.className = 'message' + (id === myId ? ' me' : '') + (isPrivate ? ' private' : '');
  const when = new Date(time || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  let preview = '';
  if (fileType.startsWith('image/')) preview = `<img src="${data}" alt="${escapeHtml(fileName)}" />`;
  else if (fileType.startsWith('video/')) preview = `<video src="${data}" controls></video>`;
  else if (fileType.startsWith('audio/')) preview = `<audio src="${data}" controls></audio>`;
  div.innerHTML = `<div class="file-message"><strong>${escapeHtml(fileName)}</strong><br><span>${formatBytes(fileSize)} · ${escapeHtml(fileType || 'file')}</span>${preview}<br><a href="${data}" download="${escapeHtml(fileName)}">Download</a></div><small>${escapeHtml(name || 'Guest')} · ${when} · ${isPrivate ? 'Private file' : 'Room file'}</small>`;
  els.messages.appendChild(div); els.messages.scrollTop = els.messages.scrollHeight;
  if (id !== myId) { notify(`${name || 'Someone'} shared a file`, fileName); bumpUnread(); }
}
function formatBytes(bytes) { if (!bytes) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(1024)); return `${(bytes/Math.pow(1024,i)).toFixed(i?1:0)} ${u[i]}`; }

async function joinRoom() {
  const name = els.name.value.trim() || 'Guest', roomId = els.room.value.trim(), password = els.password.value;
  if (!roomId || !password) return alert('Room code and password are required.');
  localStorage.setItem('just-us-name', name);
  socket.emit('join-room', { roomId, name, password }, async (res) => {
    if (!res?.ok) return alert(res?.error || 'Could not join.');
    myId = res.id; currentRoom = roomId; els.login.classList.add('hidden');
    els.profileName.textContent = name; els.myAvatar.textContent = initials(name); els.roomTitle.textContent = roomId; els.roomLabel.textContent = 'Password-protected room is active'; els.chatRoomLabel.textContent = roomId;
    setInvite(roomId); setStatus('Online'); updatePeople(res.users || [], res.max || 20); addSystem(`Joined ${roomId}. Multiple rooms can run at the same time.`); setChatOpen(false);
    for (const user of res.existingUsers || []) { names.set(user.id, user.name); await createPeer(user.id, true); }
  });
}
async function copyInvite() { if (!currentRoom) return alert('Join a room first.'); await navigator.clipboard.writeText(els.invite.textContent); alert('Invite link copied. Your friend only needs the password after opening it.'); }
async function enableNotifications() { if (!('Notification' in window)) return alert('Notifications are not supported.'); const p = await Notification.requestPermission(); els.notify.querySelector('.control-label').textContent = p === 'granted' ? 'Notifications on' : 'Notifications'; }
function updatePeople(users, max = 20) {
  els.memberCount.textContent = `${users.length} / ${max}`; els.people.innerHTML = ''; els.recipient.innerHTML = '<option value="all">Everyone</option>';
  users.forEach(user => { names.set(user.id,user.name); const li=document.createElement('li'); li.innerHTML=`<span><span class="online-dot"></span>${escapeHtml(user.name)}${user.id===myId?' (you)':''}</span><span>online</span>`; els.people.appendChild(li); if (user.id !== myId) { const opt=document.createElement('option'); opt.value=user.id; opt.textContent=user.name; els.recipient.appendChild(opt); } });
}

const MEDIA_CONSTRAINTS = { video:{ width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:24,max:30} }, audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 } };
function applyLocalToggles(){ cameraStream?.getAudioTracks().forEach(t=>t.enabled=!muted); cameraStream?.getVideoTracks().forEach(t=>t.enabled=!videoOff); mixedScreenStream?.getAudioTracks().forEach(t=>t.enabled=!muted); }
async function startCamera(){
  try{
    if (cameraStream) { stopCamera(); return; }
    cameraStream=await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
    videoOff=false; els.videoToggle.querySelector('.control-label').textContent='Video off'; els.camera.querySelector('.control-label').textContent='Stop camera'; applyLocalToggles();
    cameraTrackIds = new Set(cameraStream.getTracks().map(t=>t.id));
    renderVideo('local-camera',cameraStream,'You · camera',true); addLocalTracksToAll(cameraStream); setStatus('Camera and mic broadcasting');
  }catch{ alert('Camera or microphone permission was blocked.'); }
}
async function shareScreen(){
  try{
    if (mixedScreenStream) { stopScreen(); return; }
    mixedScreenStream = await getScreenStreamWithAudio();
    screenTrackIds = new Set(mixedScreenStream.getTracks().map(t=>t.id));
    els.screen.querySelector('.control-label').textContent='Stop screen'; renderVideo('local-screen',mixedScreenStream,'You · screen',true); addLocalTracksToAll(mixedScreenStream); setStatus('Screen sharing to everyone');
    mixedScreenStream.getVideoTracks()[0]?.addEventListener('ended', stopScreen);
  }catch{ alert('Screen share was cancelled or blocked.'); }
}
async function getScreenStreamWithAudio(){
  screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
  const out = new MediaStream(); screenStream.getVideoTracks().forEach(t=>out.addTrack(t));
  let mic = null; try { if (!cameraStream) mic = await navigator.mediaDevices.getUserMedia({ video:false, audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } }); } catch {}
  const audioTracks = [...screenStream.getAudioTracks(), ...(mic ? mic.getAudioTracks() : []), ...(cameraStream ? cameraStream.getAudioTracks() : [])];
  if (audioTracks.length === 1) out.addTrack(audioTracks[0]);
  else if (audioTracks.length > 1) {
    const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx(); const dest = ctx.createMediaStreamDestination();
    audioTracks.forEach(track => ctx.createMediaStreamSource(new MediaStream([track])).connect(dest));
    dest.stream.getAudioTracks().forEach(t=>out.addTrack(t));
  }
  return out;
}
function stopCamera(){ const ids = new Set(cameraTrackIds); cameraStream?.getTracks().forEach(t=>t.stop()); cameraStream=null; cameraTrackIds = new Set(); removeLocalSenders(ids); document.getElementById('tile-local-camera')?.remove(); els.camera.querySelector('.control-label').textContent='Start camera'; resetStageIfEmpty(); setStatus('Camera stopped'); }
function stopScreen(){ const ids = new Set(screenTrackIds); screenStream?.getTracks().forEach(t=>t.stop()); mixedScreenStream?.getTracks().forEach(t=>t.stop()); screenStream=null; mixedScreenStream=null; screenTrackIds = new Set(); removeLocalSenders(ids); document.getElementById('tile-local-screen')?.remove(); els.screen.querySelector('.control-label').textContent='Share screen'; resetStageIfEmpty(); setStatus('Screen share stopped'); }
function stopAllMedia(){ stopCamera(); stopScreen(); }
function toggleVideo(){ if(!cameraStream)return alert('Start camera first.'); videoOff=!videoOff; cameraStream.getVideoTracks().forEach(t=>t.enabled=!videoOff); els.videoToggle.querySelector('.control-label').textContent=videoOff?'Video on':'Video off'; }

async function enableRemoteAudio(){
  document.querySelectorAll('video').forEach(v => {
    if (!v.id?.includes('local')) v.muted = false;
    v.volume = 1;
    const play = v.play();
    if (play && play.catch) play.catch(()=>{});
  });
  els.speaker.querySelector('.control-label').textContent = 'Audio enabled';
  setStatus('Remote audio enabled');
}

function toggleMute(){ if(!cameraStream && !mixedScreenStream)return alert('Start camera or screen share first.'); muted=!muted; applyLocalToggles(); els.mute.querySelector('.control-label').textContent=muted?'Unmute mic':'Mute mic'; }
function addLocalTracksToAll(stream){ for(const [peerId,pc] of peers){ stream.getTracks().forEach(track => pc.addTrack(track, stream)); renegotiate(peerId, pc); } }
function removeLocalSenders(trackIds){ for(const [peerId,pc] of peers){ const senders=pc.getSenders().filter(s=>s.track && trackIds.has(s.track.id)); senders.forEach(s=>{ try{pc.removeTrack(s)}catch{} }); renegotiate(peerId, pc); } }

async function createPeer(peerId, initiator){
  if(peers.has(peerId)) return peers.get(peerId);
  const pc=new RTCPeerConnection({ iceServers:ICE_SERVERS }); peers.set(peerId,pc);
  pc.onicecandidate=e=>{ if(e.candidate) socket.emit('signal',{to:peerId,data:{candidate:e.candidate}}); };
  pc.ontrack=e=>renderVideo(`${peerId}-${e.streams[0].id}`,e.streams[0],`${names.get(peerId)||'Friend'} · live`);
  pc.onconnectionstatechange=()=>{ if(['failed','closed','disconnected'].includes(pc.connectionState)) removePeer(peerId); };
  [cameraStream,mixedScreenStream].filter(Boolean).forEach(stream=>stream.getTracks().forEach(track=>pc.addTrack(track,stream)));
  if(initiator){ const offer=await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('signal',{to:peerId,data:{description:pc.localDescription}}); }
  return pc;
}
async function renegotiate(peerId,pc){ try{ const offer=await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('signal',{to:peerId,data:{description:pc.localDescription}}); }catch{} }
function renderVideo(id,stream,label,mutedLocal=false){
  els.videos.querySelector('.empty-state')?.remove(); let tile=document.getElementById(`tile-${cssId(id)}`);
  if(!tile){ tile=document.createElement('div'); tile.className='video-tile'; tile.id=`tile-${cssId(id)}`; tile.innerHTML=`<video autoplay playsinline></video><div class="tile-controls"><button data-action="mute">Mute</button><button data-action="pin">Pin</button><button data-action="full">Full</button></div><div class="name-tag"></div>`; els.videos.appendChild(tile); const video=tile.querySelector('video'); tile.querySelector('[data-action="mute"]').onclick=()=>{video.muted=!video.muted; tile.querySelector('[data-action="mute"]').textContent=video.muted?'Unmute':'Mute'}; tile.querySelector('[data-action="pin"]').onclick=()=>tile.classList.toggle('pinned'); tile.querySelector('[data-action="full"]').onclick=()=>tile.requestFullscreen?.(); }
  const video=tile.querySelector('video'); video.srcObject=stream; video.muted=!!mutedLocal; video.volume = mutedLocal ? 0 : 1; const p=video.play(); if(p&&p.catch)p.catch(()=>{}); tile.querySelector('.name-tag').textContent=label;
}
function cssId(id){ return String(id).replace(/[^a-zA-Z0-9_-]/g,'_'); }
function removePeer(peerId){ const pc=peers.get(peerId); if(pc) pc.close(); peers.delete(peerId); [...document.querySelectorAll(`[id^="tile-${cssId(peerId)}"]`)].forEach(x=>x.remove()); resetStageIfEmpty(); }
function resetStageIfEmpty(){ if(!els.videos.querySelector('.video-tile')) els.videos.innerHTML='<div class="empty-state">Join a room, then enable camera or screen share.</div>'; }

async function sendMessage(e){
  e.preventDefault(); if(!currentRoom)return alert('Join a room first.'); const text=els.messageInput.value.trim(); if(!text)return; const to=els.recipient.value;
  if(els.encryptToggle.checked){ if(to==='all') return alert('Encrypted private text needs one selected person.'); if(!els.secret.value) return alert('Enter a shared secret key.'); const payload=await encryptText(text, els.secret.value); socket.emit('private-encrypted-message',{to,payload}); }
  else socket.emit('chat-message',{text,to});
  els.messageInput.value='';
}
function shareFiles(){ if(!currentRoom)return alert('Join a room first.'); const files=[...els.fileInput.files]; const to=els.recipient.value; files.forEach(file=>{ if(file.size>20*1024*1024) return alert(`${file.name} is too large. Max 20 MB.`); const reader=new FileReader(); reader.onload=()=>socket.emit('file-share',{name:file.name,type:file.type,size:file.size,data:reader.result,to}); reader.readAsDataURL(file); }); els.fileInput.value=''; }
async function encryptText(text, secret){ const iv=crypto.getRandomValues(new Uint8Array(12)); const key=await deriveKey(secret); const data=new TextEncoder().encode(text); const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data); return { iv:Array.from(iv), cipher:Array.from(new Uint8Array(cipher)) }; }
async function decryptText(payload, secret){ const key=await deriveKey(secret); const iv=new Uint8Array(payload.iv); const cipher=new Uint8Array(payload.cipher); const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher); return new TextDecoder().decode(plain); }
async function deriveKey(secret){ const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)); return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']); }

function shareWatchLink(){ if(!currentRoom)return alert('Join a room first.'); const url=els.watchInput.value.trim(); if(!url)return; socket.emit('watch-link',{url}); }
function loadWatchUrl(url,name){ const embed=toEmbedUrl(url); if(embed) els.watchArea.innerHTML=`<iframe src="${embed}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`; else els.watchArea.innerHTML=`<div>Shared link:<br><br><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a><br><br>For Instagram or blocked sites, use screen share.</div>`; addSystem(`${name || 'Someone'} shared a watch link.`); }
function toEmbedUrl(url){ try{ const u=new URL(url); if(u.hostname.includes('youtube.com')){ const id=u.searchParams.get('v'); return id?`https://www.youtube.com/embed/${id}`:null; } if(u.hostname.includes('youtu.be')) return `https://www.youtube.com/embed/${u.pathname.slice(1)}`; if(u.hostname.includes('vimeo.com')){ const id=u.pathname.split('/').filter(Boolean)[0]; return id?`https://player.vimeo.com/video/${id}`:null; } return null; }catch{return null;} }

socket.on('room-users',(users)=>updatePeople(users,20));
socket.on('user-joined',async user=>{ names.set(user.id,user.name); addSystem(`${user.name} joined.`); notify('Just Us', `${user.name} joined`); await createPeer(user.id,false); });
socket.on('user-left',({id})=>{ addSystem(`${names.get(id)||'Someone'} left.`); removePeer(id); });
socket.on('chat-message',addMessage);
socket.on('file-share',addFileMessage);
socket.on('private-encrypted-message',async msg=>{ let text='Encrypted message received. Enter the same secret key, then ask them to resend if this cannot decrypt.'; try{ if(els.secret.value) text=await decryptText(msg.payload,els.secret.value); }catch{} addMessage({id:msg.id,name:msg.name,text,encrypted:true,private:true,time:msg.time}); });
socket.on('watch-link',({url,name})=>loadWatchUrl(url,name));
socket.on('signal',async({from,data})=>{ const pc=await createPeer(from,false); if(data.description){ await pc.setRemoteDescription(data.description); if(data.description.type==='offer'){ const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('signal',{to:from,data:{description:pc.localDescription}}); } } else if(data.candidate){ try{ await pc.addIceCandidate(data.candidate); }catch{} } });
