/*!
 *
 * Bare socket
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

(function(undefined) {
'use strict';

var slice = Array.prototype.slice;
var isArray = Array.isArray || function (obj) {
  return Object.prototype.toString.call(obj) === '[object Array]';
};


function Socket() {
  // message buffer
  this.buffer = [];
  this.buffer.limit = 1024;
}

/**
 * Provide a nonce
 */

var nacks = 0;
Socket.nonce = function() {
return ++nacks;
  // FIXME: elaborate
  return Math.random().toString().substring(2);
};

  /***
  // start heartbeat
  var self = this;
  setInterval(function() {
    self.send('');
  }, 15000);
  ***/

Socket.prototype.connect = function() {
  var self = this;
  var ws = this.ws = new WebSocket(
    document.location.href.replace(/^http/, 'ws'));
  this.emit('connecting');
  ws.onopen = function() {
    self.flushTimeout = 100;
    self.reconnectTimeout = 125;
    self.open = true;
    self.emit('connect');
    self.flush();
  };
  ws.onclose = function() {
    self.open = false;
    self.emit('disconnect', !self.reconnectTimeout);
    if (self.reconnectTimeout) {
      setTimeout(function() {
        self.connect();
      }, self.reconnectTimeout *= 2);
    }
  };
  // TODO: what's the use case?
  ws.onerror = function(error) {
    self.emit('error', error);
  };
  ws.onmessage = function(message) {
///console.log('MESSAGE', message);
    try {
      message = self.decode(message.data);
      // N.B. if message is not an array, we just silently fail
      self.emit.apply(self, message);
    } catch(e) {}
  };
  return this;
};

Socket.prototype.disconnect = function() {
  this.reconnectTimeout = false;
  this.flushTimeout = false;
  this.ws.close();
  return this;
};

Socket.prototype.send = function() {
  // N.B. we always buffer, then flush
  // do not allow dumb overflow
  if (this.buffer.push(arguments) >= this.buffer.limit) {
    this.buffer.shift();
  }
  // flush the buffer, if we can
  this.flush();
  return this;
};

Socket.prototype.ack = Socket.prototype.send;

Socket.prototype.flush = function() {
  var self = this;
  // have something to flush and transport is open?
  while (this.buffer.length && this.open) {
    // peek the first message from queue
    var args = this.buffer[0];
    var ack = args[args.length - 1];
    // acknowledgement is required?
    if (typeof ack === 'function') {
      // reserve ack_* event for acknowledgement
      var aid = 'ack_' + Socket.nonce();
      args[args.length - 1] = aid;
    }
    // try to send the message
    // failed to send?
    if (!this.ws.send(this.encode(args))) {
      // shedule later flush
      if (this.flushTimeout) {
        setTimeout(function() {
          self.flush();
        }, this.flushTimeout);
      }
      // stop flushing at this instant
      break;
    }
    // acknowledgement is required?
    if (typeof ack === 'function') {
      // listen to acknowledgement event
      self.once(aid, ack);
    }
    // message is sent ok. prune the first message
    this.buffer.shift();
  }
  return this;
};

// eventing
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
console.log('EVENT', arguments, handlers, args);
  for (var i = 0, l = handlers.length; i < l; ++i) {
    handlers[i].apply(this, args);
  }
  return true;
};

// TODO: shim
Socket.prototype.encode = JSON.stringify;
Socket.prototype.decode = JSON.parse;

// export Socket
typeof window !== 'undefined' ?
  window.Socket = Socket :
  module.exports = Socket;

})();
