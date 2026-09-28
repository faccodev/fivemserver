const http = require('http');
const { exec } = require('child_process');

const PORT = 81;

const server = http.createServer((req, res) => {
    if (req.url === '/sync' && req.method === 'GET') {
        exec('bash /server/sync.sh', (error, stdout, stderr) => {
            res.setHeader('Content-Type', 'text/plain');
            if (error) {
                res.statusCode = 500;
                res.end(`Error:\n${stderr}\nStack:\n${error.message}`);
            } else {
                res.statusCode = 200;
                res.end(`Output:\n${stdout}`);
            }
        });
    } else {
        res.statusCode = 404;
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`Sync server listening on port ${PORT}`);
});
