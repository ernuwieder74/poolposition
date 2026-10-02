/* Poolposition – Medien: Limits auf dem Server und Umzug des Altbestands
   1) medienZaehlen: läuft bei jedem neuen Original (uploads/{uid}/o/…) und jeder Vorschau (uploads/{uid}/v/…). Zählt je Ticket in kontingent/{uid}
      (foto, video, sprache, vor, tv = Beginn des Tickets) und löscht die Datei sofort, wenn das Limit überschritten wäre. Die App kann das nicht umgehen.
      Limits: Fotos Pauschal 200, Woche 100, Monat 150, Jahr 300; Videos und Sprachnachrichten je 20; Freikarte und Team ohne Limit; ohne bezahltes Ticket gar nichts.
   2) medienUmziehen: nur Oberbademeister. Holt Altbestand (Nachrichten mit Download-Adresse) in das neue Schema (Original unter o/, Vorschau unter v/, Pfad „p:…“ in der Nachricht). */
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const db = admin.firestore();
let REGION = 'us-central1'; try { REGION = require('./region.json').region || REGION; } catch (e) {}
let ADMINS = []; try { ADMINS = (require('./admins.json').admins || []).map(a => String(a).toLowerCase()); } catch (e) {}
const BEZAHLT = ['pauschal', 'woche', 'monat', 'jahr', 'frei'];
const FOTO = { pauschal: 200, woche: 100, monat: 150, jahr: 300 };
const VOR_MAX = 1000;
const artVon = ct => /^image\//.test(ct) ? 'foto' : /^video\//.test(ct) ? 'video' : /^audio\//.test(ct) ? 'sprache' : null;
const urlVon = (bucket, path, token) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

exports.medienZaehlen = onObjectFinalized({ region: REGION, maxInstances: 5 }, async ev => {
  const o = ev.data; if (o.metadata && o.metadata.migriert) return; const m = /^uploads\/([^/]+)\/(o|v)\/[^/]+$/.exec(o.name || ''); if (!m) return;
  const [, uid, teil] = m; const bucket = admin.storage().bucket(o.bucket); const weg = async grund => { logger.warn('Medium gelöscht', uid, o.name, grund); await bucket.file(o.name).delete().catch(() => {}); };
  const art = teil === 'v' ? 'vor' : artVon(o.contentType); if (!art) return weg('Typ');
  const u = await admin.auth().getUser(uid).catch(() => null); if (!u) return weg('Nutzer');
  const team = ADMINS.includes(String(u.email || '').toLowerCase()) || (await db.doc(`rollen/${uid}`).get()).exists;
  const ok = await db.runTransaction(async tx => {
    const [ts, ks] = await Promise.all([tx.get(db.doc(`tickets/${uid}`)), tx.get(db.doc(`kontingent/${uid}`))]);
    const t = ts.exists ? ts.data() : null; const gueltig = t && BEZAHLT.includes(t.art) && (t.bis || 0) > Date.now();
    if (!team && !gueltig) return false;
    const tv = team ? 0 : (t.von || 0); const k = ks.exists ? ks.data() : {}; const z = k.tv === tv ? { foto: k.foto || 0, video: k.video || 0, sprache: k.sprache || 0, vor: k.vor || 0 } : { foto: 0, video: 0, sprache: 0, vor: 0 };
    const limit = team || t.art === 'frei' ? Infinity : art === 'foto' ? FOTO[t.art] : art === 'vor' ? VOR_MAX : 20;
    if (z[art] >= limit) return false;
    z[art]++; tx.set(db.doc(`kontingent/${uid}`), { ...z, tv, at: Date.now() }); return true; });
  if (!ok) return weg('Limit oder kein Ticket');
});

/* ---------- Altbestand umziehen ---------- */
const pfadAusUrl = url => { const m = /\/o\/([^?]+)\?/.exec(String(url || '')); return m ? decodeURIComponent(m[1]) : null; };
async function vorschau(buf) { const sharp = require('sharp'); return sharp(buf, { animated: false }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(); }
async function eineUmziehen(bucket, d) {
  const x = d.data(); const felder = x.bild ? ['bild'] : x.audio ? ['audio'] : []; if (!felder.length) return 'leer';
  const f = felder[0]; const alt = pfadAusUrl(x[f]); if (!alt || !/^uploads\/[^/]+\/[^/]+$/.test(alt)) return 'neu';
  const [, uid, datei] = alt.split('/'); const neu = `uploads/${uid}/o/${datei}`; const quelle = bucket.file(alt);
  if (!(await quelle.exists())[0]) return 'fehlt';
  await quelle.copy(bucket.file(neu), { metadata: { metadata: { migriert: '1' } } }); const upd = { [f]: 'p:' + neu };
  if (f === 'bild' && !String(x.mime || '').startsWith('video')) {
    const [buf] = await quelle.download(); const vp = `uploads/${uid}/v/${datei.replace(/\.[^.]+$/, '')}.jpg`; const token = crypto.randomUUID();
    await bucket.file(vp).save(await vorschau(buf), { contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: token, migriert: '1' } } });
    upd.vor = urlVon(bucket.name, vp, token); }
  await d.ref.update(upd); await quelle.delete().catch(() => {}); return 'ok'; }
exports.medienUmziehen = onCall({ region: 'europe-west3', maxInstances: 1, timeoutSeconds: 540, memory: '1GiB' }, async req => {
  const uid = req.auth?.uid; if (!uid || req.auth.token.supportVon) throw new HttpsError('permission-denied', 'Nicht erlaubt.');
  const mail = String(req.auth.token.email || '').toLowerCase(); if (!ADMINS.includes(mail)) throw new HttpsError('permission-denied', 'Nur für den Oberbademeister.');
  const bucket = admin.storage().bucket(); const stat = { ok: 0, fehlt: 0, neu: 0, leer: 0, fehler: 0 }; const grenze = Date.now() + 450000;
  const snap = await db.collection('nachrichten').where('typ', 'in', ['bild', 'audio']).get();
  let offen = 0;
  for (const d of snap.docs) { const x = d.data(); const f = x.bild ? x.bild : x.audio; if (!f || /^p:/.test(f) || x.geloescht?.endgueltig) continue;
    if (Date.now() > grenze) { offen++; continue; }
    try { stat[await eineUmziehen(bucket, d)]++; } catch (e) { stat.fehler++; logger.error('Umzug', d.id, e); } }
  return { ...stat, offen };
});
