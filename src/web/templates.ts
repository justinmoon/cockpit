/**
 * Simple HTML templates for SSR
 */

export function layout(title: string, content: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
	<style>
		:root {
			--bg: #0a0a0a;
			--bg-secondary: #141414;
			--bg-hover: #1a1a1a;
			--border: #2a2a2a;
			--text: #e5e5e5;
			--text-muted: #888;
			--accent: #3b82f6;
			--accent-hover: #2563eb;
			--success: #22c55e;
			--warning: #eab308;
			--error: #ef4444;
		}

		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
			background: var(--bg);
			color: var(--text);
			line-height: 1.6;
			min-height: 100vh;
		}

		.container {
			max-width: 1200px;
			margin: 0 auto;
			padding: 2rem;
		}

		header {
			border-bottom: 1px solid var(--border);
			padding-bottom: 1.5rem;
			margin-bottom: 2rem;
		}

		h1 {
			font-size: 1.75rem;
			font-weight: 600;
			display: flex;
			align-items: center;
			gap: 0.75rem;
		}

		h1 .logo {
			font-size: 2rem;
		}

		.subtitle {
			color: var(--text-muted);
			font-size: 0.9rem;
			margin-top: 0.25rem;
		}

		.sprite-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
			gap: 1rem;
		}

		.sprite-card {
			background: var(--bg-secondary);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 1.25rem;
			transition: border-color 0.15s, background 0.15s;
		}

		.sprite-card:hover {
			border-color: var(--accent);
			background: var(--bg-hover);
		}

		.sprite-card a {
			text-decoration: none;
			color: inherit;
			display: block;
		}

		.sprite-header {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			margin-bottom: 0.75rem;
		}

		.sprite-name {
			font-weight: 600;
			font-size: 1.1rem;
			color: var(--text);
		}

		.sprite-status {
			font-size: 0.75rem;
			padding: 0.25rem 0.5rem;
			border-radius: 4px;
			font-weight: 500;
		}

		.sprite-status.idle {
			background: rgba(34, 197, 94, 0.15);
			color: var(--success);
		}

		.sprite-status.working {
			background: rgba(59, 130, 246, 0.15);
			color: var(--accent);
		}

		.sprite-status.offline {
			background: rgba(239, 68, 68, 0.15);
			color: var(--error);
		}

		.sprite-meta {
			font-size: 0.85rem;
			color: var(--text-muted);
		}

		.sprite-meta .cwd {
			font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
			font-size: 0.8rem;
			background: var(--bg);
			padding: 0.15rem 0.35rem;
			border-radius: 3px;
		}

		.sprite-meta .last-activity {
			margin-top: 0.35rem;
		}

		.empty-state {
			text-align: center;
			padding: 4rem 2rem;
			color: var(--text-muted);
		}

		.empty-state h2 {
			font-size: 1.25rem;
			margin-bottom: 0.5rem;
			color: var(--text);
		}

		.btn {
			display: inline-flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
			background: var(--accent);
			color: white;
			border: none;
			border-radius: 6px;
			font-size: 0.9rem;
			font-weight: 500;
			cursor: pointer;
			text-decoration: none;
			transition: background 0.15s;
		}

		.btn:hover {
			background: var(--accent-hover);
		}

		.actions {
			margin-top: 1.5rem;
		}

		/* Agent page styles */
		.agent-container {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}

		.agent-header {
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.agent-header a {
			color: var(--text-muted);
			text-decoration: none;
			font-size: 0.9rem;
		}

		.agent-header a:hover {
			color: var(--text);
		}

		.agent-main {
			flex: 1;
			overflow: hidden;
		}

		.agent-main iframe {
			width: 100%;
			height: 100%;
			border: none;
		}

		.connection-status {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			font-size: 0.85rem;
		}

		.connection-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--success);
		}

		.connection-dot.disconnected {
			background: var(--error);
		}
	</style>
</head>
<body>
	${content}
