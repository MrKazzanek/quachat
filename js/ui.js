const UIManager = {
  typingUsers: {},
  audioCtx: null,

  initUI() {
    this.setupEventListeners();
    this.setupTheme();
    this.setupMentionsDropdown();
  },

  playNotificationSound() {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.25);
    } catch (e) {}
  },

  showToast(msg, dur = 2600) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
  },

  setLobbyStatus(msg, type) {
    const b = document.getElementById('statusBox');
    b.textContent = msg;
    b.className = 'status-box ' + type;
  },

  clearLobbyStatus() {
    const b = document.getElementById('statusBox');
    b.className = 'status-box';
    b.textContent = '';
  },

  setupTheme() {
    const savedTheme = localStorage.getItem('qoza_theme') || 'default';
    document.body.className = savedTheme !== 'default' ? 'theme-' + savedTheme : '';
  },

  changeTheme(themeName) {
    document.body.className = themeName !== 'default' ? 'theme-' + themeName : '';
    localStorage.setItem('qoza_theme', themeName);
  },

  openChatScreen() {
    document.getElementById('lobby').classList.remove('active');
    document.getElementById('chat').classList.add('active');
    document.getElementById('sbRoomCode').textContent = WebRTCEngine.roomCode;
    document.getElementById('chatRoomLabel').textContent = '# ' + WebRTCEngine.roomCode;
    document.getElementById('waitingCode').textContent = WebRTCEngine.roomCode;
    this.updateUserList(WebRTCEngine.members);
  },

  closeChatBack() {
    WebRTCEngine.disconnect();
    document.getElementById('chat').classList.remove('active');
    document.getElementById('lobby').classList.add('active');
    document.getElementById('msgs').innerHTML = '';
    document.getElementById('msgs').style.display = 'none';
    document.getElementById('waitingPane').classList.remove('hidden');
    this.enableInput(false);
    MessageManager.msgMap = {};
    this.clearLobbyStatus();
    this.renderSavedRooms();
  },

  hideWaiting() {
    document.getElementById('waitingPane').classList.add('hidden');
    document.getElementById('msgs').style.display = 'flex';
  },

  setBadge(state) {
    const b = document.getElementById('statusBadge');
    if (state === 'ok') {
      b.className = 'status-badge badge-ok';
      b.innerHTML = '<div class="dot on"></div> Online';
    } else if (state === 'connecting') {
      b.className = 'status-badge badge-wait';
      b.innerHTML = '<div class="dot connecting"></div> Łączenie…';
    } else {
      b.className = 'status-badge badge-off';
      b.innerHTML = '<div class="dot"></div> Rozłączono';
    }
  },

  enableInput(yes) {
    document.getElementById('chatInput').disabled = !yes;
    document.getElementById('sendBtn').disabled = !yes;
    document.getElementById('emojiBtn').disabled = !yes;
    document.getElementById('recordBtn').disabled = !yes;
    const fl = document.getElementById('fileLabel');
    fl.style.opacity = yes ? '1' : '0.3';
    fl.style.pointerEvents = yes ? 'auto' : 'none';
    if (yes) document.getElementById('chatInput').focus();
  },

  updateUserList(members) {
    const list = document.getElementById('userList');
    list.innerHTML = '';
    const memArray = Object.values(members || {});

    document.getElementById('userCountBadge').textContent = memArray.length + ' / ' + MAX_ROOM_MEMBERS;

    memArray.forEach(m => {
      const d = document.createElement('div');
      const isMe = m.peerId === WebRTCEngine.myPeerId;
      d.className = 'user-row' + (isMe ? ' me' : '');

      let avatarHTML = '';
      if (m.avatar && (m.avatar.startsWith('data:') || m.avatar.startsWith('http'))) {
        avatarHTML = `<img src="${m.avatar}" alt="avatar">`;
      } else {
        avatarHTML = (m.avatar || m.name[0] || '?').toUpperCase();
      }

      let roleBadge = '';
      if (m.role === RoomPermissions.ROLES.OWNER) {
        roleBadge = '<span class="role-badge role-owner">Właściciel</span>';
      } else if (m.role === RoomPermissions.ROLES.ADMIN) {
        roleBadge = '<span class="role-badge role-admin">Admin</span>';
      }

      let modActions = '';
      if (!isMe && RoomPermissions.isAdminOrOwner(WebRTCEngine.myRole)) {
        modActions = `
          <div class="user-mod-actions">
            ${RoomPermissions.isOwner(WebRTCEngine.myRole) ? `<button class="bact" onclick="UIManager.toggleAdminRole('${escH(m.name)}')" title="Promuj/Zdegraduj">👑</button>` : ''}
            <button class="bact" onclick="UIManager.toggleMute('${escH(m.name)}')" title="Wycisz/Odwycisz">🔇</button>
            <button class="bact del" onclick="UIManager.kickUserPrompt('${escH(m.name)}')" title="Wyrzuć">🚪</button>
          </div>`;
      }

      d.innerHTML = `
        <div class="avatar">${avatarHTML}</div>
        <div class="user-details">
          <div class="user-uname-row">
            <div class="user-uname">${escH(m.name)} ${isMe ? '<span style="font-size:11px;color:var(--text3);font-weight:normal">(Ty)</span>' : ''}</div>
            ${roleBadge}
          </div>
          <div class="user-state"><div class="dot ${m.isMuted ? 'muted' : 'on'}"></div> ${m.isMuted ? 'wyciszony' : 'online'}</div>
        </div>
        ${modActions}`;
      list.appendChild(d);
    });
  },

  updateTypingBar(name, isTyping, avatar) {
    if (isTyping) {
      this.typingUsers[name] = avatar;
    } else {
      delete this.typingUsers[name];
    }

    const bar = document.getElementById('typingBar');
    const label = document.getElementById('typingLabel');
    const names = Object.keys(this.typingUsers);

    if (names.length === 0) {
      bar.classList.remove('active');
    } else {
      bar.classList.add('active');
      if (names.length === 1) label.textContent = `${names[0]} pisze...`;
      else if (names.length === 2) label.textContent = `${names[0]} i ${names[1]} piszą...`;
      else label.textContent = `Wielu użytkowników pisze...`;
    }
  },

  async renderSavedRooms() {
    const rooms = await QozaChatDB.getSavedRooms();
    const sec = document.getElementById('savedRoomsSection');
    const list = document.getElementById('savedRoomsList');
    if (!rooms.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    list.innerHTML = '';

    rooms.forEach(r => {
      const d = document.createElement('div');
      d.className = 'saved-room-item';
      d.innerHTML = `
        <div>
          <div class="saved-room-code">${escH(formatCode(r.code))}</div>
          <div class="saved-room-name">${escH(r.name)}</div>
        </div>
        <button class="saved-room-del" title="Usuń z zapisanych">✕</button>`;

      d.querySelector('.saved-room-del').onclick = (e) => {
        e.stopPropagation();
        QozaChatDB.deleteSavedRoom(r.code);
        this.renderSavedRooms();
      };
      d.onclick = () => {
        document.getElementById('roomInput').value = formatCode(r.code);
        document.getElementById('nameInput').focus();
      };
      list.appendChild(d);
    });
  },

  setupMentionsDropdown() {
    const textarea = document.getElementById('chatInput');
    const dropdown = document.getElementById('mentionsDropdown');

    textarea.addEventListener('input', () => {
      const val = textarea.value;
      const cursor = textarea.selectionStart;
      const lastAt = val.lastIndexOf('@', cursor - 1);

      if (lastAt !== -1 && (lastAt === 0 || /\s/.test(val[lastAt - 1]))) {
        const query = val.slice(lastAt + 1, cursor).toLowerCase();
        const members = Object.values(WebRTCEngine.members).filter(m => m.name.toLowerCase().includes(query) && m.peerId !== WebRTCEngine.myPeerId);

        if (members.length > 0) {
          dropdown.innerHTML = '';
          members.forEach(m => {
            const item = document.createElement('div');
            item.className = 'mention-item';
            item.innerHTML = `<div class="avatar" style="width:24px;height:24px;font-size:11px">${(m.name[0]).toUpperCase()}</div><span>${escH(m.name)}</span>`;
            item.onclick = () => {
              const before = val.slice(0, lastAt);
              const after = val.slice(cursor);
              textarea.value = before + '@' + m.name + ' ' + after;
              dropdown.classList.remove('active');
              textarea.focus();
            };
            dropdown.appendChild(item);
          });
          dropdown.classList.add('active');
          return;
        }
      }
      dropdown.classList.remove('active');
    });
  },

  setReply(id, text, author) {
    MessageManager.activeReplyTo = { id, text, author };
    const banner = document.getElementById('replyBanner');
    banner.classList.remove('hidden');
    document.getElementById('replyText').textContent = author + ': ' + text.slice(0, 60);
    document.getElementById('chatInput').focus();
  },

  clearReply() {
    MessageManager.activeReplyTo = null;
    document.getElementById('replyBanner').classList.add('hidden');
  },

  startEditMessage(id, oldText) {
    MessageManager.activeEditingId = id;
    const newText = prompt('Edytuj wiadomość:', oldText);
    if (newText !== null && newText.trim() !== '') {
      WebRTCEngine.sendEdit(id, newText.trim());
      MessageManager.applyEdit(id, newText.trim());
    }
    MessageManager.activeEditingId = null;
  },

  openReactionPicker(e, id) {
    this.reactionPickerFor = id;
    const picker = document.getElementById('reactionPickerModal');
    const rect = e.target.getBoundingClientRect();
    picker.style.display = 'flex';
    picker.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
    picker.style.top = Math.max(10, rect.top - 60) + 'px';
    picker.style.position = 'fixed';
    e.stopPropagation();
  },

  closeReactionPicker() {
    const picker = document.getElementById('reactionPickerModal');
    if (picker) picker.style.display = 'none';
  },

  openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('open');
  },

  scrollBottom() {
    const area = document.getElementById('msgs');
    area.scrollTop = area.scrollHeight;
  },

  toggleMute(username) {
    try {
      WebRTCEngine.toggleMuteUser(username);
      this.showToast('Zmieniono status wyciszenia dla ' + username);
    } catch (err) {
      this.showToast(err.message);
    }
  },

  toggleAdminRole(username) {
    try {
      const target = Object.values(WebRTCEngine.members).find(m => m.name === username);
      if (!target) return;
      const newRole = target.role === RoomPermissions.ROLES.ADMIN ? RoomPermissions.ROLES.MEMBER : RoomPermissions.ROLES.ADMIN;
      WebRTCEngine.setRole(username, newRole);
      this.showToast(`Zmieniono rolę ${username} na ${newRole}`);
    } catch (err) {
      this.showToast(err.message);
    }
  },

  kickUserPrompt(username) {
    if (confirm(`Wyrzucić ${username} z pokoju?`)) {
      try {
        WebRTCEngine.kickUser(username);
        this.showToast('Wyrzucono ' + username);
      } catch (err) {
        this.showToast(err.message);
      }
    }
  },

  openRoomSettingsModal() {
    if (!RoomPermissions.isOwner(WebRTCEngine.myRole)) {
      this.showToast('Tylko właściciel może zmieniać ustawienia pokoju.');
      return;
    }
    const s = WebRTCEngine.roomSettings;
    document.getElementById('settingPassword').value = s.password || '';
    document.getElementById('settingRequireApproval').checked = !!s.requireApproval;
    document.getElementById('settingSlowMode').value = s.slowMode || 0;
    document.getElementById('settingAllowText').checked = s.allowText !== false;
    document.getElementById('settingAllowMedia').checked = s.allowMedia !== false;
    document.getElementById('settingNewCode').value = WebRTCEngine.roomCode;
    document.getElementById('roomSettingsModal').classList.add('open');
  },

  setupEventListeners() {
    // Mobile sidebar toggle
    document.getElementById('sidebarToggleBtn').onclick = () => {
      document.getElementById('sidebar').classList.add('mobile-open');
      document.getElementById('mobileOverlay').classList.add('active');
    };
    document.getElementById('mobileOverlay').onclick = () => {
      document.getElementById('sidebar').classList.remove('mobile-open');
      document.getElementById('mobileOverlay').classList.remove('active');
    };

    // Reply close
    document.getElementById('replyClose').onclick = () => this.clearReply();

    // Lightbox close
    document.getElementById('lightbox').onclick = function () {
      this.classList.remove('open');
      document.getElementById('lightboxImg').src = '';
    };

    // Theme selector
    document.getElementById('themeSelect').onchange = (e) => this.changeTheme(e.target.value);

    // ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.getElementById('lightbox').classList.remove('open');
        document.getElementById('customCodeModal').classList.remove('open');
        document.getElementById('profileModal').classList.remove('open');
        document.getElementById('roomSettingsModal').classList.remove('open');
        this.closeReactionPicker();
      }
    });
  }
};
