// Simulator: try the plugin and the mod together without BeamNG or Stream Deck hardware.
//   npm run sim   ->  http://localhost:8377
import { readFileSync } from "node:fs";
import http from "node:http";

import { FakeDeck } from "./deck.mjs";
import { FakeGame } from "./game.mjs";

const HTTP_PORT = Number(process.env.PORT ?? 8377);
const GAME_PORT = Number(process.env.GAME_PORT ?? 44550);
const LAYOUT = [
	"power", "lightbar", "siren", "emergency", "horn",
	"lights", "highbeam", "fog", "parkingbrake", "info",
	"signal-l", "hazard", "signal-r",
];

const game = new FakeGame({ port: GAME_PORT });
const deck = new FakeDeck({ globalSettings: { host: "127.0.0.1", port: String(GAME_PORT) } });
const clients = new Set();

const push = (event, data) => {
	for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
const gameState = () => ({ running: game.running, vehicle: game.hasVehicle, electrics: game.running ? game.electrics() : null });

deck.on("image", (context, image) => push("image", { context, image }));
deck.on("alert", (context) => push("alert", { context }));
setInterval(() => push("game", gameState()), 100);

/** Things the "player" can do inside the game, independent of the Stream Deck. */
const gameActions = {
	start: () => !game.running && game.start(),
	stop: () => game.running && game.stop(),
	leave: () => game.removeVehicle(),
	enter: () => game.running && game.spawnVehicle("fullsize"),
	lightbar: () => game.runInVehicle("electrics.toggle_lightbar_signal()"),
	hazard: () => game.runInVehicle("electrics.toggle_warn_signal()"),
	lights: () => game.runInVehicle("electrics.toggle_lights()"),
	drive: () => game.runInVehicle("mockSet('gear', 'D') mockSet('targetSpeed', 23.9) mockSet('parkingbrake', 0)"),
	park: () => game.runInVehicle("mockSet('gear', 'P') mockSet('targetSpeed', 0) mockSet('parkingbrake', 1)"),
};

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");
	if (url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(readFileSync(new URL("index.html", import.meta.url)));
	} else if (url.pathname === "/events") {
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		clients.add(res);
		req.on("close", () => clients.delete(res));
		const keys = [...deck.keys].map(([context, key]) => ({ context, column: key.column, row: key.row, image: key.image }));
		res.write(`event: init\ndata: ${JSON.stringify({ columns: deck.columns, rows: deck.rows, keys })}\n\n`);
		res.write(`event: game\ndata: ${JSON.stringify(gameState())}\n\n`);
	} else if (url.pathname === "/key" && req.method === "POST") {
		const context = url.searchParams.get("context");
		if (deck.keys.has(context)) url.searchParams.get("down") === "1" ? deck.press(context) : deck.release(context);
		res.end();
	} else if (url.pathname === "/game" && req.method === "POST") {
		await gameActions[url.searchParams.get("do")]?.();
		res.end();
	} else {
		res.writeHead(404).end();
	}
});

await deck.start(LAYOUT);
if (process.env.GAME !== "off") await game.start();
server.listen(HTTP_PORT, "127.0.0.1", () => console.log(`Simulator: http://localhost:${HTTP_PORT}`));

const shutdown = () => {
	deck.stop();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
