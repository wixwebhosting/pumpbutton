const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(__dirname));

// Data storage (in production, use a database)
let totalPumps = 0;
let leaderboard = {}; // { username: pumps }

// Broadcast to all connected clients
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Get top 10 pumpers
function getLeaderboard() {
    return Object.entries(leaderboard)
        .map(([username, pumps]) => ({ username, pumps }))
        .sort((a, b) => b.pumps - a.pumps)
        .slice(0, 10);
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // Send current state to new client
    ws.send(JSON.stringify({
        type: 'update',
        totalPumps: totalPumps,
        leaderboard: getLeaderboard()
    }));
    
    // Handle messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'pump') {
                // Increment global counter
                totalPumps++;
                
                // Update leaderboard
                const username = data.username || 'Anonymous';
                if (!leaderboard[username]) {
                    leaderboard[username] = 0;
                }
                leaderboard[username]++;
                
                console.log(`💎 PUMP! Total: ${totalPumps} | ${username}: ${leaderboard[username]}`);
                
                // Broadcast update to all clients
                broadcast({
                    type: 'update',
                    totalPumps: totalPumps,
                    leaderboard: getLeaderboard()
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// HTTP endpoint to get current stats (optional)
app.get('/api/stats', (req, res) => {
    res.json({
        totalPumps: totalPumps,
        leaderboard: getLeaderboard()
    });
});

// Reset endpoint (for testing)
app.post('/api/reset', (req, res) => {
    totalPumps = 0;
    leaderboard = {};
    broadcast({
        type: 'update',
        totalPumps: 0,
        leaderboard: []
    });
    res.json({ message: 'Reset successful' });
});

const PORT = process.env.PORT || 3001;

// For Vercel serverless, export the app
if (process.env.VERCEL) {
    module.exports = app;
} else {
    server.listen(PORT, () => {
        console.log(`
    🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀
    
    PUMP BUTTON SERVER RUNNING!
    
    Server listening on port ${PORT}
    Open http://localhost:${PORT} in your browser
    
    LET'S PUMP IT! 💎💎💎
    
    🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀
    `);
    });
}

// Save data periodically (every 5 minutes)
setInterval(() => {
    console.log(`📊 Stats - Total Pumps: ${totalPumps} | Active users: ${wss.clients.size}`);
}, 300000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
