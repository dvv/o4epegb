#!/usr/bin/env node
'use strict';

/**
 * HTTP middleware
 */

var Stack = require('./lib');
var sessionHandler, restHandler;
function stack() {
return [
  Stack.health(),

function(req, res, next) {
console.error('HEAD', req.method, req.url);
next();
},

  // serve static content
  Stack.static(__dirname + '/public', 'index.html', {
    maxAge: 0,
    //cacheThreshold: 16384
  }),
  // dynamic content requires session
  sessionHandler = require('cookie-sessions')({
    session_key: 'sid',
    secret: 'change-me-in-production-env',
    path: '/',
    timeout: 86400000
  }),
  // process request body
  Stack.body(),
  // process RESTful access
  restHandler = Stack.rest('/', {
    //context: model
  }),
  // handle signin/signout
  auth(),
  //authHandler,
];
}

/**
 * Handle authentication
 */

function auth(url) {

  return function handler(req, res, next) {
    if (req.url === '/auth') {
      // session exist?
      if (req.session) {
        // ...remove session
        delete req.session;
      // no session so far?
      } else {
        // ...signin!
        // put authentication logic here
        // ???
        // set the session so that we can persist the shared context
        req.session = {
          uid: 'dvv' + Math.random().toString().substring(2)
        };
      }
      // go home
      res.writeHead(302, {location: '/'});
      res.end();
    } else {
      next();
    }
  };

}

var WebSocketServer = require('websocket').server;

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
  // handle WebSocket connections
  this.ws = new WebSocketServer({
    httpServer: this.http,
    fragmentOutgoingMessages: false,
    keepalive: false
  });
  this.ws.on('request', function(req) {
    var conn = req.accept(null, req.origin);
console.log(new Date(), 'CONNECT', conn.remoteAddress, req.websocketVersion);
    conn.sendUTF(JSON.stringify({
      msg: 'initCommands',
      data: 'FOO'
    }));
    conn.on('close', function() {
console.log(new Date(), 'DISCONNECT', conn.remoteAddress);
    });
    conn.on('message', function(message) {
console.log(new Date(), 'message', message);
      if (message.type === 'utf8') {
        try {
          var command = JSON.parse(message.utf8Data);
        } catch(e) {
                // do nothing if there's an error.
        }
      }
    });
  });
}

var s1 = new Node(3001);
var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);

var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
