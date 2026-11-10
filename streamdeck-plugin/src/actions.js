/**
 * Behaviour of every key: what a press sends to the game and how the key looks
 * for the current vehicle state. `view` returns a description that render.js
 * turns into the key image.
 *
 * Vehicle state fields (see beamng-mod/lua/ge/extensions/streamdeckBridge.lua):
 *   ign 0-3, run, ice, lb 0-2 (lightbar), lights 0-2, hi, fog, haz, sl, sr,
 *   bl, br (blinker lamps lit right now), horn, pb, gear, spd (m/s), rpm, fuel
 */

export const PREFIX = "com.maxbaumann.beamng.";

const C = {
	blue: "#1e6bff",
	red: "#e5352b",
	green: "#1faa59",
	amber: "#f2a100",
	white: "#e9eef5",
	cyan: "#19b6d2",
	neonOff: "#22e6ff",
	neonOn: "#2dff6e",
};

export const actions = {
	power: {
		down: (bridge, settings) => bridge.send("power", "toggle", settings.mode === "ignition" ? 1 : 0),
		view(s, t) {
			if (s.run) return { icon: "power", color: C.green, label: t.power, status: t.running };
			if (s.ign >= 2 && !s.ice) return { icon: "power", color: C.green, label: t.power, status: t.ready };
			if (s.ign >= 1) return { icon: "power", color: C.amber, label: t.power, status: t.ignition };
			return { icon: "power", label: t.power, status: t.off };
		},
	},

	// Blaulicht and Sirene use the neon outline look: cyan when off, all green when on
	lightbar: {
		down: (bridge) => bridge.send("lightbar"),
		view(s, t) {
			const on = s.lb > 0;
			return { neon: "beacon", color: on ? C.neonOn : C.neonOff, label: t.lightbar, status: on ? t.on : t.off };
		},
	},

	siren: {
		down: (bridge) => bridge.send("siren"),
		view(s, t) {
			const on = s.lb >= 2;
			return { neon: "horn", color: on ? C.neonOn : C.neonOff, label: t.siren, status: on ? t.on : t.off };
		},
	},

	emergency: {
		down: (bridge) => bridge.send("emergency"),
		animated: (s) => s.lb > 0,
		view(s, t, phase) {
			if (s.lb >= 2)
				return { icon: "beacon", color: C.red, label: t.emergency, status: t.lightsSiren, flash: phase % 2 };
			if (s.lb === 1) return { icon: "beacon", color: C.blue, label: t.emergency, status: t.lightsOnly, flash: phase % 2 };
			return { icon: "beacon", label: t.emergency, status: t.off };
		},
	},

	horn: {
		down: (bridge) => bridge.send("horn", "press"),
		up: (bridge) => bridge.send("horn", "release"),
		view(s, t) {
			if (s.horn) return { icon: "horn", color: C.amber, label: t.horn, waves: 3 };
			return { icon: "horn", label: t.horn };
		},
	},

	lights: {
		down: (bridge) => bridge.send("lights"),
		view(s, t) {
			if (s.lights >= 2) return { icon: "highbeam", color: C.blue, label: t.lights, status: t.highBeam };
			if (s.lights === 1) return { icon: "lowbeam", color: C.green, label: t.lights, status: t.lowBeam };
			return { icon: "lowbeam", label: t.lights, status: t.off };
		},
	},

	highbeam: {
		down: (bridge) => bridge.send("highbeam"),
		view(s, t) {
			if (s.lights >= 2 || s.hi) return { icon: "highbeam", color: C.blue, label: t.highbeam, status: t.on };
			return { icon: "highbeam", label: t.highbeam, status: t.off };
		},
	},

	fog: {
		down: (bridge) => bridge.send("fog"),
		view(s, t) {
			if (s.fog) return { icon: "fog", color: C.green, label: t.fog, status: t.on };
			return { icon: "fog", label: t.fog, status: t.off };
		},
	},

	hazard: {
		down: (bridge) => bridge.send("hazard"),
		view(s, t) {
			if (s.haz) return { icon: "hazard", color: C.red, label: t.hazard, status: t.on, dim: !(s.bl || s.br) };
			return { icon: "hazard", label: t.hazard, status: t.off };
		},
	},

	signal_l: {
		down: (bridge) => bridge.send("signal_l"),
		view(s, t) {
			if (s.sl && !s.haz) return { icon: "left", color: C.green, label: t.signalLeft, status: t.on, dim: !s.bl };
			return { icon: "left", label: t.signalLeft, status: t.off };
		},
	},

	signal_r: {
		down: (bridge) => bridge.send("signal_r"),
		view(s, t) {
			if (s.sr && !s.haz) return { icon: "right", color: C.green, label: t.signalRight, status: t.on, dim: !s.br };
			return { icon: "right", label: t.signalRight, status: t.off };
		},
	},

	parkingbrake: {
		down: (bridge) => bridge.send("parkingbrake"),
		view(s, t) {
			if (s.pb) return { icon: "parking", color: C.red, label: t.parkingBrake, status: t.engaged };
			return { icon: "parking", label: t.parkingBrake, status: t.released };
		},
	},

	gear_p: gearKey("P", (g) => g.startsWith("P")),
	gear_r: gearKey("R", (g) => g.startsWith("R")),
	gear_n: gearKey("N", (g) => g.startsWith("N")),
	// manual gearboxes report numbers, sport/manual modes of automatics S1, M1, ...
	gear_d: gearKey("D", (g) => /^[DSM1-9]/.test(g)),

	info: {
		view(s, t, _phase, settings) {
			const mph = settings.unit === "mph";
			const speed = Math.round((s.spd || 0) * (mph ? 2.23694 : 3.6));
			return {
				big: String(speed),
				unit: mph ? "mph" : "km/h",
				label: `${t.gear} ${s.gear || "–"}`,
				color: s.run ? C.cyan : undefined,
				quiet: true,
			};
		},
	},
};