</body>
</html>`;
}

export function dashboardPage(sprites: SpriteInfo[]): string {
	const content = `
	<div class="container">
		<header>
			<h1><span class="logo">π</span> Pi Dashboard</h1>
			<p class="subtitle">Manage your coding agent sessions</p>
		</header>

		${sprites.length === 0 ? emptyState() : spriteGrid(sprites)}

		<div class="actions">
			<a href="/sprites/new" class="btn">+ New Sprite</a>
		</div>
	</div>`;

	return layout("Pi Dashboard", content);
}

function emptyState(): string {
	return `
	<div class="empty-state">
		<h2>No sprites running</h2>
		<p>Create a new sprite to start a coding session.</p>
	</div>`;
}

function spriteGrid(sprites: SpriteInfo[]): string {
	return `
	<div class="sprite-grid">
		${sprites.map(spriteCard).join("\n")}
	</div>`;
}

function spriteCard(sprite: SpriteInfo): string {
	const statusClass = sprite.status;
	const statusLabel = sprite.status.charAt(0).toUpperCase() + sprite.status.slice(1);

	// Extract repo name from URL for display
	const repoDisplay = sprite.repo
		? sprite.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
		: sprite.cwd;

	return `
	<div class="sprite-card">
		<a href="/sprites/${escapeHtml(sprite.id)}">
			<div class="sprite-header">
				<span class="sprite-name">${escapeHtml(sprite.name)}</span>
				<span class="sprite-status ${statusClass}">${statusLabel}</span>
			</div>
			<div class="sprite-meta">
				<div><span class="cwd">${escapeHtml(repoDisplay)}</span>${sprite.branch ? ` <span style="color: var(--accent);">(${escapeHtml(sprite.branch)})</span>` : ""}</div>
				${sprite.lastActivity ? `<div class="last-activity">Last activity: ${escapeHtml(formatRelativeTime(sprite.lastActivity))}</div>` : ""}
			</div>
		</a>
	</div>`;
}

export function agentPage(sprite: SpriteInfo): string {
	const content = `
	<div class="agent-container">
		<div class="agent-header">
			<a href="/">← Back to Dashboard</a>
			<div>
				<strong>${escapeHtml(sprite.name)}</strong>
				<span style="color: var(--text-muted); margin-left: 0.5rem;">${escapeHtml(sprite.cwd)}</span>
			</div>
			<div class="connection-status">
				<span class="connection-dot" id="status-dot"></span>
				<span id="status-text">Connected</span>
			</div>
		</div>
		<div class="agent-main">
			<iframe src="/sprites/${escapeHtml(sprite.id)}/ui" id="agent-frame"></iframe>
		</div>
	</div>
	<script>
		// Simple connection status check
		const dot = document.getElementById('status-dot');
		const text = document.getElementById('status-text');
		const frame = document.getElementById('agent-frame');

		frame.addEventListener('load', () => {
			dot.classList.remove('disconnected');
			text.textContent = 'Connected';
		});

		frame.addEventListener('error', () => {
			dot.classList.add('disconnected');
			text.textContent = 'Disconnected';
		});
	</script>`;

	return layout(`${sprite.name} - Pi`, content);
}

export function newSpritePage(error?: string): string {
	const content = `
	<div class="container" style="max-width: 500px;">
		<header>
			<h1>New Sprite</h1>
			<p class="subtitle">Create a new coding agent session</p>
		</header>

		${error ? `<div style="background: rgba(239, 68, 68, 0.15); color: var(--error); padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem;">${escapeHtml(error)}</div>` : ""}

		<form method="POST" action="/sprites/new" style="display: flex; flex-direction: column; gap: 1rem;">
			<div>
				<label for="name" style="display: block; margin-bottom: 0.35rem; font-size: 0.9rem;">Name</label>
				<input type="text" id="name" name="name" required
					placeholder="feature-auth"
					style="width: 100%; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem;">
				<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">A short name for this session</p>
			</div>

			<div>
				<label for="repo" style="display: block; margin-bottom: 0.35rem; font-size: 0.9rem;">Git Repository</label>
				<input type="text" id="repo" name="repo" required
					placeholder="https://github.com/user/repo"
					style="width: 100%; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem; font-family: ui-monospace, monospace;">
				<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Will be cloned into the sprite's workspace</p>
			</div>

			<div>
				<label for="branch" style="display: block; margin-bottom: 0.35rem; font-size: 0.9rem;">Branch (optional)</label>
				<input type="text" id="branch" name="branch"
					placeholder="main"
					style="width: 100%; padding: 0.5rem 0.75rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 1rem;">
			</div>

			<div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
				<button type="submit" class="btn">Create Sprite</button>
				<a href="/" style="padding: 0.5rem 1rem; color: var(--text-muted); text-decoration: none;">Cancel</a>
			</div>
		</form>
	</div>`;

	return layout("New Sprite - Pi", content);
}

export function errorPage(title: string, message: string): string {
	const content = `
	<div class="container" style="text-align: center; padding-top: 4rem;">
		<h1 style="color: var(--error);">${escapeHtml(title)}</h1>
		<p style="color: var(--text-muted); margin-top: 1rem;">${escapeHtml(message)}</p>
		<a href="/" class="btn" style="margin-top: 2rem;">Back to Dashboard</a>
	</div>`;

	return layout(title, content);
}

// Types
export interface SpriteInfo {
	id: string;
	name: string;
	cwd: string;
	repo?: string;
	branch?: string;
	status: "idle" | "working" | "offline";
	lastActivity?: Date;
	url?: string;
}

// Helpers
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return `${days}d ago`;
}
