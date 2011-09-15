require(['jquery-1.6.4.min', 'order!json2', 'es5-shim', 'doT', 'order!connection-8'], function() {
  if (typeof MozWebSocket !== 'undefined') {
    WebSocket = MozWebSocket;
    main();
  } if (typeof WebSocket === 'undefined' || WebSocket.CLOSED === 2 || typeof opera !== 'undefined') {
    WebSocket = false;
    window.WEB_SOCKET_SWF_LOCATION = 'js/flash/WebSocketMain.swf';
    require(['order!flash/swfobject', 'order!flash/web_socket'], function() {
      console.log('SWF', arguments);
      //delete WEB_SOCKET_SWF_LOCATION;
      // FIXME: web_socket.js's way of attaching event to onload fails for IE
      if ($.browser.msie) {
        WebSocket.__initialize()
      }
      main();
    });
  } else {
    main();
  }
});

function main() {

function Conn() {
  var ws = new Connection();
  // N.B. we can send before connection
  for (var i = 0; i < 10; ++i) ws.send('a' + i);
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
