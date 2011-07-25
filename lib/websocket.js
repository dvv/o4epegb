'use strict';

/*!
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
    socket.write('500\r\n', 'utf8');
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

  // send response headers.
  // setup socket
  try {
    socket.setEncoding('binary');
    socket.setNoDelay(true);
    socket.write(headers.concat('', '').join('\r\n'));
    socket.setTimeout(0);
    socket.setKeepAlive(true, 0);
    // FIXME: doesn't help :(
    socket.allowHalfOpen = false;
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
    this.pos = 0;
    delete req.head;
    // upgrade this net.Socket to have WebSocket traits
    this.headers = req.headers;
    this.on('close', onClose);
    this.on('end', onEnd);
    this.on('timeout', onTimeout);
    this.on('error', handleSocketError);
    this.on('data', handleSocketData);
    // start parser
    this.emit('data', '');
    /***var self = this;
    setInterval(function(){
      console.log(self.id, self.writable);
    }, 1000);***/
  });
  // feed back data which we already have consumed, if any
  if (head.length) socket.emit('data', head.toString('binary'));

};

function handleSocketData(data) {
///console.log('SOCKET: data', data);
  if (data) this.buffer += data;
  for (var i = this.pos, chr, l = this.buffer.length; i < l; i++) {
    chr = this.buffer[i];
    if (i === 0) {
      if (chr === '\u0000') continue;
      handleSocketError.call(this,
        'Bad framing. Expected null byte as first frame');
      this.buffer = '';
      this.pos = 0;
    }
    if (chr === '\ufffd'){
      handleSocketMessage.call(this, this.buffer.substr(1, i - 1));
      this.buffer = this.buffer.substring(i + 1);
      this.pos = 0;
      return handleSocketData.call(this);
    }
  }
}

function handleSocketError(err) {
///console.log('SOCKET: error', err.stack);
  this.end();
  this.server.emit('wserror', this, err);
}

/**
 * Connection
 */

function handleSocketMessage(message) {
console.log('SOCKET: message', message);
  if (message && !this.id) {
    var id = message;
    // TODO: validate!
    this.send(Connection.encode(['authorized', id]));
///
    // emit connection event
    this.id = id;
    if (!this.server.conns) this.server.conns = {};
    var conn = this.server.conns[this.id];
    if (!conn) {
      this.server.conns[this.id] = conn = new Connection(this);
      this.server.emit('wsconnection', conn);
    } else {
      conn._s.end();
    }
///
    return;
  }
  try {
    var args = Connection.decode(message);
    if (isArray(args)) {
      // event with manual ack?
      var aid = args[args.length - 1];
      if (aid &&
          String(aid).substring(0, Connection.SERVICE_CHANNEL.length)
          === Connection.SERVICE_CHANNEL) {
        // translate ack id into a normal function
        args[args.length - 1] = this.conn.send.bind(this.conn, aid);
      }
      if (args[0] === Connection.SERVICE_CHANNEL + 'disconnect') {
        this.end();
      }
      this.server.emit('wsmessage', this, args);
    }
  } catch(e) {}
}

function onEnd() {
console.log('SOCKET: end', this.id);
}

function onClose(hadError) {
console.log('SOCKET: close', this.id);
  delete this.server.conns[this.id];
  this.server.emit('wsclose', this);
}

function onTimeout() {
console.log('SOCKET: timeout');
}

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var isArray = Array.isArray;

/**
 * Connection constructor
 *
 * @param {net.Socket} Raw socket.
 * @api private
 */

function Connection(socket) {
  this._s = socket;
  // outgoing message buffer
  // TODO: externalize to redis DB
  this._queue = [];
  this._queue.limit = 1024;
}

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

/**
 * Timeout in ms for expiration of uncalled remote events
 *
 * @api private
 */

Connection.EXPIRE_STALE_ACKS = 120000;

/**
 * Inherit from EventEmitter
 *
 * @api public
 */

Connection.prototype.__proto__ = process.EventEmitter.prototype;

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
console.log('CONN: close');
  try {
    this._s.write('\uffff\u0000', 'binary');
  } catch(err) {}
  this._s.end();
  this._s.server.emit('wsclose', this);
  return this;
};

/**
 * Enqueue the arguments to be sent as a message to remote side
 *
 * N.B. we always enqueue, then shedule flushing
 *
 * @api public
 */

Connection.prototype.send = function() {
  var self = this;
  var args = slice.call(arguments);
  var ack = args[args.length - 1];
  // reserve an event for acknowledgement and
  // substitute ack id for ack handler, if any
  if (typeof ack === 'function') {
    var aid = Connection.SERVICE_CHANNEL + Connection.nonce();
    this.once(aid, ack);
    // expire stale acks
    if (Connection.EXPIRE_STALE_ACKS) {
      setTimeout(function() {
        self.removeAllListeners(aid);
      }, Connection.EXPIRE_STALE_ACKS);
    }
    args[args.length - 1] = aid;
  }
  // do not allow dumb overflow.
  // better to loose messages than dump the server...
  if (this._queue.push(args) >= this._queue.limit) {
    this._queue.slice(this._queue.limit);
  }
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
  while (this._queue.length) {
    // peek the first message from queue
    var args = this._queue[0];
    // try to send the message.
    // break the loop if failed to send (e.g. transport is closed)...
    if (!this._s || !this._s.writable ||
        !this._s.send(Connection.encode(args))) {
      break;
    }
    // message is sent ok. prune the first message
    this._queue.shift();
  }
  return this;
};

