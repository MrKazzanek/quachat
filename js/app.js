document.addEventListener('DOMContentLoaded', async () => {
  // Initialize IndexedDB
  await QozaChatDB.init();

  // Load persistent profile
  let dbProfile = await QozaChatDB.getProfile();
  if (dbProfile) {
    document.getElementById('nameInput').value = dbProfile.name || '';
    if (dbProfile.avatar) {
      document.getElementById('profileAvatarDisplay').innerHTML = `<img src="${dbProfile.avatar}">`;
      document.getElementById('profileAvatarDisplay').dataset.avatar = dbProfile.avatar;
    }
  } else {
    const legacyName = localStorage.getItem('qoza_name') || '';
    if (legacyName) document.getElementById('nameInput').value = legacyName;
  }

  UIManager.initUI();
  UIManager.renderSavedRooms();

  // Peer WebRTC Callbacks
  WebRTCEngine.callbacks.onStatusChange = (state, reason) => {
    UIManager.setBadge(state);
    if (reason) UIManager.showToast(reason);
  };

  WebRTCEngine.callbacks.onMessageReceived = async (msgData) => {
    const isMe = msgData.author === WebRTCEngine.myName;
    msgData.side = isMe ? 'mine' : 'theirs';
    MessageManager.renderMessage(document.getElementById('msgs'), msgData);
    await QozaChatDB.saveMessage({ ...msgData, roomCode: WebRTCEngine.rawRoomCode });
    if (!isMe) UIManager.playNotificationSound();
  };

  WebRTCEngine.callbacks.onMessageEdited = (msgId, newText) => {
    MessageManager.applyEdit(msgId, newText);
  };

  WebRTCEngine.callbacks.onMessageDeleted = (msgId) => {
    MessageManager.applyDelete(msgId);
  };

  WebRTCEngine.callbacks.onReaction = (msgId, emoji, add, author) => {
    MessageManager.applyReaction(msgId, emoji, add, author);
  };

  WebRTCEngine.callbacks.onMembersUpdated = (members) => {
    UIManager.updateUserList(members);
  };

  WebRTCEngine.callbacks.onTypingUpdated = (name, isTyping, avatar) => {
    UIManager.updateTypingBar(name, isTyping, avatar);
  };

  WebRTCEngine.callbacks.onSettingsUpdated = (settings) => {
    UIManager.showToast('Ustawienia pokoju zostały zaktualizowane.');
  };

  WebRTCEngine.callbacks.onKnockRequest = (name, avatar, callback) => {
    document.getElementById('knockUserLabel').textContent = `${name} chce dołączyć do pokoju.`;
    document.getElementById('knockModal').classList.add('open');

    document.getElementById('knockAcceptBtn').onclick = () => {
      document.getElementById('knockModal').classList.remove('open');
      callback(true);
    };

    document.getElementById('knockRejectBtn').onclick = () => {
      document.getElementById('knockModal').classList.remove('open');
      callback(false);
    };
  };

  WebRTCEngine.callbacks.onKicked = (reason) => {
    alert(reason);
    UIManager.closeChatBack();
  };

  WebRTCEngine.callbacks.onRoomDeleted = () => {
    alert('Właściciel usunął pokój.');
    UIManager.closeChatBack();
  };

  WebRTCEngine.callbacks.onRoomCodeChanged = (newCode) => {
    document.getElementById('sbRoomCode').textContent = newCode;
    document.getElementById('chatRoomLabel').textContent = '# ' + newCode;
    document.getElementById('waitingCode').textContent = newCode;
    UIManager.showToast('Kod pokoju został zmieniony na: ' + newCode);
  };

  // ═══════════════════════════════════════
  // LOBBY EVENTS
  // ═══════════════════════════════════════

  // Create room
  document.getElementById('createBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) { UIManager.setLobbyStatus('Wpisz swój pseudonim.', 'error'); return; }
    UIManager.clearLobbyStatus();
    UIManager.setLobbyStatus('Tworzenie pokoju…', 'info');

    try {
      const code = generateCode();
      const profile = await QozaChatDB.getProfile();
      const avatar = profile ? profile.avatar : name[0].toUpperCase();
      await WebRTCEngine.createRoom(code, name, avatar);

      await QozaChatDB.saveProfile({ name, avatar });
      await QozaChatDB.saveRoom(code, 'Pokój ' + code.slice(0, 4), true);

      UIManager.openChatScreen();
      UIManager.hideWaiting();
      UIManager.enableInput(true);
      UIManager.setBadge('ok');
      UIManager.showToast('Pokój utworzony: ' + code);
    } catch (err) {
      UIManager.setLobbyStatus(err.message, 'error');
    }
  });

  // Custom room code modal trigger
  document.getElementById('createNamedBtn').addEventListener('click', () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) { UIManager.setLobbyStatus('Wpisz swój pseudonim.', 'error'); return; }
    document.getElementById('customCodeModal').classList.add('open');
    document.getElementById('customCodeInput').value = '';
    document.getElementById('customCodeInput').focus();
  });

  document.getElementById('customCodeClose').onclick = () => document.getElementById('customCodeModal').classList.remove('open');
  document.getElementById('customCodeCancel').onclick = () => document.getElementById('customCodeModal').classList.remove('open');

  document.getElementById('customCodeInput').addEventListener('input', function () {
    this.value = formatCode(this.value);
  });

  document.getElementById('customCodeConfirm').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim();
    const raw = normalizeCode(document.getElementById('customCodeInput').value);
    if (raw.length !== CODE_LENGTH) {
      const s = document.getElementById('customCodeStatus');
      s.textContent = `Kod musi mieć dokładnie ${CODE_LENGTH} znaków.`;
      s.className = 'status-box error';
      return;
    }

    document.getElementById('customCodeModal').classList.remove('open');
    UIManager.clearLobbyStatus();
    UIManager.setLobbyStatus('Tworzenie własnego pokoju…', 'info');

    try {
      const profile = await QozaChatDB.getProfile();
      const avatar = profile ? profile.avatar : name[0].toUpperCase();
      await WebRTCEngine.createRoom(raw, name, avatar);

      await QozaChatDB.saveProfile({ name, avatar });
      await QozaChatDB.saveRoom(raw, 'Pokój ' + raw.slice(0, 4), true);

      UIManager.openChatScreen();
      UIManager.hideWaiting();
      UIManager.enableInput(true);
      UIManager.setBadge('ok');
    } catch (err) {
      UIManager.setLobbyStatus(err.message, 'error');
    }
  });

  // Join room helper
  async function attemptJoin(rawCode, password = '') {
    const name = document.getElementById('nameInput').value.trim();
    const profile = await QozaChatDB.getProfile();
    const avatar = profile ? profile.avatar : name[0].toUpperCase();

    await WebRTCEngine.joinRoom(rawCode, name, avatar, password);
    await QozaChatDB.saveProfile({ name, avatar });
    await QozaChatDB.saveRoom(rawCode, 'Pokój ' + rawCode.slice(0, 4), false);

    UIManager.openChatScreen();
    UIManager.hideWaiting();
    UIManager.enableInput(true);
    UIManager.setBadge('ok');

    // Load previous local messages from IndexedDB for this room
    const pastMsgs = await QozaChatDB.getRoomMessages(rawCode);
    if (pastMsgs.length > 0) {
      pastMsgs.forEach(m => MessageManager.renderMessage(document.getElementById('msgs'), m, true));
      UIManager.scrollBottom();
    }
  }

  // Join button click
  document.getElementById('joinBtn').addEventListener('click', async () => {
    const name = document.getElementById('nameInput').value.trim();
    const raw = normalizeCode(document.getElementById('roomInput').value);
    if (!name) { UIManager.setLobbyStatus('Wpisz swój pseudonim.', 'error'); return; }
    if (raw.length !== CODE_LENGTH) { UIManager.setLobbyStatus(`Kod pokoju musi mieć ${CODE_LENGTH} znaków.`, 'error'); return; }

    UIManager.clearLobbyStatus();
    UIManager.setLobbyStatus('Łączenie z pokojem…', 'info');

    try {
      await attemptJoin(raw, '');
    } catch (err) {
      if (err.message.includes('password-required') || err.message.includes('hasło')) {
        UIManager.clearLobbyStatus();
        document.getElementById('passwordModalInput').value = '';
        document.getElementById('passwordModal').classList.add('open');
        document.getElementById('passwordModalInput').focus();

        document.getElementById('passwordConfirmBtn').onclick = async () => {
          const pass = document.getElementById('passwordModalInput').value;
          document.getElementById('passwordModal').classList.remove('open');
          UIManager.setLobbyStatus('Weryfikacja hasła…', 'info');
          try {
            await attemptJoin(raw, pass);
          } catch (e2) {
            UIManager.setLobbyStatus(e2.message, 'error');
          }
        };
      } else {
        UIManager.setLobbyStatus(err.message, 'error');
      }
    }
  });

  document.getElementById('passwordModalClose').onclick = () => document.getElementById('passwordModal').classList.remove('open');
  document.getElementById('passwordCancelBtn').onclick = () => document.getElementById('passwordModal').classList.remove('open');

  document.getElementById('roomInput').addEventListener('input', function () {
    this.value = formatCode(this.value);
  });

  // Profile modal
  document.getElementById('profileCardSetup').onclick = async () => {
    const profile = (await QozaChatDB.getProfile()) || {};
    document.getElementById('profileNameInput').value = profile.name || document.getElementById('nameInput').value;
    if (profile.avatar && profile.avatar.startsWith('data:')) {
      document.getElementById('profileModalAvatarPrev').innerHTML = `<img src="${profile.avatar}">`;
    }
    document.getElementById('profileModal').classList.add('open');
  };
  document.getElementById('profileModalClose').onclick = () => document.getElementById('profileModal').classList.remove('open');

  document.getElementById('profileAvatarUpload').onchange = function () {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        const base64 = e.target.result;
        document.getElementById('profileModalAvatarPrev').innerHTML = `<img src="${base64}">`;
        document.getElementById('profileAvatarDisplay').innerHTML = `<img src="${base64}">`;
        document.getElementById('profileAvatarDisplay').dataset.avatar = base64;
      };
      reader.readAsDataURL(file);
    }
  };

  document.getElementById('saveProfileBtn').onclick = async () => {
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) return alert('Wpisz nazwę');
    const avatar = document.getElementById('profileAvatarDisplay').dataset.avatar || name[0].toUpperCase();

    await QozaChatDB.saveProfile({ name, avatar });
    document.getElementById('nameInput').value = name;
    document.getElementById('profileModal').classList.remove('open');
    UIManager.showToast('Zapisano profil');
  };

  // ═══════════════════════════════════════
  // CHAT INPUT & MESSAGING
  // ═══════════════════════════════════════

  function handleSendOrEdit() {
    const inp = document.getElementById('chatInput');
    const text = inp.value.trim();
    if (!text) return;

    if (UIManager.editingMsgId) {
      // Perform Inline Editing
      const editingId = UIManager.editingMsgId;
      WebRTCEngine.sendEdit(editingId, text);
      MessageManager.applyEdit(editingId, text);
      UIManager.cancelEdit();
      return;
    }

    try {
      const msgObj = WebRTCEngine.sendMessage(text, MessageManager.activeReplyTo);
      msgObj.side = 'mine';
      MessageManager.renderMessage(document.getElementById('msgs'), msgObj);
      QozaChatDB.saveMessage({ ...msgObj, roomCode: WebRTCEngine.rawRoomCode });

      inp.value = '';
      inp.style.height = 'auto';
      UIManager.clearReply();
      WebRTCEngine.sendTyping(false);
    } catch (err) {
      UIManager.showToast(err.message);
    }
  }

  document.getElementById('sendBtn').onclick = handleSendOrEdit;

  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendOrEdit();
    }
  });

  let lastTypingTime = 0;
  document.getElementById('chatInput').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';

    const now = Date.now();
    if (now - lastTypingTime > 1500) {
      WebRTCEngine.sendTyping(true);
      lastTypingTime = now;
    }
  });

  // Mobile newline button
  document.getElementById('mobileNewlineBtn').onclick = () => {
    const inp = document.getElementById('chatInput');
    const pos = inp.selectionStart;
    inp.value = inp.value.slice(0, pos) + '\n' + inp.value.slice(inp.selectionEnd);
    inp.setSelectionRange(pos + 1, pos + 1);
    inp.focus();
  };

  // Voice recording
  let isRecMode = false;
  document.getElementById('recordBtn').onclick = async () => {
    if (!isRecMode) {
      const ok = await AudioManager.startRecording(
        (sec) => {
          document.getElementById('chatInput').placeholder = `Nagrywanie: ${sec} s…`;
        },
        (err) => UIManager.showToast(err)
      );
      if (ok) {
        isRecMode = true;
        document.getElementById('recordBtn').classList.add('recording');
      }
    } else {
      const audioData = await AudioManager.stopRecording();
      isRecMode = false;
      document.getElementById('recordBtn').classList.remove('recording');
      document.getElementById('chatInput').placeholder = 'Napisz wiadomość…';

      if (audioData) {
        try {
          const msgObj = WebRTCEngine.sendMediaMessage({ name: 'glosowka.webm' }, audioData, true);
          msgObj.side = 'mine';
          MessageManager.renderMessage(document.getElementById('msgs'), msgObj);
          QozaChatDB.saveMessage({ ...msgObj, roomCode: WebRTCEngine.rawRoomCode });
        } catch (err) {
          UIManager.showToast(err.message);
        }
      }
    }
  };

  // File upload
  document.getElementById('fileInput').onchange = function () {
    Array.from(this.files).forEach(file => {
      if (file.size > FILE_MAX) {
        UIManager.showToast('Plik przekracza limit 25 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        const src = e.target.result;
        const meta = { name: file.name, size: file.size, mime: file.type, isImage: /^image\//.test(file.type), src };
        try {
          const msgObj = WebRTCEngine.sendMediaMessage(meta, null, false);
          msgObj.side = 'mine';
          MessageManager.renderMessage(document.getElementById('msgs'), msgObj);
          QozaChatDB.saveMessage({ ...msgObj, roomCode: WebRTCEngine.rawRoomCode });
        } catch (err) {
          UIManager.showToast(err.message);
        }
      };
      reader.readAsDataURL(file);
    });
    this.value = '';
  };

  // Room Settings button
  document.getElementById('roomSettingsBtn').onclick = () => UIManager.openRoomSettingsModal();
  document.getElementById('roomSettingsClose').onclick = () => document.getElementById('roomSettingsModal').classList.remove('open');

  document.getElementById('saveRoomSettingsBtn').onclick = () => {
    try {
      const password = document.getElementById('settingPassword').value.trim() || null;
      const requireApproval = document.getElementById('settingRequireApproval').checked;
      const slowMode = parseInt(document.getElementById('settingSlowMode').value || '0', 10);
      const allowText = document.getElementById('settingAllowText').checked;
      const allowMedia = document.getElementById('settingAllowMedia').checked;

      WebRTCEngine.updateSettings({ password, requireApproval, slowMode, allowText, allowMedia });

      const newCode = normalizeCode(document.getElementById('settingNewCode').value);
      if (newCode && newCode !== WebRTCEngine.rawRoomCode) {
        WebRTCEngine.changeRoomCode(newCode);
      }

      document.getElementById('roomSettingsModal').classList.remove('open');
      UIManager.showToast('Zapisano ustawienia pokoju');
    } catch (err) {
      alert(err.message);
    }
  };

  // Delete Room button (for Owner)
  const delRoomBtn = document.getElementById('deleteRoomBtn');
  if (delRoomBtn) {
    delRoomBtn.onclick = () => {
      if (confirm('Czy na pewno chcesz usunąć ten pokój? Wszyscy uczestnicy zostaną rozłączeni.')) {
        try {
          WebRTCEngine.deleteRoom();
          UIManager.closeChatBack();
          UIManager.showToast('Pokój został usunięty');
        } catch (err) {
          alert(err.message);
        }
      }
    };
  }

  // Copy room code
  const copyCodeAction = () => {
    navigator.clipboard.writeText(WebRTCEngine.roomCode).then(() => UIManager.showToast('Skopiowano kod pokoju'));
  };
  document.getElementById('copyCodeBtn').onclick = copyCodeAction;

  // Leave chat
  const leaveAction = () => {
    if (confirm('Czy na pewno chcesz opuścić pokój?')) {
      UIManager.closeChatBack();
    }
  };
  document.getElementById('leaveBtn').onclick = leaveAction;

  // Export chat
  document.getElementById('exportBtn').onclick = () => {
    let txt = `QozaChat – Eksport rozmowy\nPokój: ${WebRTCEngine.roomCode}\nData: ${new Date().toLocaleString('pl-PL')}\n\n`;
    Object.values(MessageManager.msgMap).forEach(item => {
      const d = item.data;
      txt += `[${d.time}] ${d.author}: ${d.text}\n`;
    });
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qozachat_${WebRTCEngine.rawRoomCode}_${Date.now()}.txt`;
    a.click();
    UIManager.showToast('Wyeksportowano historię czatu');
  };

  // Emoji picker for input bar
  const pickerEl = document.getElementById('emojiPicker');
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'ep-em'; btn.textContent = em;
    btn.onclick = (e) => {
      const inp = document.getElementById('chatInput');
      const pos = inp.selectionStart;
      inp.value = inp.value.slice(0, pos) + em + inp.value.slice(inp.selectionEnd);
      inp.setSelectionRange(pos + em.length, pos + em.length);
      inp.focus();
      e.stopPropagation();
    };
    pickerEl.appendChild(btn);
  });

  document.getElementById('emojiBtn').onclick = (e) => {
    pickerEl.style.display = pickerEl.style.display === 'flex' ? 'none' : 'flex';
    e.stopPropagation();
  };
  document.addEventListener('click', () => { pickerEl.style.display = 'none'; });
});
