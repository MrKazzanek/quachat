const CallManager = {
  localStream: null,
  peerCalls: {},
  isInCall: false,

  async toggleCall() {
    if (this.isInCall) {
      this.endCall();
    } else {
      await this.startCall();
    }
  },

  async startCall() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.isInCall = true;

      const grid = document.getElementById('videoGrid');
      grid.classList.add('active');

      this.addVideoCard('my_stream', this.localStream, `${WebRTCEngine.myName} (Ty)`, true);

      // Call all active peers
      Object.keys(WebRTCEngine.connections).forEach(peerId => {
        this.callPeer(peerId);
      });

      // Listen for incoming calls
      WebRTCEngine.peer.on('call', call => {
        call.answer(this.localStream);
        call.on('stream', remoteStream => {
          const peerInfo = WebRTCEngine.members[call.peer] || { name: 'Użytkownik' };
          this.addVideoCard(call.peer, remoteStream, peerInfo.name, false);
        });
        call.on('close', () => this.removeVideoCard(call.peer));
        this.peerCalls[call.peer] = call;
      });

      UIManager.showToast('Połączenie wideo rozpoczęte');
    } catch (err) {
      console.error('Call error:', err);
      UIManager.showToast('Nie można uzyskać dostępu do kamery lub mikrofonu.');
    }
  },

  callPeer(peerId) {
    if (!WebRTCEngine.peer || !this.localStream) return;
    const call = WebRTCEngine.peer.call(peerId, this.localStream);
    if (!call) return;

    call.on('stream', remoteStream => {
      const peerInfo = WebRTCEngine.members[peerId] || { name: 'Użytkownik' };
      this.addVideoCard(peerId, remoteStream, peerInfo.name, false);
    });
    call.on('close', () => this.removeVideoCard(peerId));
    this.peerCalls[peerId] = call;
  },

  addVideoCard(id, stream, label, isMuted = false) {
    const grid = document.getElementById('videoGrid');
    let card = document.getElementById('vcard_' + id);
    if (!card) {
      card = document.createElement('div');
      card.className = 'video-card';
      card.id = 'vcard_' + id;

      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      if (isMuted) video.muted = true;
      video.srcObject = stream;

      const tag = document.createElement('div');
      tag.className = 'video-label';
      tag.textContent = label;

      card.append(video, tag);
      grid.appendChild(card);
    }
  },

  removeVideoCard(id) {
    const card = document.getElementById('vcard_' + id);
    if (card) card.remove();
  },

  endCall() {
    this.isInCall = false;
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    Object.values(this.peerCalls).forEach(call => { try { call.close(); } catch (e) {} });
    this.peerCalls = {};

    const grid = document.getElementById('videoGrid');
    grid.innerHTML = '';
    grid.classList.remove('active');
    UIManager.showToast('Zakończono połączenie wideo');
  }
};
