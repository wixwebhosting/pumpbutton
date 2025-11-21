# 🚀 THE PUMP BUTTON 🚀

The most important button on the internet. Press it to pump hopium into the markets!

## Features

- 💎 **Giant Pump Button** - One massive, satisfying button
- 🔊 **Sound Effects** - Dynamic pump sound with each click
- ✨ **Particle Effects** - Explosive emoji animations
- 📊 **Global Counter** - See total pumps from all users worldwide
- 🏆 **Leaderboard** - Compete to be the top pumper
- 🌐 **Real-time Sync** - WebSocket-powered live updates
- 💾 **Persistent Stats** - Your pumps are saved locally

## Installation & Local Development

1. Install Node.js dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Deployment to Railway

1. **Connect to Railway:**
   - Go to [railway.app](https://railway.app)
   - Sign in with your GitHub account
   - Click "New Project"
   - Choose "Deploy from GitHub repo"

2. **Configure:**
   - Railway will auto-detect the Node.js project
   - Set environment variables if needed (none required for basic functionality)
   - Deploy!

3. **Full WebSocket Support:**
   - Railway supports persistent WebSocket connections
   - All real-time features work perfectly

## How to Play

1. Enter your username (optional, defaults to "Anonymous")
2. Click the giant PUMP button
3. Watch the magic happen:
   - Sound effect plays
   - "PUMPING HOPIUM INTO THE MARKETS" flashes on screen
   - Particles explode from the button
   - Global counter increments
   - Your score updates on the leaderboard
4. Compete to become the #1 Top Pumper!

## Technical Stack

- **Frontend**: Pure HTML5, CSS3, JavaScript
- **Backend**: Node.js + Express
- **Real-time**: WebSocket (ws library)
- **Audio**: Web Audio API

## API Endpoints

- `GET /api/stats` - Get current pump statistics
- `POST /api/reset` - Reset all counters (for testing)

## Configuration

Default port is 3000. To change it, set the PORT environment variable:
```bash
PORT=8080 npm start
```

## Features Breakdown

### Visual Effects
- Gradient animated background
- Glowing text effects
- Button pulse animation on click
- Flash text animation
- Particle system with random emojis

### Sound
- Procedurally generated pump sound using Web Audio API
- No external audio files needed

### Data Storage
- Server stores global pump count and leaderboard
- Client stores personal pump count in localStorage
- Real-time synchronization across all connected clients

## Future Enhancements Ideas

- Persistent database (MongoDB, PostgreSQL)
- User authentication
- Daily/weekly/monthly leaderboards
- Achievements and badges
- Social sharing
- Multiple pump button skins
- Combo multipliers

## License

MIT - Pump it up! 💎
🚀
