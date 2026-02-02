export type LogLevel = "info" | "warn" | "error";

function format(level: LogLevel, message: string) {
	const ts = new Date().toISOString();
	return `[${ts}] [${level}] ${message}`;
}

export function log(message: string) {
	console.log(format("info", message));
}

export function warn(message: string) {
	console.warn(format("warn", message));
}

export function error(message: string) {
	console.error(format("error", message));
}
