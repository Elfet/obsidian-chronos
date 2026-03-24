import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import obsidianPlugin from "eslint-plugin-obsidianmd";

export default [
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
				sourceType: "module",
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
			obsidianmd: obsidianPlugin,
		},
		rules: {
			...Object.fromEntries(
				Object.keys(obsidianPlugin.rules).map((rule) => [`obsidianmd/${rule}`, "warn"])
			),
		},
	},
];
