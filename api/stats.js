// In-memory storage (shared across function invocations in same instance)
global.pumpData = global.pumpData || {
    totalPumps: 0,
    leaderboard: {}
};

module.exports = (req, res) => {
    const topPumpers = Object.entries(global.pumpData.leaderboard)
        .map(([username, pumps]) => ({ username, pumps }))
        .sort((a, b) => b.pumps - a.pumps)
        .slice(0, 10);
    
    res.json({
        totalPumps: global.pumpData.totalPumps,
        leaderboard: topPumpers
    });
};
