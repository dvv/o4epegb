'use strict';

/*!
 *
 * Connection
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

var createHash = require('crypto').createHash;

/**
 * Send WebSocket frame
 *
 * @api private
 */

require('net').Socket.prototype.send = function(data) {
console.log('NET.Socket#send', data);
  if (this.writable) try {
    this.write('\u0000' + data + '\uffff', 'binary');
  } catch(err) {
    this.end();
  }
  return this;
};

/**
 * Handler for 'upgrade' event of an HTTP server
 */

module.exports = function(req, socket, head) {

  // FIXME: we don't have `res`
  function fail(err) {
console.error('FAIL', err && err.stack);
    socket.write('500\r\n\r\n', 'utf8');
    socket.end();
  }

  // check validity
  if (req.method === 'GET' && req.headers.upgrade !== 'WebSocket') {
    fail();
    return;
  }

  var origin = req.headers.origin;
  var location = (socket.encrypted ||
    (origin && origin.substring(0, 6) === 'https:') ? 'wss' : 'ws')
    + '://' + req.headers.host + req.url

  // analyse request headers, prepare response headers
  if (req.headers['sec-websocket-key1']) {
    var headers = [
        'HTTP/1.1 101 WebSocket Protocol Handshake'
      , 'Upgrade: WebSocket'
      , 'Connection: Upgrade'
      , 'Sec-WebSocket-Origin: ' + origin
      , 'Sec-WebSocket-Location: ' + location
    ];
    if (req.headers['sec-websocket-protocol']){
      headers.push('Sec-WebSocket-Protocol: '
        + req.headers['sec-websocket-protocol']);
    }
  } else {
    var headers = [
        'HTTP/1.1 101 Web Socket Protocol Handshake'
      , 'Upgrade: WebSocket'
      , 'Connection: Upgrade'
      , 'WebSocket-Origin: ' + origin
      , 'WebSocket-Location: ' + location
    ];
  }

  // setup socket
  try {
    // disable encoding
    socket.setEncoding('binary');
    // disable Nagle's algorithm
    socket.setNoDelay(true);
    // write handshake headers
    socket.write(headers.concat('', '').join('\r\n'));
    // FIXME: do we really need keep-alive packets?
    socket.setKeepAlive(true, 0);
    // N.B. net.Socket coming from http.Server has implicit 'timeout'
    // handler already, which destroys the socket.
    // We could purge previous handlers and add ours one, but it would
    // fire only once, hence 'timeout' event is not suitable for
    // implementing heartbeats
    socket.setTimeout(0);
  } catch(err) {
    fail(err);
    return;
  }

  // ensure nonce has arrived (e.g. HAProxy compatibility)
  req.head = '';
  socket.on('data', function waitForNonce(data) {
    var self = this;
    req.head += data;
    if (req.head.length < 8) return;
    // remove this listener
    this.removeListener('data', waitForNonce);
    // ack connection
    var k1 = req.headers['sec-websocket-key1'];
    var k2 = req.headers['sec-websocket-key2'];
    if (k1 && k2) {
      var md5 = createHash('md5');
      [k1, k2].forEach(function (k) {
        var n = parseInt(k.replace(/[^\d]/g, ''))
          , spaces = k.replace(/[^ ]/g, '').length;
        if (spaces === 0 || n % spaces !== 0) {
console.error('WARN: Invalid key: "' + k + '".');
          fail();
          return false;
        }
        n /= spaces;
        md5.update(String.fromCharCode(
          n >> 24 & 0xFF,
          n >> 16 & 0xFF,
          n >> 8  & 0xFF,
          n       & 0xFF));
      });
      try {
        md5.update(req.head.substring(0, 8));
        this.write(md5.digest('binary'), 'binary');
      } catch(err) {
        fail(err);
        return;
      }
    }
    // ack complete, put connection into utf8 mode
    this.setEncoding('utf8');
    // pass the rest of buffer (if any) to new listener
    this.buffer = req.head.substring(8);
    delete req.head;
    // upgrade this net.Socket to have WebSocket traits
    this.headers = req.headers;
    this.on('error', handleSocketError);
    this.on('end', handleSocketEnd);
    this.on('close', handleSocketClose);
    this.on('data', handleSocketData);
    // start parser
    this.emit('data');
    /***var self = this;
    setInterval(function(){
      console.log(self.id, self.writable);
    }, 1000);***/
  });
  // feed back data which we already have consumed, if any
  if (head.length) socket.emit('data', head.toString('binary'));

};

