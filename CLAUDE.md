# Simpel Budget

Budgetplanner in de browser: plain HTML/CSS/JS (`index.html`, `app.js`,
`style.css`), geen build-stap. Gegevens staan in `localStorage`.
Live via GitHub Pages vanaf `main`: https://wikidave.github.io/simpel-budget/

## Werkwijze voor elke wijziging (verplicht)

1. **Nooit rechtstreeks op `main` werken of pushen.** Maak voor elke
   wijziging eerst een nieuwe branch vanaf de laatste `main`, met een
   gepaste, korte naam in kleine letters met streepjes
   (bv. `terug-knop-popups`, `fix-jaarlijks-knop`).
2. Commit met een duidelijke, beschrijvende commit-boodschap (in het Nederlands).
3. Test de wijziging zelf in de browser (Playwright/Chromium) voor je pusht.
4. Push de branch en geef de gebruiker een testlink voor die branch:
   `https://raw.githack.com/WikiDave/simpel-budget/<branch>/index.html`
   Vermeld dat die link een eigen, lege opslag heeft (andere origin dan de live site).
5. **Pas mergen naar `main` nadat de gebruiker de testlink heeft getest en
   expliciet toestemming geeft.** Daarna controleren dat de live site de
   nieuwe versie toont.
