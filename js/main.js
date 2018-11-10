'use strict';

var isLeader = false;
var turnReady;
var btn2;
var t;
var myID;
var roomLeaderID;
var pc = {};
var videoStream;
var teststream;
var videoSrc;
var videoCaptureStatus = false;

var pcConfig = {
    'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
    }]
};

// Set up audio and video regardless of what devices are present.
var constraints = {
    audio: true,
    video: true
};

var sdpConstraints = {
    offerToReceiveAudio: constraints.audio,
    offerToReceiveVideo: constraints.video
};

if (location.hostname !== 'localhost') {
    requestTurn(
        'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
    );
}

/////////////////////////////////////////////

// var room = 'foo';
// Could prompt for room name:
var room = prompt('Enter classroom name:');

var socket = io.connect();

if (room !== '') {
    socket.emit('create or join', room);
    console.log('Attempted to create or join room', room);
}

socket.on('created', function(room, peerID) {
    // Requested room didn't exist or was empty
    console.log('Created room ' + room);

    isLeader = true;
    myID = peerID;
    roomLeaderID = myID;
    videoSrc = myID;

    // Request video from user for broadcast
    getVideoForBroadcast(function() {});
});

socket.on('joined', function(room, socketID, leaderID) {
    // Requested room already exists
    console.log('joined: ' + room);

    myID = socketID;
    roomLeaderID = leaderID;
    videoSrc = leaderID;
    console.log('Student found');

    var btn = document.createElement("BUTTON");
    var t = document.createTextNode("Raise Doubt");
    btn.appendChild(t);
    document.body.appendChild(btn);
	
    btn.onclick = function(){
        var date = new Date();
        var timestamp = date.getTime();
        console.log('Raising a doubt and asking the room leader to let me broadcast video');
        socket.emit('doubt raised', room, timestamp);
    };
});

socket.on('approve or deny doubt', function(room, socketID, timestamp) {
    if(isLeader){
        console.log('Student with clientID: ', socketID, ' raised a doubt');
        console.log('Requesting permission from user');
        var answer=confirm("Student raised a doubt. To approve press OK otherwise press CANCEL");
        socket.emit('doubt answered', room, socketID, answer);
    }
});

socket.on('doubt reply', function(socketID, answer) {
    if(answer==true) {
        trace('doubt is approved by prof');
        videoSrc = myID;
    } else {
        trace('doubt is denied by prof');
    }
});

socket.on('change video source', function(socketID) {
    trace('Video source changed to ' + socketID);
    videoSrc = socketID;
	if(isLeader){
	btn2 = document.createElement("BUTTON");
    t = document.createTextNode("STOP STUDENTS VIDEO");
    btn2.appendChild(t);
    document.body.appendChild(btn2);
	btn2.onclick = function() {
		
        socket.emit('myevent',room);	
	}
    };
});

socket.on('send doubt video', function(room, studentID, peerIds) {

    if ( myID != studentID ) {
        return;
    }
	
   trace('Attempting to initialize video capture');

    getVideoForBroadcast( function() {
        trace('Calling all students in the room');
        for(var i = 0; i < peerIds.length; i++) {
            if (studentID != peerIds[i]) {
                createPeerConnection(peerIds[i]);
                pc[peerIds[i]].addStream(videoStream);
                doCall(peerIds[i]);
            }
        }
    });
});
socket.on('ss', function(room, studentID, peerIds) {
	//videoStream = teststream;
   	remoteVideo.srcObject = teststream;
	if(isLeader)
		remoteVideo.srcObject = null;
	else
		localVideo.srcObject = null;
	btn2.remove(btn2);
	
});
socket.on('full', function(room) {
    console.log('Room ' + room + ' is full');
});

socket.on('join', function (room, peerID) {
    console.log('Another peer: ' + peerID + ' made a request to join room ' + room);

    if (isLeader) {
        // Connect with the peer
        createPeerConnection(peerID);
        if (videoCaptureStatus) {
            pc[peerID].addStream(videoStream);
        } else {
            console.log('Local video stream has not been captured');
            console.log('No peer connection with ' + peerID + ' attempted.');
            return;
        }
        doCall(peerID);
    }
	

});

socket.on('log', function(array) {
    console.log.apply(console, array);
});

////////////////////////////////////////////////

function trace(text) {
    text = text.trim();
    const now = (window.performance.now() / 1000).toFixed(3);

    console.log(now, text);
}

function sendMessage(message) {
    // console.log('Client sending message: ', message);
    message.srcID = myID;
    socket.emit('message', message, room);
}

