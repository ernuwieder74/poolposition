#!/usr/bin/env python3
"""Erzeugt beim automatischen Veröffentlichen die Dateien, die nicht im Repo liegen sollen:
public/config.js (Firebase-Zugangsdaten der Web-App, Admin-Adressen, Web-Push-Schlüssel),
firestore.rules (aus der Vorlage mit den Admin-Adressen), functions/region.json und .bucket."""
import json, os, re, subprocess, sys
P = os.environ.get('PROJECT', 'poolposition-46f4c')
def fehler(t):  # als Hinweis in der GitHub-Übersicht sichtbar
    print(f'::error title=Konfiguration::{t}'); sys.exit(1)
admins = [a.strip().lower() for a in os.environ.get('ADMINS', '').split(',') if a.strip()]
vapid = os.environ.get('VAPID', '').strip()
if not admins: fehler('Secret ADMINS fehlt oder ist leer (E-Mail-Adresse des Oberbademeisters).')
if not vapid: print('::warning title=Web-Push::Secret VAPID fehlt – Push-Benachrichtigungen bleiben aus.')
def fb(*a):
    r = subprocess.run(['firebase', *a, '--project', P, '--json'], capture_output=True, text=True)
    try: d = json.loads(r.stdout)
    except Exception: fehler(f'firebase {" ".join(a)}: {(r.stderr or r.stdout)[-500:]}')
    if d.get('status') == 'error': fehler(f'firebase {" ".join(a)}: {d.get("error")}')
    return d
apps = (fb('apps:list', 'WEB').get('result') or [])
if not apps: fehler('Keine Web-App im Firebase-Projekt gefunden.')
r = fb('apps:sdkconfig', 'WEB', apps[0]['appId']).get('result', {})
cfg = r.get('sdkConfig') or json.loads(re.search(r'\{.*\}', r.get('fileContents', ''), re.S).group(0))
open('public/config.js', 'w').write('self.PP_CONFIG = ' + json.dumps({'firebase': cfg, 'admins': admins, 'vapid': vapid}, indent=2) + ';\n')
open('firestore.rules', 'w').write(open('firestore.rules.vorlage').read().replace('__ADMIN_EMAILS__', json.dumps(admins)))
open('.bucket', 'w').write(cfg.get('storageBucket', ''))
try: loc = subprocess.check_output(['gcloud', 'firestore', 'databases', 'describe', '--database=(default)', '--project', P, '--format=value(locationId)'], text=True).strip()
except Exception: loc = ''
reg = {'nam5': 'us-central1', 'eur3': 'europe-west1', '': 'us-central1'}.get(loc, loc)
try: bl = subprocess.check_output(['gcloud', 'storage', 'buckets', 'describe', 'gs://' + cfg.get('storageBucket', ''), '--project', P, '--format=value(location)'], text=True).strip().lower()
except Exception: bl = ''
open('functions/admins.json', 'w').write(json.dumps({'admins': admins}))
open('functions/region.json', 'w').write(json.dumps({'region': reg, 'bucketRegion': bl or reg}))
print(f'Konfiguration erzeugt: Admins {len(admins)}, Web-Push {"ja" if vapid else "nein"}, Datenbank {loc or "?"} → Funktionen-Region {reg}, Speicher {cfg.get("storageBucket")}')
