const AudioManager = {
  mediaRecorder: null,
  audioChunks: [],
  recordingStartTime: 0,
  recordingInterval: null,
  isRecording: false,

  async startRecording(onTick, onError) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      this.recordingInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        if (onTick) onTick(sec);
      }, 1000);

      return true;
    } catch (err) {
      console.error('Mic access error:', err);
      if (onError) onError('Brak dostępu do mikrofonu.');
      return false;
    }
  },

  stopRecording() {
    return new Promise(resolve => {
      if (!this.mediaRecorder || !this.isRecording) return resolve(null);

      clearInterval(this.recordingInterval);
      this.isRecording = false;

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result;
          // Stop mic tracks
          this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
          resolve(base64data);
        };
        reader.readAsDataURL(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  },

  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      clearInterval(this.recordingInterval);
      this.isRecording = false;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  },

  createAudioPlayer(audioDataUrl) {
    const container = document.createElement('div');
    container.className = 'audio-bubble';

    const audio = new Audio(audioDataUrl);

    const playBtn = document.createElement('button');
    playBtn.className = 'audio-play-btn';
    playBtn.innerHTML = '▶';

    const wave = document.createElement('div');
    wave.className = 'audio-wave';
    for (let i = 0; i < 16; i++) {
      const bar = document.createElement('div');
      bar.className = 'audio-bar';
      bar.style.height = (30 + Math.sin(i * 0.8) * 60) + '%';
      wave.appendChild(bar);
    }

    const timeLabel = document.createElement('div');
    timeLabel.className = 'audio-time';
    timeLabel.textContent = '0:00';

    const speedBtn = document.createElement('button');
    speedBtn.className = 'bact';
    speedBtn.style.fontSize = '11px';
    speedBtn.style.fontWeight = 'bold';
    speedBtn.textContent = '1x';
    const speeds = [1, 1.5, 2];
    let speedIdx = 0;

    speedBtn.onclick = (e) => {
      e.stopPropagation();
      speedIdx = (speedIdx + 1) % speeds.length;
      audio.playbackRate = speeds[speedIdx];
      speedBtn.textContent = speeds[speedIdx] + 'x';
    };

    audio.onloadedmetadata = () => {
      const dur = Math.floor(audio.duration || 0);
      timeLabel.textContent = `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}`;
    };

    audio.ontimeupdate = () => {
      const cur = Math.floor(audio.currentTime || 0);
      timeLabel.textContent = `${Math.floor(cur / 60)}:${(cur % 60).toString().padStart(2, '0')}`;
      const pct = (audio.currentTime / (audio.duration || 1)) * 100;
      const bars = wave.querySelectorAll('.audio-bar');
      const activeCount = Math.floor((pct / 100) * bars.length);
      bars.forEach((b, idx) => {
        b.classList.toggle('active', idx <= activeCount);
      });
    };

    audio.onended = () => {
      playBtn.innerHTML = '▶';
    };

    playBtn.onclick = () => {
      if (audio.paused) {
        audio.play();
        playBtn.innerHTML = '⏸';
      } else {
        audio.pause();
        playBtn.innerHTML = '▶';
      }
    };

    container.append(playBtn, wave, timeLabel, speedBtn);
    return container;
  }
};
