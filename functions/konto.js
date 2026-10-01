/* Poolposition – Datenexport und Konto löschen (Pflicht für App Store und Google Play, DSGVO)
   - datenExport: gibt alle Daten der angemeldeten Person als JSON zurück (Profil, Einstellungen, Mitgliedschaften, eigene Beiträge je Reise).
   - kontoLoeschen: löscht Profil, Einstellungen, Push-Schlüssel, Notfallpass, Zimmer-/Budget-/Anreise-Angaben und Stimmen, setzt die Mitgliedschaften auf „ausgetreten“,
     anonymisiert eigene Chatnachrichten und löscht zuletzt das Anmeldekonto. Wer Admin einer Reise mit weiteren aktiven Mitgliedern ist, muss die Reise vorher löschen
     (die Rechte lassen sich nicht automatisch übergeben). Kassenbuch-Einträge bleiben für die Abrechnung der anderen erhalten, der Name verschwindet mit dem Profil.
   Sicherheit: kein Zugriff in der Support-Ansicht, Anmeldung höchstens 10 Minuten alt, Bestätigung per Tippen von LÖSCHEN. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const db = admin.firestore();
let REGION = 'europe-west3'; try { REGION = require('./region.json').region || REGION; } catch (e) {}
const CALL = { region: 'europe-west3', maxInstances: 2, timeoutSeconds: 300, memory: '512MiB' };

const EIGENE = [['mitglied', 'uid'], ['stimmen', 'uid'], ['zimmerwahl', 'uid'], ['zimmerbudget', 'uid'], ['anreisewunsch', 'uid'], ['notfallpass', 'uid'], ['astimmen', 'uid'], ['angebotstimmen', 'uid'],
  ['nachrichten', 'by'], ['aktivitaeten', 'by'], ['kasse', 'zahler'], ['aufgaben', 'by'], ['aufgaben', 'wer'], ['einkauf', 'by'], ['mitbringen', 'by'], ['mitbringen', 'wer'], ['musik', 'by'], ['vorschlaege', 'by']];
async function hole(col, feld, uid) { const s = await db.collection(col).where(feld, '==', uid).limit(5000).get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
function pruefen(req, frisch) { const uid = req.auth?.uid; if (!uid) throw new HttpsError('unauthenticated', 'Bitte anmelden.'); if (req.auth.token.supportVon) throw new HttpsError('permission-denied', 'In der Support-Ansicht nicht möglich.');
  if (frisch) { const t = (req.auth.token.auth_time || 0) * 1000; if (Date.now() - t > 10 * 60 * 1000) throw new HttpsError('failed-precondition', 'Bitte melde dich neu an und versuche es dann noch einmal.'); } return uid; }

exports.datenExport = onCall(CALL, async req => { const uid = pruefen(req, false);
  const out = { erstellt: new Date().toISOString(), uid, profil: null, einstellungen: null, push: null, konto: null, daten: {} };
  const p = await db.doc(`profile/${uid}`).get(); out.profil = p.exists ? p.data() : null;
  const st = await db.doc(`data/users/${uid}/settings`).get(); out.einstellungen = st.exists ? st.data() : null;
  const pt = await db.doc(`pushtokens/${uid}`).get(); out.push = pt.exists ? { prefs: pt.data().prefs || {}, geraete: Object.keys(pt.data().tokens || {}).length } : null;
  try { const u = await admin.auth().getUser(uid); out.konto = { email: u.email || null, erstellt: u.metadata.creationTime, letzteAnmeldung: u.metadata.lastSignInTime }; } catch (e) {}
  for (const [col, feld] of EIGENE) { try { const l = await hole(col, feld, uid); if (l.length) out.daten[`${col}.${feld}`] = l; } catch (e) { logger.warn('Export', col, e.message); } }
  return out; });

async function batchLoeschen(refs) { for (let i = 0; i < refs.length; i += 400) { const b = db.batch(); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); } }
async function batchUpdate(liste) { for (let i = 0; i < liste.length; i += 400) { const b = db.batch(); liste.slice(i, i + 400).forEach(([r, d]) => b.update(r, d)); await b.commit(); } }

exports.kontoLoeschen = onCall(CALL, async req => { const uid = pruefen(req, true);
  if (String(req.data?.bestaetigung || '').trim().toUpperCase() !== 'LÖSCHEN') throw new HttpsError('invalid-argument', 'Bitte tippe zur Bestätigung LÖSCHEN.');
  if ((await db.doc(`rollen/${uid}`).get()).data()?.super === true) throw new HttpsError('failed-precondition', 'Der Oberbademeister kann sein Konto nicht selbst löschen.');
  // Admin einer Reise mit weiteren aktiven Mitgliedern?
  const reisen = (await db.collection('reisen').where('admin', '==', uid).get()).docs.filter(d => d.data().status !== 'geloescht');
  const blocker = [];
  for (const r of reisen) { const m = (await db.collection('mitglied').where('rid', '==', r.id).get()).docs.map(d => d.data()).filter(x => x.uid !== uid && ['teilnehmer', 'zugesagt', 'eingeladen'].includes(x.status)); if (m.length) blocker.push(r.data().titel || r.id); }
  if (blocker.length) throw new HttpsError('failed-precondition', `Du bist Admin von: ${blocker.join(', ')}. Lösche diese Reisen vorher oder bitte die Gruppe, eine neue Reise ohne dich anzulegen.`);
  // Reisen ohne weitere Mitglieder werden mit gelöscht
  await batchUpdate(reisen.map(r => [r.ref, { status: 'geloescht', geloeschtAm: Date.now(), geloeschtVon: uid }]));
  // eigene Angaben löschen
  for (const [col, feld] of [['stimmen', 'uid'], ['zimmerwahl', 'uid'], ['zimmerbudget', 'uid'], ['anreisewunsch', 'uid'], ['notfallpass', 'uid'], ['astimmen', 'uid'], ['angebotstimmen', 'uid']]) {
    try { const s = await db.collection(col).where(feld, '==', uid).get(); await batchLoeschen(s.docs.map(d => d.ref)); } catch (e) { logger.warn('Löschen', col, e.message); } }
  // Mitgliedschaften beenden, Nachrichten anonymisieren
  const ms = await db.collection('mitglied').where('uid', '==', uid).get(); await batchUpdate(ms.docs.map(d => [d.ref, { status: 'ausgetreten', geloeschtAm: Date.now() }]));
  const ns = await db.collection('nachrichten').where('by', '==', uid).get(); await batchUpdate(ns.docs.map(d => [d.ref, { by: 'geloescht', text: '', geloescht: true }]));
  // Profil, Einstellungen, Push, Rolle
  const sets = await db.collection(`data/users/${uid}`).get().catch(() => ({ docs: [] })); await batchLoeschen(sets.docs.map(d => d.ref));
  await batchLoeschen([db.doc(`profile/${uid}`), db.doc(`pushtokens/${uid}`), db.doc(`rollen/${uid}`), db.doc(`data/users/${uid}/settings`)]);
  await admin.auth().deleteUser(uid);
  logger.info('Konto gelöscht', { uid });
  return { ok: true }; });
