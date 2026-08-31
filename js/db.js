const QozaChatDB = {
  db: null,

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('QozaChatDB', 1);

      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('rooms')) {
          db.createObjectStore('rooms', { keyPath: 'code' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('roomCode', 'roomCode', { unique: false });
          msgStore.createIndex('msgId', 'msgId', { unique: true });
        }
      };

      request.onsuccess = e => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = e => {
        console.error('IndexedDB init error:', e);
        resolve(null);
      };
    });
  },

  async getProfile() {
    if (!this.db) return null;
    return new Promise(resolve => {
      const tx = this.db.transaction('profiles', 'readonly');
      const req = tx.objectStore('profiles').get('me');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },

  async saveProfile(profile) {
    if (!this.db) return;
    profile.id = 'me';
    profile.updatedAt = Date.now();
    return new Promise(resolve => {
      const tx = this.db.transaction('profiles', 'readwrite');
      tx.objectStore('profiles').put(profile);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async getSavedRooms() {
    if (!this.db) return [];
    return new Promise(resolve => {
      const tx = this.db.transaction('rooms', 'readonly');
      const req = tx.objectStore('rooms').getAll();
      req.onsuccess = () => {
        const rooms = req.result || [];
        rooms.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
        resolve(rooms);
      };
      req.onerror = () => resolve([]);
    });
  },

  async saveRoom(code, name, isOwner = false) {
    if (!this.db) return;
    const cleanCode = normalizeCode(code);
    return new Promise(resolve => {
      const tx = this.db.transaction('rooms', 'readwrite');
      tx.objectStore('rooms').put({
        code: cleanCode,
        name: name || 'Pokój ' + cleanCode.slice(0, 4),
        isOwner,
        lastActive: Date.now()
      });
      tx.oncomplete = () => resolve(true);
    });
  },

  async deleteSavedRoom(code) {
    if (!this.db) return;
    const cleanCode = normalizeCode(code);
    return new Promise(resolve => {
      const tx = this.db.transaction('rooms', 'readwrite');
      tx.objectStore('rooms').delete(cleanCode);
      tx.oncomplete = () => resolve(true);
    });
  },

  async saveMessage(msg) {
    if (!this.db || !msg.roomCode || !msg.msgId) return;
    return new Promise(resolve => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const dbMsg = {
        id: msg.roomCode + '_' + msg.msgId,
        roomCode: msg.roomCode,
        msgId: msg.msgId,
        side: msg.side,
        author: msg.author,
        text: msg.text,
        time: msg.time,
        timestamp: msg.timestamp || Date.now(),
        replyTo: msg.replyTo || null,
        isFile: !!msg.isFile,
        isVoice: !!msg.isVoice,
        isPoll: !!msg.isPoll,
        fileMeta: msg.fileMeta || null,
        audioData: msg.audioData || null,
        reactions: msg.reactions || {},
        pollData: msg.pollData || null,
        deleted: !!msg.deleted,
        edited: !!msg.edited
      };
      store.put(dbMsg);
      tx.oncomplete = () => resolve(true);
    });
  },

  async getRoomMessages(roomCode) {
    if (!this.db) return [];
    const cleanCode = normalizeCode(roomCode);
    return new Promise(resolve => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('roomCode');
      const req = index.getAll(cleanCode);
      req.onsuccess = () => {
        const msgs = req.result || [];
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        resolve(msgs);
      };
      req.onerror = () => resolve([]);
    });
  },

  async updateMessageInDB(roomCode, msgId, updates) {
    if (!this.db) return;
    const id = roomCode + '_' + msgId;
    return new Promise(resolve => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          const updated = { ...req.result, ...updates };
          store.put(updated);
        }
      };
      tx.oncomplete = () => resolve(true);
    });
  }
};
