const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
    // Try multiple possible paths
    const possiblePaths = [
        path.join(__dirname, '..', 'index.html'),
        path.join(process.cwd(), 'index.html'),
        '/var/task/index.html'
    ];
    
    let html;
    for (const tryPath of possiblePaths) {
        if (fs.existsSync(tryPath)) {
            html = fs.readFileSync(tryPath, 'utf8');
            break;
        }
    }
    
    if (!html) {
        return res.status(500).send('Could not find index.html. Paths tried: ' + possiblePaths.join(', '));
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
};
