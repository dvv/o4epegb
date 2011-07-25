/**!
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

function Connection() {
  // outgoing messages queue
  // TODO: implement outgoing async filters
  this._queue = [];
  this._queue.limit = 1024;
}

/**
 * Connection state
 *
 * @api private
 */

Connection.CONNECTING = 0;
Connection.OPEN = 1;
Connection.CLOSED = 2;

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

/**
 * Initial timeout in ms for reconnection attempts. Each failed
 * reconnect attempt doubles the current value.
 */

Connection.RECONNECT_TIMEOUT = 125;

/**
 * Timeout in ms for expiration of uncalled remote events
 *
 * @api private
 */

Connection.EXPIRE_STALE_ACKS = 120000;

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
      if (list[i] === fn ||
         (list[i].listener && list[i].listener === fn)) {
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
 * Socket: handle incoming messages
 *
 * @api private
 */

function handleSocketMessage(event) {
  var message = event.data;
  if (!message) return;
  var self = this;
  var args;
console.log('MESSAGE', message);
  try {
    // authorization?
    if (!this.id) {
      // authorize
      this.conn.authorize(message, function(err, id) {
        self.id = message;
        self.open = true;
        // notify connection is open
        self.conn.emit('connect');
        // flush pending messages
        self.conn.flush();
      });
    // event?
    } else if (isArray(args = Connection.decode(message))) {
      // handle orderly disconnect from remote side
      if (args[0] === Connection.SERVICE_CHANNEL + 'disconnect') {
        this.conn.close();
      // other events
      } else {
        this.conn.emit.apply(this.conn, args);
      }
    // data?
    } else {
      // emit 'data' event
      this.conn.emit('data', args);
    }
  } catch(e) {
    console.error('ONMESSAGEERR', e, message);
  }
}

/**
 * Socket: handle errors
 *
 * @api private
 */

function handleSocketError(error) {
  this.conn.emit('error', error);
};

/**
 * Socket: handle open event
 *
 * @api private
 */

function handleSocketOpen() {
  this.reconnectTimeout = Connection.RECONNECT_TIMEOUT;
  this.send(this.id || Connection.nonce());
};

/**
 * Socket: handle close event
 *
 * @api private
 */

function handleSocketClose() {
  if (this.open) {
    this.conn.emit('disconnect', !this.reconnectTimeout);
    this.open = false;
  }
  if (this.reconnectTimeout) {
    var self = this;
    setTimeout(function() {
      self.conn.open();
    }, this.reconnectTimeout *= 2);
  }
};

/**
 * Establish the connection
 *
 * @api public
 */

Connection.prototype.open = function(url) {
  var self = this;
  // use provided URL or guess one
  if (!url) url = window.location.href.replace(/^http/, 'ws');
  // prohibit open() if already open/opening
  if (this._s && this._s.readyState <= Connection.OPEN) return this;
  // create new WebSocket, copying properties from old WebSocket, if any
  var old_s = this._s;
  this._s = new WebSocket(url);
  if (old_s) {
    // FIXME: just vanilla extend()?
    /*for (var i in old_s) if (old_s.hasOwnProperty(i)) {
      console.log('COPY:', i, old_s[i]);
    }*/
    //for (var i in ['id', 'reconnectTimeout'])
    if (old_s.id)
      this._s.id = old_s.id;
    if (old_s.reconnectTimeout)
      this._s.reconnectTimeout = old_s.reconnectTimeout;
  }
  this.emit('connecting');
  // delegate Socket handlers
  this._s.conn = this;
  this._s.onopen = bind(handleSocketOpen, this._s);
  this._s.onclose = bind(handleSocketClose, this._s);
  this._s.onerror = bind(handleSocketError, this._s);
  this._s.onmessage = bind(handleSocketMessage, this._s);
  return this;
};

/**
 * Orderly close the connection
 *
 * @api public
 */

Connection.prototype.close = function() {
  if (this._s) {
    delete this._s.reconnectTimeout;
    this.send(Connection.SERVICE_CHANNEL + 'disconnect');
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
  if (this._s) {
    this._s.reconnectTimeout = delay || 100;
    this._s.close();
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

Connection.prototype.send = function(/* args... */) {
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
  // better to loose messages than dump the browser...
  if (this._queue.push(args) >= this._queue.limit) {
    this._queue.slice(-this._queue.limit);
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
    if (!this._s || this._s.readyState !== Connection.OPEN ||
        !this._s.send(Connection.encode(args))) {
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

Connection.prototype.authorize = function(secret, callback) {
  if (typeof callback === 'function') callback.call(this, null, secret);
  return this;
};

})(this);
