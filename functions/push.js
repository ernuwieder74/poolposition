/* Poolposition – Push-Benachrichtigungen (Firebase Cloud Messaging)
   Geräte-Schlüssel liegen unter pushtokens/{uid}: { tokens: {<token>: {at, ua}}, prefs: {chat, fluester, termine, morgen, admin} }.
   - Gruppenchat, Event-Chat, Flüstern, Morgenbericht, neue Termine, Termin-Erinnerung 30 Minuten vorher, neue Meldungen für die Badeaufsicht, Erinnerung am Vortag der Abreise und an fällige To-dos (Kategorie 'aufgaben').
   - Wer blockiert ist, löst beim Blockierenden keine Benachrichtigung aus. Ungültige Geräte-Schlüssel werden automatisch entfernt. */
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const db = admin.firestore();
let REGION = 'us-central1'; try { REGION = require('./region.json').region || REGION; } catch (e) {}
const TRIG = { region: REGION, maxInstances: 5 };

const kurz = (t, n = 120) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
async function namen(uids) { const out = {}; const l = [...new Set(uids)].filter(u => u && u !== 'support' && u !== 'system');
  if (l.length) (await db.getAll(...l.map(u => db.doc(`profile/${u}`)))).forEach(s => { const p = s.exists ? s.data() : {}; out[s.id] = p.spitzname || (p.vorname ? `${p.vorname}${p.nachname ? ' ' + p.nachname[0].toUpperCase() + '.' : ''}` : '') || p.name || 'Jemand'; });
  return out; }
const vorname = n => String(n || 'Jemand').split(' ')[0];

/* Senden an eine Liste von Empfängern, Kategorie = Schlüssel in prefs (Standard: an) */
async function senden(uids, kat, { title, body, tag, link = '/', von = null }) {
  uids = [...new Set(uids)].filter(u => u && u !== von && u !== 'support' && u !== 'system'); if (!uids.length) return;
  const snaps = await db.getAll(...uids.map(u => db.doc(`pushtokens/${u}`)));
  let blockiert = {}; if (von) { const st = await db.getAll(...uids.map(u => db.doc(`data/users/${u}/settings`))); st.forEach(s => { if (s.exists && (s.data().blockiert || {})[von]) blockiert[s.ref.parent.parent.id] = true; }); }
  const ziele = []; // [uid, token]
  snaps.forEach(s => { if (!s.exists) return; const d = s.data(); const u = s.id; if (blockiert[u]) return; if ((d.prefs || {})[kat] === false) return;
    Object.entries(d.tokens || {}).filter(([t, v]) => v).forEach(([t]) => ziele.push([u, t])); });
  if (!ziele.length) return;
  for (let i = 0; i < ziele.length; i += 400) { const teil = ziele.slice(i, i + 400);
    const res = await admin.messaging().sendEachForMulticast({ tokens: teil.map(x => x[1]),
      webpush: { notification: { title: kurz(title, 60), body: kurz(body, 160), icon: '/icon-192.png', badge: '/icon-192.png', tag: tag || undefined, renotify: !!tag }, fcmOptions: { link } } });
    const weg = {}; res.responses.forEach((r, j) => { const c = r.error?.code || ''; if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(c)) { const [u, t] = teil[j]; (weg[u] = weg[u] || []).push(t); } });
    for (const [u, ts] of Object.entries(weg)) await db.doc(`pushtokens/${u}`).update(Object.fromEntries(ts.map(t => [new admin.firestore.FieldPath('tokens', t), admin.firestore.FieldValue.delete()]))).catch(() => {});
  } }

const reiseTitel = r => r?.titel || 'Eure Reise';
function inhalt(x) { if (x.geloescht) return ''; if (x.typ === 'bild') return x.mime?.startsWith('video') ? '🎬 hat ein Video geschickt' : '📷 hat ein Foto geschickt';
  if (x.audio || x.typ === 'audio') return '🎤 Sprachnachricht'; if (x.typ === 'herz') return '❤️ hat ein neues Herz erobert'; return x.text || ''; }

