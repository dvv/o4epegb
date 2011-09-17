var http = require('http');
var sockjs = require('sockjs');
var node_static = require('node-static');

// 1. Echo sockjs server
var sockjs_opts = {sockjs_url: "http://majek.github.com/sockjs-client/sockjs-latest.min.js"};

var sjs_echo = new sockjs.Server(sockjs_opts);
sjs_echo.on('open', function(conn) {
repl.c = conn;
console.log(conn);
                conn.on('message', function(e) {
console.log(e);
                            conn.send(e.data);
                        });
            });

// 2. Static files server
var static_directory = new node_static.Server(__dirname);

// 3. Usual http stuff
var server = http.createServer();
server.addListener('request', function(req, res) {
                       static_directory.serve(req, res);
                   });
server.addListener('upgrade', function(req,res){
                       res.end();
                   });

sjs_echo.installHandlers(server, {prefix:'[/]echo'});

console.log(' [*] Listening on 0.0.0.0:9999' );
server.listen(9999, '0.0.0.0');

var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
