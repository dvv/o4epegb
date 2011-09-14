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
 * Handle incoming messages
 */

function handleSocketMessage(message) {
  var server = this.server;
  if (!server.conns) server.conns = {};
  var conn;
  var args;
console.log('SOCKET: message', message, Connection.encode(message), this.id, !!conn);
  try {
    // this socket has no bound connection?
    if (!(conn = this.conn)) {
      // `message` is desired connection id
      var id = message;
      // server has such connection?
      conn = server.conns[id];
      if (conn) {
        // replace underlying socket
console.log('REPLACING SOCKET FOR', conn.id);
        // forcibly close the connection's old socket
        conn.socket.end();
        // assign new socket to the connection
        conn.socket = this;
        this.conn = conn;
        // ack that socket is bound to the connection
        this.send(id);
        /// flush pending messages
        ///conn.flush();
      // server doesn't have connection of desired id
      } else {
        // create new connection
console.log('REGISTERING NEW SOCKET FOR', id);
        conn = new Connection(this);
        conn.id = id;
        // authorize socket
        var self = this;
        conn.authorize(this, function(err, id) {
          // authorization failed?
          if (err) {
            // close connection
            conn.close();
          // authorization ok
          } else {
            // ack that socket is bound to the connection
            conn.id = id;
            self.conn = conn;
            self.send(id);
            // register new connection
            conn.add();
            /// flush pending messages
            ///conn.flush();
          }
        });
      }
    // event?
    } else {
      // event?
      if (isArray(args = Connection.decode(message))) {
        // handle orderly disconnect from remote side
        if (args[0] === Connection.SERVICE_CHANNEL + 'close') {
          conn.remove();
        // ordinary events
        } else {
          conn.emit.apply(conn, args);
        }
      // data?
      } else {
        // emit 'data' event
        conn.emit('data', args);
      }
    }
  } catch(e) {
    console.error('ONMESSAGEERR', e.stack, message);
  }
}

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var isArray = Array.isArray;

function now(delta) {
  return Date.now() + (delta || 0);
}

/**
 * Connection constructor
 *
 * @param {net.Socket} Raw socket.
 * @api private
 */

function Connection(socket) {
}

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

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
  this.send(Connection.SERVICE_CHANNEL + 'close');
  return this;
};

/**
 * Flag to apply expiry timeout to following adjacent #send()
 *
 * @api public
 */

Connection.prototype.expire = function(msecs) {
  this.expire = msecs;
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
    if (this.expire) {
      setTimeout(function() {
        self.emit(aid, new Error('expired'));
      }, this.expire);
      delete this.expire;
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

module.exports = Connection;
