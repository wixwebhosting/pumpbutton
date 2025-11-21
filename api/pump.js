// In-memory storage (shared across function invocations in same instance)
global.pumpData = global.pumpData || {
    totalPumps: 0,
    leaderboard: {}
};

module.exports = (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username } = req.body;
    
    global.pumpData.totalPumps++;
    
    const user = username || 'Anonymous';
    if (!global.pumpData.leaderboard[user]) {
        global.pumpData.leaderboard[user] = 0;
    }
    global.pumpData.leaderboard[user]++;
    
    const topPumpers = Object.entries(global.pumpData.leaderboard)
        .map(([username, pumps]) => ({ username, pumps }))
        .sort((a, b) => b.pumps - a.pumps)
        .slice(0, 10);
    
    res.json({
        totalPumps: global.pumpData.totalPumps,
        leaderboard: topPumpers
    });
};
