const express = require('express');
const path = require('path');

const app = express();

// Serve static files
app.use(express.static(__dirname));

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// In-memory storage (note: this resets on every serverless invocation)
let totalPumps = 0;
let leaderboard = {};

// API endpoint to get current stats
app.get('/api/stats', (req, res) => {
    const topPumpers = Object.entries(leaderboard)
        .map(([username, pumps]) => ({ username, pumps }))
        .sort((a, b) => b.pumps - a.pumps)
        .slice(0, 10);
    
    res.json({
        totalPumps: totalPumps,
        leaderboard: topPumpers
    });
});

// API endpoint to register a pump
app.post('/api/pump', express.json(), (req, res) => {
    const { username } = req.body;
    
    totalPumps++;
    
    const user = username || 'Anonymous';
    if (!leaderboard[user]) {
        leaderboard[user] = 0;
    }
    leaderboard[user]++;
    
    const topPumpers = Object.entries(leaderboard)
        .map(([username, pumps]) => ({ username, pumps }))
        .sort((a, b) => b.pumps - a.pumps)
        .slice(0, 10);
    
    res.json({
        totalPumps: totalPumps,
        leaderboard: topPumpers
    });
});

module.exports = app;
