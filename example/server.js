#!/usr/bin/env node
'use strict';

/**
 * HTTP middleware
 */

var Stack = require('./lib');
var sessionHandler, restHandler;
var stack = [
  Stack.health(),
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

/*function(req, res, next) {
console.error('HEAD', req.method, req.url, req.headers);
next();
},*/

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
  this.http = Stack.listen(stack, {
    websocket: {
      foo: true
    }
  }, port);
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
  /*this.ws.on('connection', function() {
    console.log('CONNECTION', this);
  });
  this.ws.on('message', function() {
    console.log('MESSAGE', arguments, this);
  });*/
}

var s1 = new Node(3001);
/*var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);*/

var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
