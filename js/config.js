const EMOJIS = ['👍','❤️','😂','😮','😢','🔥','👏','🎉','💯','🤔','😎','🙏','🙌','✨','🚀','🎉'];
const FILE_MAX = 25 * 1024 * 1024;
const MAX_ROOM_MEMBERS = 12;
const CODE_LENGTH = 12;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(raw) {
  const clean = normalizeCode(raw).slice(0, CODE_LENGTH);
  let formatted = '';
  for (let i = 0; i < clean.length; i++) {
    if (i > 0 && i % 4 === 0) formatted += '-';
    formatted += clean[i];
  }
  return formatted;
}

function escH(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function linkify(s) {
  const esc = escH(s);
  return esc.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;font-weight:500;">$1</a>');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function nowStr() {
  return new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', zip: '🗜️', rar: '🗜️', mp3: '🎵', wav: '🎵', ogg: '🎵', mp4: '🎬', mov: '🎬', txt: '📃', csv: '📊' };
  return map[ext] || '📎';
}
