// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Rodolfo Carrillo

// Synthetic CSMS used only to record the CLI demo. It answers the calls of the
// demo scenario with minimal OCPP 2.0.1 responses. It runs from the temporary
// recording workspace, where `ws` is installed.

import { WebSocketServer } from 'ws';

const now = () => new Date().toISOString();
const responses = {
	BootNotification: () => ({ status: 'Accepted', currentTime: now(), interval: 300 }),
	StatusNotification: () => ({}),
	Heartbeat: () => ({ currentTime: now() }),
	Authorize: () => ({ idTokenInfo: { status: 'Accepted' } }),
	TransactionEvent: () => ({}),
	MeterValues: () => ({}),
	NotifyEvent: () => ({}),
};

const port = Number(process.env.CSMS_PORT ?? 9000);
const server = new WebSocketServer({
	host: '127.0.0.1',
	port,
	handleProtocols: (protocols) => (protocols.has('ocpp2.0.1') ? 'ocpp2.0.1' : false),
});

server.on('connection', (socket) => {
	socket.on('message', (data) => {
		const frame = JSON.parse(String(data));
		if (frame[0] !== 2) return;
		const [, id, action] = frame;
		const reply = responses[action];
		socket.send(
			JSON.stringify(
				reply ? [3, id, reply()] : [4, id, 'NotImplemented', `${action} is not handled`, {}],
			),
		);
	});
});

server.on('listening', () => {
	console.log(`synthetic CSMS listening on ws://127.0.0.1:${port}`);
});
