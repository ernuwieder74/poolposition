#!/usr/bin/env bash
# Poolposition – einmalig: interne Google-Rechte für die Server-Funktionen (Push, Erinnerungen, Morgenbericht)
PROJECT=poolposition-46f4c
PNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
CSA="$PNUM-compute@developer.gserviceaccount.com"
echo "Dienst-Agenten werden angelegt …"
gcloud beta services identity create --service=pubsub.googleapis.com --project "$PROJECT" >/dev/null 2>&1 || true
gcloud beta services identity create --service=eventarc.googleapis.com --project "$PROJECT" >/dev/null 2>&1 || true
gib() { for V in 1 2 3 4 5 6; do gcloud projects add-iam-policy-binding "$PROJECT" --member="$1" --role="$2" --condition=None >/dev/null 2>&1 && { echo "  ok: $2"; return; }; sleep 10; done; echo "  FEHLER: $2 für $1"; }
gib "serviceAccount:service-$PNUM@gcp-sa-pubsub.iam.gserviceaccount.com" roles/iam.serviceAccountTokenCreator
gib "serviceAccount:$CSA" roles/run.invoker
gib "serviceAccount:$CSA" roles/eventarc.eventReceiver
gib "serviceAccount:service-$PNUM@gcp-sa-eventarc.iam.gserviceaccount.com" roles/eventarc.serviceAgent
echo "Fertig. Jetzt Claude Bescheid geben."
