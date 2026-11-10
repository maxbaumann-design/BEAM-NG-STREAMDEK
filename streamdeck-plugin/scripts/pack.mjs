// Builds the two installable files in ../dist:
//   beamng_streamdeck_bridge.zip          -> BeamNG mods folder
//   com.maxbaumann.beamng.streamDeckPlugin -> double-click to install in Stream Deck
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const modDir = fileURLToPath(new URL("../../beamng-mod/", import.meta.url));
const pluginDir = fileURLToPath(new URL("../com.maxbaumann.beamng.sdPlugin", import.meta.url));

function files(dir, prefix = "") {
	return readdirSync(dir).sort().flatMap((name) =>
		statSync(dir + name).isDirectory() ? files(`${dir}${name}/`, `${prefix}${name}/`) : [prefix + name],
	);
}

/** Minimal zip writer (deflate), enough for a handful of text files. */
function zip(dir) {
	const parts = [];
	const central = [];
	let offset = 0;
	for (const name of files(dir)) {
		const data = readFileSync(dir + name);
		const packed = zlib.deflateRawSync(data);
		const header = Buffer.alloc(26);
		header.writeUInt16LE(20, 0); // version needed
		header.writeUInt16LE(8, 4); // deflate
		header.writeUInt32LE(0x00210000, 6); // fixed timestamp 1980-01-01 for reproducible output
		header.writeUInt32LE(zlib.crc32(data), 10);
		header.writeUInt32LE(packed.length, 14);
		header.writeUInt32LE(data.length, 18);
		header.writeUInt16LE(Buffer.byteLength(name), 22);
		const local = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), header, Buffer.from(name), packed]);
		const tail = Buffer.alloc(14);
		tail.writeUInt32LE(offset, 10);
		central.push(Buffer.concat([Buffer.from("PK\x01\x02\x14\x00", "latin1"), header, tail, Buffer.from(name)]));
		parts.push(local);
		offset += local.length;
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.write("PK\x05\x06", "latin1");
	end.writeUInt16LE(central.length, 8);
	end.writeUInt16LE(central.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, directory, end]);
}

mkdirSync(dist, { recursive: true });
rmSync(pluginDir + "/logs", { recursive: true, force: true });
writeFileSync(dist + "beamng_streamdeck_bridge.zip", zip(modDir));
execFileSync("npx", ["streamdeck", "pack", pluginDir, "--output", dist, "--force"], { stdio: "inherit", shell: process.platform === "win32" });
console.log(readdirSync(dist).join("\n"));
