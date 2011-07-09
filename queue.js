'use strict';

var redis = require('redis').createClient();
var codec = require('bison'); // should provide .encode/.decode

function Namespace(id) {
  this.id = id;
  // clients
  this.clients = {};
  // named filters
  this.filters = {};
}

Namespace.prototype.client = function(id) {
  if (!this.clients[id]) {
    this.clients[id] = new Client(id);
    this.clients[id].space = this;
  }
  return this.clients[id];
};

Namespace.prototype.broadcast = function(or, and, not, flt) {
  this.filter = {
    // sunion
    or: or,
    // sinter
    and: and,
    // sdiff
    not: not,
    // name of the filter, if any
    flt: flt
  };
  return this;
};

Namespace.prototype.publish = function(event, payload) {
  // vanilla broadcast fields
  var message = {
    // namespace
    space: this.id,
    // data
    payload: payload
  };
  // apply filter, if any
  if (this.filter) {
    // recepients: string denotes single group, array denotes multiple groups
    message.or = this.filter.or;
    // list of clients to intersect
    message.and = this.filter.and;
    // list of clients to exclude
    message.not = this.filter.not;
    // optional named filtering. N.B. such should be exposed in `filter` hash
    message.flt = this.filter.flt;
    // reset used filter
    delete this.filter;
  }
  // publish message to corresponding channel
  var s = codec.encode(message);
  redis.publish('bcast:' + this.id, s);
  return this;
};

Namespace.prototype.handleBroadcast = function(cids, message) {
  // apply custom filter, if any
  // N.B. this is very expensive option since we have to dereference client data given cid
  // FIXME: can this data ever be obtained async?
  var fn;
  if (message.flt && (fn = this.filters[message.flt])) {
    cids = cids.filter(fn);
  }
  // distribute payload to relevant clients
  var payload = message.payload;
  for (var i = 0, l = cids.length; i < l; ++i) {
    var client = this.clients[cids[i]];
    if (client) client.handleBroadcast(payload);
  }
};

function Client(id) {
  this.id = id;
  this.sockets = {};
}

Client.prototype.of = function(nsp) {
  if (!nsp) nsp = '';
  // TODO: really use `nsp`
  return this.space;
};

Client.prototype.broadcast = function() {
  return this.space.broadcast.apply(this.space, arguments);
};

Client.prototype.handleBroadcast = function(payload) {
  for (var i in this.sockets) {
    // N.B. transport is lower level
    getTransportForSocket(i).write(message.payload);
  }
  sids = null;
};

function Socket(id) {
  this.id = id;
}

Socket.prototype.write = function(x) {
  console.log('WRITE to', this.id);//, x);
}

function Worker(wid) {
  this.wid = wid;
  var sub = require('redis').createClient();
  sub.psubscribe('*'); sub.on('pmessage', this.handleMessage.bind(this));
  this.db = require('redis').createClient();
  this.namespaces = {};
}

Worker.prototype.of = function(nsp) {
  if (!nsp) nsp = '';
  // TODO: really use nsp
  if (!this.namespaces[nsp]) {
    this.namespaces[nsp] = new Namespace(nsp);
    this.namespaces[nsp].wid = this.wid;
  }
  return this.namespaces[nsp];
};

Worker.prototype.handleMessage = function(pattern, channel, message) {
  var db = this.db;
  // deserialize message
  message = codec.decode(message);
  // retrieve namespace
  // N.B. we don't create namespaces for non-existent names
  // when handling messages
  var nsp = this.namespaces[message.nsp];
  if (!nsp) return;
  //
  // compose list of recipients
  //
  var commands = [];
  // short-circuit for simple cases
  if (!message.or) {
    commands.push(['smembers', 'g:all']);
  } else if (typeof message.or === 'string') {
    commands.push(['smembers', message.or]);
  } else {
    var tempSetName = 'TODO:unique-and-nonce,but,maybe,a,join,of,message.or';
    commands.push(['sunionstore', tempSetName].concat(message.or));
    if (message.and) {
      commands.push(['sinterstore', tempSetName, tempSetName].concat(message.and));
    }
    if (message.not) {
      commands.push(['sdiffstore', tempSetName, tempSetName].concat(message.not));
    }
    // TODO: once we find a way to encode and/or/not in resonable short string
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
    nsp.handleBroadcast(cids, message);
  });
};

//
// dumb independent workers
//
var w1 = new Worker(1000);
w1.of();
var w2 = new Worker(2000);
w2.of();
var w3 = new Worker(3000);
w3.of();
var w4 = new Worker(4000);
w4.of();

//
// testing broadcasts
//
var payload = '0'; for (var i = 0; i < 12; ++i) payload += payload;
redis.multi([
  ['flushall'],
  ['sadd', 'g:all', 1, 2, 3, 4],
  ['sadd', 'c:dvv', 1],
  ['sadd', 'g:dvvallies', 2, 3, 4],
  ['sadd', 'g:jslovers', 1, 3],
  ['sadd', 'g:banned', 3]
]).exec(function() {
  var socket = w1.of().socket('c:dvv');
  setInterval(function() {
    // this should result in pushing to client 1 only
    // as ([1] + [2, 3, 4]) * [1, 3] - [3] === [1]
    socket.of().broadcast(['c:dvv', 'g:dvvallies'], ['g:jslovers'], ['g:banned']).publish('tick', {foo: payload});
  }, 1000);
  setInterval(function() {
    // this should result in pushing to clients 1, 2, 4
    // as [1] + [2, 3, 4] - [3] === [1, 2, 4]
    socket.of().broadcast(['c:dvv', 'g:dvvallies'], null, ['g:banned']).publish('tick', {foo: payload});
  }, 1100);
  setInterval(function() {
    // this should result in pushing to all clients 1, 2, 3, 4
    socket.of().broadcast().publish('tick', {foo: payload});
  }, 1200);
});
