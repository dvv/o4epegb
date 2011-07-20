'use strict';

global._ = require('underscore');
require('underscore-data');

var Proto = require('mongolian/lib/collection').prototype;
Proto.__proto__ = process.EventEmitter.prototype;

var _find = Proto.find;
Proto.find = function(query) {
  // parse the query
  var qry = _.rql(query).toMongo();
  // get the cursor
  var cursor = _find.call(this, qry.search, qry.meta.fields);
  // tune the cursor
  qry.meta.skip && cursor.skip(qry.meta.skip);
  // N.B. we force no more than 100 records at once
  var limit = Math.min(qry.meta.limit || 100, 100);
  cursor.limit(limit);
  qry.meta.sort && cursor.sort(qry.meta.sort);
  return cursor;
};

Proto.query = function(query, callback) {
  // employ find
  this.find(query).toArray(function(err, docs) {
    // adjust ids
    if (docs) {
      for (var i = 0, l = docs.length; i < l; i++) {
        var doc = docs[i];
        doc.id = doc._id;
        delete doc._id;
      }
    }
    // allow continuation
    typeof callback === 'function' && callback(err, docs);
  });
  // allow chaining
  return this;
};

Proto.get = function(id, callback) {
  // compose the query and employ findOne
  if (typeof id === 'string') id = [id];
  this.findOne(id, function(err, doc) {
    // adjust id
    if (doc) {
      doc.id = doc._id;
      delete doc._id;
    }
    // allow continuation
    typeof callback === 'function' && callback(err, doc || null);
  });
  // allow chaining
  return this;
};

Proto.schema = function(schema) {
  this._schema = schema;
  return this;
};

var _insert = Proto.insert;
Proto.insert = function(document, callback) {
  // accept only objects
  if (Object(document) !== document) {
    typeof callback === 'function' && callback(406);
    return this;
  }
  var self = this;
  // make sync validation
  this.emit('beforeInsert', document);
  if (document.$stop) {
    typeof callback === 'function' && callback(403);
    return this;
  }
  // assign id if one is missing
  document._id = document.id;
  delete document.id;
  // call db method
  _insert.call(this, document, function(err, result) {
    self.emit('afterInsert', err, result);
    // adjust id
    if (result) {
      result.id = result._id;
      delete result._id;
    }
    // allow continuation
    typeof callback === 'function' && callback(err || null, result);
  });
  // allow chaining
  return this;
  /***
  var schema = this._schema; delete this._schema;
  if (schema) {
    _.validate.call(context, document, schema, {
      veto: true,
      removeAdditionalProps: !schema.additionalProperties,
      flavor: 'add',
      coerce: true
    }, function(err, validated) {
      if (err) {
        callback(err);
      } else {
        document = validated;
        _insert.apply(this, arguments);
      }
    });
  } else {
    _insert.apply(this, arguments);
  }***/
};

var _update = Proto.update;
Proto.update = function(query, changes, upsert, multi, callback) {
  // accept only objects
  if (Object(changes) !== changes) {
    typeof callback === 'function' && callback(406);
    return this;
  }
  // parse the query
  var self = this;
  query = _.rql(query).toMongo().search;
  // make sync validation
  this.emit('beforeUpdate', changes, query);
  if (query.$stop) {
    typeof callback === 'function' && callback(403);
    return this;
  }
  // wrap the changes
  if (multi && !changes.$set) {
    query.$atomic = 1;
    delete changes.id; delete changes._id;
    changes = {$set: changes};
  }
  // call db method
  _update.call(this, query, changes, upsert, multi, function(err) {
    self.emit('afterUpdate', err);
    // allow continuation
    typeof callback === 'function' && callback(err || null);
  });
  // allow chaining
  return this;
};

var _remove = Proto.remove;
Proto.remove = function(query, callback) {
  // validate the query -- silently ignore empty one
  if (!query) {
    typeof callback === 'function' && callback(403);
    return this;
  }
  // parse the query
  query = _.rql(query).toMongo().search;
  var self = this;
  // make sync validation
  this.emit('beforeRemove', query);
  if (query.$stop) {
    typeof callback === 'function' && callback(403);
    return this;
  }
  // call db method
  _remove.call(this, query, function(err) {
    self.emit('afterRemove', err);
    // allow continuation
    typeof callback === 'function' && callback(err || null);
  });
  // allow chaining
  return this;
};

function DB(url) {
  var Mongolian = require('mongolian');
  var server = new Mongolian();
  var db = server.db(url);
  for (var p in db) this[p] = db[p];
  // order RQL parser to convert strings to ObjectIDs
  _.rql().constructor.convertId = function(str) {
    try {
      str = Mongolian.ObjectId.createFromHexString(str);
    } catch(err) {}
    return str;
  }
}

DB.events = {
  beforeInsert: true,
  afterInsert: true,
  beforeUpdate: true,
  afterUpdate: true,
  beforeRemove: true,
  afterRemove: true,
};

DB.prototype.facetFor = function(collection, options) {
  if (!options) options = {};
  var c = this.collection(collection);
  for (var i in DB.events) if (options[i]) c.on(i, options[i]);
  var facet = {
    query: c.query.bind(c),
    get: c.get.bind(c),
    add: c.insert.bind(c),
    update: c.updateAll.bind(c),
    remove: c.remove.bind(c)
  };
  return facet;
};

exports = module.exports = DB;
