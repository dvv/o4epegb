#!/usr/bin/env node
'use strict';

/**
 * HTTP middleware
 */

var Stack = require('../lib');
var sessionHandler, restHandler;
function stack() {
return [
  Stack.health(),

require('../lib/eventsource')(),

  // serve static content
  Stack.static(__dirname + '/public', 'index.html', {
    maxAge: 0,
    //cacheThreshold: 16384
  }),
];
}

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
}

var s1 = new Node(3001);
var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);

var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
repl.s2 = s2;
repl.s3 = s3;
repl.s4 = s4;
