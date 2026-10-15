import type { BosiaPlugin } from "../types/plugin.ts";

export interface AccessLogEntry {
	method: string;
	/** Path without the query string. */
	path: string;
	/** The status the client got. */
	status: number;
	/** Time to build the response, in milliseconds (not to deliver its body). */
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

/** Flush early once this much is waiting, so a burst never piles up here. */
const MAX_BUFFER_CHARS = 64 * 1024;
/** Stdout bytes still unsent past which new lines are dropped (a stalled pipe). */
const MAX_PENDING_STDOUT = 1024 * 1024;

function defaultFormat(e: AccessLogEntry): string {
	return `[${e.method}] ${e.path} ${e.status} (${e.ms.toFixed(1)}ms)`;
}

function defaultWrite(): (chunk: string) => void {
	// Bun only: on Workers, nodejs_compat's process.stdout isn't the log stream.
	if (typeof Bun === "undefined" || typeof process.stdout?.write !== "function") {
		return (chunk) => console.log(chunk.replace(/\n$/, ""));
	}
	const stdout = process.stdout;
	let dropped = 0;
	return (chunk) => {
		// A consumer that stopped reading (backed-up log driver) would otherwise
		// grow the stream's buffer without limit. Drop and say how many.
		if ((stdout.writableLength ?? 0) > MAX_PENDING_STDOUT) {
			for (let i = chunk.indexOf("\n"); i !== -1; i = chunk.indexOf("\n", i + 1)) dropped++;
			return;
		}
		if (dropped > 0) {
			chunk = `[access-log] ${dropped} line(s) dropped: stdout is not keeping up\n${chunk}`;
			dropped = 0;
		}
		stdout.write(chunk);
	};
}

/** Path of a request URL without allocating a URL object. */
function pathOf(url: string): string {
	const start = url.indexOf("/", url.indexOf("//") + 2);
	if (start === -1) return "/";
	const q = url.indexOf("?", start);
	return q === -1 ? url.slice(start) : url.slice(start, q);
}

// One process "exit" listener for every logger, added on the first buffered
// line — so `bosia build` (which also loads the config) never registers one.
const pendingFlushes = new Set<() => void>();
let exitHooked = false;
function flushOnExit(flush: () => void): void {
	pendingFlushes.add(flush);
	if (exitHooked || typeof process === "undefined" || typeof process.on !== "function") return;
	exitHooked = true;
	process.on("exit", () => {
		for (const f of pendingFlushes) {
			try {
				f();
			} catch {
				// Keep flushing the other loggers.
			}
		}
	});
}

/**
 * Logs one line per request: method, path, status, duration. Opt-in — the
 * app templates no longer log every request from `hooks.server.ts`; a reverse
 * proxy (nginx, Caddy) can keep the access log instead.
 *
 * Reads the final response (`onResponse`), so the status is what the client
 * got whatever other plugins did, and every request is logged exactly once.
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
		write(out);
	};

	const log = (entry: AccessLogEntry) => {
		if (filter && !filter(entry)) return;
		buffer += format(entry) + "\n";
		if (flushMs <= 0 || buffer.length >= MAX_BUFFER_CHARS) flush();
		else if (!timer) {
			flushOnExit(flush);
			timer = setTimeout(() => {
				try {
					flush();
				} catch {
					// A broken sink loses this batch, not the process.
				}
			}, flushMs);
			(timer as { unref?: () => void }).unref?.();
		}
	};

	return {
		name: "access-log",
		backend: {
			before(app) {
				// onResponse swallows a throw here (a broken filter/format/sink),
				// so logging can never change or fail a response.
				return app.onResponse(({ request, response, start }) => {
					log({
						method: request.method,
						path: pathOf(request.url),
						status: response.status,
						ms: performance.now() - start,
						request,
					});
				});
			},
		},
	};
}

export default accessLog;
