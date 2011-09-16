require([
  'jquery-1.6.4.min',
  'order!json2',
  'es5-shim',
  'doT',
  'order!connection-8'], function() {
  var browser = $.browser;
  // FF >= 7.0 introduces MozWebSocket
  if (typeof MozWebSocket !== 'undefined') WebSocket = MozWebSocket;
  // only some browsers support draft 8 WebSocket so far
  if (typeof WebSocket !== 'undefined' && (
    // FF >= 7.0
    (browser.mozilla && +browser.version >= 7) ||
    // Chrome >= 14
    (browser.webkit && +browser.version >= 535.1)
  )) {
    main();
  // provide shim for older browsers
  } else {
    // N.B. let shim always apply, nomatter there is native WebSocket
    WebSocket = false;
    //window.WEB_SOCKET_DEBUG = true
    window.WEB_SOCKET_SWF_LOCATION = 'js/flash/WebSocketMain.swf';
    // FIXME: web_socket.js's way of attaching onload event clashes with
    // requirejs.
    // See https://github.com/kanaka/web-socket-js/commit/978e31ce6ff15926391b616667c4e4370bbac800#commitcomment-590868
    window.WEB_SOCKET_DISABLE_AUTO_INITIALIZATION = true;
    require(['order!flash/swfobject', 'order!flash/web_socket'], function() {
      WebSocket.__initialize();
      main();
    });
  }
});

function main() {
console.log('STARTING');

function Conn() {
  var ws = new Connection();
  // N.B. we can send before connection
  ///for (var i = 0; i < 10; ++i) ws.send('a' + i);
  ws.on('error', function() {
    console.log('ERROR:', new Date(), this.id, this, arguments);
  });
  ws.on('connecting', function() {
    console.log('CONNECTING:', new Date(), this.id, this, arguments);
  });
  ws.on('data', function() {
    console.log('DATA:', new Date(), this.id, this, arguments);
  });
  ws.on('open', function() {
    console.log('OPEN:', new Date(), this.id, this, arguments);
  });
  ws.on('close', function() {
    console.log('CLOSE:', new Date(), this.id, this, arguments);
  });
  ws.on('connect', function() {
    console.log('CONNECT:', new Date(), this.id, this, arguments);
  });
  ws.on('disconnect', function() {
    console.log('DISCONNECT:', new Date(), this.id, this, arguments);
  });
  ws.open();
  // mimick network failures
  ///setInterval(function() {ws.socket.close();}, 5000);
  return ws;
}
ws = new Conn();
ws1 = new Conn();

}
