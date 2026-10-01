#!/usr/bin/env bash
# Poolposition – Einrichtung und Aktualisierung in der Google Cloud Shell
set -e
cd "$(dirname "$0")"
echo ""
echo "=== Poolposition einrichten: $(cat VERSION 2>/dev/null) ==="
if [ -f .projekt ]; then source .projekt; fi
if [ -z "$PROJECT" ]; then read -r -p "Firebase-Projekt-ID (steht in der Firebase-Konsole unter Projekteinstellungen): " PROJECT; fi
if [ -z "$ADMINS" ]; then read -r -p "E-Mail-Adresse(n) der System-Admins, mit Komma getrennt: " ADMINS; fi
if [ -z "$VAPID" ]; then
  echo ""
  echo "Für Push-Benachrichtigungen braucht die App einen Web-Push-Schlüssel."
  echo "Firebase-Konsole → Projekteinstellungen (Zahnrad) → Cloud Messaging → ganz unten „Web-Push-Zertifikate“ → „Schlüsselpaar generieren“."
  echo "Dann den langen Schlüssel (beginnt meist mit B…) kopieren und hier einfügen. Leer lassen = Push später einrichten."
  read -r -p "Web-Push-Schlüssel: " VAPID
fi
printf 'PROJECT=%q\nADMINS=%q\nVAPID=%q\n' "$PROJECT" "$ADMINS" "$VAPID" > .projekt

if ! command -v firebase >/dev/null 2>&1; then echo "Firebase-Werkzeuge werden installiert …"; npm install -g firebase-tools >/dev/null; fi
if ! firebase projects:list >/dev/null 2>&1; then echo "Bitte bei Firebase anmelden (Link öffnen, Code hier einfügen):"; firebase login --no-localhost; fi

echo "Web-App wird gesucht oder angelegt …"
appid() { firebase apps:list WEB --project "$PROJECT" --json | python3 -c 'import sys,json; r=json.load(sys.stdin).get("result") or []; print(r[0]["appId"] if r else "")'; }
APPID=$(appid)
if [ -z "$APPID" ]; then firebase apps:create WEB "Poolposition" --project "$PROJECT" >/dev/null; APPID=$(appid); fi
firebase apps:sdkconfig WEB "$APPID" --project "$PROJECT" --json > .sdk.json

python3 - "$ADMINS" "$VAPID" <<'PY'
import json, re, sys
admins=[a.strip().lower() for a in sys.argv[1].split(',') if a.strip()]
vapid=(sys.argv[2] if len(sys.argv)>2 else '').strip()
d=json.load(open('.sdk.json')); r=d.get('result', d)
cfg=r.get('sdkConfig')
if not cfg:
    txt=r.get('fileContents','')
    m=re.search(r'\{.*\}', txt, re.S); cfg=json.loads(m.group(0))
open('public/config.js','w').write('self.PP_CONFIG = ' + json.dumps({'firebase':cfg,'admins':admins,'vapid':vapid}, indent=2) + ';\n')
rules=open('firestore.rules.vorlage').read().replace('__ADMIN_EMAILS__', json.dumps(admins))
open('firestore.rules','w').write(rules)
open('.bucket','w').write(cfg.get('storageBucket',''))
print('Konfiguration geschrieben. Speicher:', cfg.get('storageBucket'))
PY

BUCKET=$(cat .bucket)
echo "Foto-Speicher wird für Downloads freigeschaltet …"
gcloud storage buckets update "gs://$BUCKET" --cors-file=cors.json --project "$PROJECT" >/dev/null 2>&1 || gsutil cors set cors.json "gs://$BUCKET"

echo "App und Regeln werden veröffentlicht …"
firebase deploy --only hosting,firestore:rules,storage --project "$PROJECT" --non-interactive

echo "Region der Datenbank wird ermittelt (für Push-Benachrichtigungen) …"
LOC=$(gcloud firestore databases describe --database='(default)' --project "$PROJECT" --format='value(locationId)' 2>/dev/null || true)
case "$LOC" in nam5|"") REG=us-central1;; eur3) REG=europe-west1;; *) REG="$LOC";; esac
echo "{\"region\": \"$REG\"}" > functions/region.json
gcloud services enable fcm.googleapis.com eventarc.googleapis.com --project "$PROJECT" >/dev/null 2>&1 || true

echo "Rechte für die Support-Ansicht werden eingerichtet …"
gcloud services enable iamcredentials.googleapis.com --project "$PROJECT" >/dev/null 2>&1 || true
PNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true)
if [ -n "$PNUM" ]; then SA="$PNUM-compute@developer.gserviceaccount.com"
  gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role="roles/iam.serviceAccountTokenCreator" --project "$PROJECT" >/dev/null 2>&1 \
    || echo "Hinweis: Das Recht für die Support-Ansicht ließ sich nicht setzen. Die übrige App funktioniert."; fi

echo "Server-Funktionen (Morgenbericht, Badeaufsicht) werden eingerichtet …"
( cd functions && npm install --silent --no-audit --no-fund >/dev/null 2>&1 ) || echo "Hinweis: Pakete für den Morgenbericht ließen sich nicht installieren."
if ! firebase deploy --only functions --project "$PROJECT" --non-interactive --force; then
  echo "Erster Versuch hat nicht geklappt, Google schaltet evtl. noch Dienste frei. Neuer Versuch in 60 Sekunden …"; sleep 60
  firebase deploy --only functions --project "$PROJECT" --non-interactive --force || echo "HINWEIS: Der Morgenbericht konnte nicht eingerichtet werden. Die App selbst ist aktualisiert. Bitte Screenshot an Claude schicken."
fi

echo ""
echo "=== Fertig! ==="
echo "Deine App: https://$PROJECT.web.app"
echo ""
