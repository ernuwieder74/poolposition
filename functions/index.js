/* Poolposition – Server-Funktionen
   Morgenbericht: läuft alle 15 Minuten. Für jede laufende Reise wird die Ortszeit am Urlaubsort
   bestimmt (Zeitzone über den Wetterdienst Open-Meteo). Ist es dort 8 Uhr oder später und gab es
   gestern einen Reisetag, schreibt der Server einmalig die Zusammenfassung in den Gruppenchat. */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { berichtText, medienZaehlen } = require('./bericht');
admin.initializeApp();
const db = admin.firestore();
const MORGEN_H = 8;

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function ortszeit(tz, ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, stunde: +p.hour };
}
async function holJson(url) { const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }

/* Ort der Reise: festgelegter Wetter-Ort, sonst das Reiseziel über die Ortssuche */
async function ortVon(r) {
  if (r.wetterOrt && r.wetterOrt.lat != null) return { ...r.wetterOrt, tz: r.tz || r.wetterOrt.tz };
  const q = String(r.ort || '').split(/[,/(]/)[0].trim(); if (!q) return null;
  const j = await holJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=de&format=json`);
  const x = (j.results || [])[0]; if (!x) return null;
  return { name: x.name, lat: +x.latitude.toFixed(3), lon: +x.longitude.toFixed(3), tz: x.timezone };
}

/* Wetterzeile für heute */
const WMO = {0:['☀️','Klar'],1:['🌤️','Überwiegend sonnig'],2:['⛅','Teils bewölkt'],3:['☁️','Bewölkt'],45:['🌫️','Nebel'],48:['🌫️','Nebel'],51:['🌦️','Leichter Nieselregen'],53:['🌦️','Nieselregen'],55:['🌧️','Starker Nieselregen'],56:['🌧️','Gefrierender Niesel'],57:['🌧️','Gefrierender Niesel'],61:['🌦️','Leichter Regen'],63:['🌧️','Regen'],65:['🌧️','Starker Regen'],66:['🌧️','Gefrierender Regen'],67:['🌧️','Gefrierender Regen'],71:['🌨️','Leichter Schneefall'],73:['🌨️','Schneefall'],75:['❄️','Starker Schneefall'],77:['🌨️','Schneegriesel'],80:['🌦️','Regenschauer'],81:['🌧️','Kräftige Schauer'],82:['⛈️','Heftige Schauer'],85:['🌨️','Schneeschauer'],86:['❄️','Starke Schneeschauer'],95:['⛈️','Gewitter'],96:['⛈️','Gewitter mit Hagel'],99:['⛈️','Schweres Gewitter mit Hagel']};
const BFT_KMH = [1,6,12,20,29,39,50,62,75,89,103,118];
const BFT_NAME = ['Windstill','Leiser Zug','Leichte Brise','Schwache Brise','Mäßige Brise','Frische Brise','Starker Wind','Steifer Wind','Stürmischer Wind','Sturm','Schwerer Sturm','Orkanartiger Sturm','Orkan'];
const RICHT = ['Nord','Nordost','Ost','Südost','Süd','Südwest','West','Nordwest'];
const bft = k => { let b = 0; while (b < BFT_KMH.length && k >= BFT_KMH[b]) b++; return b; };
async function wetterZeile(ort, heute) { try {
  const j = await holJson(`https://api.open-meteo.com/v1/forecast?latitude=${ort.lat}&longitude=${ort.lon}&timezone=auto&forecast_days=3&wind_speed_unit=kmh&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max`);
  const d = j.daily; const i = d.time.indexOf(heute); if (i < 0) return { zeile: '', tz: j.timezone };
  const [em, txt] = WMO[d.weather_code[i]] || ['🌡️', 'Wetter']; const b = bft(d.wind_speed_10m_max[i] || 0); const r = v => v == null ? '–' : Math.round(v);
  const dir = RICHT[Math.round((((d.wind_direction_10m_dominant[i] || 0) % 360) + 360) % 360 / 45) % 8];
  const boe = d.wind_gusts_10m_max[i] || 0; const uv = d.uv_index_max[i];
  return { tz: j.timezone, zeile: `${em} Wetter heute in ${ort.name || 'eurem Urlaubsort'}: ${txt}, ${r(d.temperature_2m_min[i])}–${r(d.temperature_2m_max[i])} °C, Regenrisiko ${r(d.precipitation_probability_max[i])} %.\n💨 Wind: ${b} Bft (${BFT_NAME[b]}) aus ${dir}, bis ${r(boe)} km/h in Böen.${boe >= 50 ? ' Achtung, kräftige Böen!' : ''}${uv >= 8 ? `\n🧴 UV-Index ${r(uv)}: an Sonnencreme denken!` : ''}` };
} catch (e) { logger.warn('Wetter', e.message); return { zeile: '' }; } }

