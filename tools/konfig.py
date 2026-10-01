#!/usr/bin/env python3
"""Erzeugt beim automatischen Veröffentlichen die Dateien, die nicht im Repo liegen sollen:
public/config.js (Firebase-Zugangsdaten der Web-App, Admin-Adressen, Web-Push-Schlüssel),
firestore.rules (aus der Vorlage mit den Admin-Adressen), functions/region.json und .bucket."""
import json, os, re, subprocess, sys
P = os.environ.get('PROJECT', 'poolposition-46f4c')
admins = [a.strip().lower() for a in os.environ.get('ADMINS', '').split(',') if a.strip()]
vapid = os.environ.get('VAPID', '').strip()
if not admins: sys.exit('FEHLER: Secret ADMINS fehlt (E-Mail-Adresse des Oberbademeisters).')
def fb(*a): return json.loads(subprocess.check_output(['firebase', *a, '--project', P, '--json']))
apps = (fb('apps:list', 'WEB').get('result') or [])
if not apps: sys.exit('FEHLER: Keine Web-App im Firebase-Projekt gefunden.')
r = fb('apps:sdkconfig', 'WEB', apps[0]['appId']).get('result', {})
cfg = r.get('sdkConfig') or json.loads(re.search(r'\{.*\}', r.get('fileContents', ''), re.S).group(0))
open('public/config.js', 'w').write('self.PP_CONFIG = ' + json.dumps({'firebase': cfg, 'admins': admins, 'vapid': vapid}, indent=2) + ';\n')
open('firestore.rules', 'w').write(open('firestore.rules.vorlage').read().replace('__ADMIN_EMAILS__', json.dumps(admins)))
open('.bucket', 'w').write(cfg.get('storageBucket', ''))
try: loc = subprocess.check_output(['gcloud', 'firestore', 'databases', 'describe', '--database=(default)', '--project', P, '--format=value(locationId)'], text=True).strip()
except Exception: loc = ''
reg = {'nam5': 'us-central1', 'eur3': 'europe-west1', '': 'us-central1'}.get(loc, loc)
open('functions/region.json', 'w').write(json.dumps({'region': reg}))
print(f'Konfiguration erzeugt: Admins {len(admins)}, Web-Push {"ja" if vapid else "nein"}, Datenbank {loc or "?"} → Funktionen-Region {reg}, Speicher {cfg.get("storageBucket")}')
