/**
 * Turns a key description (see actions.js) into an SVG key image. Only basic
 * SVG features are used so the image renders the same in the Stream Deck app.
 */

const OFF_ICON = "#8a919d";
const FONT = 'font-family="Arial, Helvetica, sans-serif" font-weight="bold" text-anchor="middle"';

const esc = (text) =>
	String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function shade(hex, factor) {
	const n = Number.parseInt(hex.slice(1), 16);
	const ch = (shift) => {
		const v = (n >> shift) & 255;
		const out = factor < 1 ? v * factor : v + (255 - v) * (factor - 1);
		return Math.max(0, Math.min(255, Math.round(out)))
			.toString(16)
			.padStart(2, "0");
	};
	return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Icons are drawn inside a 72x72 box centred on (0,0). `c` is the line colour. */
const icons = {
	power: (c) =>
		`<path d="M-15,-17 A24,24 0 1 0 15,-17" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>` +
		`<line x1="0" y1="-30" x2="0" y2="-4" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,

	beacon: (c, d) => {
		const rays = (side, lit) => {
			const o = lit ? 1 : 0.25;
			return (
				`<g stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="${o}">` +
				`<line x1="${side * 25}" y1="-8" x2="${side * 35}" y2="-12"/>` +
				`<line x1="${side * 20}" y1="-22" x2="${side * 28}" y2="-31"/>` +
				`</g>`
			);
		};
		const active = d.flash !== undefined;
		return (
			`<path d="M-17,16 V-4 A17,17 0 0 1 17,-4 V16 Z" fill="${c}"/>` +
			`<rect x="-25" y="18" width="50" height="9" rx="3" fill="${c}"/>` +
			`<line x1="0" y1="-25" x2="0" y2="-34" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="${active ? 1 : 0.25}"/>` +
			rays(-1, active && d.flash === 0) +
			rays(1, active && d.flash === 1)
		);
	},

	siren: (c, d) => speaker(c, d.waves ?? 0, d.accent),
	horn: (c, d) => speaker(c, d.waves ?? 0),

	lowbeam: (c) => lamp(c, [-17, -6, 5, 16].map((y) => [y, y + 8])),
	highbeam: (c) => lamp(c, [-18, -6, 6, 18].map((y) => [y, y])),

	fog: (c) =>
		lamp(c, [-16, -4, 8].map((y) => [y, y + 6])) +
		`<path d="M-23,-22 q7,7 0,14 q-7,7 0,14 q7,7 0,14" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,

	hazard: (c) =>
		`<path d="M0,-28 L30,24 H-30 Z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>` +
		`<path d="M0,-9 L13,14 H-13 Z" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>`,

	left: (c) => `<path d="M-32,0 L-2,-28 V-12 H30 V12 H-2 V28 Z" fill="${c}"/>`,
	right: (c) => `<path d="M32,0 L2,-28 V-12 H-30 V12 H2 V28 Z" fill="${c}"/>`,

	parking: (c) =>
		`<circle cx="0" cy="0" r="21" fill="none" stroke="${c}" stroke-width="6"/>` +
		`<path d="M-27,-22 A35,35 0 0 0 -27,22" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>` +
		`<path d="M27,-22 A35,35 0 0 1 27,22" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>` +
		`<path d="M-6,13 V-12 H3 A7.5,7.5 0 0 1 3,3 H-6" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function speaker(c, waves, accent) {
	const arc = (r, i) =>
		`<path d="M${4 + r * 0.72},${-r * 0.72} A${r},${r} 0 0 1 ${4 + r * 0.72},${r * 0.72}" fill="none" ` +
		`stroke="${i === 0 && accent ? accent : c}" stroke-width="5.5" stroke-linecap="round" opacity="${waves > i || (i === 0 && accent) ? 1 : 0.22}"/>`;
	return `<path d="M-32,-10 H-20 L-2,-25 V25 L-20,10 H-32 Z" fill="${c}"/>` + [12, 23, 34].map(arc).join("");
}

function lamp(c, beams) {
	return (
		`<path d="M2,-25 H8 A25,25 0 0 1 8,25 H2 Z" fill="${c}"/>` +
		beams
			.map(
				([y1, y2]) =>
					`<line x1="-7" y1="${y1}" x2="-31" y2="${y2}" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/>`,
			)
			.join("")
	);
}

/** Outline drawings for the neon look, on the full 144x144 key. */
const neonIcons = {
	beacon:
		`<path d="M50,96 V72 A22,22 0 0 1 94,72 V96"/><rect x="41" y="96" width="62" height="13" rx="3"/>` +
		`<path d="M76,62 L64,81 H73 L68,95 L81,75 H72 Z"/>` +
		`<path d="M72,41 V32 M45,50 L38,43 M99,50 L106,43"/>`,
	horn:
		`<path d="M104,50 V92 C92,82 82,79 70,79 H42 V63 H70 C82,63 92,60 104,50 Z"/>` +
		`<path d="M42,71 H33 M33,65 V77"/><rect x="54" y="79" width="22" height="13" rx="6"/>`,
};

/** Neon outline key: frame and symbol in one colour with a soft glow. */
function renderNeon(d) {
	const color = d.unavailable ? "#4d525c" : d.color;
	const shape = `<rect x="15" y="15" width="114" height="114" rx="20"/>${neonIcons[d.neon]}`;
	const layer = (width, opacity) =>
		`<g fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round">${shape}</g>`;
	const note = d.unavailable
		? `<rect x="24" y="112" width="96" height="24" rx="8" fill="#05070a"/>` +
			`<text x="72" y="130" font-size="${fitText(d.status, 17, 90)}" fill="${d.unavailable === "offline" ? "#ff5a4f" : "#f2a100"}" ${FONT}>${esc(d.status)}</text>`
		: "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<desc>${esc(d.status ?? "")}</desc>` +
		`<rect width="144" height="144" fill="#05070a"/>` +
		(d.unavailable ? "" : layer(15, 0.12) + layer(9, 0.25)) +
		layer(4.5, 1) +
		(d.unavailable ? "" : `<g fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">${shape}</g>`) +
		note +
		`</svg>`
	);
}

