#!/usr/bin/env node
var WebSocketRequest = require('websocket').request;
var http = require('http');

var server = http.createServer(function(request, response) {
    console.log((new Date()) + " Received request for " + request.url);
    response.writeHead(404);
    response.end();
});
server.listen(8080, function() {
    console.log((new Date()) + " Server is listening on port 8080");
});

var serverConfig =  {
    // All options *except* 'httpServer' are required when bypassing
    // WebSocketServer.
    maxReceivedFrameSize: 0x10000,
    maxReceivedMessageSize: 0x100000,
    fragmentOutgoingMessages: true,
    fragmentationThreshold: 0x4000,
    keepalive: true,
    keepaliveInterval: 20000,
    assembleFragments: true,
    // autoAcceptConnections is not applicable when bypassing WebSocketServer
    // autoAcceptConnections: false,
    disableNagleAlgorithm: true,
    closeTimeout: 5000
};

// Handle the upgrade event ourselves instead of using WebSocketServer
server.on('upgrade', function(req, socket, head) {
    var wsConnection;
    try {
        var wsRequest = new WebSocketRequest(socket, req, serverConfig);
        wsConnection = wsRequest.accept(wsRequest.requestedProtocols[0], wsRequest.origin);
        // wsConnection is now live and ready for use
    }
    catch(e) {
        console.log("WebSocket Request unsupported by WebSocket-Node: " + e.toString());
        return;
        // Attempt old websocket library connection here.
        // wsConnection = /* some fallback code here */
    }
    
    handleWebSocketConnect(wsConnection);
});

function handleWebSocketConnect(connection) {
    console.log((new Date()) + " Connection accepted.");
    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            console.log("Received Message: " + message.utf8Data);
            connection.sendUTF(message.utf8Data);
        }
        else if (message.type === 'binary') {
            console.log("Received Binary Message of " + message.binaryData.length + " bytes");
            connection.sendBytes(message.binaryData);
        }
    });
    connection.on('close', function(connection) {
        console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
    });
}
