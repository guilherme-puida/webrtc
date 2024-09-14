const $ = document.querySelector.bind(document);

const $joinRoomForm = $("#join-room-form");
const $startPage = $("#start-page");
const $conferencePage = $("#conference-page");
const $chatToggle = $("#chat-toggle");
const $chatClose = $("#chat-close");
const $chatMessages = $("#chat-messages");
const $chatPanel = $("#chat-panel");
const $chatForm = $("#chat-form");
const $localVideo = $("#local-video");
const $localName = $("#local-name");
const $videoGrid = $("#video-grid");
const $muteButton = $("#mute-btn");
const $stopVideoButton = $("#stop-video-btn");
const $shareScreenButton = $("#share-screen-btn");

const makeVideoId = (uid) => `remote-video-${uid}`;
const makeShortId = (uid) => uid.split("-")[0];

const uid = crypto.randomUUID();
const peerConnections = {};
const iceCandidateQueue = {};
let localStream;

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

  iceCandidateQueue[data.uid] = [];
  peerConnections[data.uid] = undefined;
}

function appendMessage(senderUid, message) {
  const p = document.createElement("p");
  p.innerHTML = `<span>${makeShortId(senderUid)}</span>: ${message}`;
  $chatMessages.appendChild(p);
  $chatMessages.scrollTop = $chatMessages.scrollHeight;
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
  "chat-message": chatMessageHandler,
  "new-peer": newPeerHandler,
  "peer-left": peerLeftHandler,
  "offer": handleOffer,
  "answer": handleAnswer,
  "ice-candidate": handleIceCandidate,
};

signalingSocket.addEventListener("message", async (event) => {
  const data = JSON.parse(event.data);
  try {
    if (!data.target || data.target === uid) {
      await wsHandlers[data.type](data);
    }
  } catch (error) {
    console.error(`failed to handle message for type ${data.type}`, error);
  }
});

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
      $videoGrid.appendChild(vd);
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

$joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { room } = $joinRoomForm.elements;
  if (room) {
    $startPage.classList.add("hidden");
    $conferencePage.classList.remove("hidden");

    document.title = room.value + " - WebRTC";

    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    $localVideo.srcObject = localStream;

    $localName.innerHTML = `<span>${makeShortId(uid)}</span> (you)`;
    send({ type: "join", roomId: room.value, uid: uid });
  }
});

$chatToggle.addEventListener("click", () => {
  $chatPanel.classList.remove("hidden");
  $chatToggle.classList.add("hidden");
});

$chatClose.addEventListener("click", () => {
  $chatPanel.classList.add("hidden");
  $chatToggle.classList.remove("hidden");
});

$chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const { message } = $chatForm.elements;
  const messageContent = message.value.trim();

  if (messageContent) {
    send({
      type: "chat-message",
      uid: uid,
      message: messageContent,
    });

    $chatForm.reset();
  }
});

$muteButton.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  isAudioEnabled = !isAudioEnabled;
  audioTrack.enabled = isAudioEnabled;
  $muteButton.textContent = isAudioEnabled ? "Mute" : "Unmute";
});

$stopVideoButton.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  isVideoEnabled = !isVideoEnabled;
  videoTrack.enabled = isVideoEnabled;
  $stopVideoButton.textContent = isVideoEnabled ? "Stop Video" : "Start Video";
});

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
  $shareScreenButton.textContent = "Stop Sharing";

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
  $shareScreenButton.textContent = "Share Screen";
}

$shareScreenButton.addEventListener("click", async () => {
  if (!isScreenSharing) {
    try {
      await startScreenShare();
    } catch (error) {
      console.error("Error sharing screen", error);
    }
  } else {
    endScreenShare();
  }
});
