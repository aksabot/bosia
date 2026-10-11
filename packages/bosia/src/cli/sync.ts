import { scanRoutes, RouteConflictError } from "../core/scanner.ts";
import { generateRoutesFile } from "../core/routeFile.ts";
import { clientDefaultTitle, loadAppHtmlTemplate } from "../core/appHtml.ts";
import { DEFAULT_TITLE } from "../core/headScan.ts";
import { generateRouteTypes, ensureRootDirs } from "../core/routeTypes.ts";
import { loadEnv, classifyEnvVars } from "../core/env.ts";
import { generateEnvModules } from "../core/envCodegen.ts";
import { findBrandPlaceholders, BRAND_SENTINEL } from "../core/brandGuard.ts";

export async function runSync() {
	const envMode = process.env.NODE_ENV === "production" ? "production" : "development";
	const classifiedEnv = classifyEnvVars(loadEnv(envMode));
	let manifest;
	try {
		manifest = scanRoutes();
	} catch (err) {
		if (!(err instanceof RouteConflictError)) throw err;
		console.error(`❌ ${err.message}`);
		process.exit(1);
	}
	generateRoutesFile(manifest, syncDefaultTitle());
	generateRouteTypes(manifest);
	ensureRootDirs();
	generateEnvModules(classifiedEnv);
	console.log("✅ Bosia codegen ready (.bosia/routes.ts, types, env modules)");

	const brandHits = findBrandPlaceholders();
	if (brandHits.length > 0) {
		console.error(
			`\n❌ ${BRAND_SENTINEL} placeholder left un-replaced in ${brandHits.length} spot(s):`,
		);
		for (const { file, line } of brandHits) console.error(`  • ${file}:${line}`);
		console.error(`\nReplace ${BRAND_SENTINEL} with the app's name (nav/header/footer).\n`);
		process.exit(1);
	}
}

/** app.html's title, as build passes it. A missing or broken app.html is the
 *  build's error to report; sync still writes the routes. */
function syncDefaultTitle(): string {
	try {
		return clientDefaultTitle(loadAppHtmlTemplate());
	} catch {
		return DEFAULT_TITLE;
	}
}
