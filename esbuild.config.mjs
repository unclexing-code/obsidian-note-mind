import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const isWatch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: true,
  external: ["obsidian", "electron", ...builtins]
});

if (isWatch) {
  await context.watch();
  // eslint-disable-next-line no-console
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
