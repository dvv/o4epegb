'use strict';

var redis = require('redis').createClient();
//var codec = {encode: JSON.stringify, decode: JSON.parse}; // should provide .encode/.decode
var codec = require('bison'); // should provide .encode/.decode

/**
 * 
 * Client -- an identified set of connections
 * 
 */

function Client(id, manager) {
  this.id = id;
  this.manager = manager;
  this.sockets = {};
}

// inherit from EventEmitter
Client.prototype.__proto__ = process.EventEmitter.prototype;

/***
//
// manual acknowledgement
// FIXME: think over
//
Client.prototype.ack = function(id) {
  this.send({
    ackId: id,
    result: Array.prototype.slice.call(arguments, 1)
  });
  return this;
};
***/

Client.prototype.broadcast = function() {
  return this.manager.broadcast.apply(this.manager, arguments);
};

/**
 * 
 * Manager -- clients director
 * 
 */

function Manager(id) {
  this.id = id;
  var sub = require('redis').createClient();
  sub.psubscribe('*'); sub.on('pmessage', this.handleMessage.bind(this));
  this.db = require('redis').createClient();
  // managed clients
  this.clients = {};
  // named filtering functions
  this.filters = {};
}

// inherit from EventEmitter
Manager.prototype.__proto__ = process.EventEmitter.prototype;

Manager.prototype.handleMessage = function(pattern, channel, message) {
  var self = this;
  var db = this.db;
  // deserialize message
  message = codec.decode(message);
  //
  // compose list of recipients
  //
  var commands = [];
//console.log('RECV', message.event, message.filter);
  // short-circuit simple cases
  if (!message.filter.or) {
    commands.push(['smembers', 'g:all']);
  } else if (typeof message.filter.or === 'string') {
    commands.push(['smembers', message.filter.or]);
  } else {
    var tempSetName = 'TODO:unique-and-nonce,but,maybe,a,join,of,message.or';
    commands.push(['sunionstore', tempSetName].concat(message.filter.or));
    if (message.filter.and) {
      commands.push(['sinterstore', tempSetName, tempSetName].concat(message.filter.and));
    }
    if (message.filter.not) {
      commands.push(['sdiffstore', tempSetName, tempSetName].concat(message.filter.not));
    }
    // TODO: once we find a way to encode and/or/not in reasonable short string
    // we can use it as resulting set name and set expire on resulting set and reuse it.
    //db.expire(tempSetName, 1); // valid for 1 second
    commands.push(['smembers', tempSetName]);
  }
//console.log('COMMANDS', commands);
  db.multi(commands).exec(function(err, results) {
    // FIXME: until we don't use expiry, we free resulting set immediately
    if (tempSetName) db.del(tempSetName);
    // error means we are done, no need to bubble
    if (err) return;
    // get resulting set members
    // N.B. redis set operations guarantee we have no duplicates on client level
    var cids = results[results.length - 1];
//console.log('CIDS', cids);
    // apply custom named filter, if any
    // N.B. this is very expensive option since we have to dereference client data given cid
    // FIXME: can this data ever be obtained async?
    var fn;
    if (message.filter.flt && (fn = self.filters[message.filter.flt])) {
      cids = cids.filter(fn);
    }
    // distribute payload to relevant clients
    var payload = message.payload;
    for (var i = 0, l = cids.length; i < l; ++i) {
      var client = self.clients[cids[i]];
      if (client) client.emit(message.event, message.payload);
    }
  });
};

Manager.prototype.client = function(id) {
  if (!this.clients[id]) {
    this.clients[id] = new Client(id, this);
  }
  return this.clients[id];
};

Manager.prototype.broadcast = function(or, and, not, flt) {
  var bcast = new Broadcast(or, and, not, flt);
  bcast.manager = this;
  return bcast;
};

/**
 * 
 * Broadcast helper
 * 
 */

function Broadcast(to, only, except, flt) {
  this.filter = {};
  this.to(to);
  this.only(only);
  this.except(except);
  this.custom(flt);
  return this;
}

Broadcast.prototype.to = function(to) {
  // recepient group(s): string denotes single group,
  // array denotes multiple groups
  if (to) this.filter.or = to;
  return this;
};

Broadcast.prototype.only = function(and) {
  // list of groups to intersect
  if (and) this.filter.and = and;
  return this;
};

Broadcast.prototype.except = function(not) {
  // list of groups to exclude
  if (not) this.filter.not = not;
  return this;
};

Broadcast.prototype.custom = function(flt) {
  // optional name of final filtering function
  // N.B. define these functions in `this.filters` hash
  if (flt) this.filter.flt = flt;
  return this;
};

Broadcast.prototype.emit = function(event, payload) {
  // vanilla broadcast fields
  var message = {
    // event name
    event: event,
    // data
    payload: payload
  };
  // apply filter, if any
  if (this.filter) {
    message.filter = this.filter;
    // reset used filter
    delete this.filter;
  }
  // publish event to corresponding channel
  var s = codec.encode(message);
//console.log('EMIT', event, message.filter);
  // FIXME: consider returning publish return value
  // to support kinda "source quench" to not flood the channel
  this.manager.db.publish(event, s);
  return this;
};

/**
 * 
 * POC code
 * 
 */

//
// dumb independent workers
//
var m1 = new Manager(1000);
var m2 = new Manager(2000);
var m3 = new Manager(3000);
var m4 = new Manager(4000);

//
// testing broadcasts
//
var payload = '0'; for (var i = 0; i < 2; ++i) payload += payload;
redis.multi([
  ['flushall'],
  // test groups
  ['sadd', 'c:1', 'c:1'], // N.B. client is a group as well
  ['sadd', 'g:all', 'c:1', 'c:2', 'c:3', 'c:4'],
  ['sadd', 'g:1allies', 'c:2', 'c:3', 'c:4'],
  ['sadd', 'g:jslovers', 'c:1', 'c:3'],
  ['sadd', 'g:banned', 'c:3']
]).exec(function() {

  function cc(mgr, id) {
    var client = mgr.client(id);
    client.on('//tick', function() {
      console.log('TICK for client', mgr.id + ':' + id);
    });
    return client;
  }

  var c1 = cc(m1, 'c:1');
  var c2 = cc(m2, 'c:2');
  var c3 = cc(m3, 'c:3');
  var c4 = cc(m4, 'c:4');
  setInterval(function() {
    // this should result in pushing to client 1 only
    // as ([1] + [2, 3, 4]) * [1, 3] - [3] === [1]
    c1.broadcast(['c:1', 'g:1allies'], ['g:jslovers'], ['g:banned']).emit('//tick', {foo: payload});
  }, 1000);
  setInterval(function() {
    // this should result in pushing to clients 1, 2, 4
    // as [1] + [2, 3, 4] - [3] === [1, 2, 4]
    c2.broadcast().to(['c:1', 'g:1allies']).except(['g:banned']).emit('//tick', {foo: payload});
  }, 1100);
  setInterval(function() {
    // this should result in pushing to all clients 1, 2, 3, 4
    m4.broadcast().emit('//tick', {foo: payload});
  }, 1200);
});
