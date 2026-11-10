// End-to-end test: fake Stream Deck app <-> real plugin <-> UDP <-> real mod Lua <-> simulated vehicle.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { FakeDeck } from "./deck.mjs";
import { FakeGame } from "./game.mjs";

const PORT = 44561;
const game = new FakeGame({ port: PORT });
const deck = new FakeDeck({ globalSettings: { host: "127.0.0.1", port: String(PORT) } });

const LAYOUT = ["power", "lightbar", "siren", "emergency", "horn", "lights", "highbeam", "fog", "signal-l", "hazard", "signal-r", "parkingbrake", ["info", { unit: "kmh" }], "gear-p", "gear-r", "gear-n", "gear-d"];

async function until(check, what, timeout = 4000) {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			if (check()) return;
		} catch {}
		if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}\n${game.logs.join("\n")}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

function tap(name) {
	const context = deck.find(name);
	deck.press(context);
	deck.release(context);
}

const shows = (name, text) => deck.image(name).includes(`>${text}<`);
const e = () => game.electrics();

before(async () => {
	await deck.start(LAYOUT);
});
after(() => {
	deck.stop();
	if (game.running) game.stop();
});

test("keys show OFFLINE while the game is not running, presses raise an alert", async () => {
	await until(() => shows("lightbar", "OFFLINE"), "offline image");
	tap("lightbar");
	await until(() => deck.alerts === 1, "alert");
});

test("keys come alive when the game starts", async () => {
	await game.start();
	await until(() => shows("power", "AUS") && shows("lightbar", "AUS"), "idle images");
	assert.ok(shows("parkingbrake", "FEST"));
	assert.ok(game.logs.some((l) => l.includes("Stream Deck connected")));
});

test("vehicle on/off: ignition, start, running, off", async () => {
	tap("power");
	await until(() => e().ignitionLevel === 2 && shows("power", "ZÜNDUNG"), "ignition shown while cranking");
	await until(() => e().engineRunning === 1 && shows("power", "LÄUFT"), "engine running");
	tap("power");
	await until(() => e().ignitionLevel === 0 && e().engineRunning === 0 && shows("power", "AUS"), "vehicle off");
});

test("lightbar and siren keys depend on each other", async () => {
	tap("lightbar");
	await until(() => e().lightbar === 1 && shows("lightbar", "AN") && shows("siren", "AUS"), "lights on, siren still off");
	assert.ok(shows("emergency", "LICHT"));

	tap("siren");
	await until(() => e().lightbar === 2 && shows("siren", "AN") && shows("emergency", "LICHT+TON"), "siren on");

	tap("siren");
	await until(() => e().lightbar === 1 && shows("siren", "AUS") && shows("lightbar", "AN"), "siren off, lights stay");

	tap("lightbar");
	await until(() => e().lightbar === 0 && shows("lightbar", "AUS") && shows("siren", "AUS"), "all off");

	tap("siren");
	await until(() => e().lightbar === 2 && shows("lightbar", "AN") && shows("siren", "AN"), "siren switches lights on too");

	tap("emergency");
	await until(() => e().lightbar === 0 && shows("emergency", "AUS"), "emergency key cycles to off");
});

test("lightbar and siren symbols are cyan when off and completely green when on", async () => {
	const colors = (name) => new Set(deck.image(name).match(/stroke="#[0-9a-f]{6}"/g).filter((c) => !c.includes("ffffff")));
	assert.deepEqual([...colors("lightbar")], ['stroke="#22e6ff"']);
	assert.deepEqual([...colors("siren")], ['stroke="#22e6ff"']);
	tap("siren");
	await until(() => shows("lightbar", "AN") && shows("siren", "AN"), "both on");
	assert.deepEqual([...colors("lightbar")], ['stroke="#2dff6e"']);
	assert.deepEqual([...colors("siren")], ['stroke="#2dff6e"']);
	const frames = new Set();
	await until(() => frames.add(deck.image("emergency")).size >= 2, "emergency key flashes");
	tap("lightbar");
	await until(() => shows("lightbar", "AUS") && shows("siren", "AUS"), "both off");
});

test("changes made inside the game show up on the keys", async () => {
	game.runInVehicle("electrics.toggle_lightbar_signal()");
	await until(() => shows("lightbar", "AN"), "lightbar key follows the game");
	game.runInVehicle("electrics.set_lightbar_signal(0) electrics.toggle_warn_signal()");
	await until(() => shows("lightbar", "AUS") && shows("hazard", "AN"), "hazard key follows the game");
	game.runInVehicle("electrics.toggle_warn_signal()");
	await until(() => shows("hazard", "AUS"), "hazards off");
});

