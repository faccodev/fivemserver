const http = require('http');

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('true');
});

server.listen(8082, () => {
    console.log('Mock Auth Server running on port 8082');
});
