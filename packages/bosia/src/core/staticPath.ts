// URLs the server answers as static files, never as pages. No imports and no top-level
// work: the build loads this before loadEnv(), so it must not touch env or the base path.

const STATIC_EXTS = new Set([
	".ico",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".css",
	".js",
	".woff",
	".woff2",
	".ttf",
	".xml",
	".txt",
	".json",
	".webmanifest",
]);

// The server answers these itself; prerender rejects entries() values that reach them.
export const HEALTH_PATH = "/_health";

// The framework's own folders: built assets and data/runtime endpoints.
export function isFrameworkPath(path: string): boolean {
	return path.startsWith("/dist/") || path.startsWith("/__bosia/");
}

export function isStaticPath(path: string): boolean {
	if (isFrameworkPath(path)) return true;
	const dot = path.lastIndexOf(".");
	return dot !== -1 && STATIC_EXTS.has(path.slice(dot));
}