test("lights, high beam, fog, signals, hazards, parking brake, horn", async () => {
	tap("lights");
	await until(() => e().lights_state === 1 && shows("lights", "ABBLEND"), "low beam");
	tap("highbeam");
	await until(() => e().lights_state === 2 && shows("lights", "FERNLICHT") && shows("highbeam", "AN"), "high beam");
	tap("lights");
	await until(() => e().lights_state === 0 && shows("lights", "AUS") && shows("highbeam", "AUS"), "lights off");

	tap("fog");
	await until(() => e().fog === 1 && shows("fog", "AN"), "fog on");
	tap("fog");
	await until(() => e().fog === 0 && shows("fog", "AUS"), "fog off");

	tap("signal-l");
	await until(() => e().signal_left_input === 1 && shows("signal-l", "AN"), "left signal");
	tap("signal-r");
	await until(() => e().signal_right_input === 1 && shows("signal-r", "AN") && shows("signal-l", "AUS"), "right replaces left");
	tap("signal-r");
	await until(() => e().signal_right_input === 0 && shows("signal-r", "AUS"), "signal off");

	tap("hazard");
	await until(() => e().hazard_enabled === 1 && shows("hazard", "AN"), "hazards on");
	const frames = new Set();
	await until(() => frames.add(deck.image("hazard")).size >= 2, "hazard key blinks with the vehicle", 3000);
	tap("hazard");
	await until(() => e().hazard_enabled === 0 && shows("hazard", "AUS"), "hazards off");

	tap("parkingbrake");
	await until(() => e().parkingbrake === 0 && shows("parkingbrake", "GELÖST"), "parking brake released");

	deck.press(deck.find("horn"));
	await until(() => e().horn === 1, "horn while held");
	deck.release(deck.find("horn"));
	await until(() => e().horn === 0, "horn released");
});

test("info key shows speed and gear", async () => {
	tap("power");
	await until(() => e().engineRunning === 1, "engine running");
	tap("gear-d");
	game.runInVehicle("mockSet('targetSpeed', 20)");
	await until(() => shows("info", "72") && shows("info", "GANG D"), "72 km/h in D");
	game.runInVehicle("mockSet('targetSpeed', 0)");
	tap("gear-p");
	await until(() => e().gear === "P", "back in park");
});

test("gear keys P R N D select the gear and only the engaged one is lit", async () => {
	const lit = () => ["p", "r", "n", "d"].filter((g) => shows(`gear-${g}`, "AN")).join("");
	await until(() => lit() === "p", "P lit initially");
	for (const g of ["r", "n", "d", "p"]) {
		tap(`gear-${g}`);
		await until(() => e().gear === g.toUpperCase() && lit() === g, `gear ${g}`);
	}
	game.runInVehicle("controller.mainController.shiftToGearIndex(-1)");
	await until(() => lit() === "r", "R key follows a shift made in the game");
	tap("gear-p");
	await until(() => lit() === "p", "P again");
});

test("gear keys on a manual gearbox: D is first gear, P is neutral plus parking brake", async () => {
	game.runInVehicle("mockSet('manual', true) mockSet('gear', 0) mockSet('parkingbrake', 0)");
	tap("gear-d");
	await until(() => e().gear === 1 && shows("gear-d", "AN"), "first gear", 6000);
	tap("gear-p");
	await until(() => e().gear === "N" && e().parkingbrake === 1 && shows("gear-n", "AN"), "neutral + parking brake", 6000);
	game.runInVehicle("mockSet('manual', false) mockSet('gear', 'P')");
});

test("leaving the vehicle and switching to an electric car", async () => {
	game.removeVehicle();
	await until(() => shows("lightbar", "KEIN FZG"), "no vehicle");
	await game.spawnVehicle("vivace", { hasEngine: false });
	await until(() => shows("power", "AUS"), "new vehicle idle");
	tap("power");
	await until(() => e().ignitionLevel === 2 && shows("power", "BEREIT"), "electric car ready");
	tap("power");
	await until(() => e().ignitionLevel === 0 && shows("power", "AUS"), "electric car off");
});

test("malformed and hostile packets are ignored", async () => {
	const dgram = await import("node:dgram");
	const socket = dgram.createSocket("udp4");
	const send = (text) => new Promise((r) => socket.send(text, PORT, "127.0.0.1", r));
	await send("not json");
	await send(JSON.stringify({ t: "cmd", id: 'x") os.exit() --', a: "toggle" }));
	await send(JSON.stringify({ t: "cmd", id: "lightbar", a: 'on") mockSet("lightbar", 2) --' }));
	await send(JSON.stringify({ t: "cmd", id: "nope", a: "toggle" }));
	await send(JSON.stringify({ t: "cmd", id: "fog", a: "on" }));
	await until(() => e().fog === 1, "valid command after bad ones still works");
	assert.equal(e().lightbar, 0);
	socket.close();
	tap("fog");
	await until(() => e().fog === 0, "fog off");
});

test("keys go back to OFFLINE when the game closes and recover afterwards", async () => {
	game.stop();
	await until(() => shows("lightbar", "OFFLINE"), "offline after game exit", 6000);
	await game.start();
	await until(() => shows("lightbar", "AUS"), "reconnected");
});
