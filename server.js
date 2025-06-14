const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// مدیریت چنل‌ها و کاربران
const channels = new Map();
const userSessions = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// مدیریت اتصالات Socket.io
io.on('connection', (socket) => {
  console.log(`کاربر متصل شد: ${socket.id}`);

  // مدیریت session کاربر
  const userSession = {
    id: socket.id,
    callAttempts: 0,
    lastCallTime: 0,
    currentCall: null
  };
  userSessions.set(socket.id, userSession);

  // پیوستن به چنل (بدون callback)
  socket.on('joinChannel', (data) => {
    try {
      const { username, channel } = data;
      
      if (!username || !channel) {
        throw new Error('نام کاربری و چنل ضروری است');
      }

      // ذخیره اطلاعات کاربر
      socket.username = username;
      socket.channel = channel;
      userSession.channel = channel;

      // مدیریت چنل‌ها
      if (!channels.has(channel)) {
        channels.set(channel, new Set());
      }
      channels.get(channel).add(socket.id);

      // پیوستن به اتاق
      socket.join(channel);
      
      // اطلاع به کاربران چنل
      io.to(channel).emit('message', {
        username: 'سیستم',
        text: `${username} به چنل پیوست.`,
        isSystem: true,
        timestamp: Date.now()
      });

    } catch (err) {
      console.error('خطا در پیوستن به چنل:', err);
      socket.emit('joinError', { error: err.message });
    }
  });

  // ارسال پیام (بدون callback)
  socket.on('sendMessage', (message) => {
    try {
      if (!socket.channel || !socket.username) {
        throw new Error('شما به هیچ چنلی ملحق نشده‌اید');
      }

      io.to(socket.channel).emit('message', {
        username: socket.username,
        text: message,
        isSystem: false,
        timestamp: Date.now()
      });

    } catch (err) {
      console.error('خطا در ارسال پیام:', err);
      socket.emit('messageError', { error: err.message });
    }
  });

  // دریافت لیست کاربران چنل (با callback)
  socket.on('getUsersInChannel', (channel, callback) => {
    try {
      const users = [];
      const room = io.sockets.adapter.rooms.get(channel);
      
      if (room) {
        room.forEach(userId => {
          const userSocket = io.sockets.sockets.get(userId);
          if (userSocket && userSocket.username) {
            users.push({
              id: userId,
              username: userSocket.username
            });
          }
        });
      }
      
      callback({ success: true, users });
    } catch (err) {
      console.error('خطا در دریافت کاربران چنل:', err);
      callback({ success: false, error: err.message });
    }
  });

  // مدیریت تماس‌های صوتی (بدون callback)
  socket.on('offer', (data) => {
    try {
      if (userSession.callAttempts > 5) {
        throw new Error('تعداد تماس‌های شما به حد مجاز رسیده است');
      }

      if (userSession.currentCall) {
        throw new Error('شما در حال حاضر در یک تماس هستید');
      }

      userSession.callAttempts++;
      userSession.lastCallTime = Date.now();
      userSession.currentCall = data.target;

      socket.to(data.target).emit('offer', {
        sender: socket.id,
        offer: data.offer,
        username: socket.username,
        timestamp: Date.now()
      });

      // تایم‌اوت تماس
      setTimeout(() => {
        if (userSession.currentCall === data.target) {
          socket.emit('callTimeout');
          resetCallSession(socket.id);
        }
      }, 15000); // 15 ثانیه

    } catch (err) {
      console.error('خطا در ارسال offer:', err);
      socket.emit('callError', { error: err.message });
    }
  });

  // پاسخ به تماس (بدون callback)
  socket.on('answer', (data) => {
    try {
      socket.to(data.target).emit('answer', {
        sender: socket.id,
        answer: data.answer,
        timestamp: Date.now()
      });
      resetCallSession(socket.id);
    } catch (err) {
      console.error('خطا در ارسال answer:', err);
    }
  });

  // ارسال ICE candidate (بدون callback)
  socket.on('candidate', (data) => {
    try {
      socket.to(data.target).emit('candidate', {
        sender: socket.id,
        candidate: data.candidate,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('خطا در ارسال candidate:', err);
    }
  });

  // رد تماس (بدون callback)
  socket.on('callRejected', (data) => {
    try {
      socket.to(data.target).emit('callRejected', {
        sender: socket.id,
        timestamp: Date.now()
      });
      resetCallSession(socket.id);
    } catch (err) {
      console.error('خطا در ارسال callRejected:', err);
    }
  });

  // پایان تماس (بدون callback)
  socket.on('endCall', (data) => {
    try {
      if (userSession.currentCall) {
        socket.to(userSession.currentCall).emit('callEnded', {
          reason: 'تماس توسط طرف مقابل قطع شد',
          sender: socket.id
        });
        resetCallSession(socket.id);
      }
    } catch (err) {
      console.error('خطا در پایان تماس:', err);
    }
  });

  // قطع ارتباط
  socket.on('disconnect', () => {
    try {
      if (socket.channel && socket.username) {
        // حذف از چنل
        if (channels.has(socket.channel)) {
          channels.get(socket.channel).delete(socket.id);
        }

        // اطلاع به سایر کاربران
        io.to(socket.channel).emit('message', {
          username: 'سیستم',
          text: `${socket.username} چت را ترک کرد.`,
          isSystem: true,
          timestamp: Date.now()
        });
      }

      // پایان تماس اگر در حال انجام بود
      if (userSession.currentCall) {
        socket.to(userSession.currentCall).emit('callEnded', {
          sender: socket.id,
          reason: 'کاربر قطع شد',
          timestamp: Date.now()
        });
      }

      // حذف session
      userSessions.delete(socket.id);
    } catch (err) {
      console.error('خطا در disconnect:', err);
    }
  });
});

// تابع کمکی برای ریست session تماس
function resetCallSession(userId) {
  if (userSessions.has(userId)) {
    const session = userSessions.get(userId);
    session.currentCall = null;
  }
}

// مدیریت خطاهای全局
process.on('uncaughtException', (err) => {
  console.error('خطای catch نشده:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejection catch نشده:', err);
});

// شروع سرور
server.listen(PORT, () => {
  console.log(`سرور در حال اجرا روی پورت ${PORT}`);
});