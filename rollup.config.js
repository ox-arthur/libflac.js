// import webWorkerLoader from "rollup-plugin-web-worker-loader";
import typescript from "@rollup/plugin-typescript";
import { terser } from "rollup-plugin-terser";

export default {
	input: "src/worklet.ts",
	output: {
		file: "dist/encoder.bundled.js",
		name: "RollupAudioWorklet",
		format: "es",
	},
	plugins: [
		typescript(),
		terser(),
		// webWorkerLoader({ preserveSource: true }),
	],
};

