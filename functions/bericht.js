/* ===================== Text des Morgenberichts (auch vom Server genutzt) =====================
   Reine Funktion: bekommt alle Daten übergeben, greift auf nichts Globales zu. */
/* Neue Bilder und Videos eines Urlaubstags: nur was am Ende noch im Album ist (nicht gelöscht, nicht ausgeblendet).
   tagVon(ms) liefert den Urlaubstag (JJJJ-MM-TT) zu einem Zeitpunkt. */
function medienZaehlen(msgs, tag, tagVon){ let bilder=0, videos=0;
  for(const m of msgs||[]){ if(m.typ!=='bild' || !m.bild || m.geloescht || m.ausgeblendet) continue; if(tagVon(m.createdAt||0)!==tag) continue;
    if(String(m.mime||'').startsWith('video')) videos++; else bilder++; }
  return {bilder, videos}; }
function berichtText(d){ const {r, mitglied, akt, profil, gestern, heute, wetter, medien, knister=[]} = d;
  const name = uid => { const p=profil(uid)||{}; return p.spitzname || (p.vorname ? `${p.vorname}${p.nachname?` ${p.nachname[0].toUpperCase()}.`:''}` : '') || p.name || 'Jemand'; };
  const kat = {}; ['Bier','Wein','Gin Tonic','Sex on the Beach'].forEach(n=>kat[n]=n); Object.entries(r.getraenkeKat||{}).forEach(([id,e])=>{ if(e&&e.name) kat[id]=e.name; });
  const trinkName = id => kat[id] || id;
  const liste = arr => arr.length<=1 ? (arr[0]||'') : arr.slice(0,-1).join(', ')+' und '+arr[arr.length-1];
  const tagSumme = (m, t) => Object.values(m.getraenke||{}).reduce((s,g)=>s+(+g?.tage?.[t]||0),0);
  const ms=mitglied.filter(m=>['zugesagt','entfernt','ausgetreten'].includes(m.status));
  const aktiv=mitglied.filter(m=>m.status==='zugesagt');
  const z=[`☀️ Guten Morgen liebe ${String(r.gruppenName||'').trim()||'Reisegruppe'}!`];
  const summe=ms.reduce((s,m)=>s+tagSumme(m,gestern),0);
  if(summe>0){
    const proG={}; ms.forEach(m=>Object.entries(m.getraenke||{}).forEach(([k,g])=>{ const n=+g?.tage?.[gestern]||0; if(n){ const nn=trinkName(k); proG[nn]=(proG[nn]||0)+n; } }));
    const fav=Object.entries(proG).sort((a,b)=>b[1]-a[1]); const favTop=fav.filter(e=>e[1]===fav[0][1]).map(e=>e[0]);
    const proM=ms.map(m=>[m.uid,tagSumme(m,gestern)]).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]); const vorn=proM.filter(e=>e[1]===proM[0][1]).map(e=>name(e[0]));
    z.push(`Gestern habt ihr gemeinsam ${summe} ${summe===1?'Getränk':'Getränke'} geschafft. ${favTop.length===1?`Euer Favorit des Tages war ${favTop[0]} (${fav[0][1]}).`:`Eure Favoriten des Tages waren ${liste(favTop)} (je ${fav[0][1]}).`}`);
    z.push(vorn.length===1?`🍾 Ausgezeichnet für die meisten Getränke des Tages wurde ${vorn[0]} (${proM[0][1]}).`:`🥂 Die meisten Getränke des Tages teilen sich ${liste(vorn)} (je ${proM[0][1]}).`);
  } else z.push('Gestern wurde im Barometer nichts gezählt. Heute ist ein guter Tag für einen Sundowner! 🍹');
  // Herzen: nur die Anzahl, nie Namen aus den privaten Urlaubsherzen
  const neueH=ms.reduce((s,m)=>s+(+m.herzTage?.[gestern]||0),0);
  const hv=ms.map(m=>[m.uid,+m.herzen||0]); const hmax=Math.max(0,...hv.map(v=>v[1])); const hids=hmax>0?hv.filter(v=>v[1]===hmax).map(v=>v[0]):[];
  const trikot = hids.length ? (hids.length>1?`Das gelbe Trikot teilen sich ${liste(hids.map(name))}.`:`Das gelbe Trikot trägt ${neueH?'nun':'weiterhin'} ${name(hids[0])}.`) : '';
  z.push(neueH ? `❤️ Es ${neueH===1?'wurde ein neues Herz':`wurden ${neueH} neue Herzen`} vergeben. ${trikot}` : (trikot?`Gestern wurden keine neuen Herzen vergeben. ${trikot}`:''));
  // Erwiderte Urlaubsherzen: Namen nur, wenn beide es erlaubt haben
  if(knister.length){ const offen=knister.filter(a=>a.vonZeigen&&a.anZeigen); const geheim=knister.length-offen.length;
    const t=[]; if(geheim) t.push(geheim===1?'💘 Und es knistert: Gestern wurde in der Gruppe ein Urlaubsherz erwidert. Wer das wohl ist? 😉':`💘 Und es knistert gewaltig: Gestern wurden ${geheim} Urlaubsherzen erwidert. Wer das wohl ist? 😉`);
    offen.forEach(a=>t.push(`💞 Zwischen ${name(a.von)} und ${name(a.an)} hat es gefunkt!`)); z.push(t.join('\n')); }
  if(medien && (medien.bilder||medien.videos)){ const b=medien.bilder, v=medien.videos;
    const was=[b?`${b} ${b===1?'neues Bild':'neue Bilder'}`:'', v?`${v} ${v===1?'neues Video':'neue Videos'}`:''].filter(Boolean).join(' und ');
    z.push(`📸 Gestern ${b+v===1?'ist':'sind'} ${was} ins Album gekommen.`); }
  if(wetter) z.push(wetter);
  if(heute<=r.bis){ const t=akt.filter(a=>a.datum===heute && !a.privat).sort((a,b)=>(a.zeit||'').localeCompare(b.zeit||''));
    z.push(t.length?`📅 Für heute stehen schon folgende Termine an:\n${t.map(a=>`• ${a.zeit?`${a.zeit}${a.bis?`–${a.bis}`:''} Uhr `:''}${a.titel}${a.ort?` (${a.ort})`:''}`).join('\n')}`:'📅 Für heute ist noch kein Termin eingetragen.'); }
  const bes=[]; const tt=heute.slice(8,10)+'.'+heute.slice(5,7)+'.';
  aktiv.forEach(m=>{ const n=name(m.uid);
    if((m.abreise||r.bis)===heute && heute<=r.bis) bes.push(`${n} reist heute ab${m.transferAb?`, Transfer ist um ${String(m.transferAb).replace(/\s*Uhr$/i,'')} Uhr`:''}.`);
    if(m.anreise && m.anreise===heute && heute!==r.von) bes.push(`${n} kommt heute an${m.transferAn?`, Transfer ist um ${String(m.transferAn).replace(/\s*Uhr$/i,'')} Uhr`:''}.`);
    if((profil(m.uid)||{}).geb===tt) bes.push(`${n} hat heute Geburtstag! 🎂`); });
  if(heute>r.bis) bes.push('Gestern war euer letzter Urlaubstag. Danke für die schöne Zeit! 🧳');
  if(bes.length) z.push(`⭐ Besonderheiten:\n${bes.join('\n')}`);
  return z.filter(Boolean).join('\n\n').replace(/([A-Za-zÄÖÜäöüß])\.\./g,'$1.'); }
module.exports = { berichtText, medienZaehlen };