/**
 * WebSocket event handlers
 */

/**
 * Handle errors on the socket
 */

// FIXME: do we need this?
// We can use this.server.on('clientError',...) for this.
// BTW, I couldn't get this event fired...
function handleSocketError(err) {
console.log('SOCKET: error', err.stack);
  this.server.emit('wserror', this, err);
}

/**
 * Handle end of socket. Housekeeping
 */

function handleSocketEnd() {
console.log('SOCKET: end');
}

/**
 * Handle closed socket. Housekeeping
 */

function handleSocketClose() {
console.log('SOCKET: close');
  delete this.conn;
}

/**
 * Glue raw incoming data frames into messages
 */

function handleSocketData(data) {
///console.log('SOCKET: data', data);
  if (data) this.buffer += data;
  var chunks = this.buffer.split('\ufffd');
  var count = chunks.length - 1; // last is '' or a partial packet
  for(var i = 0; i < count; i++) {
    var chunk = chunks[i];
    if(chunk[0] === '\u0000') {
      handleSocketMessage.call(this, chunk.slice(1));
    } else {
console.error('Bad framing. Expected null byte as first frame');
      this.end();
      break;
    }
  }
  this.buffer = chunks[count];
}

/**
 * Handle incoming messages
 */

function handleSocketMessage(message) {
  var server = this.server;
  if (!server.conns) server.conns = {};
  var conn;
  var args;
console.log('SOCKET: message', message, Connection.encode(message), this.id, !!conn);
  try {
    // this socket has no bound connection?
    if (!(conn = this.conn)) {
      // `message` is desired connection id
      var id = message;
      // server has such connection?
      conn = server.conns[id];
      if (conn) {
        // replace underlying socket
console.log('REPLACING SOCKET FOR', conn.id);
        // forcibly close the connection's old socket
        conn.socket.end();
        // assign new socket to the connection
        conn.socket = this;
        this.conn = conn;
        // ack that socket is bound to the connection
        this.send(id);
        // flush pending messages
        conn.flush();
      // server doesn't have connection of desired id
      } else {
        // create new connection
console.log('REGISTERING NEW SOCKET FOR', id);
        conn = new Connection(this);
        conn.id = id;
        // authorize socket
        var self = this;
        conn.authorize(this, function(err, id) {
          // authorization failed?
          if (err) {
            // close connection
            conn.close();
          // authorization ok
          } else {
            // ack that socket is bound to the connection
            conn.id = id;
            self.conn = conn;
            self.send(id);
            // register new connection
            server.conns[id] = conn;
            server.emit('wsconnection', conn);
            conn.emit('connect');
            // flush pending messages
            conn.flush();
          }
        });
      }
    // event?
    } else {
      // event?
      if (isArray(args = Connection.decode(message))) {
        // handle orderly disconnect from remote side
        if (args[0] === Connection.SERVICE_CHANNEL + 'close') {
          delete server.conns[conn.id];
          server.emit('wsclose', conn);
          conn.emit('close');
          this.end();
        // other events
        } else {
          server.emit('wsmessage', conn, args);
          conn.emit('message', args);
        }
      // data?
      } else {
        // emit 'data' event
        server.emit('wsdata', conn);
        conn.emit('data', args);
      }
    }
  } catch(e) {
    console.error('ONMESSAGEERR', e.stack, message);
  }
}

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var isArray = Array.isArray;

function now(delta) {
  return Date.now() + (delta || 0);
}

/**
 * Connection constructor
 *
 * @param {net.Socket} Raw socket.
 * @api private
 */

function Connection(socket) {
  this.socket = socket;
  // outgoing message buffer
  // TODO: externalize to redis DB
  this._queue = [];
  this._queue.limit = 1024;
  /***
  // start GC
  var self = this;
  setInterval(function() {
    self.expireStaleOneTimeListeners(now());
  }, Connection.GC_TIMEOUT);
  ***/
}

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

