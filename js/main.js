'use strict';

var isLeader = false;
var turnReady;

var myID;
var roomLeaderID;
var pc = {};
var videoStream;

var pcConfig = {
    'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
    }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
};

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
    console.log('Created room ' + room);
    isLeader = true;
    myID = peerID;
    roomLeaderID = myID;
    getVideoForBroadcast();
});

socket.on('joined', function(room, socketID, leaderID) {
    console.log('joined: ' + room);
    myID = socketID;
    roomLeaderID = leaderID;
    createPeerConnection(leaderID);
});

socket.on('full', function(room) {
    console.log('Room ' + room + ' is full');
});

socket.on('join', function (room, peerID) {
    console.log('Another peer: ' + peerID + ' made a request to join room ' + room);
    // console.log('This peer is the initiator of room ' + room + '!');
    if (isLeader) {
        maybeStart(peerID);
    }
});

socket.on('log', function(array) {
    console.log.apply(console, array);
});

////////////////////////////////////////////////

function sendMessage(message) {
    // console.log('Client sending message: ', message);
    message.srcID = myID;
    socket.emit('message', message, room);
}

function trace(text) {
    text = text.trim();
    const now = (window.performance.now() / 1000).toFixed(3);

    console.log(now, text);
}

// This client receives a message
socket.on('message', function(message) {
    console.log('Client received message:', message);
    if (message.type === 'str') {
        if (message.content === 'bye') {
            handleRemoteHangup();
        }
    } else {
        if (message.destID !== myID) {
            return;
        }

        if (message.type === 'offer') {
            pc[roomLeaderID].setRemoteDescription(new RTCSessionDescription(message));
            doAnswer();
        } else if (message.type === 'answer') {
            trace('Received answer, adding remote description');
            pc[message.srcID].setRemoteDescription(new RTCSessionDescription(message));
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

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

var constraints = {
    audio: true,
    video: true
};

function getVideoForBroadcast() {
    console.log('Getting user media with constraints', constraints);

    navigator.mediaDevices.getUserMedia(constraints)
        .then(gotStream)
        .catch(function(e) {
            alert('getUserMedia() error: ' + e.name);
        });
}

function gotStream(stream) {
    console.log('Adding local stream.');
    videoStream = stream;
    localVideo.srcObject = stream;
    sendMessage({
        type: 'str',
        content: 'got user media'
    });
}

if (location.hostname !== 'localhost') {
    requestTurn(
        'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
    );
}

function maybeStart(peerID) {
    console.log('>>>>>>> maybeStart() ', videoStream);
    if (typeof videoStream !== 'undefined') {
        console.log('>>>>>> creating peer connection');
        createPeerConnection(peerID);
        pc[peerID].addStream(videoStream);
        doCall(peerID);
    } else {
        console.log('Local video stream couldn\'t be captured');
        console.log('No peer connection with ' + peerID + ' attempted.');
    }
}

window.onbeforeunload = function() {
    sendMessage({
        type: 'str',
        content: 'bye'
    });
};

/////////////////////////////////////////////////////////

function createPeerConnection(peerID) {
    try {
        pc[peerID] = new RTCPeerConnection(null);
        pc[peerID].onicecandidate = function(event) {
            handleIceCandidate(event, peerID);
        };
        if (!isLeader) {
            pc[peerID].onaddstream = handleRemoteStreamAdded;
            pc[peerID].onremovestream = handleRemoteStreamRemoved;
        }
        console.log('Created RTCPeerConnnection');
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

function doAnswer() {
    console.log('Sending answer to peer.');
    pc[roomLeaderID].createAnswer().then(
        function(sessionDescription) {
            setLocalAndSendMessage(sessionDescription, roomLeaderID)
        },
        onCreateSessionDescriptionError
    );
}

function setLocalAndSendMessage(sessionDescription, peerID) {
    pc[peerID].setLocalDescription(sessionDescription);
    sessionDescription.destID = peerID;
    console.log('setLocalAndSendMessage sending message', sessionDescription,
        ' to peer ', peerID);
    sendMessage(sessionDescription);
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
    videoStream = event.stream;
    remoteVideo.srcObject = event.stream;
}

function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
}

function hangup() {
    console.log('Hanging up.');
    stop();
    sendMessage({
        type: 'str',
        content: 'bye'
    });
}

function handleRemoteHangup() {
    console.log('Session terminated.');
    stop();
    isLeader = false;
}

function stop() {
    pc.close();
    pc = null;
}
