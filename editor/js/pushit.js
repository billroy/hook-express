var Pushit = {
	init: function() {
		console.log('Initializing socket.io');
		this.socket = io.connect();
	},
	on: function(message, handler) {
		console.log('subscribe', message);
		this.socket.on(message, handler);
	},
	send: function(message, data) {
        console.log('Pushit.send:', message, data);
		this.socket.emit(message, data);
	}
};
Pushit.init();
Pushit.on('hx.ping', function(data) {
    console.log('hx.ping', data);
    if (data) {
        data.pongtime = new Date().getTime();
        Pushit.send('hx.pong', data);
    }
});
Pushit.send('hx.hello', {});
