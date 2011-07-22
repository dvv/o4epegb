/*!
 *
 * Connection
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
var toString = Object.prototype.toString;

var isArray = Array.isArray || function(obj) {
  return toString.call(obj) === '[object Array]';
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
 * Connection constructor
 *
 * @param {String} [url] URL to connect to.
 * @api private
 */

exports.Connection = Connection;

function Connection(url) {
  // use provided URL or guess one
  this.url = (url || window.location.href).replace(/^http/, 'ws');
  // outgoing messages queue
  this._queue = [];
  this._queue.limit = 1024;
}

/**
 * Prefix reserved for acknowledgement events
 *
 * @api private
 */

Connection.ACK_EVENT_PREFIX = '_ack_';

/**
 * EventEmitter simplified interface
 *
 * @api public
 */

Connection.prototype.on = function(name, fn) {
  if (!this._events) this._events = {};
  this._events[name] = (this._events[name] || []).concat(fn);
  return this;
};
Connection.prototype.addListener = Connection.prototype.on;

Connection.prototype.once = function(name, fn) {
  var self = this;
  function on() {
    self.removeListener(name, on);
    fn.apply(this, arguments);
  }
  on.listener = fn;
  return this.on(name, on);
};

Connection.prototype.removeListener = function(name, fn) {
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

Connection.prototype.removeAllListeners = function(name) {
  if (this._events && this._events[name]) {
    this._events[name] = null;
    delete this._events[name];
  }
  return this;
};

Connection.prototype.emit = function(name) {
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

Connection.nonce = function() {
  // FIXME: make it less guessable
  return Math.random().toString().substring(2);
};

/**
 * Define codec for messages
 *
 * @api private
 */

// TODO: shim
Connection.encode = JSON.stringify;
Connection.decode = JSON.parse;

/**
 * Establish the connection
 *
 * @api public
 */

Connection.prototype.open = function() {
  var self = this;
  // prohibit open() if already opening
  if (this.ws && this.ws.readyState === this.ws.CONNECTING) return this;
  // create new WebSocket, copying properties from old WebSocket, if any
  if (this.ws) {
    var oldws = this.ws;
    this.ws = new WebSocket(oldws.URL);
    if (oldws.id) this.ws.id = oldws.id;
    this.ws.reconnectTimeout = oldws.reconnectTimeout;
  } else {
    this.ws = new WebSocket(this.url);
    delete this.url;
  }
  this.emit('connecting');
  //
  // transport opened
  //
  this.ws.onopen = function() {
    this.reconnectTimeout = 125;
    this.send('_auth:' + (this.id || Connection.nonce()));
  };
  //
  // transport closed
  //
  this.ws.onclose = function() {
    if (this.open) {
      self.emit('disconnect', !this.reconnectTimeout);
      this.open = false;
    }
    if (this.reconnectTimeout) {
      setTimeout(function() {
        self.open();
      }, this.reconnectTimeout *= 2);
    }
  };
  //
  // transport errored
  //
  // TODO: what's the use case?
  this.ws.onerror = function(error) {
    self.emit('error', error);
  };
  //
  // message arrived
  //
  this.ws.onmessage = function(event) {
//console.log('MESSAGE', event.data);
    try {
      var args = Connection.decode(event.data);
      // N.B. if message is not an array, we just silently fail
      if (isArray(args)) {
        var aid = args[args.length - 1];
        // event with manual ack?
        if (aid && aid.substring(0, Connection.ACK_EVENT_PREFIX.length)
            === Connection.ACK_EVENT_PREFIX) {
          // translate ack id into a normal function
          args[args.length - 1] = bind(self.send, self, aid);
        // authorization event?
        } else if (args[0] === 'authorized') {
          // authorized?
          if (args[1]) {
            // save id
            this.id = args[1];
            this.open = true;
            // notify connection is open
            self.emit('connect');
            // flush pending messages
            self.flush();
          // unauthorized?
          } else {
            // just close
            self.close();
          }
        }
        self.emit.apply(self, args);
      }
    } catch(e) {
      console.error('ONMESSAGEERR', e);
    }
  };
  return this;
};

/**
 * Orderly close the connection
 *
 * @api public
 */

Connection.prototype.close = function() {
  if (this.ws) {
    delete this.ws.reconnectTimeout;
    this.send('disconnect');
  }
  return this;
};

/**
 * Close and reopen the connection
 *
 * @param {Number} delay
 *    If specified, delay reopening for specified amount of ms.
 *
 * @api public
 */

Connection.prototype.reopen = function(delay) {
  if (this.ws) {
    this.ws.reconnectTimeout = delay || 100;
    this.ws.close();
  }
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
  // do not allow dumb overflow.
  // better to loose messages than dump the browser...
  if (this._queue.push(slice.call(arguments)) >= this._queue.limit) {
    this._queue.shift();
  }
  // shedule flushing
  var self = this; setTimeout(function() { self.flush(); }, 0);
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
    var ack = args[args.length - 1];
    // reserve an event for acknowledgement and
    // substitute ack id for ack handler, if any
    if (typeof ack === 'function') {
      var aid = Connection.ACK_EVENT_PREFIX + Connection.nonce();
      this.once(aid, ack);
      args[args.length - 1] = aid;
    }
    // try to send the message.
    // break the loop if failed to send (e.g. transport is closed)...
    if (!this.ws || this.ws.readyState !== this.ws.OPEN ||
        !this.ws.send(Connection.encode(args))) {
      break;
    }
    // message is sent ok. prune the first message
    this._queue.shift();
  }
  return this;
};

})(this);
