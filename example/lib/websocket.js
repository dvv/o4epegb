'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Handle 'upgrade' event of HTTP server
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
    // create Socket
    Socket.call(this);
    // pass the rest of buffer (if any) to new listener
    this.buffer = req.head.substring(8);
    delete req.head;
    // emit connection event
    this.server.emit('wsconnection', this, req);
    // start parser
    this.emit('data', '');
  });
  // feed back data which we already have consumed, if any
  if (head.length) socket.emit('data', head.toString('binary'));

};

/**
 * WebSocket
 */

function Socket() {
  this.buffer = '';
  this.pos = 0;
  for (var i in Socket.prototype) this[i] = Socket.prototype[i];
  this.on('message', function(message) {
console.log('' + ' received message', message);
    this.server.emit('wsmessage', this, message);
  });
  this.on('disconnect', function(forced) {
console.log('SOCKET: disconnect', forced);
    this.end();
    this.server.emit('wsclose', this, forced);
  });
  this.on('error', function(err) {
console.log('SOCKET: error', err.stack);
    this.end();
    this.server.emit('wserror', this, err);
  });
  this.on('data', function(data) {
console.log('SOCKET: data', data);
    this.buffer += data;
    this.parse();
  });
  this.on('timeout', function() {
console.log('SOCKET: timeout');
    // ???
  });
  this.on('drain', function() {
console.log('SOCKET: drain');
    //this.flush();
  });
};

Socket.prototype.parse = function() {
  for (var i = this.pos, chr, l = this.buffer.length; i < l; i++) {
    chr = this.buffer[i];

    if (this.buffer.length === 2 && this.buffer[1] === '\u0000') {
      this.emit('disconnect', true);
      this.buffer = '';
      this.pos = 0;
      return;
    }

    if (i === 0) {
      if (chr === '\u0000') continue;
      this.emit('error', 'Bad framing. Expected null byte as first frame');
      this.buffer = '';
      this.pos = 0;
    }

    if (chr === '\ufffd'){
      this.emit('message', this.buffer.substr(1, i - 1));
      this.buffer = this.buffer.substring(i + 1);
      this.pos = 0;
      return this.parse();
    }
  }
};

Socket.prototype.send = function(data) {
  this.drained = false;

  var length = Buffer.byteLength(data);
  var buffer = new Buffer(2 + length);

  buffer.write('\u0000', 'binary');
  buffer.write(data, 1, 'utf8');
  buffer.write('\uffff', 1 + length, 'binary');

  try {
    if (this.write(buffer)) {
      this.drained = true;
    }
  } catch (e) {
    this.end();
  }

console.log('' + ' writing', data);
  return this;
};

Socket.prototype.disconnect = function() {
  //if (this.state === Client.STATUS_READY) {
    this.write('\xff\x00', 'binary');
  //}
  return this;
};
