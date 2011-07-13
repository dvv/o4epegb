'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
*/

var parseUrl = require('url').parse;
var Path = require('path');

// regexp to check for valid IP string
var REGEXP_IP = /^\d{1,3}.\d{1,3}.\d{1,3}.\d{1,3}$/;

//
// fill req.body with object reflecting content of request body
//
module.exports = function setup(options) {

	// setup
	if (!options) options = {};

	// require external parsers
	var Qs = require('qs');
	var Formidable;
	var HTMLParser;

	function parseJSON(data, next) {
		try {
			var r = JSON.parse(data);
			next(null, r);
		} catch (err) {
			next(err);
		}
	}

	function parseQS(data, next) {
		try {
			var r = Qs.parse(data);
			next(null, r);
		} catch (err) {
			next(err);
		}
	}

	function parseHTML(data, next) {
		if (!HTMLParser) HTMLParser = require('htmlparser');
		var handler = new HTMLParser.DefaultHandler(next, {
			ignoreWhitespace: true,
			verbose: false
		});
		var parser = new HTMLParser.Parser(handler);
		parser.parseComplete(data);
	}

	// guess the parser by the first char
	function guess(s, next) {
		// JSON: starts with { or [
		// XML: starts with <
		// urlemcoded: else
		var c = s.charAt(0);
///console.error('GUESS', s);
		(c === '{' || c === '[') ?
			parseJSON(s, next) : (c === '<') ? parseHTML(s, next) :
				(~s.indexOf('=')) ? parseQS(s, next) : next(null, s);
	}

	// parsers for well-known mime
	var parsers = {
		'application/json': parseJSON,
		'text/javascript': parseJSON,
		'application/www-urlencoded': parseQS,
		'application/x-www-form-urlencoded': parseQS,
		'application/xml': guess,
		'text/xml': guess,
		// FIXME: streaming version?
		///'text/html': guess,
		'text/plain': guess
	};

	// handler
	return function(req, res, next) {

		// swallow .. and other URL quirks
		req.url = Path.normalize(req.url);

		// parse URL
		req.uri = parseUrl(req.url);

		// skip leading ? in querystring
		req.uri.search = (req.uri.search || '').substring(1);

		// honor X-Forwarded-For: possibly set by a reverse proxy
		var h;
		if (h = req.headers['x-forwarded-for']) {
			if (REGEXP_IP.test(h)) {
				req.socket.remoteAddress = h;
			}
			// forget the source of knowledge
			delete req.headers['x-forwarded-for'];
		}

		// honor method override
		if (h = req.headers['x-http-method-override']) {
			req.method = h.toUpperCase();
			// forget the source of knowledge
			delete req.headers['x-http-method-override'];
		}

		// bodyful request?
		req.body = {};
///console.log('HEADERS', req.headers);
		// N.B. if method is overridden, any method can contain body
		if (!req.method || req.method === 'POST' || req.method === 'PUT') {

			// get content type. N.B. can't just test equality, charset may be set
			// TODO: req.is()?!
			var type = req.headers['content-type'];
			type = (type) ? type.split(';')[0] : 'application/xml';
///console.log('TYPE', type);

			//
			// parser registered for this content-type?
			//
			if (parsers.hasOwnProperty(type)) {

				// set body encoding
				req.setEncoding('utf8');

				// collect the body
				var body = '';
				var len = options.maxLength;
				req.on('data', function(chunk) {
///console.log('BODYCHUNK', chunk);
					body += chunk;
					// control max body length
					if (body.length > len && len > 0) {
						next(SyntaxError('Length exceeded'));
					}
				});

				// bump on read error
				req.on('error', function(err) {
					next(err);
				});

				// body collected -> parse it at once
				req.on('end', function() {
///console.log('BODYREAD', body);
					if (!body) return next();
					parsers[type](body, function(err, data) {
						if (err) { next(err); return; }
///console.log('BODYPARSED', data);
						req.body = data;
						next();
					});
				});

			//
			// formidable
			//
			} else if (type === 'multipart/form-data') {

				// setup the form reader
				if (!Formidable) Formidable = require('formidable');
				var form = new Formidable.IncomingForm();
				// restrict big non-file parts
				form.maxFieldsSize = options.maxLength || 8192;

				// control ability to upload
				// TODO: current user rights?
				// FIXME: ensure uploadDir exists?
				form.uploadDir = options.uploadDir || 'upload';
				if (false) {
					form.onPart = function(part) {
						//console.log('PART', part);
						if (!part.filename) {
							// let formidable handle all non-file parts
							form.handlePart(part);
						}
					}
				}

				var fields = '';
				var files = {};
				// N.B. intrinsic fields decoder is almost noop
				// so collect all non-file fields and parse them with Qs
				form.on('field', function(name, value) {
					//console.log('FIELD', name, value);
					fields += '&' + name + '=' + value;
				});
				form.on('file', function(name, file) {
					//console.log('FILE', arguments);
					fields += '&' + name + '=' + encodeURIComponent(file.path);
					files[file.path] = file;
				});

				// handle file upload progress
				if (options.onUploadProgress) {
					form.on('fileBegin', function(field, file) {
						options.onUploadProgress(file, false);
						file
						.on('progress', function(received) {
							options.onUploadProgress(file);
						})
						.on('end', function() {
							options.onUploadProgress(file, true);
						})
					});
				}

				// parse the body
				form.parse(req, function(err) {
					if (err) return next(err);
					// parse collected fields as querystring
					req.body = Qs.parse(fields.substring(1));
					// uploaded files hash
					req.files = files;
					//console.log('FORM', req.body, req.files);
					//return res.send(arguments);
					next();
				});

			//
			// htmlparser
			//
			} else if (type === 'text/html') {

				// setup the parser
				if (!HTMLParser) HTMLParser = require('htmlparser');
				var html = new HTMLParser.DefaultHandler(function(err, dom) {
					if (err) return next(err);
//console.error(dom);
					req.body = dom;
					next();
				}, {
					ignoreWhitespace: true,
					verbose: false
				});

				// parse
				var parser = new HTMLParser.Parser(html);
				req.on('data', function(chunk) {
//console.log(chunk.toString('utf8'));
					parser.parseChunk(chunk);
				});
				req.on('error', function(err) {
					parser.done();
				});
				req.on('end', function() {
					parser.done();
				});

			//
			// unsupported content-type. skip
			//
			} else {
				next();
			}

		} else {
			return next();
		}

	};

};