/**
 * Garbage collector interval
 *
 * @api private
 */
Connection.GC_TIMEOUT = 20000;

/**
 * Timeout in ms for purging uncalled one-time event handlers.
 *
 * @api private
 */

Connection.EXPIRE_ACKS_TIMEOUT = 120000;

/**
 * Error to be used as the error parameter for uncalled one-time
 * handlers.
 *
 * @api private
 */

Connection.EXPIRE_ERROR = new Error('Expired');

/**
 * Inherit from EventEmitter
 *
 * @api public
 */

Connection.prototype.__proto__ = process.EventEmitter.prototype;

/***Connection.prototype.expireStaleOneTimeListeners = function(olderThan) {
  if (this._events) for (var n in this._events) {
    var list = this._events[n];
    for (var i = 0, l = list.length; i < l; i++) {
      if (list[i].listener && list[i].expiredAt < olderThan)
        this.emit(n, Connection.EXPIRE_ERROR);
    }
  }
};***/

/**
 * Provide a nonce
 *
 * @api private
 */

Connection.nonce = function() {
  // FIXME: make less guessable
  return Math.random().toString().substring(2);
};

/**
 * Define codec for messages
 *
 * @api private
 */

Connection.encode = JSON.stringify;
Connection.decode = JSON.parse;

/**
 * Orderly close the connection
 *
 * @api public
 */

Connection.prototype.close = function() {
  this.send(Connection.SERVICE_CHANNEL + 'close');
  return this;
};

/**
 * Flag to enqueue quality (high priority) message
 *
 * @api public
 */
Connection.prototype.quality = function() {
  this._queue.quality = true;
  return this;
};

/**
 * Enqueue the arguments to be sent as a message to remote side
 *
 * N.B. we always enqueue, then shedule flushing
 *
 * @api public
 */

Connection.prototype.send = function(/* args... */) {
  var self = this;
  var args = slice.call(arguments);
  var ack = args[args.length - 1];
  // reserve an event for acknowledgement and
  // substitute ack id for ack handler, if any
  if (typeof ack === 'function') {
    var aid = Connection.SERVICE_CHANNEL + Connection.nonce();
    // N.B. we let GC purge expired acks
    this.once(aid, ack, now(Connection.EXPIRE_ACKS_TIMEOUT));
    args[args.length - 1] = aid;
  }
  // do not allow dumb overflow.
  // better to loose messages than dump the server...
  // TODO: lpush/rpush('queue:' + this.id, args);
  // FIXME: more elegant way of quality handling?
  if (this._queue[this._queue.quality ? 'unshift' : 'push'](args)
      >= this._queue.limit) {
    this._queue.slice(-this._queue.limit);
  }
  delete this._queue.quality;
  // shedule flushing
  setTimeout(function() { self.flush(); }, 0);
  return this;
};

/**
 * Try to send all pending messages
 *
 * @api private
 */

Connection.prototype.flush = function() {
  // while have something to flush...
  // TODO: blpop('queue:' + this.id, args);
  while (this._queue.length) {
    // peek the first message from queue
    var args = this._queue[0];
    // try to send the message.
    // break the loop if failed to send (e.g. transport is closed)...
    if (!this.socket || !this.socket.writable ||
        !this.socket.send(Connection.encode(args))) {
      break;
    }
    // message is sent ok. prune the first message
    this._queue.shift();
  }
  return this;
};

/**
 * Safely ack event execution
 *
 * @api public
 */

Connection.prototype.ack = function(aid /*, args... */) {
  // check if `aid` looks like an id for ack function,
  // and send ack event if it does
  if (aid &&
      String(aid).substring(0, Connection.SERVICE_CHANNEL.length)
      === Connection.SERVICE_CHANNEL) {
    this.send.apply(this, arguments);
  }
  return this;
};

/**
 * Authorize the connection
 *
 * N.B. By default auhorizes all connections. Should be overridden by
 * authors.
 *
 * @api public
 */

Connection.prototype.authorize = function(socket, callback) {
  typeof callback === 'function' &&
    callback.call(this, null, this.id || Connection.nonce());
  return this;
};
