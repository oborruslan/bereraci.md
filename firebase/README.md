# Tombola Firebase

Aceasta este structura pregătită pentru logarea cu promo code pe bereraci.md.

## Pași de configurare

1. Creează un proiect în Firebase Console și adaugă o aplicație Web.
2. Activează Authentication -> Sign-in method -> Anonymous.
3. Creează Firestore Database în modul production.
4. Copiază configurația aplicației Web în `assets/js/firebase-config.js`.
5. Publică regulile din `firebase/firestore.rules` în Firestore Rules.
6. Importă codurile private:

```powershell
npm install firebase-admin
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\cale\spre\service-account.json"
node scripts/import-promo-codes-to-firestore.mjs firebase-private/promo-codes-1000.json
```

## Colecții Firestore

- `promoCodes/{code}`: coduri create de administrator, de exemplu `BR-ABCD-2345`.
- `tombolaParticipants/{code}`: participanți validați. Documentul este creat automat când clientul introduce un cod valid.

Un promo cod poate crea un singur document în `tombolaParticipants`. Dacă același cod este introdus a doua oară, pagina afișează eroarea că promo codul este deja înregistrat, iar regulile Firestore blochează actualizarea documentului existent.

Pentru fiecare tombolă viitoare poți extrage participanții din `tombolaParticipants` unde `eligibleForAllDraws == true` și `status == "active"`.

## Unde vezi participanții

În Firebase Console intră la Firestore Database -> Data -> `tombolaParticipants`.

Fiecare document are ID-ul promo codului și câmpuri pentru:

- `customerName`
- `customerPhone`
- `promoCode`
- `status`
- `eligibleForAllDraws`
- `createdAt`
- `lastLoginAt`

## Export participanți CSV

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\cale\spre\service-account.json"
node scripts/export-tombola-participants.mjs
```

Fișierul se va crea în:

```text
firebase-private/tombola-participants.csv
```

## Important

Folderul `firebase-private/` conține cele 1000 coduri reale și este ignorat de Git. Nu îl încărca pe site-ul public.

În `index.html` există doar hash-urile acestor 1000 coduri, pentru verificare locală în pagină. Codurile brute rămân în `firebase-private/promo-codes-1000.json` și se importă în Firestore.
