// Minimal property inspector: binds form fields to Stream Deck settings.
// <input data-setting="x"> is stored per key, data-global="x" for the whole plugin.
let socket;
let uuid;
let settings = {};
let globalSettings = {};

const send = (event, payload) => socket.send(JSON.stringify({ event, context: uuid, payload }));

function fill() {
	for (const el of document.querySelectorAll("[data-setting]")) {
		el.value = settings[el.dataset.setting] ?? el.dataset.default ?? "";
	}
	for (const el of document.querySelectorAll("[data-global]")) {
		el.value = globalSettings[el.dataset.global] ?? "";
	}
}

function connectElgatoStreamDeckSocket(port, propertyInspectorUUID, registerEvent, _info, actionInfo) {
	uuid = propertyInspectorUUID;
	settings = JSON.parse(actionInfo).payload?.settings ?? {};
	fill();

	socket = new WebSocket(`ws://127.0.0.1:${port}`);
	socket.onopen = () => {
		socket.send(JSON.stringify({ event: registerEvent, uuid }));
		socket.send(JSON.stringify({ event: "getGlobalSettings", context: uuid }));
	};
	socket.onmessage = (message) => {
		const data = JSON.parse(message.data);
		if (data.event === "didReceiveGlobalSettings") {
			globalSettings = data.payload.settings ?? {};
			fill();
		} else if (data.event === "didReceiveSettings") {
			settings = data.payload.settings ?? {};
			fill();
		}
	};
}

document.addEventListener("change", (ev) => {
	const el = ev.target;
	if (el.dataset.setting) {
		settings[el.dataset.setting] = el.value;
		send("setSettings", settings);
	} else if (el.dataset.global) {
		globalSettings[el.dataset.global] = el.value.trim();
		send("setGlobalSettings", globalSettings);
	}
});
