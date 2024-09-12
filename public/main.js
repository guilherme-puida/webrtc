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

signalingSocket.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "chat-message") {
    appendMessage(data.uid, data.message);
  } else if (data.type === "new-peer") {
    if (!peerConnections[data.uid]) {
      createPeerConnection(data.uid);
    }
  } else if (data.type === "peer-left") {
    const remoteVideo = $("#" + makeVideoId(data.uid));
    if (remoteVideo) {
      remoteVideo.remove();
    }
  } else if (data.type === "offer") {
    if (!peerConnections[data.uid]) {
      createPeerConnection(data.uid);
    }

    const peerConnection = peerConnections[data.uid];
    if (
      peerConnection.signalingState === "stable" ||
      peerConnection.signalingState === "have-remote-offer"
    ) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.sdp)
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      signalingSocket.send(
        JSON.stringify({
          type: "answer",
          sdp: answer,
          uid: uid,
        })
      );

      if (iceCandidateQueue[data.uid]) {
        while (iceCandidateQueue[data.uid].length) {
          const candidate = iceCandidateQueue[data.uid].shift();
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    }
  } else if (data.type === "answer" && peerConnections[data.uid]) {
    await peerConnections[data.uid].setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );

    if (iceCandidateQueue[data.uid]) {
      while (iceCandidateQueue[data.uid].length) {
        const candidate = iceCandidateQueue[data.uid].shift();
        await peerConnections[data.uid].addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      }
    }
  } else if (
    data.type === "ice-candidate" &&
    data.candidate &&
    peerConnections[data.uid]
  ) {
    const peerConnection = peerConnections[data.uid];

    if (
      peerConnection.remoteDescription &&
      peerConnection.remoteDescription.type
    ) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
      if (!iceCandidateQueue[data.uid]) {
        iceCandidateQueue[data.uid] = [];
      }

      iceCandidateQueue[data.uid].push(data.candidate);
    }
  }
};

joinRoomButton.onclick = () => {
  const roomId = roomInput.value;
  signalingSocket.send(
    JSON.stringify({ type: "join", roomId: roomId, uid: uid })
  );
  joinRoomButton.disabled = true;
  roomInput.disabled = true;

  document.title = roomId;
  chatInput.disabled = false;
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
      signalingSocket.send(
        JSON.stringify({
          type: "ice-candidate",
          candidate: event.candidate,
          uid: uid,
        })
      );
    }
  };

  peerConnection.ontrack = (event) => {
    const videoId = makeVideoId(remoteUid);
    if (!$("#" + videoId)) {
      const v = document.createElement("video");
      v.srcObject = event.streams[0];
      v.autoplay = true;

      const vt = document.createElement("p");
      vt.textContent = makeShortId(remoteUid);

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
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    peerConnection.createOffer().then((offer) => {
      signalingSocket.send(
        JSON.stringify({
          type: "offer",
          sdp: offer,
          uid: uid,
        })
      );
    });
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
    signalingSocket.send(
      JSON.stringify({
        type: "chat-message",
        uid: uid,
        message: message,
      })
    );

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
