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
  // NEW: Tracks when the message was read. If null, it is unread.
  readAt: { type: Date, default: null },
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
app.get('/openai.png', (req, res) => { res.sendFile(__dirname + '/openai.png'); });

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('join', async ({ code, username }) => {
    if (code === SECRET_CODE) {
      currentUser = username;
      socket.emit('auth-success');
      
      // 1. MARK MESSAGES AS READ
      // Find all messages NOT sent by me, that are currently Unread, and mark them Read
      await Message.updateMany(
        { username: { $ne: currentUser }, readAt: null },
        { $set: { readAt: new Date() } }
      );

      // 2. Notify the other person that I read their messages
      socket.broadcast.emit('messages-read');

      // 3. Load History
      const history = await Message.find().sort({ timestamp: 1 }).limit(50);
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
      fileName: data.fileName || "",
      type: data.type || 'text',
      readAt: null // Starts as unread
    });

    await newMsg.save();
    io.emit('chat message', newMsg);
  });

  // If user is live and looking at screen, mark incoming as read instantly
  socket.on('mark-as-read', async (msgId) => {
      await Message.findByIdAndUpdate(msgId, { readAt: new Date() });
      socket.broadcast.emit('single-msg-read', msgId);
  });

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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
