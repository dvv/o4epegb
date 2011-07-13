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

module.exports = function setup(options) {

	if (!options) options = {};

	return function handler(req, socket, head) {

    // FIXME: we don't have `res`
    function fail(err) {
console.error('FAIL', err && err.stack);
      //res.writeHead(500);
      //res.end();
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

    // send response headers
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

    // ensure nonce has arrived (HAProxy compatibility)
    req.head = '';
    socket.on('data', function waitForNonce(data) {
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
      // set ordinary listener
      this.on('data', onData);
      // set connection to utf8 encoding after receiving the nonce
      this.setEncoding('utf8');
      // pass the rest of buffer (if any) to new listener
      if (req.head.length > 8) this.emit('data', req.head.substring(8));
      delete req.head;
    });
    // feed back data which we already have consumed, if any
    if (head.length) socket.emit('data', head.toString('binary'));

  };

  function onConnect() {
console.log('CONNECT', arguments);
  }

  function onData() {
console.log('DATA', arguments);
  }

};
