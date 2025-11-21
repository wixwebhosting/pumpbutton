const path = require('path');
const fs = require('fs');

module.exports = (req, res) => {
    const indexPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
};
