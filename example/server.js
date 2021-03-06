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

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
  // handle WebSocket connections
  this.http.on('upgrade', require('./lib/websocket'));
  this.http.on('close', function() {
    this.removeAllListeners('upgrade');
  });
  this.http.on('wsconnection', function(conn) {
    console.log('CONNECTION', conn.id);//, conn.socket.headers);
    repl.s = conn;
    ///var n = 0; setInterval(function() {conn.send('aaa' + (++n))}, 500);
  });
  /***this.http.on('wsmessage', function(conn, message) {
    console.log('MESSAGE', message);
    //socket.send(message + message);
  });***/
  this.http.on('wsclose', function(conn, forced) {
    console.log('CLOSED', conn.id, forced);
  });
  /***this.http.on('wsdata', function(conn, data) {
    console.log('DATA', arguments);
  });***/
  this.http.on('wserror', function(conn, error) {
    console.log('ERROR', error);
  });
  this.http.on('clientError', function() {
    console.log('CLERROR', arguments);
  });
}

var s1 = new Node(3001);
var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);

var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
