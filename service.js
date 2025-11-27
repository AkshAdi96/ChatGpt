const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve the frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// THE SECRET CODE (We will set this in the hosting settings later)
const SECRET_CODE = process.env.SECRET_CODE || "default_password";

io.on('connection', (socket) => {
  let isAuthenticated = false;

  // 1. Listen for the code
  socket.on('auth', (code) => {
    if (code === SECRET_CODE) {
      isAuthenticated = true;
      socket.emit('auth-success'); // Tell client they are in
    } else {
      socket.emit('auth-fail'); // Tell client code is wrong
    }
  });

  // 2. Listen for chat messages
  socket.on('chat message', (msg) => {
    // Only allow message if they passed the code check
    if (isAuthenticated) {
      io.emit('chat message', msg); // Send to everyone
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});