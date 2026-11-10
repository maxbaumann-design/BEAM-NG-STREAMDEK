import streamDeck from "@elgato/streamdeck";

import { PREFIX, actions, describe, isAnimated } from "./actions.js";
import { Bridge } from "./bridge.js";
import { renderKey, toDataUrl } from "./render.js";

const FRAME_MS = 220;

const bridge = new Bridge();
/** Visible keys: context id -> { action, id, settings, image } */
const keys = new Map();
let phase = 0;
let animation;

const lang = () => (String(streamDeck.info?.application?.language ?? "en").startsWith("de") ? "de" : "en");

function draw(key) {
	const svg = renderKey(describe(key.id, bridge, { lang: lang(), phase, settings: key.settings }));
	if (svg === key.image) return;
	key.image = svg;
	key.action.setImage(toDataUrl(svg)).catch(() => {});
}

function refresh() {
	let animate = false;
	for (const key of keys.values()) {
		draw(key);
		animate ||= isAnimated(key.id, bridge);
	}
	if (animate && !animation) {
		animation = setInterval(() => {
			phase = (phase + 1) % 6;
			refresh();
		}, FRAME_MS);
	} else if (!animate && animation) {
		clearInterval(animation);
		animation = undefined;
	}
}

const idOf = (action) => action.manifestId.slice(PREFIX.length).replace("-", "_");

streamDeck.actions.onWillAppear((ev) => {
	const id = idOf(ev.action);
	if (!actions[id] || !ev.action.isKey()) return;
	keys.set(ev.action.id, { action: ev.action, id, settings: ev.payload.settings ?? {}, image: "" });
	refresh();
});

streamDeck.actions.onWillDisappear((ev) => {
	keys.delete(ev.action.id);
	refresh();
});

streamDeck.settings.onDidReceiveSettings((ev) => {
	const key = keys.get(ev.action.id);
	if (!key) return;
	key.settings = ev.payload.settings ?? {};
	refresh();
});

streamDeck.actions.onKeyDown((ev) => {
	const id = idOf(ev.action);
	const handler = actions[id]?.down;
	if (!handler) return;
	if (!bridge.connected || !bridge.hasVehicle) {
		ev.action.showAlert().catch(() => {});
		return;
	}
	handler(bridge, ev.payload.settings ?? {});
});

streamDeck.actions.onKeyUp((ev) => {
	actions[idOf(ev.action)]?.up?.(bridge, ev.payload.settings ?? {});
});

// keeps the plugin compatible with Stream Deck 6.5+ (the new behaviour needs 7.1)
streamDeck.settings.useLegacySettingsBehavior = true;

const applyGlobal = (settings) => bridge.configure(settings?.host, settings?.port);
streamDeck.settings.onDidReceiveGlobalSettings((ev) => applyGlobal(ev.settings));

bridge.on("change", refresh);
bridge.start();

await streamDeck.connect();
streamDeck.settings
	.getGlobalSettings()
	.then(applyGlobal)
	.catch(() => {});
