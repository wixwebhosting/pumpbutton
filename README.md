# The Trenches Voice Grid

Real-time, browser-based voice trenches for the memecoin space. Spin up a single voice room per IP, gate entry behind a cleaned-up callsign, and let the rest of the squad drop in via WebRTC.

## Stack

- **Node.js + Express** for serving assets
- **WebSocket (ws)** for real-time room + signaling events
- **WebRTC (SimplePeer)** for peer-to-peer audio
- **Vanilla HTML/CSS/JS** with a cyberpunk-inspired UI

## Getting Started

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` to access the grid.

## Key Features

- Username gate with profanity filter and local persistence
- One trench (voice room) per IP—creates auto-collapse when the host leaves
- Dynamic lobby listing active trenches + headcounts
- Full-mesh WebRTC audio using SimplePeer
- Responsive, animated UI tailored for the degen trenches vibe

## Deploying

Use `npm start` for production. Behind a proxy, ensure `X-Forwarded-For` headers are forwarded so IP-locking stays accurate.
