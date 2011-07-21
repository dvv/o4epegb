/*!
 *
 * Bare socket
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

(function(exports, undefined) {
'use strict';

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;

var isArray = Array.isArray || function (obj) {
  return Object.prototype.toString.call(obj) === '[object Array]';
};

var nativeBind = Function.prototype.bind;
function bind(func, obj) {
	if (func.bind === nativeBind && nativeBind) {
		return nativeBind.apply(func, slice.call(arguments, 1));
	}
	var args = slice.call(arguments, 2);
	return function() {
		return func.apply(obj, args.concat(slice.call(arguments)));
	};
}

exports.dump = function() {
  console.log('DUMP', arguments);
};

/**
 * Socket constructor
 *
 * @param {String} [url] URL to connect to.
 * @api private
 */

exports.Socket = Socket;

function Socket(url) {
  // use provided URL or guess one
  this.url = url || window.location.href.replace(/^http/, 'ws');
  // outgoing messages queue
  this._queue = [];
  this._queue.limit = 1024;
}

/**
 * Prefix reserved for acknowledgement events
 *
 * @api private
 */

Socket.ACK_EVENT_PREFIX = '_ack_';

/**
 * EventEmitter simplified interface
 *
 * @api public
 */

Socket.prototype.on = function(name, fn) {
  if (!this._events) this._events = {};
  this._events[name] = (this._events[name] || []).concat(fn);
  return this;
};
Socket.prototype.addListener = Socket.prototype.on;

Socket.prototype.once = function(name, fn) {
  var self = this;
  function on() {
    self.removeListener(name, on);
    fn.apply(this, arguments);
  }
  on.listener = fn;
  return this.on(name, on);
};

Socket.prototype.removeListener = function(name, fn) {
  var list;
  if (this._events && (list = this._events[name])) {
    for (var i = 0, l = list.length; i < l; i++) {
      if (list[i] === fn || (list[i].listener && list[i].listener === fn)) {
        list.splice(i, 1);
        if (!list.length) delete this._events[name];
        break;
      }
    }
  }
  return this;
};

Socket.prototype.removeAllListeners = function(name) {
  if (this._events && this._events[name]) {
    this._events[name] = null;
    delete this._events[name];
  }
  return this;
};

Socket.prototype.emit = function(name) {
  var handlers;
  if (!this._events || !(handlers = this._events[name])) return false;
  var args = slice.call(arguments, 1);
  handlers = handlers.slice();
///console.log('EVENT', arguments, handlers, args);
  for (var i = 0, l = handlers.length; i < l; ++i) {
    handlers[i].apply(this, args);
  }
  return true;
};


/**
 * Provide a nonce
 *
 * @api private
 */

Socket.nonce = function() {
  // FIXME: make it less guessable
  return Math.random().toString().substring(2);
};

/**
 * Define codec for messages
 *
 * @api private
 */

// TODO: shim
Socket.prototype.encode = JSON.stringify;
Socket.prototype.decode = JSON.parse;

/**
 * Establish the connection
 *
 * @api public
 */

Socket.prototype.connect = function() {
  var self = this;
  // prohibit connect() if already connecting
  if (this.connecting) return this;
  // create new WebSocket
  // TODO: hide private stuff into this.ws, and reuse that stuff
  // on reconnecting. This will clean Socket instance
  var ws = this.ws = new WebSocket(this.url);
  this.connecting = true;
  this.emit('connecting');
  //
  // transport opened
  //
  ws.onopen = function() {
    delete self.connecting;
    self.reconnectTimeout = 125;
    ///self.open = true;
    self.emit('connect');
    self.flush();
  };
  //
  // transport closed
  //
  ws.onclose = function() {
    ///self.open = false;
    self.emit('disconnect', !self.reconnectTimeout, arguments);
    if (self.reconnectTimeout) {
      setTimeout(function() {
        self.connect();
      }, self.reconnectTimeout *= 2);
    }
  };
  //
  // transport errored
  //
  // TODO: what's the use case?
  ws.onerror = function(error) {
    self.emit('error', error);
  };
  //
  // message arrived
  //
  ws.onmessage = function(message) {
///console.log('MESSAGE', message);
    try {
      var args = self.decode(message.data);
    } catch(e) {}
    // N.B. if message is not an array, we just silently fail
    if (isArray(args)) {
      var aid = args[args.length - 1];
      // ack event
      if (aid.substring(0, Socket.ACK_EVENT_PREFIX.length) ===
        Socket.ACK_EVENT_PREFIX) {
        // translate it to normal function
        args[args.length - 1] = bind(self.send, self, aid);
      // handshake event
      } else if (args[0] === 'handshake') {
        this.id = args[1];
      }
      self.emit.apply(self, args);
    }
  };
  return this;
};

/**
 * Close the connection
 *
 * @param {Number} [reconnectTimeout]
 *    If specified, try to reconnect after specified amount of ms.
 *    If omitted, just close the connection.
 *
 * @api public
 */

Socket.prototype.disconnect = function(reconnectTimeout) {
  this.reconnectTimeout = reconnectTimeout > 0;
  this.ws.close();
  return this;
};

/**
 * Enqueue the arguments to be sent as a message to remote side
 *
 * N.B. we always buffer, then flush
 *
 * @api public
 */

Socket.prototype.send = function() {
  // do not allow dumb overflow.
  // better to loose messages than dump the browser.
  if (this._queue.push(slice.call(arguments)) >= this._queue.limit) {
    this._queue.shift();
  }
  // try to flush the buffer
  // FIXME: shouldn't it be called in setTimeout()?
  this.flush();
  return this;
};

/**
 * Try to send all pending messages
 *
 * @api private
 */

Socket.prototype.flush = function() {
  // while have something to flush...
  while (this._queue.length) {
    // peek the first message from queue
    var args = this._queue[0];
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
    this._queue.shift();
  }
  return this;
};

})(this);