/* ---------- Gruppenchat, Event-Chat, Morgenbericht ---------- */
exports.pushNachricht = onDocumentCreated({ ...TRIG, document: 'nachrichten/{id}' }, async ev => {
  const x = ev.data?.data(); if (!x || !x.rid || x.nurAlbum) return;
  const rs = await db.doc(`reisen/${x.rid}`).get(); if (!rs.exists) return; const r = rs.data(); if (r.geschlossen) return;
  const ms = (await db.collection('mitglied').where('rid', '==', x.rid).get()).docs.map(d => d.data());
  const aktiv = ms.filter(m => ['zugesagt', 'teilnehmer'].includes(m.status)).map(m => m.uid);
  if (x.typ === 'morgen') return senden(aktiv, 'morgen', { title: `☀️ ${reiseTitel(r)}`, body: kurz(String(x.text || '').split('\n').slice(0, 2).join(' ')), tag: `morgen_${x.rid}` });
  if (x.typ === 'system' || x.typ === 'entscheidung' || x.typ === 'aktivitaet') return;
  const n = await namen([x.by]); const text = inhalt(x); if (!text) return;
  if (x.aktId) { // Event-Chat: nur wer dabei ist (und wer den Termin angelegt hat)
    const a = await db.doc(`aktivitaeten/${x.aktId}`).get(); if (!a.exists) return; const ad = a.data();
    const dabei = Object.entries(ad.dabei || {}).filter(([u, v]) => v === true).map(([u]) => u).concat(ad.by ? [ad.by] : []);
    return senden(dabei.filter(u => aktiv.includes(u)), 'chat', { title: `${ad.titel || 'Event'} · ${reiseTitel(r)}`, body: `${vorname(n[x.by])}: ${text}`, tag: `akt_${x.aktId}`, von: x.by }); }
  return senden(aktiv, 'chat', { title: reiseTitel(r), body: `${vorname(n[x.by])}: ${text}`, tag: `chat_${x.rid}`, von: x.by });
});

/* ---------- Flüstern (auch Nachrichten von Poolposition Bademeister) ---------- */
exports.pushFluester = onDocumentCreated({ ...TRIG, document: 'fluesternachrichten/{id}' }, async ev => {
  const x = ev.data?.data(); if (!x || !x.pair) return; const [a, b] = String(x.pair).split('__');
  if (x.by === 'support') { const u = a === 'support' ? b : a; const body = x.typ === 'meldstatus' ? `Deine Meldung ${x.vorgang || ''} ist eingegangen.` : inhalt(x);
    return senden([u], 'fluester', { title: '🛟 Poolposition Bademeister', body, tag: `f_${x.pair}` }); }
  const an = a === x.by ? b : a; if (an === 'support') return; // Antworten an die Badeaufsicht laufen über das Ticket
  const n = await namen([x.by]); const text = inhalt(x); if (!text) return;
  return senden([an], 'fluester', { title: `🤫 ${n[x.by] || 'Jemand'} flüstert`, body: text, tag: `f_${x.pair}`, von: x.by });
});

/* ---------- Neuer Termin ---------- */
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const datumKurz = d => { const x = new Date(d + 'T12:00:00Z'); return `${WT[x.getUTCDay()]} ${String(x.getUTCDate()).padStart(2, '0')}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.`; };
exports.pushTermin = onDocumentCreated({ ...TRIG, document: 'aktivitaeten/{id}' }, async ev => {
  const a = ev.data?.data(); if (!a || !a.rid || a.ausgeblendet) return; if (a.serieId && a.datum !== a.serieVon) return; // Serie: nur einmal benachrichtigen
  const rs = await db.doc(`reisen/${a.rid}`).get(); if (!rs.exists) return; const r = rs.data(); if (r.geschlossen) return;
  const ms = (await db.collection('mitglied').where('rid', '==', a.rid).get()).docs.map(d => d.data());
  const ziel = a.privat ? [...(a.eingeladen || [])] : ms.filter(m => m.status === 'zugesagt').map(m => m.uid);
  const n = await namen([a.by]);
  return senden(ziel, 'termine', { title: `📅 Neuer Termin · ${reiseTitel(r)}`, body: `${vorname(n[a.by])}: ${a.titel || 'Termin'}, ${a.serieId ? `täglich bis ${datumKurz(a.serieBis)}` : a.datum ? datumKurz(a.datum) : ''}${a.zeit ? ' ' + a.zeit : ''}${a.ort ? ' · ' + a.ort : ''}`, tag: `termin_${ev.params.id}`, von: a.by });
});

