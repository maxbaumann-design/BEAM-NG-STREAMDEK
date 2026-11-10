// A stand-in for the Stream Deck app: launches the plugin exactly like the
// real software does and speaks the plugin WebSocket protocol with it.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");

const PLUGIN_DIR = fileURLToPath(new URL("../com.maxbaumann.beamng.sdPlugin/", import.meta.url));
const manifest = JSON.parse(readFileSync(PLUGIN_DIR + "manifest.json", "utf8"));
const DEVICE = "SIMULATED-DECK";

export class FakeDeck extends EventEmitter {
	/** context -> { action, column, row, settings, image } */
	keys = new Map();
	columns = 5;
	rows = 3;
	alerts = 0;
	#server;
	#socket;
	#process;
	#globalSettings;

	constructor({ globalSettings = {}, language = "de" } = {}) {
		super();
		this.#globalSettings = globalSettings;
		this.language = language;
	}

	/** Places actions on the deck, row by row. `layout` is a list of action names or [name, settings]. */
	async start(layout) {
		layout.forEach((entry, index) => {
			if (!entry) return;
			const [name, settings] = Array.isArray(entry) ? entry : [entry, {}];
			const action = manifest.Actions.find((a) => a.UUID.endsWith("." + name));
			if (!action) throw new Error(`Unknown action ${name}`);
			this.keys.set(`key${index}`, {
				action: action.UUID,
				column: index % this.columns,
				row: Math.floor(index / this.columns),
				settings,
				image: null,
			});
		});

		this.#server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await new Promise((resolve) => this.#server.once("listening", resolve));
		const registered = new Promise((resolve) => {
			this.#server.on("connection", (socket) => {
				this.#socket = socket;
				socket.on("message", (data) => this.#onMessage(JSON.parse(data), resolve));
			});
		});

		const info = {
			application: { font: "Arial", language: this.language, platform: "windows", platformVersion: "10", version: "6.9.0" },
			plugin: { uuid: manifest.UUID, version: manifest.Version },
			devicePixelRatio: 2,
			colors: {},
			devices: [{ id: DEVICE, name: "Simulated Stream Deck", size: { columns: this.columns, rows: this.rows }, type: 0 }],
		};
		this.#process = spawn(
			process.execPath,
			[
				PLUGIN_DIR + manifest.CodePath,
				"-port", String(this.#server.address().port),
				"-pluginUUID", manifest.UUID,
				"-registerEvent", "registerPlugin",
				"-info", JSON.stringify(info),
			],
			{ cwd: PLUGIN_DIR, stdio: ["ignore", "inherit", "inherit"] },
		);
		const exited = new Promise((_, reject) =>
			this.#process.once("exit", (code) => reject(new Error(`Plugin exited with code ${code}, see logs/ in the plugin folder`))),
		);
		exited.catch(() => {});
		await Promise.race([registered, exited]);

		this.#send({ event: "deviceDidConnect", device: DEVICE, deviceInfo: info.devices[0] });
		for (const context of this.keys.keys()) this.#keyEvent("willAppear", context);
	}

	stop() {
		this.#process?.kill();
		this.#server?.close();
	}

	press(context) {
		this.#keyEvent("keyDown", context);
	}

	release(context) {
		this.#keyEvent("keyUp", context);
	}

	/** Context of the first key showing the given action name. */
	find(name) {
		for (const [context, key] of this.keys) if (key.action.endsWith("." + name)) return context;
		throw new Error(`No key with action ${name}`);
	}

	/** Decoded SVG currently shown on a key. */
	image(name) {
		const image = this.keys.get(this.find(name)).image;
		return image ? decodeURIComponent(image.slice(image.indexOf(",") + 1)) : "";
	}

	#send(message) {
		this.#socket?.send(JSON.stringify(message));
	}

	#keyEvent(event, context) {
		const key = this.keys.get(context);
		this.#send({
			event,
			action: key.action,
			context,
			device: DEVICE,
			payload: {
				controller: "Keypad",
				coordinates: { column: key.column, row: key.row },
				isInMultiAction: false,
				settings: key.settings,
				state: 0,
			},
		});
	}

	#onMessage(message, onRegistered) {
		switch (message.event) {
			case "registerPlugin":
				onRegistered();
				break;
			case "getGlobalSettings":
				this.#send({ event: "didReceiveGlobalSettings", id: message.id, payload: { settings: this.#globalSettings } });
				break;
			case "setImage": {
				const key = this.keys.get(message.context);
				if (key) {
					key.image = message.payload.image;
					this.emit("image", message.context, key.image);
				}
				break;
			}
			case "showAlert":
				this.alerts++;
				this.emit("alert", message.context);
				break;
		}
	}
}
