const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Serve index.html for root
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '..', 'index.html');
    res.sendFile(indexPath);
});

// Serve pump.png
app.get('/pump.png', (req, res) => {
    const imagePath = path.join(__dirname, '..', 'pump.png');
    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).send('Image not found');
    }
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
