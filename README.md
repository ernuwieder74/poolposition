# Poolposition

Die Reise-App für Urlaubsgruppen. Dieses Repo enthält die Firebase-Version (App, Datenbank-Regeln, Server-Funktionen).

**Veröffentlichen:** Jede neue Version im Zweig `main` wird automatisch über GitHub Actions bei Firebase eingespielt
(siehe `.github/workflows/veroeffentlichen.yml`). Den Stand siehst du unter „Actions“.

**Einmalige Einrichtung:** `github-einrichten.sh` in der Google Cloud Shell ausführen und die ausgegebenen Werte
als Secrets `FIREBASE_SA`, `ADMINS` und `VAPID` im Repo hinterlegen.

**Manuell (Notfall):** Wie bisher ZIP in die Cloud Shell laden und `bash setup.sh` ausführen.