function fitText(text, size, maxWidth) {
	const width = String(text).length * size * 0.66;
	return width > maxWidth ? Math.floor((size * maxWidth) / width) : size;
}

/**
 * @param {object} d key description from actions.describe()
 * @returns {string} SVG markup (144x144)
 */
export function renderKey(d) {
	if (d.neon) return renderNeon(d);
	const active = Boolean(d.color) && !d.unavailable;
	const lit = active && !d.dim;
	const base = d.color ?? "#2a2d34";

	const top = active ? shade(base, lit ? 1 : 0.42) : "#30333b";
	const bottom = active ? shade(base, lit ? 0.55 : 0.25) : "#191b20";
	const iconColor = d.unavailable ? "#4d525c" : active ? (lit ? "#ffffff" : shade(base, 1.45)) : OFF_ICON;
	const labelColor = d.unavailable ? "#6b717c" : active ? "#ffffff" : "#c5cad3";
	const statusColor = d.unavailable === "offline" ? "#ff5a4f" : d.unavailable ? "#f2a100" : active ? "#ffffff" : "#8a919d";

	let body = "";
	if (d.big !== undefined) {
		body +=
			`<text x="72" y="72" font-size="${fitText(d.big, 58, 120)}" fill="${d.unavailable ? "#4d525c" : "#ffffff"}" ${FONT}>${esc(d.big)}</text>` +
			`<text x="72" y="94" font-size="17" fill="${active ? shade(base, 1.5) : "#8a919d"}" ${FONT}>${esc(d.unit ?? "")}</text>`;
	} else if (d.icon && icons[d.icon]) {
		body += `<g transform="translate(72,${d.status ? 62 : 56}) scale(${d.status ? 0.88 : 1})">${icons[d.icon](iconColor, d)}</g>`;
	}

	let header = "";
	if (d.status && d.big === undefined) {
		const fill = active ? "#000000" : "#0f1013";
		header =
			`<rect x="8" y="8" width="128" height="24" rx="8" fill="${fill}" opacity="${active ? 0.35 : 0.9}"/>` +
			`<text x="72" y="26" font-size="${fitText(d.status, 17, 118)}" fill="${statusColor}" ${FONT}>${esc(d.status)}</text>`;
	} else if (d.status) {
		header = `<text x="72" y="26" font-size="${fitText(d.status, 17, 118)}" fill="${statusColor}" ${FONT}>${esc(d.status)}</text>`;
	}

	const label = d.label
		? `<text x="72" y="130" font-size="${fitText(d.label, 20, 124)}" fill="${labelColor}" ${FONT}>${esc(d.label)}</text>`
		: "";

	// flashing lightbar: brighten the side that is lit in this frame
	const glow =
		d.flash !== undefined && active
			? `<rect x="${d.flash === 0 ? 0 : 72}" y="0" width="72" height="144" fill="#ffffff" opacity="0.16"/>`
			: "";

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
		`<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
		`<rect width="144" height="144" fill="url(#bg)"/>` +
		glow +
		(active ? `<rect x="0" y="138" width="144" height="6" fill="#ffffff" opacity="${lit ? 0.85 : 0.3}"/>` : "") +
		header +
		body +
		label +
		`</svg>`
	);
}

export const toDataUrl = (svg) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
