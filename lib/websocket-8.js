'use strict';

/*!
 *
 * Connection
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

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
 * @api public
 */

module.exports = Connection;

function Connection(req) {
  this.on('close', handleSocketClose.bind(this));
  this.on('error', handleSocketError.bind(this));
  this.on('message', handleSocketMessage.bind(this));
console.log(new Date(), 'CONNECT', req.httpRequest.headers.cookie);
}

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

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
 * WebSocketConnection: handle incoming messages
 *
 * @api private
 */

function handleSocketMessage(message) {
  if (!message) return;
  // TODO: only utf8 messages so far
  if (message.type !== 'utf8') return;
  message = message.utf8Data;
  if (!message) return;
console.log('INMESSAGE', message);
  var args;
  // FIXME: Connection.decode may throw, that's why try/catch.
  // OTOH, it slows things down. Solution?
  try {
    // event?
    if (isArray(args = Connection.decode(message))) {
      this.emit.apply(this, args);
    // data?
    } else {
      // emit 'data' event
      this.emit('data', args);
    }
  } catch(e) {
    console.error('ONMESSAGEERR', e.stack, message);
  }
}

/**
 * WebSocketConnection: handle errors
 *
 * @api private
 */

function handleSocketError(error) {
console.error('SOCKETERROR', error, this);
};

/**
 * WebSocketConnection: handle close event
 *
 * @api private
 */

function handleSocketClose() {
console.log(new Date(), 'DISCONNECT');
}

/**
 * Flag to apply expiry timeout to following adjacent #send()
 *
 * @api public
 */

Connection.prototype.expire = function(msecs) {
  this._expire = msecs;
  return this;
};

/**
 * Send a message to remote side
 *
 * N.B. we use internal WebSocketConnection outgoing queue
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
    this.once(aid, ack);
    // we let `this.expire` control expiry on this ack.
    if (this._expire) {
      setTimeout(function() {
        self.emit(aid, new Error('expired'));
      }, this._expire);
      delete this._expire;
    }
    args[args.length - 1] = aid;
  }
  this.sendUTF(Connection.encode(args));
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
 * Augment WebSocketConnection with Connection methods
 */

var WebSocketConnection = require('WebSocket-Node/lib/WebSocketConnection');
for (var i in Connection.prototype) {
  WebSocketConnection.prototype[i] = Connection.prototype[i];
}
