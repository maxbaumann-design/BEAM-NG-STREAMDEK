import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";

export default {
	input: "src/plugin.js",
	output: {
		file: "com.maxbaumann.beamng.sdPlugin/bin/plugin.js",
		format: "esm",
		inlineDynamicImports: true,
	},
	plugins: [nodeResolve({ preferBuiltins: true, exportConditions: ["node"] }), commonjs()],
	onwarn(warning, warn) {
		if (warning.code === "CIRCULAR_DEPENDENCY" || warning.code === "THIS_IS_UNDEFINED") return;
		warn(warning);
	},
};
