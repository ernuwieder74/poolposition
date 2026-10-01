# Poolposition einrichten – eigene Test-App mit Login

Nach dieser Anleitung hat Poolposition eine eigene Web-Adresse (z. B. `https://poolposition-test.web.app`).
Tester melden sich dort mit E-Mail und Passwort an – ein Claude-Konto brauchen sie nicht.

Dauer: etwa 30 Minuten. Du brauchst ein Google-Konto und eine Kreditkarte (für den Fotospeicher, siehe Schritt 2).

---

## 1. Firebase-Projekt anlegen
1. Öffne https://console.firebase.google.com und melde dich mit deinem Google-Konto an.
2. **Projekt erstellen** → Name z. B. `poolposition-test` → Google Analytics **ausschalten** → **Projekt erstellen**.
3. Notiere dir die **Projekt-ID**. Sie steht unter dem Projektnamen bzw. unter ⚙️ **Projekteinstellungen** (z. B. `poolposition-test` oder `poolposition-test-1a2b3`).

## 2. Tarif „Blaze“ aktivieren (nötig für Fotos)
1. Unten links auf **Upgrade** bzw. **Spark** klicken → **Blaze** wählen → Rechnungskonto mit Kreditkarte anlegen.
2. Beim Einrichten ein **Budget** festlegen, z. B. 5 €. Dann bekommst du eine E-Mail, falls je Kosten entstehen.

Für eine kleine Testgruppe bleibt die Nutzung normalerweise im kostenlosen Grundkontingent.

## 3. Anmeldung einschalten
1. Links **Build → Authentication** → **Jetzt starten**.
2. Reiter **Sign-in method** → **E-Mail-Adresse/Passwort** → **Aktivieren** (nur den ersten Schalter) → **Speichern**.
3. Optional: Reiter **Templates** → Stift-Symbol → Sprache **Deutsch**, damit die „Passwort vergessen“-Mail auf Deutsch ankommt.

## 4. Datenbank anlegen
1. Links **Build → Firestore Database** → **Datenbank erstellen**.
2. Standort **europe-west3 (Frankfurt)** → **Weiter** → **Im Produktionsmodus starten** → **Erstellen**.

## 5. Fotospeicher anlegen
1. Links **Build → Storage** → **Jetzt starten**.
2. Standort wählen (möglichst ebenfalls Europa, z. B. `EUROPE-WEST3`) → **Im Produktionsmodus starten** → **Fertig**.

## 6. App hochladen (Google Cloud Shell)
Die Cloud Shell ist ein Terminal im Browser – du musst nichts installieren.

1. Öffne https://console.cloud.google.com/?cloudshell=true und wähle oben dein Projekt aus.
2. Unten öffnet sich das Terminal. Oben rechts im Terminal: **⋮ (Mehr) → Hochladen** → die Datei `poolposition-firebase.zip` auswählen.
3. Dann diese Zeile ins Terminal kopieren und Enter drücken:

   ```
   unzip -o poolposition-firebase.zip && cd poolposition-firebase && bash setup.sh
   ```

4. Das Skript fragt:
   - die **Projekt-ID** aus Schritt 1,
   - die **E-Mail-Adresse des System-Admins** – das ist die Adresse, mit der **du** dich später in der App registrierst.
5. Falls es um eine Anmeldung bei Firebase bittet: den angezeigten Link öffnen, mit deinem Google-Konto bestätigen, den Code kopieren und ins Terminal einfügen.
6. Am Ende steht: **Deine App: https://…web.app** – das ist deine Adresse.

## 7. Loslegen
1. Öffne die Adresse, tippe **Konto erstellen** und registriere dich mit der Admin-E-Mail aus Schritt 6.
2. Profil anlegen, Urlaub anlegen, unter **Mitglieder → Einladen** eine Einladung erstellen und per WhatsApp verschicken. Jede Einladung hat einen eigenen Code, gilt 7 Tage und nur für die gewählte Anzahl Personen.
3. Tester tippen **Mit Einladungscode beitreten**, legen ein Konto an und landen direkt in der Reise.
4. Tipp für alle: Im Handy-Browser **Zum Startbildschirm hinzufügen** – dann sieht Poolposition aus wie eine App.

---

## Später: neue Version einspielen
Wenn Claude dir eine neue `poolposition-firebase.zip` gibt: in der Cloud Shell hochladen und dieselbe Zeile wie in Schritt 6.3 ausführen. Projekt-ID und Admin-E-Mail werden beim zweiten Mal nicht mehr abgefragt. Alle Daten bleiben erhalten.

## Wenn etwas nicht klappt
- **„Permission denied“ oder „Fehlende Berechtigung“ beim Hochladen:** Schritt 4 oder 5 fehlt noch.
- **Registrieren geht nicht:** Schritt 3 prüfen (E-Mail/Passwort aktiviert?).
- **Anderer Fehler:** Kopiere den roten Text aus dem Terminal oder mach einen Screenshot und schick ihn an Claude.

## Gut zu wissen
- Die App hat noch kein Impressum und keine Datenschutzerklärung. Für einen Test im Freundeskreis ist das üblich; bevor Fremde mitmachen, sollten beide ergänzt werden.
- Die Daten liegen bei Google Firebase (Standort wie in Schritt 4 und 5 gewählt).


## Update einspielen

1. Neue ZIP-Datei in der Cloud Shell hochladen (⋮ → Hochladen).
2. Im Terminal eingeben:

```
cd ~ && unzip -o poolposition-firebase.zip && cd poolposition-firebase && bash setup.sh
```

Projekt und Admin-E-Mail merkt sich das Skript vom ersten Mal. Die Daten in der Datenbank bleiben erhalten.