/* ---------- Neue Meldung an die Badeaufsicht ---------- */
exports.pushMeldung = onDocumentCreated({ ...TRIG, document: 'meldungen/{uid}/eintraege/{id}' }, async ev => {
  const m = ev.data?.data(); if (!m || m.typ === 'feedback') return;
  const rol = (await db.collection('rollen').get()).docs.filter(d => { const x = d.data(); return x.super === true || (x.rechte || {}).meldungen === true; }).map(d => d.id);
  return senden(rol.filter(u => u !== ev.params.uid), 'admin', { title: '🚩 Neue Meldung für die Badeaufsicht', body: `${m.vorgang || 'Neue Meldung'} · bitte im Adminbereich ansehen`, tag: 'meldungen' });
});

/* ---------- Erinnerung 30 Minuten vor einem Termin (Ortszeit der Reise) ---------- */
function jetztIn(tz) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) }; }
exports.terminErinnerung = onSchedule({ schedule: 'every 10 minutes', region: 'europe-west3', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const rs = await db.collection('reisen').where('status', '==', 'fest').get();
  for (const d of rs.docs) { const r = d.data(); if (r.geschlossen) continue; let tz = r.tz || 'Europe/Berlin'; let jetzt;
    try { jetzt = jetztIn(tz); } catch (e) { jetzt = jetztIn('Europe/Berlin'); }
    if (r.von && jetzt.datum < r.von) continue; if (r.bis && jetzt.datum > r.bis) continue;
    const as = await db.collection('aktivitaeten').where('rid', '==', d.id).where('datum', '==', jetzt.datum).get();
    for (const a of as.docs) { const x = a.data(); if (x.ausgeblendet || x.erinnert || !/^\d{1,2}:\d{2}/.test(x.zeit || '')) continue;
      const [h, mi] = x.zeit.split(':').map(Number); const diff = h * 60 + mi - jetzt.min; if (diff < 15 || diff > 40) continue;
      await a.ref.update({ erinnert: true }).catch(() => {});
      const dabei = Object.entries(x.dabei || {}).filter(([u, v]) => v === true).map(([u]) => u).concat(x.by ? [x.by] : []);
      try { await senden(dabei, 'termine', { title: `⏰ Gleich geht's los: ${x.titel || 'Termin'}`, body: `Um ${x.zeit} Uhr${x.ort ? ' · ' + x.ort : ''} · ${reiseTitel(r)}`, tag: `erinnerung_${a.id}` }); }
      catch (e) { logger.error('Erinnerung', a.id, e); } } }
});

/* ---------- Ansagen des Admins (rundnachrichten) ---------- */
exports.pushRund = onDocumentCreated({ ...TRIG, document: 'rundnachrichten/{id}' }, async ev => {
  const x = ev.data?.data(); if (!x || !x.rid || !x.text) return;
  const rs = await db.doc(`reisen/${x.rid}`).get(); if (!rs.exists) return; const r = rs.data();
  const ms = (await db.collection('mitglied').where('rid', '==', x.rid).get()).docs.map(d => d.data());
  const aktiv = ms.filter(m => ['zugesagt', 'teilnehmer'].includes(m.status)).map(m => m.uid);
  const n = await namen([x.by]);
  return senden(aktiv, 'rund', { title: `📣 Ansage von ${vorname(n[x.by])} · ${reiseTitel(r)}`, body: x.text, tag: `rund_${ev.params.id}`, von: x.by });
});

