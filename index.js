'use strict';

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');

var fileServer = new(nodeStatic.Server)();
var app = http.createServer(function(req, res) {
    fileServer.serve(req, res);
}).listen(8080,'0.0.0.0');
var room_size_limit = 100;
var student_doubt={};
var room_leader = {};

var io = socketIO.listen(app);

io.sockets.on('connection', function(socket) {

    // convenience function to log server messages on the client
    function log() {
        var array = ['Message from server:'];
        array.push.apply(array, arguments);
        socket.emit('log', array);
    }

    socket.on('create or join', function(room) {
        log('Received request to create or join room ' + room);

        var clientsInRoom = io.sockets.adapter.rooms[room];
        var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
        log('Room ' + room + ' now has ' + numClients + ' client(s)');

        if (numClients === 0) {
            socket.join(room);
            // log('Client ID ' + socket.id + ' created room ' + room);
            socket.emit('created', room, socket.id);
            room_leader[room] = socket;
			student_doubt[room]=0;
        } else if (numClients < room_size_limit) {
            // log('Client ID ' + socket.id + ' joined room ' + room);
            io.sockets.in(room).emit('join', room, socket.id);
            socket.join(room);
            socket.emit('joined', room, socket.id, room_leader[room].id);
        } else {
            // No more space for students
            socket.emit('full', room);
        }
    });

    socket.on('message', function(message, room) {
        // log('Client said: ', message);
        // for a real app, would be room-only (not broadcast)
        socket.broadcast.to(room).emit('message', message);
    });

	socket.on('doubt raised', function(room,socketID,leaderID,timestamp) {
		if(student_doubt[room]==0){
		 student_doubt[room]=socket;
		 room_leader[room].emit('approve or deny doubt', room, socketID, leaderID,timestamp);
		}
		else{
			socket.emit('asklater', room);
		}
		
    });
	socket.on('doubt answered', function(room,socketID,leaderID,answer) {
		 student_doubt[room].emit('reply student', room, socketID, leaderID,answer);
		if(answer==true)
		{
			var numClients = io.sockets.adapter.rooms[room] ? Object.keys(io.sockets.adapter.rooms[room].sockets).length : 0;
			log(numClients);
			//student_doubt.emit('send doubt video', room, student_doubt.id,Object.keys(io.sockets.adapter.rooms[room].sockets));
		}
		else
			student_doubt[room]=0;
		
		
    });
	socket.on('answer', function(room,socketID,leaderID,question,answer) {
		 io.sockets.in(room).emit('answerstudent', room, socketID, leaderID,question,answer);
		// room_leader[room].emit('answerstudent', room, socketID, leaderID,question,answer);
		student_doubt[room]=0;
		
		
    });
	socket.on('question', function(room,socketID,leaderID,question){
		student_doubt[room]=socket;
		room_leader[room].emit('question asked', room, socketID, leaderID,question);
	});

    socket.on('ipaddr', function() {
        var ifaces = os.networkInterfaces();
        for (var dev in ifaces) {
            ifaces[dev].forEach(function(details) {
                if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
                    socket.emit('ipaddr', details.address);
                }
            });
        }
    });

    socket.on('bye', function(){
        console.log('received bye');
    });

});