async function berichtFuer(doc) {
  const r = { id: doc.id, ...doc.data() };
  if (r.geschlossen || r.morgenAus || !r.von || !r.bis) return;
  // Grob vorfiltern (ohne Netzabfrage): Reisen weit außerhalb des Zeitraums überspringen
  const grob = addDays(ortszeit(r.tz || 'Europe/Berlin').datum, -1);
  if (grob < addDays(r.von, -1) || grob > addDays(r.bis, 1)) return;
  let ort = null; try { ort = await ortVon(r); } catch (e) { logger.warn('Ort', r.id, e.message); }
  let tz = r.tz || ort?.tz || 'Europe/Berlin';
  if (!r.tz && ort?.tz) { r.tz = tz; await doc.ref.update({ tz }).catch(() => {}); }
  const { datum: heute, stunde } = ortszeit(tz);
  const gestern = addDays(heute, -1);
  if (gestern < r.von || gestern > r.bis) return;               // gestern war kein Reisetag
  if (stunde < MORGEN_H) return;                                 // vor 8 Uhr Ortszeit
  const ref = db.doc(`nachrichten/morgen_${r.id}_${heute}`);
  if ((await ref.get()).exists) return;                         // heute schon geschrieben
  const [ms, ak, bi] = await Promise.all([db.collection('mitglied').where('rid', '==', r.id).get(), db.collection('aktivitaeten').where('rid', '==', r.id).get(),
    db.collection('nachrichten').where('rid', '==', r.id).where('typ', '==', 'bild').get()]);
  // Neue Bilder des Urlaubstags (Tagesgrenze wie in der App, Standard 6 Uhr), nur was noch im Album ist
  const grenze = (r.tagesgrenze === undefined || r.tagesgrenze === null || r.tagesgrenze === '') ? 6 : +r.tagesgrenze;
  const medien = medienZaehlen(bi.docs.map(x => x.data()), gestern, t => ortszeit(tz, t - grenze * 3600e3).datum);
  const mitglied = ms.docs.map(x => x.data()); const akt = ak.docs.map(x => ({ id: x.id, ...x.data() }));
  const uids = [...new Set(mitglied.map(m => m.uid))]; const prof = {};
  if (uids.length) (await db.getAll(...uids.map(u => db.doc(`profile/${u}`)))).forEach(s => { if (s.exists) prof[s.id] = s.data(); });
  let wetter = '';
  if (ort && heute <= r.bis) { const w = await wetterZeile(ort, heute); wetter = w.zeile; if (w.tz && !r.tz) tz = w.tz; }
  if (!r.tz && tz) { r.tz = tz; await doc.ref.update({ tz }).catch(() => {}); }  // Zeitzone merken
  // Erwiderte Urlaubsherzen von gestern (Namen nur, wenn beide es erlaubt haben)
  const hz = await db.collection('herzanfragen').where('rid', '==', r.id).where('status', '==', 'bestaetigt').get().catch(() => null);
  const knister = hz ? hz.docs.map(x => x.data()).filter(a => a.bestaetigtTag === gestern) : [];
  const text = berichtText({ r, mitglied, akt, profil: u => prof[u], gestern, heute, wetter, medien, knister });
  try { await ref.create({ rid: r.id, typ: 'morgen', tag: gestern, text, by: 'system', createdAt: Date.now() }); logger.info('Morgenbericht', r.id, heute); }
  catch (e) { if (e.code !== 6) throw e; }                      // 6 = gibt es schon (paralleler Lauf)
}

exports.morgenbericht = onSchedule({ schedule: 'every 15 minutes', region: 'europe-west3', timeoutSeconds: 300, memory: '256MiB', maxInstances: 1 }, async () => {
  const s = await db.collection('reisen').where('status', '==', 'fest').get();
  for (const d of s.docs) { try { await berichtFuer(d); } catch (e) { logger.error('Reise', d.id, e); } }
});

