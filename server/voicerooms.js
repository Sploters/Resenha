// Salas de voz para gamers: limite de pessoas, senha, orador prioritário, pedir a vez e sussurro.
//
// - Limite (channels.user_limit, 0 = sem limite): conta só gente (bots de música não ocupam vaga). Quem gerencia canais
//   ou modera voz entra mesmo cheia; quem foi movido pela moderação também.
// - Senha (channels.voice_locked = 1; o hash fica em voice_pass, que nunca vai para o app: o canal inteiro é enviado em
//   CHANNEL_UPDATE/READY). Quem acertou uma vez não digita de novo até a senha mudar (passOk, na memória). As mesmas
//   exceções do limite.
// - Orador prioritário (permissão de cargo P.PRIORITY): quem tem liga "Falar com prioridade" e, enquanto fala, os apps
//   dos outros abaixam as demais vozes (public/voice.js applyVolume). O servidor só confere a permissão.
// - Pedir a vez: st.hand = momento em que levantou a mão (a ordem da fila). A própria pessoa baixa; quem modera voz
//   baixa a de qualquer um da sala.
// - Sussurro: a voz de quem sussurra só chega às pessoas escolhidas da mesma sala (o SFU pausa o consumer do microfone
//   para os outros: server/sfu.js sfuModerate whisper). Sem SFU (malha P2P) não há como garantir: é recusado.
import crypto from 'node:crypto';
import { hashPw } from './accounts.js';

export const MAX_LIMIT = 99;
export const MAX_WHISPER = 25;

export function createVoiceRooms({ db, get, run, can, P }) {
  for (const c of ['user_limit INTEGER DEFAULT 0', 'voice_locked INTEGER DEFAULT 0']) { try { db.exec('ALTER TABLE channels ADD COLUMN ' + c); } catch { /* já existe */ } }
  db.exec('CREATE TABLE IF NOT EXISTS voice_pass(channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE, salt TEXT NOT NULL, hash TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 1)');
  const passOk = new Map(); // `${cid}:${uid}` -> versão da senha que a pessoa acertou

  const bypass = (ch, uid) => !!ch.guild_id && (can(ch.guild_id, uid, P.MANAGE_CHANNELS) || can(ch.guild_id, uid, P.VOICE_MOD));

  // { user_limit?: número, password?: string ('' tira a senha) } -> mensagem de erro ou null
  function configure(ch, b) {
    if (ch.type !== 2) return 'Só salas de voz têm limite e senha';
    if (b.user_limit !== undefined) {
      const n = Math.round(Number(b.user_limit));
      if (!Number.isFinite(n) || n < 0 || n > MAX_LIMIT) return `O limite vai de 0 (sem limite) a ${MAX_LIMIT}`;
      run('UPDATE channels SET user_limit=? WHERE id=?', n, ch.id);
    }
    if (typeof b.password === 'string') {
      const pw = b.password.trim();
      if (!pw) { run('DELETE FROM voice_pass WHERE channel_id=?', ch.id); run('UPDATE channels SET voice_locked=0 WHERE id=?', ch.id); }
      else {
        if (pw.length < 3 || pw.length > 64) return 'A senha da sala precisa ter de 3 a 64 caracteres';
        const salt = crypto.randomBytes(16).toString('hex'), v = (get('SELECT v FROM voice_pass WHERE channel_id=?', ch.id)?.v || 0) + 1;
        run('INSERT INTO voice_pass(channel_id,salt,hash,v) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET salt=excluded.salt, hash=excluded.hash, v=excluded.v', ch.id, salt, hashPw(pw, salt), v);
        run('UPDATE channels SET voice_locked=1 WHERE id=?', ch.id);
      }
    }
    return null;
  }

  function passMatches(ch, uid, pw) {
    const row = get('SELECT salt, hash, v FROM voice_pass WHERE channel_id=?', ch.id);
    if (!row) return true;
    if (passOk.get(ch.id + ':' + uid) === row.v) return true;
    if (typeof pw !== 'string' || !pw) return false;
    const a = Buffer.from(hashPw(pw.slice(0, 64), row.salt), 'hex'), b = Buffer.from(row.hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    passOk.set(ch.id + ':' + uid, row.v);
    return true;
  }

  // antes de entrar: null (pode) ou { code, reason } para o VOICE_DENIED
  function checkJoin(ch, uid, room, { password, moved } = {}) {
    if (ch.type !== 2 || moved || room?.has(uid) || bypass(ch, uid)) return null;
    if (ch.voice_locked && !passMatches(ch, uid, password)) {
      return typeof password === 'string' && password
        ? { code: 'wrong_password', reason: 'Senha da sala errada' }
        : { code: 'need_password', reason: 'Esta sala tem senha' };
    }
    const limit = ch.user_limit | 0;
    if (limit > 0) {
      let n = 0; for (const s of room?.values() || []) if (!s.bot) n++;
      if (n >= limit) return { code: 'full', reason: `A sala está cheia (${n}/${limit})` };
    }
    return null;
  }

  const canPriority = (ch, uid) => !ch.guild_id || can(ch.guild_id, uid, P.PRIORITY);
  const canLowerHands = (ch, uid) => !!ch.guild_id && can(ch.guild_id, uid, P.VOICE_MOD);
  return { configure, checkJoin, canPriority, canLowerHands };
}