/** One key per gear position; the engaged one lights up green. */
function gearKey(letter, isActive) {
	return {
		down: (bridge) => bridge.send(`gear_${letter.toLowerCase()}`, "set"),
		view(s, t) {
			const active = isActive(String(s.gear ?? ""));
			return { letter, color: active ? C.green : undefined, label: t.gear, status: active ? t.on : t.off };
		},
	};
}

export const texts = {
	de: {
		power: "FAHRZEUG",
		running: "LÄUFT",
		ready: "BEREIT",
		ignition: "ZÜNDUNG",
		off: "AUS",
		on: "AN",
		standby: "BEREIT",
		lightbar: "BLAULICHT",
		siren: "SIRENE",
		emergency: "EINSATZ",
		lightsOnly: "LICHT",
		lightsSiren: "LICHT+TON",
		horn: "HUPE",
		lights: "LICHT",
		lowBeam: "ABBLEND",
		highBeam: "FERNLICHT",
		highbeam: "FERNLICHT",
		fog: "NEBEL",
		hazard: "WARNBLINK",
		signalLeft: "BLINKER L",
		signalRight: "BLINKER R",
		parkingBrake: "HANDBREMSE",
		engaged: "FEST",
		released: "GELÖST",
		gear: "GANG",
		offline: "OFFLINE",
		noVehicle: "KEIN FZG",
	},
	en: {
		power: "VEHICLE",
		running: "RUNNING",
		ready: "READY",
		ignition: "IGNITION",
		off: "OFF",
		on: "ON",
		standby: "READY",
		lightbar: "LIGHTBAR",
		siren: "SIREN",
		emergency: "EMERGENCY",
		lightsOnly: "LIGHTS",
		lightsSiren: "LIGHTS+SIREN",
		horn: "HORN",
		lights: "LIGHTS",
		lowBeam: "LOW BEAM",
		highBeam: "HIGH BEAM",
		highbeam: "HIGH BEAM",
		fog: "FOG",
		hazard: "HAZARDS",
		signalLeft: "SIGNAL L",
		signalRight: "SIGNAL R",
		parkingBrake: "PARK BRAKE",
		engaged: "ON",
		released: "OFF",
		gear: "GEAR",
		offline: "OFFLINE",
		noVehicle: "NO VEHICLE",
	},
};

const EMPTY = { ign: 0, lb: 0, lights: 0, spd: 0 };

/**
 * Describes how a key should look right now.
 * @param {string} id action name without the plugin prefix
 * @param {{connected: boolean, hasVehicle: boolean, state: object}} bridge
 */
export function describe(id, bridge, { lang = "de", phase = 0, settings = {} } = {}) {
	const action = actions[id];
	const t = texts[lang] ?? texts.en;
	if (!action) return { label: "?" };

	if (!bridge.connected || !bridge.hasVehicle) {
		const idle = action.view(EMPTY, t, 0, settings);
		return {
			icon: idle.icon,
			neon: idle.neon,
			letter: idle.letter,
			big: idle.big ? "–" : undefined,
			unit: idle.unit,
			label: idle.quiet ? t.gear + " –" : idle.label,
			status: bridge.connected ? t.noVehicle : t.offline,
			unavailable: bridge.connected ? "vehicle" : "offline",
		};
	}
	return action.view(bridge.state, t, phase, settings);
}

/** Whether the key needs periodic redraws (flashing lights etc.). */
export function isAnimated(id, bridge) {
	const animated = actions[id]?.animated;
	return Boolean(animated && bridge.connected && bridge.hasVehicle && animated(bridge.state));
}