// This client receives a message
socket.on('message', function(message) {
    console.log('Client received message:', message);
    if (message.type === 'str') {
        if (message.content === 'bye') {
            handleRemoteHangup(message.srcID);
        }
    } else {
        if (message.destID !== myID) {
            return;
        }

        if (message.type === 'description') {
            trace('Received description from peer');

            // videoSrc calls all other room members
            // Room members on receiving peer description answer back
            if (videoSrc != myID) {
                trace('Creating a connection');
                createPeerConnection(message.srcID);
            }

            // Add remote description
            trace('Adding remote description to RTCPeerConnection');
            pc[message.srcID].setRemoteDescription(new RTCSessionDescription(message.content));

            if (videoSrc != myID) {
                // create and send description
                doAnswer(message.srcID);
            }
        } else if (message.type === 'candidate') {
            trace('Adding ice candidate');
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: message.label,
                candidate: message.candidate
            });
            pc[message.srcID].addIceCandidate(candidate);
        }
    }
});

////////////////////////////////////////////////////

window.onbeforeunload = function() {
    sendMessage({
        type: 'str',
        content: 'bye'
    });
};

function getVideoForBroadcast(callback) {
    console.log('Getting user media with constraints', constraints);

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
            videoCaptureStatus = true;

            console.log('Adding local stream.');
            videoStream = stream;
            remoteVideo.srcObject = null;
            localVideo.srcObject = stream;
            callback();
        })
        .catch(function(e) {
            videoCaptureStatus = false;

            alert('getUserMedia() error: ' + e.name);
        });
}

/////////////////////////////////////////////////////////

function createPeerConnection(peerID) {
    try {
        pc[peerID] = new RTCPeerConnection(null);

        pc[peerID].onaddstream = handleRemoteStreamAdded;
        pc[peerID].onremovestream = handleRemoteStreamRemoved;
        pc[peerID].onicecandidate = function(event) {
            handleIceCandidate(event, peerID);
        };
        console.log('Created RTCPeerConnnection with peer: ', peerID);
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        alert('Cannot create RTCPeerConnection object.');
        return;
    }
}

function handleIceCandidate(event, peerID) {
    console.log('icecandidate event: ', event);
    if (event.candidate) {
        sendMessage({
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate,
            destID: peerID
        });
    } else {
        console.log('End of candidates.');
    }
}

function handleCreateOfferError(event) {
    console.log('createOffer() error: ', event);
}

function doCall(peerID) {
    console.log('Sending offer to peer');
    pc[peerID].createOffer().then(
        function(sessionDescription) {
            setLocalAndSendMessage(sessionDescription, peerID);
        },
        handleCreateOfferError
    );
}

function doAnswer(peerID) {
    console.log('Sending answer to peer.');
    pc[peerID].createAnswer().then(
        function(sessionDescription) {
            setLocalAndSendMessage(sessionDescription, peerID)
        },
        onCreateSessionDescriptionError
    );
}

function setLocalAndSendMessage(sessionDescription, peerID) {
    pc[peerID].setLocalDescription(sessionDescription);
    sessionDescription.destID = peerID;
    console.log('setLocalAndSendMessage sending message', sessionDescription,
        ' to peer ', peerID);
    sendMessage({
        type: 'description',
        destID: peerID,
        content: sessionDescription
    });
}

function onCreateSessionDescriptionError(error) {
    console.log('Failed to create session description: ', error.toString());
}

function requestTurn(turnURL) {
    var turnExists = false;
    for (var i in pcConfig.iceServers) {
        if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
            turnExists = true;
            turnReady = true;
            break;
        }
    }
    if (!turnExists) {
        console.log('Getting TURN server from ', turnURL);
        // No TURN server. Get one from computeengineondemand.appspot.com:
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
                var turnServer = JSON.parse(xhr.responseText);
                console.log('Got TURN server: ', turnServer);
                pcConfig.iceServers.push({
                    'urls': 'turn:' + turnServer.username + '@' + turnServer.turn,
                    'credential': turnServer.password
                });
                turnReady = true;
            }
        };
        xhr.open('GET', turnURL, true);
        xhr.send();
    }
}

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
	if(videoSrc==roomLeaderID)
		teststream=event.stream;
    videoStream = event.stream;
    remoteVideo.srcObject = event.stream;
}

function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
    pc[roomLeaderID] = null;
}

function hangup() {
    console.log('Hanging up.');
    Object.keys(pc).forEach(function(peerID) {
        stop(peerID);
    });
    sendMessage({
        type: 'str',
        content: 'bye'
    });
}

function handleRemoteHangup(peerID) {
    console.log('Student left classroom.');
    stop(peerID);
}

function stop(peerID) {
    pc[peerID].close();
    pc[peerID] = null;
}
