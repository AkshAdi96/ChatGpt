const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e7 });

const MONGO_URI = process.env.MONGO_URI; 
const SECRET_CODE = process.env.SECRET_CODE || "1234";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error(err));

const messageSchema = new mongoose.Schema({
  username: String,
  text: String,
  fileName: String, 
  type: { type: String, enum: ['text', 'image', 'document', 'audio'], default: 'text' },
  // TTL INDEX: Messages with a date here delete themselves
  expiresAt: { type: Date, index: { expires: '0s' } }, 
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('join', async ({ code, username }) => {
    if (code === SECRET_CODE) {
      currentUser = username;
      socket.emit('auth-success');
      
      // DEFAULT: Join Normal Room
      socket.join('room-normal');
      
      // Load Normal History (Messages where expiresAt DOES NOT exist)
      const history = await Message.find({ $or: [ { expiresAt: { $exists: false } }, { expiresAt: null } ] })
                                   .sort({ timestamp: 1 }).limit(50);
      socket.emit('load-history', history);
    } else {
      socket.emit('auth-fail');
    }
  });

  // --- NEW: SWITCH MODES ---
  socket.on('switch-mode', async (mode) => {
    if (mode === 'temp') {
        socket.leave('room-normal');
        socket.join('room-temp');
        // Load Temp History (Messages where expiresAt EXISTS)
        const history = await Message.find({ expiresAt: { $exists: true, $ne: null } })
                                     .sort({ timestamp: 1 }).limit(50);
        socket.emit('load-history', history);
    } else {
        socket.leave('room-temp');
        socket.join('room-normal');
        // Load Normal History
        const history = await Message.find({ $or: [ { expiresAt: { $exists: false } }, { expiresAt: null } ] })
                                     .sort({ timestamp: 1 }).limit(50);
        socket.emit('load-history', history);
    }
  });

  socket.on('chat message', async (data) => {
    if (!currentUser) return;
    
    const msgData = {
      username: currentUser,
      text: data.text,
      fileName: data.fileName || "",
      type: data.type || 'text'
    };

    // If Temp Mode: Set Expiry and Room
    let room = 'room-normal';
    if (data.isTemp) {
      msgData.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours
      room = 'room-temp';
    }

    const newMsg = new Message(msgData);
    await newMsg.save();
    
    // SEND ONLY TO THE SPECIFIC ROOM
    io.to(room).emit('chat message', newMsg);
  });

  // Standard Events
  socket.on('typing', () => { if (currentUser) socket.broadcast.emit('display-typing', currentUser); });
  socket.on('stop-typing', () => { socket.broadcast.emit('hide-typing'); });
  
  socket.on('unsend-message', async (id) => { 
    await Message.findByIdAndDelete(id); 
    io.emit('message-unsent', id); 
  });
  
  socket.on('edit-message', async ({ messageId, newText }) => { 
    await Message.findByIdAndUpdate(messageId, { text: newText }); 
    io.emit('message-edited', { messageId, newText }); 
  });

  // Video Signaling (Broadcasts globally to ensure connection across modes)
  socket.on("call-user", (data) => socket.broadcast.emit("call-made", { offer: data.offer, socket: socket.id }));
  socket.on("make-answer", (data) => socket.to(data.to).emit("answer-made", { socket: socket.id, answer: data.answer }));
  socket.on("ice-candidate", (data) => socket.to(data.to).emit("ice-candidate", { candidate: data.candidate }));
  socket.on("hang-up", () => socket.broadcast.emit("call-ended"));
});

server.listen(3000, () => { console.log('Server running on 3000'); });
