/* Poolposition – Anbindung an Firebase (Anmeldung, Datenbank, Fotospeicher, Downloads).
   Stellt dieselben Schnittstellen bereit, die die App auch in der Claude-Version nutzt. */
(function(){
  window.PP_FB = true;
  const cfg = window.PP_CONFIG;
  firebase.initializeApp(cfg.firebase);
  const auth = firebase.auth(), fs = firebase.firestore(), st = firebase.storage();
  try { fs.settings({ ignoreUndefinedProperties: true }); } catch (e) { console.warn(e); }
  const P = firebase.auth.Auth.Persistence;

  /* ---------- Anmeldung ---------- */
  let res; const ready = new Promise(r => res = r);
  auth.onAuthStateChanged(u => res(u));
  window.PPAuth = {
    ready: () => ready,
    signIn: async (email, pw, bleiben) => { await auth.setPersistence(bleiben ? P.LOCAL : P.SESSION); return auth.signInWithEmailAndPassword(email, pw); },
    register: async (email, pw) => { await auth.setPersistence(P.LOCAL); return auth.createUserWithEmailAndPassword(email, pw); },
    // Link zum Zurücksetzen; danach führt „Weiter“ zurück in die App. Klappt die Rücksprungadresse nicht, ohne sie senden.
    reset: async email => { try { await auth.sendPasswordResetEmail(email, { url: location.origin + '/' }); } catch (e) { if (/continue-uri|unauthorized/.test(e.code || '')) await auth.sendPasswordResetEmail(email); else throw e; } },
    signOut: () => auth.signOut(),
    email: () => auth.currentUser?.email || '',
    hatPasswort: () => !!auth.currentUser?.providerData?.some(p => p.providerId === 'password'),
    // E-Mail ändern: erst mit dem aktuellen Passwort bestätigen, dann Link an die neue Adresse
    changeEmail: async (pw, neu) => { await reauth(pw); await auth.currentUser.verifyBeforeUpdateEmail(neu); },
    changePw: async (pw, neu) => { await reauth(pw); await auth.currentUser.updatePassword(neu); },
    // Badeaufsicht: Server-Funktionen und Support-Ansicht (Anmeldung per Einmal-Token vom Server)
    refresh: () => auth.currentUser.getIdToken(true),
    call: async (name, data) => (await firebase.app().functions('europe-west3').httpsCallable(name)(data)).data,
    supportVon: async () => { const u = auth.currentUser; if (!u) return null; try { return (await u.getIdTokenResult()).claims.supportVon || null; } catch (e) { return null; } },
    mitToken: async (token, nurSitzung) => { await auth.setPersistence(nurSitzung ? P.SESSION : P.LOCAL); await auth.signInWithCustomToken(token); },
    // Push-Benachrichtigungen (Firebase Cloud Messaging)
    push: {
      unterstuetzt: async () => { try { return !!cfg.vapid && 'Notification' in window && 'serviceWorker' in navigator && await firebase.messaging.isSupported(); } catch (e) { return false; } },
      erlaubnis: () => ('Notification' in window ? Notification.permission : 'unsupported'),
      token: async (fragen) => {
        if (fragen) { const p = await Notification.requestPermission(); if (p !== 'granted') return { perm: p }; }
        else if (Notification.permission !== 'granted') return { perm: Notification.permission };
        const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const token = await firebase.messaging().getToken({ vapidKey: cfg.vapid, serviceWorkerRegistration: reg });
        return { perm: 'granted', token };
      },
      loeschen: async () => { try { await firebase.messaging().deleteToken(); } catch (e) {} },
    },
  };
  async function reauth(pw) { const u = auth.currentUser; await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, pw)); }
  try { auth.languageCode = 'de'; } catch (e) {}

  /* ---------- Datenbank ----------
     update(): Diese Felder werden zusammengeführt statt ersetzt (z. B. "Bin dabei" mehrerer Personen). */
  const MERGE = ['dabei', 'likes', 'gesperrt', 'platzDabei', 'getraenke', 'unread', 'getraenkeKat', 'nutzer', 'reakt', 'gastGesperrt', 'gelesen', 'dialog', 'antworten', 'faelle', 'tokens', 'prefs', 'abholer', 'stimmen'];
  const plain = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  function flatten(obj, path, out) {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const p = path.concat(k);
      if (plain(v) && Object.keys(v).length) flatten(v, p, out);
      else out.push(new firebase.firestore.FieldPath(...p), v);
    }
    return out;
  }
  function updateArgs(data) {
    const out = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (MERGE.includes(k) && plain(v) && Object.keys(v).length) flatten(v, [k], out);
      else out.push(new firebase.firestore.FieldPath(k), v);
    }
    return out;
  }
  const wrapErr = e => { const m = { 'permission-denied': 'invalid_argument', 'not-found': 'invalid_argument', 'resource-exhausted': 'quota_exceeded', 'unavailable': 'unavailable' }; const x = new Error(e.message); x.code = m[e.code] || e.code; x.fbCode = e.code; return x; };
  const guard = p => p.catch(e => { throw wrapErr(e); });
  function wrapDoc(ref) {
    return {
      id: ref.id, path: ref.path,
      get: () => guard(ref.get()),
      set: d => guard(ref.set(d)),
      update: d => { const a = updateArgs(d); return a.length ? guard(ref.update(...a)) : Promise.resolve(); },
      delete: () => guard(ref.delete()),
      onSnapshot: (n, e) => ref.onSnapshot(n, err => e && e(wrapErr(err))),
      collection: c => wrapCol(ref.collection(c)),
    };
  }
  function wrapQuery(q) {
    return {
      where: (f, o, v) => wrapQuery(q.where(f, o, v)),
      orderBy: (f, d) => wrapQuery(q.orderBy(f, d)),
      limit: n => wrapQuery(q.limit(n)),
      get: () => guard(q.get()),
      onSnapshot: (n, e) => q.onSnapshot(n, err => e && e(wrapErr(err))),
    };
  }
  function wrapCol(c) {
    return Object.assign(wrapQuery(c), {
      path: c.path,
      doc: id => wrapDoc(id ? c.doc(id) : c.doc()),
      add: async d => { const r = c.doc(); await guard(r.set(d)); return wrapDoc(r); },
    });
  }
  const db = {
    doc: p => wrapDoc(fs.doc(p)), collection: p => wrapCol(fs.collection(p)),
    /* Mehrere Schreibvorgänge gemeinsam: klappt alles oder nichts (z. B. Beitritt + Einladung verbrauchen) */
    batch: ops => { const b = fs.batch(); for (const o of ops) { const r = fs.doc(o.path); if (o.op === 'set') b.set(r, o.data); else b.update(r, ...updateArgs(o.data)); } return guard(b.commit()); },
  };

  /* ---------- Nutzer ---------- */
  const COLORS = ['#e0607e', '#3b8fd9', '#2fa37a', '#d98a1c', '#9a6ad6', '#d1573b', '#1f9aa8', '#b6862c'];
  const colorOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const admins = (cfg.admins || []).map(a => a.toLowerCase());
  const user = {
    me: async () => { const u = auth.currentUser; return { id: u ? u.uid : null, name: '', avatarUrl: '', color: colorOf(u?.uid), email: u?.email || null, isOwner: !!u && admins.includes((u.email || '').toLowerCase()), canEdit: true }; },
    id: async () => auth.currentUser?.uid || null,
    can: async () => true, canEdit: async () => true,
    isOwner: async () => !!auth.currentUser && admins.includes((auth.currentUser.email || '').toLowerCase()),
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: '', color: colorOf(i), email: null, isMe: i === auth.currentUser?.uid, guest: false }])),
  };

  /* ---------- Fotospeicher ---------- */
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mp4': 'm4a', 'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };
  const assets = {
    upload: async (blob, opt = {}) => {
      const type = opt.type || blob.type; const uid = auth.currentUser.uid;
      const sub = opt.orig ? 'o/' : opt.vor ? 'v/' : ''; const path = `uploads/${uid}/${sub}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${EXT[type] || 'bin'}`; const ref = st.ref(path);
      try { await ref.put(blob, { contentType: type }); } catch (e) { const x = new Error(e.message); x.code = e.code === 'storage/quota-exceeded' ? 'quota_or_state' : 'upstream_error'; throw x; }
      const url = await ref.getDownloadURL();
      /* Originale: nur der Pfad wird gespeichert, die Adresse holt die App beim Anzeigen (die Speicherregeln prüfen dabei das Ticket) */
      return { id: opt.orig ? 'p:' + path : url, url, contentType: type, sizeBytes: blob.size };
    },
    url: path => st.ref(path).getDownloadURL(),
    delete: async ref => { try { await (/^p:/.test(ref) ? st.ref(ref.slice(2)) : st.refFromURL(ref)).delete(); return { deleted: true }; } catch (e) { return { deleted: false }; } },
  };

  /* ---------- Downloads ---------- */
  const downloads = {
    save: async ({ filename, data }) => {
      const b = data instanceof Blob ? data : new Blob([data]); const url = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); return { status: 'saved' };
    },
  };

  const caps = { db, user, assets, downloads };
  window.claude = { use: async n => caps[n] || null };
})();