/* ===================== Badeaufsicht: Konto-Infos und Support-Ansicht („Als Mitglied ansehen“) =====================
   - kontoInfos: Registrierung und letzte Anmeldung aus dem Firebase-Konto (für Oberbademeister und Recht „Nutzer“).
   - alsAnmelden: Oberbademeister und Bademeister mit dem Recht „Als Mitglied ansehen“. Meldet ihn mit Begründung als Mitglied an (Kennzeichen supportVon im Token).
     Die App schaltet dabei auf „nur ansehen“. Jeder Zugriff wird in supportlog protokolliert.
   - supportZurueck: Beendet die Support-Ansicht und meldet den Oberbademeister wieder mit seinem eigenen Konto an. */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const CALL = { region: 'europe-west3', maxInstances: 2 };
async function rolle(uid) { const s = await db.doc(`rollen/${uid}`).get(); return s.exists ? s.data() : null; }
const istOber = r => !!r && r.super === true;

exports.kontoInfos = onCall(CALL, async req => {
  const von = req.auth?.uid; if (!von || req.auth.token.supportVon) throw new HttpsError('permission-denied', 'Nicht erlaubt.');
  const r = await rolle(von); if (!istOber(r) && !(r?.rechte?.nutzer)) throw new HttpsError('permission-denied', 'Nur für die Badeaufsicht.');
  const uids = [].concat(req.data?.uids || []).map(String).filter(Boolean).slice(0, 100);
  if (!uids.length) return { infos: {} };
  const res = await admin.auth().getUsers(uids.map(uid => ({ uid })));
  const t = x => (x ? Date.parse(x) || 0 : 0);
  return { infos: Object.fromEntries(res.users.map(u => [u.uid, { erstellt: t(u.metadata.creationTime), anmeldung: t(u.metadata.lastSignInTime), aktiv: t(u.metadata.lastRefreshTime), email: istOber(r) ? (u.email || '') : '' }])) };
});

exports.alsAnmelden = onCall(CALL, async req => {
  const von = req.auth?.uid; if (!von) throw new HttpsError('unauthenticated', 'Bitte anmelden.');
  if (req.auth.token.supportVon) throw new HttpsError('failed-precondition', 'Du bist schon in der Support-Ansicht.');
  const r = await rolle(von); if (!istOber(r) && !(r?.rechte?.support)) throw new HttpsError('permission-denied', 'Dafür fehlt dir das Recht „Als Mitglied ansehen“.');
  const uid = String(req.data?.uid || ''), grund = String(req.data?.grund || '').trim().slice(0, 500);
  if (!uid || uid === von) throw new HttpsError('invalid-argument', 'Ungültiges Mitglied.');
  // Schutz: den Oberbademeister kann niemand ansehen, andere Bademeister nur der Oberbademeister
  const ziel = await rolle(uid);
  if (istOber(ziel)) throw new HttpsError('permission-denied', 'Der Oberbademeister kann nicht angesehen werden.');
  if (!istOber(r) && ziel && Object.values(ziel.rechte || {}).some(Boolean)) throw new HttpsError('permission-denied', 'Andere Bademeister kann nur der Oberbademeister ansehen.');
  if (!grund) throw new HttpsError('invalid-argument', 'Bitte einen Grund angeben.');
  await admin.auth().getUser(uid);
  const token = await admin.auth().createCustomToken(uid, { supportVon: von });
  await db.collection('supportlog').add({ von, als: uid, grund, art: 'start', at: Date.now() });
  logger.info('Support-Ansicht gestartet', { von, als: uid });
  return { token };
});

exports.supportZurueck = onCall(CALL, async req => {
  const als = req.auth?.uid, von = req.auth?.token?.supportVon; if (!als || !von) throw new HttpsError('failed-precondition', 'Keine Support-Ansicht aktiv.');
  const r = await rolle(von); if (!istOber(r) && !(r?.rechte?.support)) throw new HttpsError('permission-denied', 'Nicht mehr berechtigt. Bitte neu anmelden.');
  const token = await admin.auth().createCustomToken(von);
  await db.collection('supportlog').add({ von, als, art: 'ende', at: Date.now() });
  return { token };
});


/* Push-Benachrichtigungen */
Object.assign(exports, require('./push'));
Object.assign(exports, require('./konto'));
Object.assign(exports, require('./claims'));
Object.assign(exports, require('./medien'));
