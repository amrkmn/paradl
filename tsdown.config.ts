import { defineConfig } from "tsdown";

export default defineConfig({
    entry: {
        index: "./src/index.ts",
        "cli/index": "./src/cli/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node18",
    platform: "node",
    treeshake: true,
    minify: false,
    sourcemap: true,
    shims: true,
    exports: {
        exclude: ["cli/index"],
    },
});
