# Knuten

Inskrivningssystem för **Ungdomsgården Knuten** – anonym besöksstatistik direkt i webbläsaren.

## Funktioner

- ✅ **Registrering utan namn** – besökaren kan skriva sitt förnamn för en personlig hälsning, men namnet sparas aldrig.
- 🎉 **Ungdomlig design** – stora pekvänliga valknappar, animerad bakgrund och konfetti vid registrering.
- 📊 **Statistik i realtid** – totalt antal besökare, könsfördelning, åldersgrupper och kommuner.
- 🔒 **Personalvy med PIN-kod** – statistik, historik, export och hantering ligger bakom en PIN-kod (standard: `1234` – byt den direkt!).
- 🗓️ **Historik** – tidigare dagars statistik sparas i 92 dagar och kan visas och exporteras.
- 📄 **CSV-export** – exportera en vald dag eller alla dagar.
- 💾 **Säkerhetskopiering** – exportera och återställ all data som JSON-fil.
- ↩️ **Ångra-knapp** – ångra den senaste registreringen vid feltryck.
- 🌅 **Automatisk ny dag** – räknaren nollställs automatiskt vid midnatt.

## Kom igång

1. Öppna `index.html` i en modern webbläsare (Chrome, Edge, Firefox), eller
2. publicera mappen via GitHub Pages.

Ingen installation eller server behövs. All data sparas lokalt i webbläsaren på den enhet som används.

## Köra på iPad (kioskläge)

1. Öppna sidan i **Safari** på iPaden (t.ex. via GitHub Pages).
2. Tryck på **Dela** → **Lägg till på hemskärmen** – sidan startar då i helskärm som en app, utan adressfält.
3. Slå på **Guidad åtkomst** (Inställningar → Åtkomst → Guidad åtkomst) och starta den i Safari för att låsa iPaden till inskrivningssidan.
4. Sidan försöker hålla skärmen vaken automatiskt (Wake Lock), men ställ gärna in **Inställningar → Skärm och ljusstyrka → Lås automatiskt → Aldrig** på kioskenheten.

Zoom och dubbeltryckszoom är avstängda, och tryckmålen är stora och pekvänliga.

## Personal (PIN-kod)

1. Klicka på **🔒 Personal – logga in**.
2. Ange PIN-koden (standard **1234**).
3. Byt PIN-koden via **🔑 Ändra PIN-kod** i personalvyn.

Personalvyn låses automatiskt när fliken stängs.

## Integritet

- **Förnamn sparas aldrig** – det används bara för en personlig hälsning på skärmen.
- Endast **anonym sammanräknad statistik** lagras – aldrig namn eller individuella poster.
- All data stannar **lokalt i webbläsaren** (localStorage) på den enhet som används.
- Statistik som är äldre än 92 dagar raderas automatiskt.

## Säkerhet

PIN-koden är avsedd som en enkel spärr på en dedikerad enhet, inte som fullständigt skydd.
Ta regelbundet **säkerhetskopior (JSON)** – webbläsardata kan försvinna om cacheminnet rensas
eller enheten byts ut.

## Teknik

Ren HTML/CSS/JavaScript – inga ramverk, inga beroenden.

- `index.html` – sidans struktur
- `styles.css` – utseende
- `app.js` – all logik

---

*English summary: Anonymous, privacy-friendly visitor sign-in for the Knuten youth center.
First names are never stored – they are only used for an on-screen greeting.
Single-page app with no backend – data stays in the browser.*

copyright M4yf4ll
