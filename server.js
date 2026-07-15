const http = require('http');
const handler = require('./api/index');
const PORT = process.env.PORT || 3000;

http.createServer(handler).listen(PORT, () => {
  console.log('listening on ' + PORT);
});
