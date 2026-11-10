// A stand-in for BeamNG.drive: runs the real mod Lua (GE extension + vehicle
// agent) in Lua VMs and simulates one vehicle's electrics.
import dgram from "node:dgram";
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";

const here = (file) => new URL(file, import.meta.url);
const MOD = readFileSync(here("../../beamng-mod/lua/ge/extensions/streamdeckBridge.lua"), "utf8");
const MOCK_GE = readFileSync(here("mockGE.lua"), "utf8");
const MOCK_VEHICLE = readFileSync(here("mockVehicle.lua"), "utf8");

const factory = new LuaFactory();

/** Converts a JSON value into a Lua literal, so Lua receives real tables. */
function toLua(value) {
	if (value === null || value === undefined) return "nil";
	if (Array.isArray(value)) return `{${value.map(toLua).join(",")}}`;
	if (typeof value === "object") {
		return `{${Object.entries(value)
			.map(([k, v]) => `[${JSON.stringify(k)}]=${toLua(v)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export class FakeGame {
	logs = [];
	#ge;
	#vehicle;
	#vehicleId = null;
	#socket;
	#inbox = [];
	#geQueue = [];
	#vehicleQueue = [];
	#timer;
	#nextId = 1000;

	constructor({ port = 4455 } = {}) {
		this.port = port;
	}

	get running() {
		return Boolean(this.#ge);
	}

	get hasVehicle() {
		return this.#vehicleId !== null;
	}

	/** Starts the "game": loads the mod and spawns a vehicle. */
	async start({ vehicle = "fullsize" } = {}) {
		const ge = await factory.createEngine();
		const log = (level, tag, msg) => this.logs.push(`${level}|${tag}|${msg}`);
		ge.global.set("mockLog", log);
		ge.global.set("mockJsonToLua", (text) => toLua(JSON.parse(text)));
		ge.global.set("mockConfigJson", JSON.stringify({ port: this.port }));
		ge.global.set("mockBind", (address, port) => {
			this.#socket = dgram.createSocket("udp4");
			this.#socket.on("message", (data, from) =>
				this.#inbox.push({ data: data.toString("utf8"), ip: from.address, port: from.port }),
			);
			this.#socket.bind(port, address);
		});
		ge.global.set("mockReceive", () => {
			const packet = this.#inbox.shift();
			return packet ? `${packet.ip}\n${packet.port}\n${packet.data}` : undefined;
		});
		ge.global.set("mockSend", (data, ip, port) => this.#socket?.send(data, port, ip));
		ge.global.set("mockClose", () => {
			this.#socket?.close();
			this.#socket = undefined;
		});
		ge.global.set("mockQueueVehicle", (id, code) => this.#vehicleQueue.push({ id, code }));
		await ge.doString(MOCK_GE);
		ge.global.get("mockLoadExtension")("streamdeckBridge", MOD);
		this.#ge = ge;

		if (vehicle) await this.spawnVehicle(vehicle);
		let last = performance.now();
		this.#timer = setInterval(() => {
			const now = performance.now();
			this.#frame(Math.min(0.1, (now - last) / 1000));
			last = now;
		}, 16);
	}

	/** Closes the "game". */
	stop() {
		clearInterval(this.#timer);
		this.#ge?.doStringSync("extensions.streamdeckBridge.onExtensionUnloaded()");
		this.#ge?.global.close();
		this.#vehicle?.global.close();
		this.#ge = this.#vehicle = undefined;
		this.#vehicleId = null;
		this.#inbox = [];
		this.#geQueue = [];
		this.#vehicleQueue = [];
	}

	/** Spawns (or replaces) the player vehicle with a fresh vehicle Lua VM. */
	async spawnVehicle(name = "fullsize", { hasEngine = true } = {}) {
		this.removeVehicle();
		const vm = await factory.createEngine();
		const id = this.#nextId++;
		vm.global.set("MOCK_VEHICLE_ID", id);
		vm.global.set("mockQueueGE", (code) => this.#geQueue.push(code));
		vm.global.set("mockLog", (level, tag, msg) => this.logs.push(`${level}|${tag}|${msg}`));
		await vm.doString(MOCK_VEHICLE);
		vm.global.get("mockSet")("hasEngine", hasEngine);
		this.#vehicle = vm;
		this.#vehicleId = id;
		this.#ge.global.set("mockVehicleId", id);
		this.#ge.global.set("mockVehicleName", name);
	}

	removeVehicle() {
		if (!this.#vehicle) return;
		this.#vehicle.global.close();
		this.#vehicle = undefined;
		this.#vehicleId = null;
		this.#vehicleQueue = [];
		this.#ge?.doStringSync("mockVehicleId = nil");
	}

	/** Runs Lua in the vehicle, like a key binding inside the game would. */
	runInVehicle(code) {
		this.#vehicle?.doStringSync(code);
	}

	/** Raw electrics values of the simulated vehicle. */
	electrics() {
		if (!this.#vehicle) return null;
		return JSON.parse(this.#vehicle.doStringSync("return mockValuesJson()"));
	}

	#frame(dt) {
		if (!this.#ge) return;
		this.#ge.global.get("extensions").streamdeckBridge.onUpdate(dt, dt, dt);
		for (const { id, code } of this.#vehicleQueue.splice(0)) {
			if (id === this.#vehicleId) this.#vehicle.doStringSync(code);
		}
		this.#vehicle?.global.get("mockUpdate")(dt);
		for (const code of this.#geQueue.splice(0)) this.#ge.doStringSync(code);
	}
}
