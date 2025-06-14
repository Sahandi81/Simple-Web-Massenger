const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

// شیء برای ذخیره چنل‌ها و کاربران
const channels = {};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

io.on('connection', (socket) => {
    console.log('یک کاربر متصل شد');
    
    socket.on('joinChannel', (data) => {
        const { username, channel } = data;
        
        // ذخیره اطلاعات کاربر
        socket.username = username;
        socket.channel = channel;
        
        // ایجاد چنل اگر وجود نداشت
        if (!channels[channel]) {
            channels[channel] = [];
        }
        
        // اضافه کردن کاربر به چنل
        channels[channel].push(socket.id);
        
        // اطلاع به کاربران چنل
        socket.join(channel);
        io.to(channel).emit('message', {
            username: 'سیستم',
            text: `${username} به چنل ${channel} پیوست.`,
            isSystem: true
        });
    });
    
    socket.on('sendMessage', (message) => {
        if (socket.channel) {
            io.to(socket.channel).emit('message', {
                username: socket.username,
                text: message,
                isSystem: false
            });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.channel && socket.username) {
            // حذف کاربر از چنل
            channels[socket.channel] = channels[socket.channel].filter(id => id !== socket.id);
            
            // اطلاع به کاربران چنل
            io.to(socket.channel).emit('message', {
                username: 'سیستم',
                text: `${socket.username} چنل را ترک کرد.`,
                isSystem: true
            });
        }
    });
});

server.listen(PORT, () => {
    console.log(`سرور در حال اجرا روی پورت ${PORT}`);
});