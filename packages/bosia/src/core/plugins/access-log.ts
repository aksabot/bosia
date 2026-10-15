import type { BosiaPlugin } from "../types/plugin.ts";

export interface AccessLogEntry {
	method: string;
	/** Path without the query string. */
	path: string;
	status: number;
	/** Time to build the response, in milliseconds (see serverTiming). */
	ms: number;
	request: Request;
}

export interface AccessLogOptions {
	/** Return false to skip a line, e.g. `(e) => e.status >= 400 || e.ms > 200`. */
	filter?: (entry: AccessLogEntry) => boolean;
	/** One line per request, without the trailing newline. */
	format?: (entry: AccessLogEntry) => string;
	/** Where lines go. Defaults to stdout on Bun, console.log on Workers. */
	write?: (chunk: string) => void;
	/**
	 * Lines are collected and written together at most this often (ms). One
	 * write per request costs a syscall each: on a pipe (`docker logs`, systemd)
	 * that was ~14µs of CPU per request, batched ~2µs. 0 writes every line at
	 * once. Defaults to 100 on Bun, 0 on Workers (no timers after a response).
	 */
	flushMs?: number;
}

/** Flush early once this much is waiting, so a burst never piles up in memory. */
const MAX_BUFFER_CHARS = 64 * 1024;

function defaultFormat(e: AccessLogEntry): string {
	return `[${e.method}] ${e.path} ${e.status} (${e.ms.toFixed(1)}ms)`;
}

function defaultWrite(): (chunk: string) => void {
	// Bun only: on Workers, nodejs_compat's process.stdout isn't the log stream.
	if (typeof Bun !== "undefined" && typeof process.stdout?.write === "function") {
		return (chunk) => void process.stdout.write(chunk);
	}
	return (chunk) => console.log(chunk.replace(/\n$/, ""));
}

/** Path of a request URL without allocating a URL object. */
function pathOf(url: string): string {
	const start = url.indexOf("/", url.indexOf("//") + 2);
	if (start === -1) return "/";
	const q = url.indexOf("?", start);
	return q === -1 ? url.slice(start) : url.slice(start, q);
}

/**
 * Logs one line per request: method, path, status, duration. Opt-in — the
 * app templates no longer log every request from `hooks.server.ts`; a reverse
 * proxy (nginx, Caddy) can keep the access log instead.
 *
 * Measured like serverTiming, from `onRequest` to `onAfterHandle`. A request
 * that throws past the handler is logged as 500.
 */
export function accessLog(options: AccessLogOptions = {}): BosiaPlugin {
	const format = options.format ?? defaultFormat;
	const write = options.write ?? defaultWrite();
	const flushMs = options.flushMs ?? (typeof Bun === "undefined" ? 0 : 100);
	const filter = options.filter;

	let buffer = "";
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (buffer === "") return;
		const out = buffer;
		buffer = "";
		try {
			write(out);
		} catch {
			// A broken log sink must not take requests down with it.
		}
	};

	const log = (entry: AccessLogEntry) => {
		if (filter && !filter(entry)) return;
		buffer += format(entry) + "\n";
		if (flushMs <= 0 || buffer.length >= MAX_BUFFER_CHARS) flush();
		else if (!timer) {
			timer = setTimeout(flush, flushMs);
			(timer as { unref?: () => void }).unref?.();
		}
	};

	// Lines still waiting when the server drains and exits.
	if (flushMs > 0 && typeof process !== "undefined" && typeof process.on === "function") {
		process.on("exit", flush);
	}

	return {
		name: "access-log",
		backend: {
			before(app) {
				const starts = new WeakMap<Request, number>();
				const entry = (request: Request, status: number): AccessLogEntry => {
					const start = starts.get(request);
					return {
						method: request.method,
						path: pathOf(request.url),
						status,
						ms: start === undefined ? 0 : performance.now() - start,
						request,
					};
				};
				return app
					.onRequest(({ request }) => {
						starts.set(request, performance.now());
					})
					.onAfterHandle(({ request, response, set }) => {
						// The same status the client gets: `set.status` wins, as in toResponse.
						const status = set.status ?? (response instanceof Response ? response.status : 200);
						log(entry(request, status));
					})
					.onError(({ request }) => {
						log(entry(request, 500));
					});
			},
		},
	};
}

export default accessLog;
