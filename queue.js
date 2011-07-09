'use strict';

var redis = require('redis').createClient();
var codec = require('bison'); // should provide .encode/.decode

// hash of client sockets
var handshaken = {};

// hash of custom filtering functions
var filters = {
  // e.g.
  foo: function(id) { return handshaken[id] && handshaken[id].foo === 'foo'; }
};

//
// FIXME: should be redis set? client:CID {socket:SID, socket:SID, ...}
//
function getListOfSocketsForClient(cid) {
  // N.B. we express return duplicates to check logic
  return [1000 + +cid, 1000 + +cid];
}

//
// stub for transport
// N.B. should always buffer data until transport is writeable
//
function getTransportForSocket(sid) {
  return {
    write: function(x) {
      console.log('WRITE to', sid);//, x);
	}
  };
}

function Socket(cid) {
  this.cid = cid;
}

Socket.prototype.broadcast = function(to, only, except) {
  this.or = to;
  this.and = only;
  this.not = except;
  return this;
};

Socket.prototype.filter = function(name) {
  this.filter = name;
  return this;
};

Socket.prototype.emit = function(event, payload) {
  var s = codec.encode({
    // client sending the message
    who: this.cid,
    // recepients: string denotes single group, array denotes multiple groups
    or: this.or,
    // list of clients to intersect
    and: this.and,
    // list of clients to exclude
    not: this.not,
    // optional named filtering. N.B. such should be exposed in `filter` hash
    filter: this.filter,
    // original message
    payload: payload
  });
  redis.publish('timeline', s);
  return this;
};

function sub(channel, message) {
  message = codec.decode(message);
  var commands = [];
  // short-circuit for simple cases
  if (!message.or) {
    commands.push(['smembers', 'g:all']);
  } else if (typeof message.or === 'string') {
    commands.push(['smembers', message.or]);
  } else {
    var tempSetName = 'TODO:unique,maybe,a,join,of,message.or';
    commands.push(['sunionstore', tempSetName].concat(message.or));
    if (message.and) {
      commands.push(['sinterstore', tempSetName, tempSetName].concat(message.and));
    }
    if (message.not) {
      commands.push(['sdiffstore', tempSetName, tempSetName].concat(message.not));
    }
    // TODO: once we find a way to encode and/or/not in resonable short string
    // we can use it as resulting set name and set expire on resulting set and reuse it.
    //redis.expire(tempSetName, 1); // valid for 1 second
    commands.push(['smembers', tempSetName]);
  }
//console.log('COMMANDS', commands);
  redis.multi(commands).exec(function(err, results) {
    // FIXME: until we don't use expiry, we free resulting set immediately
    if (tempSetName) redis.del(tempSetName);
    // error means we are done, no need to bubble
    if (err) return;
    // get resulting set members
    // N.B. redis set operations guarantee we have no duplicates on client level
    var cids = results[results.length - 1];
//console.log('CIDS', cids);
    // apply custom filter, if any
    // N.B. this is very expensive option since we have to dereference client data given cid
    // FIXME: can this data ever be obtained async?
    var fn;
    if (message.filter && (fn = filters[message.filter])) {
      cids = cids.filter(fn);
    }
    // N.B. maintaining unique array is much more painful than using hash
    var sids = {};
    for (var i = 0, l = cids.length; i < l; ++i) {
      // N.B. client to sockets mapping is left purely to worker
      var sockets = getListOfSocketsForClient(cids[i]);
      for (var j = 0; j < sockets.length; ++j) {
        sids[sockets[j]] = true;
      }
    }
    cids = null;
    // distribute payload to relevant sockets
    for (var i in sids) {
      // N.B. transport is lower level
      getTransportForSocket(i).write(payload);
    }
    sids = null;
  });
}

//
// sub
//
var spoke = require('redis').createClient();
spoke.subscribe('timeline'); spoke.on('message', sub);

//
// pub
//
var payload = '0'; for (var i = 0; i < 8; ++i) payload += payload;
redis.multi([
  ['flushall'],
  ['sadd', 'c:dvv', 1],
  ['sadd', 'g:dvvallies', 2, 3, 4],
  ['sadd', 'g:jslovers', 1, 3],
  ['sadd', 'g:banned', 3]
]).exec(function() {
  var socket = new Socket('c:dvv');
  setInterval(function() {
    // this should result in pushing to client 1 only
    // as ([1] + [2, 3, 4]) * [1, 3] - [3] === [1]
    socket.broadcast(['c:dvv', 'g:dvvallies'], ['g:jslovers'], ['g:banned']).emit('tick', {foo: payload});
  }, 1000);
  setInterval(function() {
    // this should result in pushing to clients 1, 2, 4
    // as [1] + [2, 3, 4] - [3] === [1, 2, 4]
    socket.broadcast(['c:dvv', 'g:dvvallies'], null, ['g:banned']).emit('tick', {foo: payload});
  }, 1100);
});
