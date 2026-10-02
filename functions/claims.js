/* Poolposition – Berechtigungen für die Originale im Speicher (Fotos, Videos, Sprachnachrichten)
   Die Speicherregeln können keine Datenbank lesen, deshalb schreibt der Server das Ticket als Kennzeichen in die Anmeldung des Nutzers:
   tkb = Ende des bezahlten Tickets (Millisekunden), st = Team (Oberbademeister und Bademeister). Die Regeln vergleichen tkb mit der aktuellen Zeit,
   ein abgelaufenes Ticket verliert die Berechtigung also von selbst. Neu gesetzt wird bei jeder Änderung an tickets/{uid} oder rollen/{uid}
   und einmal beim App-Start über claimsSelf (für Bestandsnutzer). Bestehende Kennzeichen (z. B. supportVon) bleiben erhalten. */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const db = admin.firestore();
let REGION = 'us-central1'; try { REGION = require('./region.json').region || REGION; } catch (e) {}
let ADMINS = []; try { ADMINS = (require('./admins.json').admins || []).map(a => String(a).toLowerCase()); } catch (e) {}
const BEZAHLT = ['pauschal', 'woche', 'monat', 'jahr', 'frei'];
const IMMER = 4102444800000; // 01.01.2100

async function kennzeichenSetzen(uid) {
  const u = await admin.auth().getUser(uid).catch(() => null); if (!u) return null;
  const [t, r] = await Promise.all([db.doc(`tickets/${uid}`).get(), db.doc(`rollen/${uid}`).get()]);
  const alt = u.customClaims || {};
  const team = r.exists || ADMINS.includes(String(u.email || '').toLowerCase());
  let tkb = 0; if (t.exists) { const d = t.data(); if (BEZAHLT.includes(d.art)) tkb = Number(d.bis) || 0; }
  if (team) tkb = IMMER;
  const neu = { ...alt }; if (tkb) neu.tkb = tkb; else delete neu.tkb; if (team) neu.st = true; else delete neu.st;
  if (JSON.stringify(neu) !== JSON.stringify(alt)) await admin.auth().setCustomUserClaims(uid, neu);
  /* Öffentlich sichtbare Ticketart (nur Art und Ende, für das Profil anderer Mitglieder). Das Team erscheint als Testerkarte, wie die Tester, damit eine fehlende Karte nichts verrät. */
  if (team) await db.doc(`ticketart/${uid}`).set({ art: 'frei', bis: IMMER, at: Date.now() });
  else { const d = t.exists ? t.data() : null; await db.doc(`ticketart/${uid}`).set({ art: d ? d.art : 'tag', bis: d ? Number(d.bis) || 0 : 0, at: Date.now() }); }
  return { tkb, team };
}
exports.ticketKennzeichen = onDocumentWritten({ region: REGION, maxInstances: 5, document: 'tickets/{uid}' }, ev => kennzeichenSetzen(ev.params.uid).catch(e => logger.error('Kennzeichen', ev.params.uid, e)));
exports.rollenKennzeichen = onDocumentWritten({ region: REGION, maxInstances: 5, document: 'rollen/{uid}' }, ev => kennzeichenSetzen(ev.params.uid).catch(e => logger.error('Kennzeichen', ev.params.uid, e)));
exports.claimsSelf = onCall({ region: 'europe-west3', maxInstances: 5 }, async req => {
  const uid = req.auth?.uid; if (!uid) throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  if (req.auth.token.supportVon) return { ok: false };
  return { ok: true, ...(await kennzeichenSetzen(uid)) };
});
