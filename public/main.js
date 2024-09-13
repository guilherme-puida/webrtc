const makeVideoId = (uid) => `remote-video-${uid}`;
const makeShortId = (uid) => uid.split("-")[0];

const uid = crypto.randomUUID();
const peerConnections = {};
const iceCandidateQueue = {};
let localStream;

const $ = document.querySelector.bind(document);

const localVideo = $("#local-video");
const remoteVideos = $("#remote-videos");
const roomInput = $("#room-input");
const joinRoomButton = $("#join");
const toggleAudio = $("#toggle-audio");
const toggleVideo = $("#toggle-video");
const toggleShareScreen = $("#toggle-share");
const chatInput = $("#chat-input");
const chatForm = $("#chat-form");
const chatBox = $("#chat-box");

let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;
let originalVideoTrack;

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = wsProtocol + "//" + window.location.host + "/ws";
const signalingSocket = new WebSocket(wsUrl);

function send(payload) {
  signalingSocket.send(JSON.stringify(payload));
}

async function newPeerHandler(data) {
  if (!peerConnections[data.uid]) {
    createPeerConnection(data.uid);
  }
}

async function peerLeftHandler(data) {
  const remoteVideo = $("#" + makeVideoId(data.uid));
  remoteVideo?.remove();
}

async function chatMessageHandler(data) {
  appendMessage(data.uid, data.message);
}

async function handleOffer(data) {
  if (!peerConnections[data.uid]) {
    createPeerConnection(data.uid);
  }

  const peerConnection = peerConnections[data.uid];
  const peerState = peerConnection.signalingState;
  if (peerState !== "stable" && peerState !== "have-remote-offer") {
    console.log(`skipping offer, invalid signaling state ${peerState}`);
    return;
  }

  if (peerState === "have-local-offer") {
    await peerConnection.setLocalDescription({ type: "rollback" });
  }

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    send({ type: "answer", sdp: answer, uid: uid, target: data.uid });

    while (iceCandidateQueue[data.uid]?.length) {
      const candidate = iceCandidateQueue[data.uid].shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error("failed to handle offer", error);
  }
}

async function handleAnswer(data) {
  const peerConnection = peerConnections[data.uid];
  if (!peerConnection) return;

  if (peerConnection.signalingState !== "have-local-offer") {
    console.log(
      `skipping answer, invalid signaling state: ${peerConnection.signalingState}`
    );
    return;
  }

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );

    while (iceCandidateQueue[data.uid]?.length) {
      const candidate = iceCandidateQueue[data.uid].shift();
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error("failed to handle answer: ", error);
  }
}

async function handleIceCandidate(data) {
  const peerConnection = peerConnections[data.uid];
  if (!peerConnection || !data.candidate) return;

  if (peerConnection.remoteDescription?.type) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("error adding ICE candidate", error);
    }
    return;
  }

  if (!iceCandidateQueue[data.uid]) {
    iceCandidateQueue[data.uid] = [];
  }

  iceCandidateQueue[data.uid].push(data.candidate);
}

const wsHandlers = {
  "new-peer": newPeerHandler,
  "peer-left": peerLeftHandler,
  "offer": handleOffer,
  "answer": handleAnswer,
  "ice-candidate": handleIceCandidate,
};

signalingSocket.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  try {
    if (!data.target || data.target === uid) {
      await wsHandlers[data.type](data);
    }
  } catch (error) {
    console.error(`failed to handle message for type ${data.type}`, error);
  }
};

joinRoomButton.onclick = () => {
  const roomId = roomInput.value;
  send({ type: "join", roomId: roomId, uid: uid });

  joinRoomButton.disabled = true;
  roomInput.disabled = true;
  chatInput.disabled = false;

  document.title = roomId;
};

async function initLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

function createPeerConnection(remoteUid) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "ae601c60b5a3dc398f306a50",
        credential: "iOwBq5l/KrPUGEQl",
      },
    ],
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      send({
        type: "ice-candidate",
        candidate: event.candidate,
        uid: uid,
        target: remoteUid,
      });
    }
  };

  peerConnection.ontrack = (event) => {
    const videoId = makeVideoId(remoteUid);
    if (!$("#" + videoId)) {
      const v = document.createElement("video");
      v.srcObject = event.streams[0];
      v.autoplay = true;

      const vt = document.createElement("p");
      vt.innerHTML = `<span>${makeShortId(remoteUid)}</span>`;

      const vd = document.createElement("div");
      vd.id = videoId;

      vd.appendChild(vt);
      vd.appendChild(v);
      remoteVideos.appendChild(vd);
    }
  };

  localStream
    .getTracks()
    .forEach((track) => peerConnection.addTrack(track, localStream));

  peerConnections[remoteUid] = peerConnection;

  setTimeout(async () => {
    if (peerConnection.signalingState === "stable") {
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      send({
        type: "offer",
        sdp: offer,
        uid: uid,
        target: remoteUid,
      });
    }
  }, 100);

  return peerConnection;
}

toggleAudio.onclick = () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  isAudioEnabled = !isAudioEnabled;
  audioTrack.enabled = isAudioEnabled;
  toggleAudio.textContent = isAudioEnabled ? "Disable Audio" : "Enable Audio";
};

toggleVideo.onclick = () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  isVideoEnabled = !isVideoEnabled;
  videoTrack.enabled = isVideoEnabled;
  toggleVideo.textContent = isVideoEnabled ? "Disable Video" : "Enable Video";
};

async function startScreenShare() {
  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
  });
  const screenTrack = screenStream.getVideoTracks()[0];

  originalVideoTrack = localStream.getVideoTracks()[0];
  localStream.removeTrack(originalVideoTrack);
  localStream.addTrack(screenTrack);

  for (const uid in peerConnections) {
    peerConnections[uid]
      .getSenders()
      .find((s) => s.track.kind === "video")
      .replaceTrack(screenTrack);
  }

  isScreenSharing = true;
  toggleShareScreen.textContent = "Stop Sharing";

  screenTrack.onended = () => {
    endScreenShare();
  };
}

async function endScreenShare() {
  const videoTrack = originalVideoTrack;
  localStream.removeTrack(localStream.getVideoTracks()[0]);
  localStream.addTrack(videoTrack);

  for (const uid in peerConnections) {
    peerConnections[uid]
      .getSenders()
      .find((s) => s.track.kind === "video")
      .replaceTrack(videoTrack);
  }

  isScreenSharing = false;
  toggleShareScreen.textContent = "Start Sharing";
}

toggleShareScreen.onclick = async () => {
  if (!isScreenSharing) {
    try {
      await startScreenShare();
    } catch (error) {
      console.error("Error sharing screen: ", error);
    }
  } else {
    endScreenShare();
  }
};

chatForm.onsubmit = (event) => {
  event.preventDefault();
  const message = chatInput.value;

  if (message.trim()) {
    send({
      type: "chat-message",
      uid: uid,
      message: message,
    });

    chatInput.value = "";
  }
};

function appendMessage(uid, message) {
  const p = document.createElement("p");
  p.innerHTML = `<span>${makeShortId(uid)}</span>: ${message}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function start() {
  joinRoomButton.disabled = false;
  toggleAudio.disabled = false;
  toggleVideo.disabled = false;
  toggleShareScreen.disabled = false;

  $("#local-video-title").innerHTML = `<span>${makeShortId(uid)}</span> (you)`;
}

initLocalStream().then(start);
