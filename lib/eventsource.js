'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Listen to specified URL, serve http://dev.w3.org/html5/eventsource/
 */

module.exports = function setup(url) {

  if (!url) url = '/events';

  return function handler(req, res, next) {
    var keepAliveInterval = null;
    // get events
    if (req.url === url) {
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        // N.B. 2kb padding for IE
        res.write(':' + Array(2048).join(' ') + '\n');
        keepAliveInterval = setInterval(function() {
          res.write('data:' + Date() + '\n\n');
        }, 1000);
        res.socket.on('close', function() {
          clearInterval(keepAliveInterval);
        });
        // honor Yaffle polyfill
        if (req.headers.polling) {
          res.end();
        }
      // event is posted
      } else if (req.method === 'POST') {
        // ???
        res.writeHead(200);
        res.end();
      }
    } else {
      next();
    }
  };

};