/* ---------- Änderung von Angaben (aenderungen) → Meldung an den Admin der Reise ---------- */
exports.pushAenderung = onDocumentCreated({ ...TRIG, document: 'aenderungen/{id}' }, async ev => {
  const x = ev.data?.data(); if (!x || !x.rid || !x.uid) return;
  const rs = await db.doc(`reisen/${x.rid}`).get(); if (!rs.exists) return; const r = rs.data(); if (!r.admin || r.admin === x.uid) return;
  const n = await namen([x.uid]);
  return senden([r.admin], 'aend', { title: `✏️ Änderung von ${vorname(n[x.uid])} · ${reiseTitel(r)}`, body: x.text || 'Angaben geändert', tag: `aend_${ev.params.id}`, von: x.uid });
});

/* ---------- Tägliche Erinnerungen (um 9 Uhr Ortszeit der Reise) ----------
   1) Am Tag vor der Abreise: „Morgen geht es los“ an alle, die dabei sind (einmal pro Reise, Marker reisen/{id}.erinnertAbreise).
   2) To-dos: zwei Tage vor der Frist und am Tag der Frist an die zuständige Person (Marker aufgaben/{id}.erinnert = Anzahl der Stufen 1|2). */
const tagPlus = (datum, n) => { const d = new Date(datum + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
exports.tagesErinnerung = onSchedule({ schedule: 'every 60 minutes', region: 'europe-west3', timeoutSeconds: 240, maxInstances: 1 }, async () => {
  const rs = await db.collection('reisen').where('status', '==', 'fest').get();
  for (const d of rs.docs) { const r = d.data(); if (r.geschlossen) continue; let jetzt; try { jetzt = jetztIn(r.tz || 'Europe/Berlin'); } catch (e) { jetzt = jetztIn('Europe/Berlin'); }
    if (jetzt.min < 9 * 60 || jetzt.min >= 10 * 60) continue; // nur in der Stunde ab 9 Uhr
    try {
      const dabei = (await db.collection('mitglied').where('rid', '==', d.id).where('status', '==', 'zugesagt').get()).docs.map(x => x.data().uid);
      if (r.von && tagPlus(jetzt.datum, 1) === r.von && r.erinnertAbreise !== r.von) {
        await d.ref.update({ erinnertAbreise: r.von }).catch(() => {});
        await senden(dabei, 'aufgaben', { title: `🧳 Morgen geht's los: ${reiseTitel(r)}`, body: 'Letzter Check: Koffer gepackt, Tickets und Ausweise griffbereit?', tag: `abreise_${d.id}`, link: '/' }); }
      const as = await db.collection('aufgaben').where('rid', '==', d.id).get();
      for (const a of as.docs) { const x = a.data(); if (x.done || x.vorgeschlagen || !x.bis || !x.wer) continue;
        const stufe = x.bis === jetzt.datum ? 2 : x.bis === tagPlus(jetzt.datum, 2) ? 1 : 0; if (!stufe || (x.erinnert || 0) >= stufe) continue;
        await a.ref.update({ erinnert: stufe }).catch(() => {});
        await senden([x.wer], 'aufgaben', { title: stufe === 2 ? `⏰ Heute fällig: ${x.titel}` : `📝 In 2 Tagen fällig: ${x.titel}`, body: reiseTitel(r), tag: `aufgabe_${a.id}` }); }
    } catch (e) { logger.error('Tageserinnerung', d.id, e); } }
});

/* ---------- Urlaubsherzen an Gruppenmitglieder ----------
   Anfrage: Empfänger bekommt eine diskrete Nachricht (ohne Namen auf dem Sperrbildschirm).
   Erwidert: Absender bekommt Bescheid. 1–3 Stunden später schreibt knisterBote „Es knistert“ in den Gruppenchat. */
exports.pushHerz = onDocumentCreated({ ...TRIG, document: 'herzanfragen/{id}' }, async ev => {
  const a = ev.data?.data(); if (!a || a.status !== 'offen') return;
  return senden([a.an], 'fluester', { title: '💘 Ein Urlaubsherz für dich', body: 'Jemand aus eurer Gruppe hat dir ein Urlaubsherz geschenkt. Tippe, um nachzusehen.', tag: `herz_${ev.params.id}` });
});
exports.pushHerzErwidert = onDocumentUpdated({ ...TRIG, document: 'herzanfragen/{id}' }, async ev => {
  const vor = ev.data?.before?.data(), nach = ev.data?.after?.data(); if (!vor || !nach || vor.status === 'bestaetigt' || nach.status !== 'bestaetigt') return;
  const n = await namen([nach.an]);
  return senden([nach.von], 'fluester', { title: '💞 Dein Urlaubsherz wurde erwidert', body: `${vorname(n[nach.an])} hat dein Herz erwidert!`, tag: `herz_${ev.params.id}` });
});
const knisterText = (a, name) => a.vonZeigen && a.anZeigen ? `💞 Es knistert! Zwischen ${name(a.von)} und ${name(a.an)} hat es gefunkt.` : '💘 In der Gruppe knistert es gerade … Ein Urlaubsherz wurde erwidert. Wer das wohl ist? 😉';
exports.knisterBote = onSchedule({ schedule: 'every 10 minutes', region: 'europe-west3', timeoutSeconds: 120, maxInstances: 1 }, async () => {
  const s = await db.collection('herzanfragen').where('status', '==', 'bestaetigt').where('knisterGepostet', '==', false).get();
  for (const d of s.docs) { const a = d.data(); if ((a.knisterAm || 0) > Date.now()) continue;
    try { const offen = !!(a.vonZeigen && a.anZeigen); const n = offen ? await namen([a.von, a.an]) : {};
      await db.doc(`nachrichten/knister_${d.id}`).create({ rid: a.rid, typ: 'system', knister: true, offen, text: knisterText(a, u => n[u] || 'Jemand'), by: 'system', createdAt: Date.now() }).catch(e => { if (e.code !== 6) throw e; });
      await d.ref.update({ knisterGepostet: true, ...(offen ? { offengelegt: true } : {}) }); }
    catch (e) { logger.error('Knister', d.id, e); } }
});

/* Wie viele Mitglieder würden Urlaubsherzen nutzen? Nur eine Zahl an der Reise, nie, wer. */
exports.herzInteresseZaehler = onDocumentWritten({ ...TRIG, document: 'herzinteresse/{id}' }, async ev => {
  const rid = (ev.data?.after?.data() || ev.data?.before?.data() || {}).rid; if (!rid) return;
  const s = await db.collection('herzinteresse').where('rid', '==', rid).where('offen', '==', true).get();
  return db.doc(`reisen/${rid}`).update({ herzInteresse: s.size }).catch(e => logger.warn('herzInteresse', rid, e.message));
});

/* Budget-Spanne: Die einzelnen Angaben sind privat. An der Reise steht nur Spanne und Schnitt, und erst ab 3 Angaben. */
exports.zimmerBudgetZaehler = onDocumentWritten({ ...TRIG, document: 'zimmerbudget/{id}' }, async ev => {
  const rid = (ev.data?.after?.data() || ev.data?.before?.data() || {}).rid; if (!rid) return;
  const s = await db.collection('zimmerbudget').where('rid', '==', rid).get();
  const l = s.docs.map(d => +d.data().betrag).filter(x => x > 0);
  // Wer eine Angabe gemacht hat (ohne Betrag) und wie viele „Egal“ gewählt haben, sieht die Gruppe immer; Spanne und Schnitt erst ab 3 Beträgen
  const info = { abgegeben: s.docs.map(d => d.data().uid).filter(Boolean), egal: s.docs.filter(d => d.data().egal === true).length,
    ...(l.length >= 3 ? { n: l.length, min: Math.min(...l), max: Math.max(...l), avg: Math.round(l.reduce((a, b) => a + b, 0) / l.length) } : {}) };
  return db.doc(`reisen/${rid}`).update({ zimmerBudget: info }).catch(e => logger.warn('zimmerBudget', rid, e.message));
});
