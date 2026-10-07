# Japa

A browser game about leaving Lagos in 52 weeks.

You draw a random starting life (Fresh Corper, Remote Dev, Staff Nurse, Balogun Trader, Pastor's Kid or Has Uncle in Houston) and pick a destination: the UK, Canada or Germany. Then you race the calendar and the exchange rate to get out.

## How to play

Every week you get **3 moves**. Spend them on:

- **Earn**: work your job, or try a risky side hustle.
- **Paperwork**: passport, language test (IELTS or Goethe B1), admission, job offer or Express Entry draw, then the visa and your flight.
- **Recover**: rest or attend a night vigil. If your sanity hits 0, the game is over.

Changing money at the **BDC** doesn't use a move. The naira usually weakens week to week, so buying dollars early helps. Proof of funds, visa fees and flights are all paid in dollars.

When you end the week, rent and food come out of your naira, the exchange rate moves, and something happens: NEPA takes light, Mummy calls for money, a WhatsApp "agent" promises a guaranteed visa, Detty December arrives.

You win when you board your flight before week 52. A secret ending unlocks if you get rich enough to stay.

## Run it

It's a static site with no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Put it online

GitHub Pages hosts it for free, but on the free plan the repository must be public.

1. **Settings → General → Danger Zone → Change visibility → Public.**
2. **Settings → Pages → Build and deployment**: set Source to *Deploy from a branch*. Pick the branch that has the game (`main` once it's merged) and the `/ (root)` folder, then save.
3. After a minute or two the game is live at **https://kzzzzzy1.github.io/Video-game/**.

The link preview tags in `index.html` (`og:url` and `og:image`) point at that address. If you host the game somewhere else, update them so WhatsApp and X show `og-image.png` when people share the link.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and font loading |
| `style.css` | Look and feel, light and dark themes |
| `engine.js` | All game rules and content. It has no DOM code, so it also runs in Node |
| `ui.js` | Screens, rendering, input and saving to `localStorage` |

To change the balance, edit the numbers in `engine.js`: `BACKGROUNDS` for starting lives and pay, `DESTINATIONS` for each route's requirements, and `EVENTS` for the weekly surprises.
