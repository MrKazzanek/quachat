const MessageManager = {
  msgMap: {},
  activeReplyTo: null,
  activeEditingId: null,

  parseMarkdown(text) {
    let esc = escH(text);
    // Code blocks / inline code
    esc = esc.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">$1</code>');
    // Bold
    esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    esc = esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Links
    esc = esc.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;font-weight:500;">$1</a>');
    return esc;
  },

  parseMentions(text, myName) {
    const esc = this.parseMarkdown(text);
    const mentionRegex = /@([a-zA-Z0-9_äöüÄÖÜąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)/g;

    let isMentionedMe = false;
    const formatted = esc.replace(mentionRegex, (match, username) => {
      if (username.toLowerCase() === (myName || '').toLowerCase()) {
        isMentionedMe = true;
      }
      return `<span class="mention-tag">@${username}</span>`;
    });

    return { html: formatted, isMentionedMe };
  },

  renderMessage(containerEl, msgData, isHistory = false) {
    const { id, author, avatar, text, time, side, replyTo, edited, isFile, isVoice, isPoll, fileMeta, audioData, reactions, pollData } = msgData;

    const group = document.createElement('div');
    group.className = 'msg-group ' + side;
    group.id = 'msg_' + id;
    group.dataset.id = id;

    const header = document.createElement('div');
    header.className = 'msg-header';
    const authorSpan = side === 'theirs' ? `<span class="msg-author">${escH(author)}</span>` : '';
    const editedSpan = edited ? `<span class="edited-tag">(edytowano)</span>` : '';
    header.innerHTML = `${authorSpan}<span>${time || nowStr()}</span> ${editedSpan}`;

    let replyHTML = '';
    if (replyTo) {
      replyHTML = `<div class="reply-quote" onclick="MessageManager.scrollToMessage('${replyTo.id}')" style="background:rgba(0,0,0,0.18);border-left:3px solid var(--acc2);border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:12px;cursor:pointer;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        <span style="font-weight:600">${escH(replyTo.author)}: </span>${escH(replyTo.text ? replyTo.text.slice(0, 60) : 'Wiadomość')}
      </div>`;
    }

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'bubble-wrap';

    // Touch support for mobile long press
    let touchTimer = null;
    bubbleWrap.addEventListener('touchstart', () => {
      touchTimer = setTimeout(() => {
        bubbleWrap.classList.add('touch-active');
      }, 450);
    });
    bubbleWrap.addEventListener('touchend', () => clearTimeout(touchTimer));
    bubbleWrap.addEventListener('touchmove', () => clearTimeout(touchTimer));

    const actions = document.createElement('div');
    actions.className = 'bubble-actions';

    const reactBtn = document.createElement('button');
    reactBtn.className = 'bact'; reactBtn.title = 'Reaguj'; reactBtn.textContent = '😊';
    reactBtn.onclick = (e) => UIManager.openReactionPicker(e, id);

    const replyBtn = document.createElement('button');
    replyBtn.className = 'bact'; replyBtn.title = 'Odpowiedz';
    replyBtn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';
    replyBtn.onclick = () => UIManager.setReply(id, text, author);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'bact'; copyBtn.title = 'Kopiuj';
    copyBtn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text).then(() => UIManager.showToast('Skopiowano treść'));
    };

    actions.append(reactBtn, replyBtn, copyBtn);

    if (side === 'mine') {
      const editBtn = document.createElement('button');
      editBtn.className = 'bact'; editBtn.title = 'Edytuj';
      editBtn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      editBtn.onclick = () => UIManager.startEditMessage(id, text);
      actions.append(editBtn);
    }

    if (side === 'mine' || RoomPermissions.canDeleteAnyMsg(WebRTCEngine.myRole)) {
      const delBtn = document.createElement('button');
      delBtn.className = 'bact del'; delBtn.title = 'Usuń';
      delBtn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      delBtn.onclick = () => {
        if (confirm('Usunąć tę wiadomość?')) {
          WebRTCEngine.sendDelete(id);
          this.applyDelete(id);
        }
      };
      actions.append(delBtn);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (isVoice && audioData) {
      bubble.appendChild(AudioManager.createAudioPlayer(audioData));
    } else if (isFile && fileMeta) {
      if (fileMeta.isImage && fileMeta.src) {
        bubble.innerHTML = `${replyHTML}<div class="img-bubble"><img src="${fileMeta.src}" alt="${escH(fileMeta.name)}" onclick="UIManager.openLightbox('${fileMeta.src}')"></div>`;
      } else {
        bubble.innerHTML = `${replyHTML}
          <div class="file-bubble">
            <div class="file-icon">${fileIcon(fileMeta.name)}</div>
            <div class="file-info">
              <div class="file-name">${escH(fileMeta.name)}</div>
              <div class="file-size">${formatBytes(fileMeta.size)}</div>
            </div>
            <a class="icon-btn file-dl" href="${fileMeta.src || '#'}" download="${escH(fileMeta.name)}" title="Pobierz">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
          </div>`;
      }
    } else {
      const parsed = this.parseMentions(text, WebRTCEngine.myName);
      bubble.innerHTML = replyHTML + parsed.html.replace(/\n/g, '<br>');
      if (parsed.isMentionedMe && !isHistory) {
        UIManager.playNotificationSound();
        UIManager.showToast(`Wspomniano o Tobie: ${author}`);
      }
    }

    bubbleWrap.append(actions, bubble);

    const reactionsBar = document.createElement('div');
    reactionsBar.className = 'reactions-bar';

    group.append(header, bubbleWrap, reactionsBar);
    containerEl.appendChild(group);

    this.msgMap[id] = { el: group, data: msgData };
    this.renderReactions(id, reactions || {});

    if (!isHistory) {
      UIManager.scrollBottom();
    }
  },

  applyEdit(msgId, newText) {
    const item = this.msgMap[msgId];
    if (!item) return;
    item.data.text = newText;
    item.data.edited = true;

    const bubble = item.el.querySelector('.bubble');
    if (bubble) {
      const parsed = this.parseMentions(newText, WebRTCEngine.myName);
      bubble.innerHTML = parsed.html.replace(/\n/g, '<br>');
    }
    const header = item.el.querySelector('.msg-header');
    if (header && !header.querySelector('.edited-tag')) {
      header.insertAdjacentHTML('beforeend', ' <span class="edited-tag">(edytowano)</span>');
    }

    QozaChatDB.updateMessageInDB(WebRTCEngine.rawRoomCode, msgId, { text: newText, edited: true });
  },

  applyDelete(msgId) {
    const item = this.msgMap[msgId];
    if (!item) return;
    const bubbleWrap = item.el.querySelector('.bubble-wrap');
    if (bubbleWrap) {
      bubbleWrap.innerHTML = '<div class="msg-deleted">Wiadomość została usunięta</div>';
    }
    const reactionsBar = item.el.querySelector('.reactions-bar');
    if (reactionsBar) reactionsBar.innerHTML = '';

    QozaChatDB.updateMessageInDB(WebRTCEngine.rawRoomCode, msgId, { text: '[usunięta]', deleted: true });
  },

  renderReactions(msgId, reactions) {
    const item = this.msgMap[msgId];
    if (!item) return;
    item.data.reactions = reactions;

    const bar = item.el.querySelector('.reactions-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const counts = {};
    const myReactions = new Set();

    Object.entries(reactions).forEach(([k, author]) => {
      let em = k.split('_')[0];
      counts[em] = (counts[em] || 0) + 1;
      if (author === WebRTCEngine.myName) myReactions.add(em);
    });

    Object.entries(counts).forEach(([em, cnt]) => {
      const chip = document.createElement('div');
      chip.className = 'reaction-chip' + (myReactions.has(em) ? ' mine' : '');
      chip.innerHTML = `${em} <span class="cnt">${cnt}</span>`;
      chip.onclick = () => {
        const isMine = myReactions.has(em);
        WebRTCEngine.sendReaction(msgId, em, !isMine);
        this.applyReaction(msgId, em, !isMine, WebRTCEngine.myName);
      };
      bar.appendChild(chip);
    });
  },

  applyReaction(msgId, emoji, add, author) {
    const item = this.msgMap[msgId];
    if (!item) return;
    const reactions = item.data.reactions || {};
    const key = emoji + '_' + author;

    if (add) {
      reactions[key] = author;
    } else {
      delete reactions[key];
    }

    this.renderReactions(msgId, reactions);
    QozaChatDB.updateMessageInDB(WebRTCEngine.rawRoomCode, msgId, { reactions });
  },

  scrollToMessage(msgId) {
    const el = document.getElementById('msg_' + msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg-highlight');
      setTimeout(() => el.classList.remove('msg-highlight'), 1500);
    }
  }
};
