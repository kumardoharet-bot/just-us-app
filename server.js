const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 32 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE || 20);
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function safeText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}
function getRoomUsers(roomId) {
  return Array.from(rooms.get(roomId)?.users.values() || []);
}
function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  room.users.delete(socket.id);
  socket.to(roomId).emit('user-left', { id: socket.id });
  io.to(roomId).emit('room-users', getRoomUsers(roomId));
  if (room.users.size === 0) rooms.delete(roomId);
  socket.leave(roomId);
  socket.data.roomId = null;
}
function userInSameRoom(socket, targetId) {
  const roomId = socket.data.roomId;
  if (!roomId) return false;
  return rooms.get(roomId)?.users.has(targetId);
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name, password }, callback) => {
    try {
      roomId = safeText(roomId, 64);
      name = safeText(name || 'Guest', 32);
      password = String(password || '').slice(0, 100);
      if (!roomId) return callback?.({ ok: false, error: 'Room code is required.' });
      if (!rooms.has(roomId)) rooms.set(roomId, { password, users: new Map(), createdAt: Date.now() });
      const room = rooms.get(roomId);
      if (room.password !== password) return callback?.({ ok: false, error: 'Wrong room password.' });
      if (!room.users.has(socket.id) && room.users.size >= MAX_ROOM_SIZE) return callback?.({ ok: false, error: `Room is full. Max ${MAX_ROOM_SIZE} people.` });

      leaveCurrentRoom(socket);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = name;
      room.users.set(socket.id, { id: socket.id, name });

      const existingUsers = getRoomUsers(roomId).filter((u) => u.id !== socket.id);
      callback?.({ ok: true, id: socket.id, existingUsers, users: getRoomUsers(roomId), max: MAX_ROOM_SIZE });
      socket.to(roomId).emit('user-joined', { id: socket.id, name });
      io.to(roomId).emit('room-users', getRoomUsers(roomId));
    } catch {
      callback?.({ ok: false, error: 'Could not join room.' });
    }
  });

  socket.on('chat-message', ({ text, to }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const safe = safeText(text, 1500);
    if (!safe) return;
    const payload = { id: socket.id, name: socket.data.name || 'Guest', text: safe, to: to || 'all', time: Date.now() };
    if (to && to !== 'all' && userInSameRoom(socket, to)) {
      io.to(to).emit('chat-message', { ...payload, private: true });
      socket.emit('chat-message', { ...payload, private: true });
    } else {
      io.to(roomId).emit('chat-message', payload);
    }
  });

  socket.on('private-encrypted-message', ({ to, payload }) => {
    if (!to || !userInSameRoom(socket, to) || !payload) return;
    const out = { id: socket.id, name: socket.data.name || 'Guest', to, payload, encrypted: true, time: Date.now() };
    io.to(to).emit('private-encrypted-message', out);
    socket.emit('private-encrypted-message', out);
  });

  socket.on('file-share', ({ name, type, size, data, to }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const fileName = safeText(name || 'file', 120);
    const fileType = safeText(type || 'application/octet-stream', 120);
    const fileSize = Number(size || 0);
    const fileData = String(data || '');
    if (!fileData || fileSize > 20 * 1024 * 1024) return;
    const payload = { id: socket.id, name: socket.data.name || 'Guest', fileName, fileType, fileSize, data: fileData, to: to || 'all', private: Boolean(to && to !== 'all'), time: Date.now() };
    if (to && to !== 'all' && userInSameRoom(socket, to)) {
      io.to(to).emit('file-share', payload);
      socket.emit('file-share', payload);
    } else {
      io.to(roomId).emit('file-share', payload);
    }
  });

  socket.on('watch-link', ({ url }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const safeUrl = safeText(url, 800);
    if (!safeUrl) return;
    io.to(roomId).emit('watch-link', { id: socket.id, name: socket.data.name || 'Guest', url: safeUrl, time: Date.now() });
  });

  socket.on('signal', ({ to, data }) => {
    if (!to || !data || !userInSameRoom(socket, to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Just Us running at http://localhost:${PORT}`);
  console.log(`Same Wi-Fi users open http://YOUR-IP:${PORT}`);
});
