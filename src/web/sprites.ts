/**
 * Sprite management - tracks running pi agent sessions
 *
 * In production, sprites are Fly.io VMs. For local dev, we can run
 * agents in-process or connect to remote sprites.
 */

import type { SpriteInfo } from "./templates";

export interface SpriteConfig {
	id: string;
	name: string;
	cwd: string;
	/** Git repository URL to clone */
	repo?: string;
	/** Branch to checkout */
	branch?: string;
	/** URL where the sprite's pi-web-ui is served (for remote sprites) */
	url?: string;
}

export interface SpriteStore {
	list(): Promise<SpriteInfo[]>;
	get(id: string): Promise<SpriteInfo | null>;
	create(config: Omit<SpriteConfig, "id">): Promise<SpriteInfo>;
	delete(id: string): Promise<void>;
	updateStatus(id: string, status: SpriteInfo["status"]): Promise<void>;
}

/**
 * In-memory sprite store for development/testing
 */
export class MemorySpriteStore implements SpriteStore {
	private sprites = new Map<string, SpriteInfo>();

	async list(): Promise<SpriteInfo[]> {
		return Array.from(this.sprites.values()).sort((a, b) => {
			// Sort by last activity, most recent first
			const aTime = a.lastActivity?.getTime() ?? 0;
			const bTime = b.lastActivity?.getTime() ?? 0;
			return bTime - aTime;
		});
	}

	async get(id: string): Promise<SpriteInfo | null> {
		return this.sprites.get(id) ?? null;
	}

	async create(config: Omit<SpriteConfig, "id">): Promise<SpriteInfo> {
		const id = crypto.randomUUID().slice(0, 8);
		const sprite: SpriteInfo = {
			id,
			name: config.name,
			cwd: config.cwd,
			repo: config.repo,
			branch: config.branch,
			url: config.url,
			status: "idle",
			lastActivity: new Date(),
		};
		this.sprites.set(id, sprite);
		return sprite;
	}

	async delete(id: string): Promise<void> {
		this.sprites.delete(id);
	}

	async updateStatus(id: string, status: SpriteInfo["status"]): Promise<void> {
		const sprite = this.sprites.get(id);
		if (sprite) {
			sprite.status = status;
			sprite.lastActivity = new Date();
		}
	}
}

/**
 * File-based sprite store - persists to a JSON file
 */
export class FileSpriteStore implements SpriteStore {
	private sprites = new Map<string, SpriteInfo>();
	private loaded = false;

	constructor(private filePath: string) {}

	private async load(): Promise<void> {
		if (this.loaded) return;

		try {
			const file = Bun.file(this.filePath);
			if (await file.exists()) {
				const data = await file.json();
				for (const sprite of data.sprites ?? []) {
					// Restore Date objects
					if (sprite.lastActivity) {
						sprite.lastActivity = new Date(sprite.lastActivity);
					}
					this.sprites.set(sprite.id, sprite);
				}
			}
		} catch {
			// File doesn't exist or is invalid, start fresh
		}
		this.loaded = true;
	}

	private async save(): Promise<void> {
		const data = {
			sprites: Array.from(this.sprites.values()),
		};
		await Bun.write(this.filePath, JSON.stringify(data, null, 2));
	}

	async list(): Promise<SpriteInfo[]> {
		await this.load();
		return Array.from(this.sprites.values()).sort((a, b) => {
			const aTime = a.lastActivity?.getTime() ?? 0;
			const bTime = b.lastActivity?.getTime() ?? 0;
			return bTime - aTime;
		});
	}

	async get(id: string): Promise<SpriteInfo | null> {
		await this.load();
		return this.sprites.get(id) ?? null;
	}

	async create(config: Omit<SpriteConfig, "id">): Promise<SpriteInfo> {
		await this.load();
		const id = crypto.randomUUID().slice(0, 8);
		const sprite: SpriteInfo = {
			id,
			name: config.name,
			cwd: config.cwd,
			repo: config.repo,
			branch: config.branch,
			url: config.url,
			status: "idle",
			lastActivity: new Date(),
		};
		this.sprites.set(id, sprite);
		await this.save();
		return sprite;
	}

	async delete(id: string): Promise<void> {
		await this.load();
		this.sprites.delete(id);
		await this.save();
	}

	async updateStatus(id: string, status: SpriteInfo["status"]): Promise<void> {
		await this.load();
		const sprite = this.sprites.get(id);
		if (sprite) {
			sprite.status = status;
			sprite.lastActivity = new Date();
			await this.save();
		}
	}
}

/**
 * Creates the appropriate sprite store based on configuration
 */
export function createSpriteStore(dataDir?: string): SpriteStore {
	if (dataDir) {
		const filePath = `${dataDir}/sprites.json`;
		return new FileSpriteStore(filePath);
	}
	return new MemorySpriteStore();
}
