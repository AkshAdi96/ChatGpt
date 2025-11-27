const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // Increased to 100MB for safety

const MONGO_URI = process.env.MONGO_URI; 
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB error:', err));

const messageSchema = new mongoose.Schema({
  username: String,
  text: String,
  type: { type: String, enum: ['text', 'image', 'audio'], default: 'text' },
  reactions: { type: Map, of: String },
  timestamp: { type: Date, default: Date.now },
  isEdited: { type: Boolean, default: false } // New field to track edits
});
const Message = mongoose.model('Message', messageSchema);

const SECRET_CODE = process.env.SECRET_CODE || "default";

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('join', async ({ code, username }) => {
    if (code === SECRET_CODE) {
      currentUser = username;
      socket.emit('auth-success');
      const history = await Message.find().sort({ timestamp: 1 }).limit(100);
      socket.emit('load-history', history);
    } else {
      socket.emit('auth-fail');
    }
  });

  socket.on('chat message', async (data) => {
    if (!currentUser) return;
    const newMsg = new Message({
      username: currentUser,
      text: data.text,
      type: data.type || 'text',
      reactions: {}
    });
    await newMsg.save();
    io.emit('chat message', newMsg);
  });

  // --- NEW FEATURES ---

  // 1. REACTION (Supports multiple emojis)
  socket.on('react', async ({ messageId, reaction }) => {
    if (!currentUser) return;
    const msg = await Message.findById(messageId);
    if (msg) {
      // If clicking the same reaction again, remove it (toggle)
      if (msg.reactions.get(currentUser) === reaction) {
        msg.reactions.delete(currentUser);
      } else {
        msg.reactions.set(currentUser, reaction);
      }
      await msg.save();
      io.emit('update-reaction', { messageId, reactions: msg.reactions });
    }
  });

  // 2. UNSEND (Delete)
  socket.on('unsend-message', async (messageId) => {
    // Security: Find message and check if it belongs to current user
    const msg = await Message.findById(messageId);
    if (msg && msg.username === currentUser) {
      await Message.findByIdAndDelete(messageId);
      io.emit('message-unsent', messageId);
    }
  });

  // 3. EDIT
  socket.on('edit-message', async ({ messageId, newText }) => {
    const msg = await Message.findById(messageId);
    if (msg && msg.username === currentUser) {
      msg.text = newText;
      msg.isEdited = true;
      await msg.save();
      io.emit('message-edited', { messageId, newText, isEdited: true });
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on 3000');
});
