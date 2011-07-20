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

function Socket() {
  // message buffer
  this.buffer = [];
  this.buffer.limit = 1024;
  // acknowledgements
  this.acks = {};
}

/**
 * Provide a nonce
 */

Socket.nonce = function() {
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
  ws.onopen = function() {
    self.flushTimeout = 100;
    self.reconnectTimeout = 125;
    self.open = true;
    console.log('OPEN');
    self.flush();
  };
  ws.onclose = function() {
    console.log('CLOSE?', this.open);
    if (self.reconnectTimeout) {
      setTimeout(function() {
        console.log('RECONNECTING');
        self.connect();
      }, self.reconnectTimeout *= 2);
    }
  };
  // TODO: what's the use case?
  ws.onerror = function() {
    console.log('ERROR', arguments);
  };
  ws.onmessage = function(message) {
    console.log('MESSAGE', message);
    try {
      message = self.decode(message.data);
      // handle acknowledgements
      if (message.n === 'ack') {
        var aid = message.a;
        if (self.acks[aid]) {
          self.acks[aid].apply(self, message.p);
          delete self.acks[aid];
        }
      }
    } catch(e) {}
  };
  return this;
};

Socket.prototype.disconnect = function() {
  this.reconnectTimeout = false;
  this.flushTimeout = false;
  this.open = false;
  this.ws.close();
  return this;
};

Socket.prototype.send = function(name, payload) {
  // N.B. we always buffer, then flush
  // do not allow dumb overflow
  if (this.buffer.push(arguments) >= this.buffer.limit) {
    this.buffer.shift();
  }
  // flush the buffer, if we can
  this.flush();
  return this;
};

Socket.prototype.ack = function(aid, result) {
  // FIXME: format
  this.send('ack', {p: result, a: aid});
  return this;
};

Socket.prototype.flush = function() {
  var self = this;
  // have something to flush and transport is open?
  while (this.buffer.length && this.open) {
    // peek the first message from queue
    var args = this.buffer[0];
    var name = args[0];
    var payload = args[1];
    var ack = args[2];
    // acknowledgement is required?
    if (typeof ack === 'function') {
      var aid = Socket.nonce();
      this.acks[aid] = ack;
    }
    // try to send the message
    // failed to send?
    if (!this.ws.send(this.encode({n: name, p: payload, a: aid}))) {
      // prune acknowledgement
      if (aid) {
        delete this.acks[aid];
      }
      // shedule later flush
      if (this.flushTimeout) {
        setTimeout(function() {
          self.flush();
        }, this.flushTimeout);
      }
      // stop flushing at this instant
      break;
    }
    // message is sent ok. prune the first message
    this.buffer.shift();
  }
  return this;
};

// TODO: shim
Socket.prototype.encode = JSON.stringify;
Socket.prototype.decode = JSON.parse;

// export Socket
typeof window !== 'undefined' ?
  window.Socket = Socket :
  module.exports = Socket;

})();
