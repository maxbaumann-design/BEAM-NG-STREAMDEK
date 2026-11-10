import dgram from "node:dgram";
import { EventEmitter } from "node:events";

const HELLO_INTERVAL = 1000;
const OFFLINE_AFTER = 2500;

/**
 * UDP link to the BeamNG mod. Emits "change" whenever the vehicle state or the
 * connection status changes.
 */
export class Bridge extends EventEmitter {
	host = "127.0.0.1";
	port = 4455;
	connected = false;
	hasVehicle = false;
	vehicleName = "";
	state = {};

	#socket;
	#lastSeen = 0;
	#timer;
	#lastRaw = "";

	start() {
		this.#open();
		this.#timer = setInterval(() => this.#tick(), HELLO_INTERVAL);
		this.#tick();
	}

	stop() {
		clearInterval(this.#timer);
		this.#socket?.close();
		this.#socket = undefined;
	}

	configure(host, port) {
		host = String(host || "").trim() || "127.0.0.1";
		port = Number.parseInt(port, 10);
		if (!(port > 0 && port < 65536)) port = 4455;
		if (host === this.host && port === this.port) return;
		this.host = host;
		this.port = port;
		this.#lastSeen = 0;
		this.#tick();
	}

	/** Sends a command for the player vehicle, e.g. send("lightbar", "toggle"). */
	send(id, action = "toggle", val) {
		this.#write({ t: "cmd", id, a: action, val });
	}

	#open() {
		const socket = dgram.createSocket("udp4");
		socket.on("message", (data) => this.#onMessage(data));
		socket.on("error", () => {
			// e.g. ICMP "port unreachable" while the game is closed; just keep trying
		});
		socket.bind(0);
		this.#socket = socket;
	}

	#write(message) {
		const data = Buffer.from(JSON.stringify(message));
		this.#socket?.send(data, this.port, this.host, () => {});
	}

	#tick() {
		this.#write({ t: "hello", v: 1 });
		if (this.connected && Date.now() - this.#lastSeen > OFFLINE_AFTER) {
			this.connected = false;
			this.hasVehicle = false;
			this.#lastRaw = "";
			this.emit("change");
		}
	}

	#onMessage(data) {
		const raw = data.toString("utf8");
		this.#lastSeen = Date.now();
		if (raw === this.#lastRaw && this.connected) return;

		let message;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (message?.t !== "state") return;

		this.#lastRaw = raw;
		this.connected = true;
		this.hasVehicle = message.veh === true && typeof message.s === "object" && message.s !== null;
		this.vehicleName = this.hasVehicle ? String(message.name ?? "") : "";
		this.state = this.hasVehicle ? message.s : {};
		this.emit("change");
	}
}
