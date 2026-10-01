#!/usr/bin/env bash
# Poolposition – einmalige Einrichtung der automatischen Veröffentlichung über GitHub (in der Google Cloud Shell ausführen)
# Legt ein Dienstkonto „github-deploy“ mit den nötigen Rechten an und gibt seinen Zugangsschlüssel aus.
set -e
PROJECT=poolposition-46f4c
SA="github-deploy@$PROJECT.iam.gserviceaccount.com"
gcloud config set project "$PROJECT" >/dev/null 2>&1
echo "=== Poolposition: automatische Veröffentlichung einrichten ==="
echo "1/4 Dienste werden eingeschaltet (kann 1–2 Minuten dauern) …"
gcloud services enable firebase.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com firestore.googleapis.com \
  cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com \
  pubsub.googleapis.com cloudscheduler.googleapis.com fcm.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com >/dev/null
echo "2/4 Dienstkonto github-deploy …"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create github-deploy --display-name="GitHub: Poolposition veröffentlichen" >/dev/null
# Ein neues Dienstkonto braucht bei Google manchmal etwas, bis man ihm Rechte geben kann – deshalb mit Wiederholung
for R in roles/editor roles/firebase.admin roles/run.admin roles/cloudfunctions.admin roles/iam.serviceAccountUser; do
  for V in 1 2 3 4 5 6 7 8 9 10; do
    if gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$R" --condition=None >/dev/null 2>&1; then echo "   Recht $R vergeben"; break; fi
    if [ "$V" = 10 ]; then echo "FEHLER: Recht $R ließ sich nicht vergeben. Bitte Skript in ein paar Minuten erneut starten."; exit 1; fi
    echo "   Google ist noch nicht so weit, neuer Versuch in 10 Sekunden …"; sleep 10
  done
done
echo "3/4 Recht für die Support-Ansicht …"
PNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
CSA="$PNUM-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$CSA" --member="serviceAccount:$CSA" --role="roles/iam.serviceAccountTokenCreator" >/dev/null 2>&1 || echo "   (übersprungen, wird beim ersten Veröffentlichen erneut versucht)"
echo "4/4 Zugangsschlüssel wird erzeugt …"
TMP=$(mktemp); gcloud iam service-accounts keys create "$TMP" --iam-account="$SA" >/dev/null
echo ""
echo "=================== FIREBASE_SA (alles zwischen den Linien kopieren) ==================="
python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))" "$TMP"
echo "========================================================================================="
rm -f "$TMP"
if [ -f ~/poolposition-firebase/.projekt ]; then source ~/poolposition-firebase/.projekt; echo ""; echo "Bisher eingetragene Admin-Adresse(n) (für das Secret ADMINS): $ADMINS"; fi
echo ""
echo "Fertig. Jetzt die Werte bei GitHub als Secrets eintragen (siehe Anleitung im Chat)."
