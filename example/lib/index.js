'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

//
// bundled creationix/Stack
//

function errorHandler(req, res, err) {
	if (err) {
		var reason = err.stack || err;
		console.error('\n' + reason + '\n');
		res.writeHead(500, {'Content-Type': 'text/plain'});
		res.end(reason + '\n');
	} else {
		res.writeHead(404, {'Content-Type': 'text/plain'});
		res.end();
	}
};
function Stack(layers) {
	var error = errorHandler;
	var handle = error;
	layers.reverse().forEach(function (layer, index) {
    layer.level = index;
		var child = handle;
		handle = function (req, res) {
			try {
//console.error('LAYER', index, layer.level);
				layer(req, res, function (err) {
//console.error('NEXTCALLED');
					if (err) {
            error(req, res, err);
          } else {
            child(req, res);
          }
				});
			} catch (err) {
				error(req, res, err);
			}
		};
	});
	return handle;
}

module.exports = Stack;

Stack.listen = function(layers, options) {
	if (!options) options = {};
  // create and run HTTP(S) server
	var server = require(options.key ? 'https' : 'http').createServer(Stack(layers), options);
	server.listen.apply(server, Array.prototype.slice.call(arguments, 2));
  // handle WebSocket connections
  if (options.websocket) {
    server.on('upgrade', require('./websocket')(options.websocket));
  }
	return server;
};

Stack.static = require('./static');
Stack.body = require('./body');
Stack.rest = require('./rest');
Stack.health = require('./health');
