# See Whot server

Three files go together: `server.js`, `package.json`, `see-whot.html`. No packages to install.

## Run on your computer (test)
    node server.js
Open http://localhost:3000 on two browser tabs, sign up in each, and try Private Code or Online Match.

## Put it online (Render.com, free plan works)
1. Make a free GitHub repository and upload the three files.
2. On render.com choose New > Web Service, pick the repository.
3. Build command: leave empty. Start command: `node server.js`.
4. When it is live, open the https link Render gives you on any phone. The game loads from your server and connects to it by itself.

Free plans go to sleep when nobody plays, so the first connection can take about 30 seconds.

## How it works
- The server runs the game rules, so nobody can cheat. Each player only receives their own cards.
- Online Match (2, 3, 4 players): bots fill empty seats after 20 seconds.
- Private Code: the host gets a 4 letter code, the friend types it, the game starts when both are in.
- If a player loses connection, a bot plays for them until they come back (within 60 seconds).
- Settings > Game server lets a player type a different server address (wss://...).
- Accounts (email and password) are still saved on each phone, not on the server.

## Recorded voices (optional)
The game plays an mp3 clip if it exists, and uses the phone's speech if it does not. Name the clips exactly like this and put them next to `server.js` (or in a folder called `voices`):
hold-on-jor.mp3, col-lect-two-jor.mp3, ba-meta-jor.mp3, col-lect-four-jor.mp3, sus-pen-sion.mp3, go-market-jor.mp3,
i-want-circle.mp3, i-want-square.mp3, i-want-star.mp3, i-want-cross.mp3, i-want-triangle.mp3,
last-card.mp3, na-me-they-always-turn-up.mp3, bom-bo-clat.mp3
Bigger stacks use col-lect-six-jor.mp3, col-lect-eight-jor.mp3, col-lect-nine-jor.mp3, col-lect-ten-jor.mp3, col-lect-twelve-jor.mp3.
