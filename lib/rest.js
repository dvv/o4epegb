'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

//
// ReST resource routing
//
module.exports = function setup(root, options) {

  var parseUrl = require('url').parse;
  var Fs = require('fs'),
  var Path = require('path');

  // setup
  options = options || {};

  // normalize mount points to always end in /
  if (root[root.length - 1] !== '/') { root += '/'; }

  // whether to PUT /Foo/_new calls Foo.add()
  var brandNewID = options.putNew ? options.putNew : {};

  // handler
  return function handler(req, res, next) {

    // defaults
    if (!req.uri) req.uri = parseUrl(req.url);
    if (!req.body) req.body = {};

    // mount relative to the given root
    var path = req.uri.pathname;
    if (path.substr(0, root.length) !== root) return next();

    // get the requested controller and method
    var parts = path.substr(root.length).split('/').map(function(p) {
      return decodeURIComponent(p);
    });
    // N.B. punt on trailing slash
    if (parts[parts.length - 1] === '') parts.pop();

    //process.log('PARTS', parts);

    // find the resource name/id pair
    var resource = parts[0];
    var id = parts[1];

    //
    // determine the handler method and parameters
    //
    var context = req.context || options.context || {};
    //console.log('CAPS', context, req.session);
    var verb = req.method;
    var method;
    var params;
    //
    // query resource
    //
    if (verb === 'GET') {
      method = 'get';
      // get by ID
      if (id && id !== brandNewID) {
        params = [id];
      // query
      } else {
        method = 'query';
        // bulk get via POST X-HTTP-Method-Override: GET
        if (Array.isArray(req.body)) {
          params = [req.body];
        // query by RQL
        } else {
          params = [req.uri.search];
        }
      }
    //
    // create new / update resource
    //
    } else if (verb === 'PUT') {
      method = 'update';
      if (id) {
        // add new
        if (id === brandNewID) {
          method = 'add';
          params = [req.body];
        // update by ID
        } else {
          params = [id, req.body];
        }
      } else {
        // bulk update via POST X-HTTP-Method-Override: PUT
        if (Array.isArray(req.body) && Array.isArray(req.body[0])) {
          params = [req.body[0], req.body[1]];
        // update by RQL
        } else {
          params = [req.uri.search, req.body];
        }
      }
    //
    // remove resource
    //
    } else if (verb === 'DELETE') {
      method = 'remove';
      if (id && id !== brandNewID) {
        params = [id];
      } else {
        // bulk remove via POST X-HTTP-Method-Override: DELETE
        if (Array.isArray(req.body)) {
          params = [req.body];
        // remove by RQL
        } else {
          params = [req.uri.search];
        }
      }
    //
    // arbitrary RPC to resource
    //
    } else if (verb === 'POST') {
      // if creation is via PUT, POST is solely for RPC
      // if `req.body` has truthy `jsonrpc` key -- try RPC
      if (options.putNew || req.body.jsonrpc) {
        // RPC
        method = req.body.method;
        params = req.body.params;
      // else POST is solely for creation
      } else {
        // add
        method = 'add';
        params = [req.body];
      }
    //
    // unsupported verb
    //
    } else {
    }

    // debug
    //console.log('RPC??', resource, method, params);
    //return res.send([resource, method, params]);

    //
    // find the resource
    //
    // bail out unless resource is found
    if (!Object.prototype.hasOwnProperty.call(context, resource)) {
      return next();
    }
    resource = context[resource];
    // bail out if method is unsupported
    if (!Object.prototype.hasOwnProperty.call(resource, method)) {
      return respond((options.jsonrpc || req.body.jsonrpc) ?
        'notsupported' : 405);
    }
    //
    // call the handler. signature is fn(context, params..., step)
    //
    if (options.passContext) params.unshift(context);
    params.push(respond);
    //console.log('RPC?', params);
    resource[method].apply(null, params);

    //
    // wrap the response to JSONRPC format,
    // if specified by `options.jsonrpc` or `req.body.jsonrpc`
    //
    function respond(err, result) {
      //console.log('RPC!', err, result);
      var response = result;
      if (options.jsonrpc || req.body.jsonrpc) {
        response = {
          result: null,
          error: null,
          //id: req.body.id
        };
        if (err) {
          response.error = err.message || err;
        } else if (result === undefined) {
          response.result = true;
        } else {
          response.result = result;
        }
      // plain response
      } else {
        if (err) {
          res.writeHead(typeof err === 'number' ? err : 406);
          res.end(err.message || String(err));
          return;
        } else if (result === null) {
          res.writeHead(404);
          res.end();
          return;
        }
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(res.fake ? response : JSON.stringify(response));
    }

  };

};
