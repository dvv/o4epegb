'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Handler for 'upgrade' event of an HTTP server
 */

var createHash = require('crypto').createHash;

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
    socket.setKeepAlive(true);
  } catch (err) {
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
console.log('WARN: Invalid key: "' + k + '".');
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
      } catch (err) {
        fail(err);
        return;
      }
    }
    // ack complete, put connection into utf8 mode
    this.setEncoding('utf8');
    // upgrade this net.Socket to have WebSocket traits
    this.buffer = '';
    this.pos = 0;
    this.on('error', onError);
    this.on('data', onData);
    this.send = send;
    // pass the rest of buffer (if any) to new listener
    this.buffer = req.head.substring(8);
    delete req.head;
    // emit connection event
    this.server.emit('wsconnection', new Socket(this), req);
    // start parser
    this.emit('data', '');
  });
  // feed back data which we already have consumed, if any
  if (head.length) socket.emit('data', head.toString('binary'));

};

/**
 * WebSocket
 */

function onMessage(message) {
  this.server.emit('wsmessage', this, message);
}

function onData(plus) {
///console.log('SOCKET: data', plus);
  if (plus) this.buffer += plus;
  for (var i = this.pos, chr, l = this.buffer.length; i < l; i++) {
    chr = this.buffer[i];

    if (this.buffer.length === 2 && this.buffer[1] === '\u0000') {
      onDisconnect.call(this, true);
      this.buffer = '';
      this.pos = 0;
      return;
    }

    if (i === 0) {
      if (chr === '\u0000') continue;
      onError.call(this, 'Bad framing. Expected null byte as first frame');
      this.buffer = '';
      this.pos = 0;
    }

    if (chr === '\ufffd'){
      onMessage.call(this, this.buffer.substr(1, i - 1));
      this.buffer = this.buffer.substring(i + 1);
      this.pos = 0;
      return onData.call(this);
    }
  }
}

function onDisconnect(forced) {
///console.log('SOCKET: disconnect', forced);
  this.end();
  this.server.emit('wsclose', this, forced);
}

function onError(err) {
///console.log('SOCKET: error', err.stack);
  this.end();
  this.server.emit('wserror', this, err);
}

function send(data) {

  // FIXME: really really optimization?!

  var length = Buffer.byteLength(data);
  var buffer = new Buffer(2 + length);

  buffer.write('\u0000', 'binary');
  buffer.write(data, 1, 'utf8');
  buffer.write('\uffff', 1 + length, 'binary');

  this.write(buffer);

console.log('SOCKET#send', data);
  return this;
}

/***
function close() {
  //if (this.state === Client.STATUS_READY) {
    this.write('\xff\x00', 'binary');
  //}
  return this;
};
***/

var slice = Array.prototype.slice;
var isArray = Array.isArray;

function Socket(raw) {
  this.ws = raw;
  ///this.id = Math.random().toString().substring(2);
  ///this.send(JSON.stringify(['handshake', this.id]));
  // message buffer
  this.buffer = [];
  this.buffer.limit = 1024;
}

Socket.ACK_EVENT_PREFIX = 'ack_';

Socket.prototype.__proto__ = process.EventEmitter.prototype;

/**
 * Provide a nonce
 */

var nacks = 0;
Socket.nonce = function() {
return ++nacks;
  // FIXME: elaborate
  return Math.random().toString().substring(2);
};

Socket.prototype.encode = JSON.stringify;
Socket.prototype.decode = JSON.parse;

Socket.prototype.send = function() {
  // N.B. we always buffer, then flush
  // do not allow dumb overflow
  if (this.buffer.push(slice.call(arguments)) >= this.buffer.limit) {
    this.buffer.shift();
  }
  // flush the buffer, if we can
  this.flush();
  return this;
};

Socket.prototype.flush = function() {
  // while have something to flush...
  while (this.buffer.length) {
    // peek the first message from queue
    var args = this.buffer[0];
    var ack = args[args.length - 1];
    // reserve an event for acknowledgement and
    // substitute ack id for ack handler, if any
    if (typeof ack === 'function') {
      var aid = Socket.ACK_EVENT_PREFIX + Socket.nonce();
      this.once(aid, ack);
      args[args.length - 1] = aid;
    }
    // try to send the message.
    // break the loop if failed to send (e.g. transport is closed)...
    if (!this.ws || !this.ws.send(this.encode(args))) break;
    // message is sent ok. prune the first message
    this.buffer.shift();
  }
//console.log('FLUSH', this.buffer.length);
  return this;
};

