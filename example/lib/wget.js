'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
*/

//
// TODO: consider 'request' repo -- just reuse bodyParser
//

var parseUrl = require('url').parse;
var bodyParser = require('./body')();

var proto = {
	'http:': {
		port: 80,
		module: require('http')
	},
	'https:': {
		port: 443,
		module: require('https')
	}
};

function request(method, url, data, headers, next) {
	// defaults
	if (!next) {
		next = headers;
		headers = null;
	}
	if (!headers) {
		headers = {
			accept: '*/*',
			'user-agent': 'wget 1.14',
			'content-type': 'application/x-www-form-urlencoded'
		}
	}
	// compose request params
	var params = parseUrl(url);
	var protocol = params.protocol;
	params = {
		//host: headers.host = params.hostname,
		host: params.hostname,
		port: params.port || proto[protocol].port || 3128,
		path: params.pathname + (params.search ? params.search : ''),
		headers: headers
	};
	// proxy?
	var proxy;
	if (proxy = process.env['' + protocol.replace(/\:$/,'') + '_proxy'] || process.env.http_proxy) {
		proxy = parseUrl(proxy);
		protocol = proxy.protocol;
		params.headers.host = params.host;
		params.port = proxy.port || 80;
		params.host = proxy.hostname;
		params.path = url;
	}
	// set the verb
	params.method = method;
	// stringify data
	if (data) {
		// FIXME: way greedy JSON
		if (typeof data === 'object') {
			data = JSON.stringify(data);
			headers['content-type'] = 'application/json';
		} else {
			data = String(data);
		}
		// set content-length
		headers['content-length'] = data.length;
	}
	//console.log('REQ', params);
	// issue the request
	var req = proto[protocol].module.request(params, function(res) {
		//console.log('WGETRESPONSEHEADERS', res.headers);
		// reuse body middleware to parse the response
		bodyParser(res, null, function(err, result) {
			//console.log('WGETBODY', res.body);
			next(err, res.body);
		});
	});
	// catch errors
	req.on('error', next);
	// send the data, if any
	if (data) {
		req.write(data, 'utf8');
	}
	req.end();
}

module.exports = {
	request: request,
	get: function(url, headers, next) {
		return request('GET', url, null, headers, next);
	},
	post: function(url, data, headers, next) {
		return request('POST', url, data, headers, next);
	}
};
