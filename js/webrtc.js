const WebRTCEngine = {
  peer: null,
  roomCode: '',
  rawRoomCode: '',
  isHost: false,
  myPeerId: '',
  myName: '',
  myAvatar: '',
  myRole: RoomPermissions.ROLES.MEMBER,
  connections: {}, // peerId -> conn
  members: {}, // peerId -> { peerId, name, avatar, role, isMuted }
  roomSettings: RoomPermissions.createDefaultSettings(),
  tabChannel: null,
  isConnecting: false,
  cooldownTimer: 0,
  lastSentTime: 0,
  seenMsgIds: new Set(),

  callbacks: {
    onStatusChange: null,
    onMessageReceived: null,
    onMessageEdited: null,
    onMessageDeleted: null,
    onReaction: null,
    onMembersUpdated: null,
    onTypingUpdated: null,
    onSettingsUpdated: null,
    onKnockRequest: null,
    onKicked: null,
    onRoomCodeChanged: null,
    onRoomDeleted: null
  },

  initTabLock() {
    if ('BroadcastChannel' in window) {
      if (this.tabChannel) { try { this.tabChannel.close(); } catch (e) {} }
      this.tabChannel = new BroadcastChannel('qozachat_active_rooms');
      this.tabChannel.onmessage = e => {
        if (e.data && e.data.type === 'ping-room' && e.data.room === this.rawRoomCode) {
          this.tabChannel.postMessage({ type: 'pong-room', room: this.rawRoomCode });
        }
      };
    }
  },

  checkTabLock(rawCode) {
    return new Promise(resolve => {
      if (!('BroadcastChannel' in window)) return resolve(false);
      const ch = new BroadcastChannel('qozachat_active_rooms');
      let found = false;
      ch.onmessage = e => {
        if (e.data && e.data.type === 'pong-room' && e.data.room === rawCode) {
          found = true;
        }
      };
      ch.postMessage({ type: 'ping-room', room: rawCode });
      setTimeout(() => {
        ch.close();
        resolve(found);
      }, 250);
    });
  },

  getHostPeerId(rawCode) {
    return 'qozachat_v2_' + rawCode + '_host';
  },

  async createRoom(code, name, avatar) {
    if (this.isConnecting) return;
    this.isConnecting = true;
    const raw = normalizeCode(code);
    const inUse = await this.checkTabLock(raw);
    if (inUse) {
      this.isConnecting = false;
      throw new Error('Jesteś już połączony z tym pokojem w innej karcie przeglądarki!');
    }

    this.rawRoomCode = raw;
    this.roomCode = formatCode(raw);
    this.myName = name;
    this.myAvatar = avatar || name[0].toUpperCase();
    this.isHost = true;
    this.myRole = RoomPermissions.ROLES.OWNER;
    this.roomSettings = RoomPermissions.createDefaultSettings();
    this.seenMsgIds.clear();

    const hostPeerId = this.getHostPeerId(raw);
    return new Promise((resolve, reject) => {
      this.peer = new Peer(hostPeerId, {
        debug: 0,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
      });

      this.peer.on('open', id => {
        this.myPeerId = id;
        this.isConnecting = false;
        this.members[id] = { peerId: id, name: this.myName, avatar: this.myAvatar, role: this.myRole, isMuted: false };
        this.initTabLock();
        resolve(this.roomCode);
      });

      this.peer.on('connection', conn => this.handleIncomingHostConn(conn));

      this.peer.on('error', err => {
        this.isConnecting = false;
        if (err.type === 'unavailable-id') {
          reject(new Error('Ten kod pokoju jest w tej chwili zajęty.'));
        } else {
          reject(new Error('Błąd połączenia PeerJS: ' + err.type));
        }
      });
    });
  },

  async joinRoom(code, name, avatar, password = '') {
    if (this.isConnecting) return;
    this.isConnecting = true;
    const raw = normalizeCode(code);
    const inUse = await this.checkTabLock(raw);
    if (inUse) {
      this.isConnecting = false;
      throw new Error('Jesteś już połączony z tym pokojem w innej karcie przeglądarki!');
    }

    this.rawRoomCode = raw;
    this.roomCode = formatCode(raw);
    this.myName = name;
    this.myAvatar = avatar || name[0].toUpperCase();
    this.isHost = false;
    this.myRole = RoomPermissions.ROLES.MEMBER;
    this.seenMsgIds.clear();

    const hostPeerId = this.getHostPeerId(raw);
    return new Promise((resolve, reject) => {
      this.peer = new Peer({
        debug: 0,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
      });

      this.peer.on('open', id => {
        this.myPeerId = id;
        const conn = this.peer.connect(hostPeerId, { reliable: true });

        const timeout = setTimeout(() => {
          this.isConnecting = false;
          try { conn.close(); } catch (e) {}
          reject(new Error('Przekroczono czas oczekiwania na połączenie z gospodarzem pokoju.'));
        }, 12000);

        conn.on('open', () => {
          clearTimeout(timeout);
          conn.send({
            type: 'join-request',
            name: this.myName,
            avatar: this.myAvatar,
            password: password
          });
        });

        conn.on('data', data => {
          if (data.type === 'join-rejected') {
            this.isConnecting = false;
            try { conn.close(); } catch (e) {}
            reject(new Error(data.reason || 'Odmowa dołączenia do pokoju.'));
          } else if (data.type === 'join-accepted') {
            this.isConnecting = false;
            this.connections[hostPeerId] = conn;
            this.setupClientConn(conn);
            this.myRole = data.yourRole || RoomPermissions.ROLES.MEMBER;
            this.members = data.members || {};
            this.roomSettings = data.settings || RoomPermissions.createDefaultSettings();
            this.initTabLock();
            resolve(this.roomCode);
          } else {
            this.handleData(data, conn.peer);
          }
        });

        conn.on('error', err => {
          clearTimeout(timeout);
          this.isConnecting = false;
          reject(new Error('Błąd połączenia z gospodarzem: ' + err));
        });
      });

      this.peer.on('error', err => {
        this.isConnecting = false;
        if (err.type === 'peer-unavailable') {
          reject(new Error('Pokój o podanym kodzie nie istnieje lub gospodarz rozłączył się.'));
        } else {
          reject(new Error('Błąd sieci: ' + err.type));
        }
      });
    });
  },

  handleIncomingHostConn(conn) {
    conn.on('data', data => {
      if (data.type === 'join-request') {
        // Clean up any stale member with the same username (duplicate user fix)
        const existingPeerId = Object.keys(this.members).find(pid => this.members[pid].name === data.name);
        if (existingPeerId) {
          delete this.members[existingPeerId];
          if (this.connections[existingPeerId]) {
            try { this.connections[existingPeerId].close(); } catch (e) {}
            delete this.connections[existingPeerId];
          }
        }

        const activeCount = Object.keys(this.connections).length + 1;
        if (activeCount >= MAX_ROOM_MEMBERS) {
          conn.send({ type: 'join-rejected', reason: 'Pokój osiągnął maksymalny limit 12 osób.' });
          conn.close();
          return;
        }

        if (this.roomSettings.bannedList && this.roomSettings.bannedList.includes(data.name)) {
          conn.send({ type: 'join-rejected', reason: 'Zostałeś zablokowany w tym pokoju.' });
          conn.close();
          return;
        }

        if (this.roomSettings.password && this.roomSettings.password !== data.password) {
          conn.send({ type: 'join-rejected', reason: 'password-required' });
          conn.close();
          return;
        }

        if (this.roomSettings.requireApproval) {
          if (this.callbacks.onKnockRequest) {
            this.callbacks.onKnockRequest(data.name, data.avatar, accepted => {
              if (accepted) {
                this.acceptJoin(conn, data);
              } else {
                conn.send({ type: 'join-rejected', reason: 'Właściciel odrzucił prośbę o dołączenie.' });
                conn.close();
              }
            });
          } else {
            this.acceptJoin(conn, data);
          }
        } else {
          this.acceptJoin(conn, data);
        }
      } else {
        this.handleData(data, conn.peer);
      }
    });

    conn.on('close', () => this.handlePeerDisconnect(conn.peer));
  },

  acceptJoin(conn, data) {
    const peerId = conn.peer;
    const role = this.roomSettings.adminList.includes(data.name) ? RoomPermissions.ROLES.ADMIN : RoomPermissions.ROLES.MEMBER;

    this.connections[peerId] = conn;
    this.members[peerId] = { peerId, name: data.name, avatar: data.avatar, role, isMuted: false };

    conn.send({
      type: 'join-accepted',
      yourRole: role,
      members: this.members,
      settings: this.roomSettings
    });

    this.broadcast({
      type: 'members-updated',
      members: this.members
    });

    if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
    this.setupHostConn(conn);
  },

  setupHostConn(conn) {
    conn.on('data', data => this.handleData(data, conn.peer));
    conn.on('close', () => this.handlePeerDisconnect(conn.peer));
  },

  setupClientConn(conn) {
    conn.on('close', () => {
      delete this.connections[conn.peer];
      if (this.callbacks.onStatusChange) this.callbacks.onStatusChange('off', 'Rozłączono z gospodarzem');
    });
  },

  handlePeerDisconnect(peerId) {
    const member = this.members[peerId];
    delete this.connections[peerId];
    delete this.members[peerId];

    if (member) {
      // If the owner left, automatically assign ownership to another active member!
      if (member.role === RoomPermissions.ROLES.OWNER && Object.keys(this.members).length > 0) {
        const remainingPeerIds = Object.keys(this.members);
        const nextOwnerId = remainingPeerIds[0];
        this.members[nextOwnerId].role = RoomPermissions.ROLES.OWNER;
        if (nextOwnerId === this.myPeerId) {
          this.myRole = RoomPermissions.ROLES.OWNER;
        }
      }

      this.broadcast({ type: 'members-updated', members: this.members });
      if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
    }
  },

  broadcast(msg, exceptPeerId = null) {
    Object.entries(this.connections).forEach(([pid, conn]) => {
      if (pid !== exceptPeerId && conn.open) {
        try { conn.send(msg); } catch (e) {}
      }
    });
  },

  handleData(data, fromPeerId) {
    if (!data || !data.type) return;

    // Deduplicate chat messages by ID
    if (data.type === 'chat-message' && data.id) {
      if (this.seenMsgIds.has(data.id)) return;
      this.seenMsgIds.add(data.id);
    }

    // Host relays to other peers (except sender)
    if (this.isHost && data.type !== 'members-updated') {
      this.broadcast(data, fromPeerId);
    }

    switch (data.type) {
      case 'members-updated':
        this.members = data.members;
        if (this.members[this.myPeerId]) this.myRole = this.members[this.myPeerId].role;
        if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
        break;
      case 'settings-updated':
        this.roomSettings = data.settings;
        if (this.callbacks.onSettingsUpdated) this.callbacks.onSettingsUpdated(this.roomSettings);
        break;
      case 'chat-message':
        if (this.callbacks.onMessageReceived) this.callbacks.onMessageReceived(data);
        break;
      case 'message-edit':
        if (this.callbacks.onMessageEdited) this.callbacks.onMessageEdited(data.id, data.text);
        break;
      case 'message-delete':
        if (this.callbacks.onMessageDeleted) this.callbacks.onMessageDeleted(data.id);
        break;
      case 'reaction':
        if (this.callbacks.onReaction) this.callbacks.onReaction(data.msgId, data.emoji, data.add, data.author);
        break;
      case 'typing-status':
        if (this.callbacks.onTypingUpdated) this.callbacks.onTypingUpdated(data.name, data.isTyping, data.avatar);
        break;
      case 'kick-user':
        if (data.targetName === this.myName) {
          if (this.callbacks.onKicked) this.callbacks.onKicked(data.reason || 'Zostałeś wyrzucony z pokoju.');
          this.disconnect();
        }
        break;
      case 'room-code-changed':
        this.rawRoomCode = data.newRawCode;
        this.roomCode = formatCode(data.newRawCode);
        if (this.callbacks.onRoomCodeChanged) this.callbacks.onRoomCodeChanged(this.roomCode);
        break;
      case 'room-deleted':
        if (this.callbacks.onRoomDeleted) this.callbacks.onRoomDeleted();
        this.disconnect();
        break;
    }
  },

  sendMessage(text, replyTo = null, extra = {}) {
    if (this.roomSettings.slowMode > 0 && !RoomPermissions.isAdminOrOwner(this.myRole)) {
      const now = Date.now();
      const elapsed = (now - this.lastSentTime) / 1000;
      if (elapsed < this.roomSettings.slowMode) {
        const wait = Math.ceil(this.roomSettings.slowMode - elapsed);
        throw new Error(`Tryb wolny włączony. Odczekaj jeszcze ${wait} s.`);
      }
      this.lastSentTime = now;
    }

    if (!this.roomSettings.allowText && !RoomPermissions.isAdminOrOwner(this.myRole)) {
      throw new Error('Wysyłanie wiadomości tekstowych zostało wyłączone przez właściciela.');
    }

    const me = this.members[this.myPeerId] || {};
    if (me.isMuted) {
      throw new Error('Jesteś wyciszony w tym pokoju.');
    }

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    this.seenMsgIds.add(msgId);

    const msgObj = {
      type: 'chat-message',
      id: msgId,
      author: this.myName,
      avatar: this.myAvatar,
      text,
      time: nowStr(),
      timestamp: Date.now(),
      replyTo,
      ...extra
    };

    this.broadcast(msgObj);
    return msgObj;
  },

  sendMediaMessage(fileMeta, rawDataOrBlob, isVoice = false) {
    if (!this.roomSettings.allowMedia && !RoomPermissions.isAdminOrOwner(this.myRole)) {
      throw new Error('Wysyłanie multimediów zostało wyłączone przez właściciela.');
    }

    const msgObj = this.sendMessage(isVoice ? '[Wiadomość głosowa]' : `[Plik: ${fileMeta.name}]`, null, {
      isFile: !isVoice,
      isVoice: isVoice,
      fileMeta,
      audioData: isVoice ? rawDataOrBlob : null
    });

    return msgObj;
  },

  sendEdit(msgId, newText) {
    const data = { type: 'message-edit', id: msgId, text: newText };
    this.broadcast(data);
  },

  sendDelete(msgId) {
    const data = { type: 'message-delete', id: msgId };
    this.broadcast(data);
  },

  sendReaction(msgId, emoji, add) {
    const data = { type: 'reaction', msgId, emoji, add, author: this.myName };
    this.broadcast(data);
  },

  sendTyping(isTyping) {
    const data = { type: 'typing-status', name: this.myName, avatar: this.myAvatar, isTyping };
    this.broadcast(data);
  },

  kickUser(targetName, reason = '') {
    const meRole = this.myRole;
    const targetMember = Object.values(this.members).find(m => m.name === targetName);
    if (!targetMember) return;
    if (!RoomPermissions.canKick(meRole, targetMember.role)) throw new Error('Brak uprawnień do wyrzucenia tego użytkownika.');

    this.broadcast({ type: 'kick-user', targetName, reason });
    delete this.members[targetMember.peerId];
    if (this.connections[targetMember.peerId]) {
      this.connections[targetMember.peerId].close();
      delete this.connections[targetMember.peerId];
    }
    this.broadcast({ type: 'members-updated', members: this.members });
    if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
  },

  banUser(targetName) {
    this.kickUser(targetName, 'Zostałeś zablokowany.');
    if (!this.roomSettings.bannedList.includes(targetName)) {
      this.roomSettings.bannedList.push(targetName);
      this.updateSettings(this.roomSettings);
    }
  },

  toggleMuteUser(targetName) {
    const targetMember = Object.values(this.members).find(m => m.name === targetName);
    if (!targetMember) return;
    if (!RoomPermissions.canMute(this.myRole, targetMember.role)) throw new Error('Brak uprawnień.');

    targetMember.isMuted = !targetMember.isMuted;
    this.broadcast({ type: 'members-updated', members: this.members });
    if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
  },

  transferOwnership(targetName) {
    if (!RoomPermissions.isOwner(this.myRole)) throw new Error('Tylko właściciel może przekazać własność pokoju.');
    const targetMember = Object.values(this.members).find(m => m.name === targetName);
    if (!targetMember) throw new Error('Nie znaleziono użytkownika.');

    this.myRole = RoomPermissions.ROLES.ADMIN;
    this.members[this.myPeerId].role = RoomPermissions.ROLES.ADMIN;
    targetMember.role = RoomPermissions.ROLES.OWNER;

    this.broadcast({ type: 'members-updated', members: this.members });
    if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
  },

  setRole(targetName, newRole) {
    if (!RoomPermissions.isOwner(this.myRole)) throw new Error('Tylko właściciel może zmieniać role.');
    const targetMember = Object.values(this.members).find(m => m.name === targetName);
    if (!targetMember) return;

    if (newRole === RoomPermissions.ROLES.OWNER) {
      this.transferOwnership(targetName);
      return;
    }

    targetMember.role = newRole;
    this.broadcast({ type: 'members-updated', members: this.members });
    if (this.callbacks.onMembersUpdated) this.callbacks.onMembersUpdated(this.members);
  },

  deleteRoom() {
    if (!RoomPermissions.isOwner(this.myRole)) throw new Error('Tylko właściciel może usunąć pokój.');
    this.broadcast({ type: 'room-deleted' });
    this.disconnect();
  },

  updateSettings(newSettings) {
    if (!RoomPermissions.isOwner(this.myRole)) throw new Error('Tylko właściciel może zmieniać ustawienia pokoju.');
    this.roomSettings = { ...this.roomSettings, ...newSettings };
    this.broadcast({ type: 'settings-updated', settings: this.roomSettings });
    if (this.callbacks.onSettingsUpdated) this.callbacks.onSettingsUpdated(this.roomSettings);
  },

  changeRoomCode(newRawCode) {
    if (!RoomPermissions.isOwner(this.myRole)) throw new Error('Tylko właściciel może zmienić kod pokoju.');
    const clean = normalizeCode(newRawCode);
    if (clean.length !== CODE_LENGTH) throw new Error(`Kod pokoju musi mieć dokładnie ${CODE_LENGTH} znaków.`);

    this.rawRoomCode = clean;
    this.roomCode = formatCode(clean);
    this.broadcast({ type: 'room-code-changed', newRawCode: clean });
    if (this.callbacks.onRoomCodeChanged) this.callbacks.onRoomCodeChanged(this.roomCode);
  },

  disconnect() {
    Object.values(this.connections).forEach(c => { try { c.close(); } catch (e) {} });
    this.connections = {};
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
    this.members = {};
    this.isConnecting = false;
    this.seenMsgIds.clear();
    if (this.tabChannel) { try { this.tabChannel.close(); } catch (e) {} this.tabChannel = null; }
  }
};
