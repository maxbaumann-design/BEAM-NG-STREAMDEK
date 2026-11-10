// Generates manifest.json and the static images of the plugin.
import { mkdirSync, writeFileSync } from "node:fs";

import { PREFIX, actions, describe, texts } from "../src/actions.js";
import { renderKey } from "../src/render.js";

const root = new URL("../com.maxbaumann.beamng.sdPlugin/", import.meta.url).pathname;
const pkg = { version: "1.0.0" };

const names = {
	power: ["Fahrzeug Ein/Aus", "Startet den Motor bzw. schaltet das Fahrzeug aus. Zeigt Aus / Zündung / Läuft."],
	lightbar: ["Blaulicht", "Schaltet das Blaulicht ein oder aus (ohne Sirene)."],
	siren: ["Sirene", "Schaltet die Sirene zu oder ab. Das Blaulicht wird bei Bedarf mit eingeschaltet."],
	emergency: ["Einsatz (Blaulicht + Sirene)", "Schaltet durch: Aus → Blaulicht → Blaulicht mit Sirene → Aus."],
	horn: ["Hupe", "Hupt, solange die Taste gedrückt ist."],
	lights: ["Licht", "Schaltet durch: Aus → Abblendlicht → Fernlicht."],
	highbeam: ["Fernlicht", "Schaltet das Fernlicht ein oder aus."],
	fog: ["Nebelscheinwerfer", "Schaltet die Nebelscheinwerfer ein oder aus."],
	hazard: ["Warnblinker", "Schaltet den Warnblinker ein oder aus und blinkt im Takt des Fahrzeugs."],
	signal_l: ["Blinker links", "Schaltet den linken Blinker ein oder aus."],
	signal_r: ["Blinker rechts", "Schaltet den rechten Blinker ein oder aus."],
	parkingbrake: ["Handbremse", "Zieht oder löst die Handbremse."],
	info: ["Tempo & Gang", "Zeigt Geschwindigkeit und eingelegten Gang."],
};

const offline = { connected: true, hasVehicle: true, state: { ign: 0, lb: 0, lights: 0, spd: 0, gear: "N" } };
const idle = (id) => renderKey(describe(id, offline, { lang: "de" }));

/** Small monochrome list icon shown in the Stream Deck action list. */
function listIcon(id) {
	const svg = idle(id);
	if (svg.includes("<desc>")) return svg.replace('width="144" height="144"', 'width="40" height="40"').replace(/<rect width="144" height="144" fill="[^"]+"\/>/, "").replaceAll("#22e6ff", "#ffffff");
	const body = svg.includes("<g transform")
		? svg.slice(svg.indexOf("<g transform"), svg.lastIndexOf("</g>") + 4).replace(/translate\(72,\d+\) scale\([\d.]+\)/, "translate(72,72) scale(1.75)")
		: `<text x="72" y="96" font-size="64" fill="#fff" font-family="Arial" font-weight="bold" text-anchor="middle">km/h</text>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 144 144">${body.replaceAll("#8a919d", "#ffffff")}</svg>`;
}

mkdirSync(`${root}imgs/actions`, { recursive: true });
for (const id of Object.keys(actions)) {
	writeFileSync(`${root}imgs/actions/${id}-key.svg`, idle(id));
	writeFileSync(`${root}imgs/actions/${id}.svg`, listIcon(id));
}

const beacon = renderKey({ icon: "beacon", color: "#1e6bff", flash: 1 });
const pluginIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288" viewBox="0 0 144 144">
<rect width="144" height="144" rx="30" fill="#12151c"/><rect x="10" y="10" width="124" height="124" rx="22" fill="#1e6bff"/>
${beacon.slice(beacon.indexOf("<g transform"), beacon.lastIndexOf("</g>") + 4).replace(/translate\(72,\d+\) scale\([\d.]+\)/, "translate(72,76) scale(1.25)")}</svg>`;
const categoryIcon = listIcon("emergency");
writeFileSync(`${root}imgs/category.svg`, categoryIcon.replace('width="40" height="40"', 'width="28" height="28"'));

// imgs/plugin.png is a rendering of this SVG: node scripts/manifest.mjs --icon out.svg
if (process.argv.includes("--icon")) writeFileSync(process.argv.at(-1), pluginIcon);

const manifest = {
	$schema: "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
	Name: "BeamNG Bridge",
	Version: `${pkg.version}.0`,
	Author: "Max Baumann",
	Description:
		"Steuert Fahrzeugfunktionen in BeamNG.drive: Fahrzeug ein/aus, Blaulicht, Sirene, Licht, Blinker und mehr. Die Tasten zeigen live an, was im Spiel aktiv ist.",
	UUID: PREFIX.slice(0, -1),
	Icon: "imgs/plugin",
	Category: "BeamNG Bridge",
	CategoryIcon: "imgs/category",
	CodePath: "bin/plugin.js",
	SDKVersion: 2,
	Software: { MinimumVersion: "6.5" },
	OS: [
		{ Platform: "windows", MinimumVersion: "10" },
		{ Platform: "mac", MinimumVersion: "12" },
	],
	Nodejs: { Version: "20", Debug: "disabled" },
	Actions: Object.keys(actions).map((id) => ({
		Name: names[id][0],
		UUID: PREFIX + id.replace("_", "-"),
		Icon: `imgs/actions/${id}`,
		Tooltip: names[id][1],
		Controllers: ["Keypad"],
		PropertyInspectorPath: id === "power" || id === "info" ? `ui/${id}.html` : "ui/connection.html",
		UserTitleEnabled: false,
		States: [{ Image: `imgs/actions/${id}-key`, ShowTitle: false }],
	})),
};
writeFileSync(`${root}manifest.json`, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`manifest.json: ${manifest.Actions.length} actions (${Object.keys(texts).join(", ")})`);
