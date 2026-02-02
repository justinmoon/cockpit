/**
 * Enhanced Agent UI template - SSR HTML with client-side WebSocket
 *
 * Features:
 * - Real-time streaming with WebSocket
 * - Markdown rendering (basic)
 * - Collapsible tool output
 * - Abort button
 * - Thinking indicator
 * - Auto-scroll with user override
 */

import type { SpriteInfo } from "./templates.js";

export function agentUIPage(sprite: SpriteInfo): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(sprite.name)} - Pi Agent</title>
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

		* { box-sizing: border-box; margin: 0; padding: 0; }

		body {
			background: var(--bg);
			color: var(--text);
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			height: 100vh;
			display: flex;
			flex-direction: column;
		}

		/* Header */
		.header {
			padding: 0.75rem 1rem;
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
			background: var(--bg-secondary);
		}

		.header-left {
			display: flex;
			align-items: center;
			gap: 0.75rem;
		}

		.sprite-name {
			font-weight: 600;
			color: var(--text);
		}

		.sprite-cwd {
			font-family: ui-monospace, monospace;
			font-size: 0.8rem;
			color: var(--text-muted);
			background: var(--bg);
			padding: 0.2rem 0.5rem;
			border-radius: 4px;
		}

		.status {
			font-size: 0.8rem;
			padding: 0.25rem 0.6rem;
			border-radius: 4px;
			display: flex;
			align-items: center;
			gap: 0.4rem;
		}

		.status-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
		}

		.status.connected { background: rgba(34, 197, 94, 0.15); color: var(--success); }
		.status.connected .status-dot { background: var(--success); }
		.status.disconnected { background: rgba(239, 68, 68, 0.15); color: var(--error); }
		.status.disconnected .status-dot { background: var(--error); }
		.status.working { background: rgba(59, 130, 246, 0.15); color: var(--accent); }
		.status.working .status-dot { background: var(--accent); animation: pulse 1s infinite; }

		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.4; }
		}

		/* Messages */
		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 1rem;
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		.message {
			padding: 0.875rem 1rem;
			border-radius: 8px;
			max-width: 85%;
			line-height: 1.5;
			word-wrap: break-word;
		}

		.message.user {
			background: linear-gradient(135deg, #1e3a5f 0%, #1e3a8f 100%);
			align-self: flex-end;
			border-bottom-right-radius: 4px;
		}

		.message.assistant {
			background: var(--bg-secondary);
			border: 1px solid var(--border);
			align-self: flex-start;
			border-bottom-left-radius: 4px;
		}

		.message.assistant pre {
			background: var(--bg);
			padding: 0.75rem;
			border-radius: 4px;
			overflow-x: auto;
			margin: 0.5rem 0;
		}

		.message.assistant code {
			font-family: ui-monospace, monospace;
			font-size: 0.9em;
		}

		.message.assistant p { margin: 0.5rem 0; }
		.message.assistant p:first-child { margin-top: 0; }
		.message.assistant p:last-child { margin-bottom: 0; }

		/* Tool messages */
		.tool-group {
			background: var(--bg-secondary);
			border: 1px solid var(--border);
			border-radius: 8px;
			max-width: 100%;
			overflow: hidden;
		}

		.tool-header {
			padding: 0.5rem 0.75rem;
			background: var(--bg);
			border-bottom: 1px solid var(--border);
			display: flex;
			justify-content: space-between;
			align-items: center;
			cursor: pointer;
			user-select: none;
		}

		.tool-header:hover {
			background: var(--bg-hover);
		}

		.tool-name {
			font-family: ui-monospace, monospace;
			font-size: 0.85rem;
			color: var(--accent);
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}

		.tool-name::before {
			content: "▶";
			font-size: 0.7em;
			transition: transform 0.15s;
		}

		.tool-group.expanded .tool-name::before {
			transform: rotate(90deg);
		}

		.tool-status {
			font-size: 0.75rem;
			padding: 0.15rem 0.4rem;
			border-radius: 3px;
		}

		.tool-status.running { background: rgba(59, 130, 246, 0.15); color: var(--accent); }
		.tool-status.success { background: rgba(34, 197, 94, 0.15); color: var(--success); }
		.tool-status.error { background: rgba(239, 68, 68, 0.15); color: var(--error); }

		.tool-content {
			display: none;
			padding: 0.75rem;
			font-family: ui-monospace, monospace;
			font-size: 0.85rem;
			white-space: pre-wrap;
			max-height: 300px;
			overflow-y: auto;
			color: var(--text-muted);
		}

		.tool-group.expanded .tool-content {
			display: block;
		}

		.tool-params {
			color: var(--text-muted);
			border-bottom: 1px solid var(--border);
			padding-bottom: 0.5rem;
			margin-bottom: 0.5rem;
		}

		.tool-result {
			color: var(--text);
		}

		/* Error message */
		.message.error {
			background: rgba(239, 68, 68, 0.1);
			border: 1px solid rgba(239, 68, 68, 0.3);
			color: var(--error);
		}

		/* Thinking indicator */
		.thinking {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			color: var(--text-muted);
			font-size: 0.9rem;
			padding: 0.5rem;
		}

		.thinking-dots {
			display: flex;
			gap: 0.25rem;
		}

		.thinking-dots span {
			width: 6px;
			height: 6px;
			background: var(--text-muted);
			border-radius: 50%;
			animation: bounce 1.4s infinite ease-in-out;
		}

		.thinking-dots span:nth-child(1) { animation-delay: -0.32s; }
		.thinking-dots span:nth-child(2) { animation-delay: -0.16s; }

		@keyframes bounce {
			0%, 80%, 100% { transform: scale(0); }
			40% { transform: scale(1); }
		}

		/* Input area */
		.input-area {
			padding: 1rem;
			border-top: 1px solid var(--border);
			display: flex;
			gap: 0.5rem;
			background: var(--bg-secondary);
		}

		.input-wrapper {
			flex: 1;
			position: relative;
		}

		textarea {
			width: 100%;
			padding: 0.75rem 1rem;
			background: var(--bg);
			border: 1px solid var(--border);
			border-radius: 8px;
			color: var(--text);
			font-size: 1rem;
			font-family: inherit;
			resize: none;
			min-height: 44px;
			max-height: 200px;
			line-height: 1.4;
		}

		textarea:focus {
			outline: none;
			border-color: var(--accent);
		}

		textarea:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.btn {
			padding: 0.75rem 1.25rem;
			border: none;
			border-radius: 8px;
			font-size: 0.95rem;
			font-weight: 500;
			cursor: pointer;
			transition: background 0.15s;
		}

		.btn-primary {
			background: var(--accent);
			color: white;
		}

		.btn-primary:hover:not(:disabled) {
			background: var(--accent-hover);
		}

		.btn-primary:disabled {
			background: #333;
			cursor: not-allowed;
		}

		.btn-danger {
			background: rgba(239, 68, 68, 0.15);
			color: var(--error);
			border: 1px solid rgba(239, 68, 68, 0.3);
		}

		.btn-danger:hover {
			background: rgba(239, 68, 68, 0.25);
		}

		/* Scrollbar */
		::-webkit-scrollbar {
			width: 8px;
			height: 8px;
		}

		::-webkit-scrollbar-track {
			background: var(--bg);
		}

		::-webkit-scrollbar-thumb {
			background: var(--border);
			border-radius: 4px;
		}

		::-webkit-scrollbar-thumb:hover {
			background: #444;
		}
	</style>
</head>
<body>
	<div class="header">
		<div class="header-left">
			<span class="sprite-name">${escapeHtml(sprite.name)}</span>
			<span class="sprite-cwd">${escapeHtml(sprite.cwd)}</span>
		</div>
		<div class="status disconnected" id="status">
			<span class="status-dot"></span>
			<span id="status-text">Connecting...</span>
		</div>
	</div>

	<div class="messages" id="messages"></div>

	<div class="input-area">
		<div class="input-wrapper">
			<textarea id="input" rows="1" placeholder="Send a message..." disabled></textarea>
		</div>
		<button class="btn btn-primary" id="send" disabled>Send</button>
		<button class="btn btn-danger" id="abort" style="display: none;">Stop</button>
	</div>

	<script>
		const messagesEl = document.getElementById('messages');
		const inputEl = document.getElementById('input');
		const sendBtn = document.getElementById('send');
		const abortBtn = document.getElementById('abort');
		const statusEl = document.getElementById('status');
		const statusText = document.getElementById('status-text');

		let currentAssistant = null;
		let currentTool = null;
		let isStreaming = false;
		let autoScroll = true;

		// Check if user has scrolled up
		messagesEl.addEventListener('scroll', () => {
			const { scrollTop, scrollHeight, clientHeight } = messagesEl;
			autoScroll = scrollHeight - scrollTop - clientHeight < 50;
		});

		function scrollToBottom() {
			if (autoScroll) {
				messagesEl.scrollTop = messagesEl.scrollHeight;
			}
		}

		// Auto-resize textarea
		inputEl.addEventListener('input', () => {
			inputEl.style.height = 'auto';
			inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
		});

		// WebSocket setup
		const wsUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/api/sprites/${sprite.id}/ws';
		let ws;
		let reconnectAttempts = 0;

		function connect() {
			ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				setStatus('connected', 'Connected');
				inputEl.disabled = false;
				sendBtn.disabled = false;
				reconnectAttempts = 0;
				inputEl.focus();
			};

			ws.onclose = () => {
				setStatus('disconnected', 'Disconnected');
				inputEl.disabled = true;
				sendBtn.disabled = true;
				isStreaming = false;
				updateButtons();

				// Reconnect with backoff
				if (reconnectAttempts < 5) {
					reconnectAttempts++;
					setTimeout(connect, 1000 * reconnectAttempts);
				}
			};

			ws.onerror = () => {
				setStatus('disconnected', 'Error');
			};

			ws.onmessage = (e) => {
				try {
					const event = JSON.parse(e.data);
					console.debug('[ws] recv', event.type);
					handleEvent(event);
				} catch (err) {
					console.error('Failed to parse message:', err, e.data);
				}
			};
		}

		function setStatus(state, text) {
			statusEl.className = 'status ' + state;
			statusText.textContent = text;
		}

		function handleEvent(event) {
			switch (event.type) {
				case 'connected':
					break;

				case 'agent_start':
					isStreaming = true;
					setStatus('working', 'Working...');
					updateButtons();
					break;

				case 'agent_end':
					isStreaming = false;
					setStatus('connected', 'Connected');
					updateButtons();
					currentAssistant = null;
					break;

				case 'message_start':
					if (event.message?.role === 'assistant') {
						currentAssistant = addMessage('', 'assistant');
					}
					break;

				case 'message_update':
					if (event.assistantMessageEvent?.type === 'text_delta' && currentAssistant) {
						currentAssistant.innerHTML += escapeHtml(event.assistantMessageEvent.delta);
						scrollToBottom();
					}
					if (event.assistantMessageEvent?.type === 'thinking_delta') {
						// Could show thinking in a separate element
					}
					break;

				case 'message_end':
					if (currentAssistant) {
						// Convert markdown-like formatting
						currentAssistant.innerHTML = formatMarkdown(currentAssistant.textContent || '');
					}
					currentAssistant = null;
					break;

				case 'tool_execution_start':
					currentTool = addToolMessage(event.toolName, event.params, 'running');
					break;

				case 'tool_execution_update':
					// Could stream tool output here
					break;

				case 'tool_execution_end':
					if (currentTool) {
						updateToolResult(currentTool, event.result, event.isError);
					}
					currentTool = null;
					break;

				case 'error':
					addMessage(event.message || 'An error occurred', 'error');
					break;
			}
		}

		function updateButtons() {
			abortBtn.style.display = isStreaming ? 'block' : 'none';
			sendBtn.style.display = isStreaming ? 'none' : 'block';
		}

		function addMessage(text, type) {
			const div = document.createElement('div');
			div.className = 'message ' + type;
			div.textContent = text;
			messagesEl.appendChild(div);
			scrollToBottom();
			return div;
		}

		function addToolMessage(name, params, status) {
			const group = document.createElement('div');
			group.className = 'tool-group';

			const header = document.createElement('div');
			header.className = 'tool-header';
			header.innerHTML = \`
				<span class="tool-name">\${escapeHtml(name)}</span>
				<span class="tool-status \${status}">\${status}</span>
			\`;
			header.onclick = () => group.classList.toggle('expanded');

			const content = document.createElement('div');
			content.className = 'tool-content';

			const paramsDiv = document.createElement('div');
			paramsDiv.className = 'tool-params';
			paramsDiv.textContent = JSON.stringify(params, null, 2);

			const resultDiv = document.createElement('div');
			resultDiv.className = 'tool-result';

			content.appendChild(paramsDiv);
			content.appendChild(resultDiv);
			group.appendChild(header);
			group.appendChild(content);
			messagesEl.appendChild(group);
			scrollToBottom();

			return { group, resultDiv, statusEl: header.querySelector('.tool-status') };
		}

		function updateToolResult(tool, result, isError) {
			const statusClass = isError ? 'error' : 'success';
			const statusText = isError ? 'error' : 'done';
			tool.statusEl.className = 'tool-status ' + statusClass;
			tool.statusEl.textContent = statusText;

			if (result?.content) {
				const text = result.content.map(c => c.text || '').join('');
				tool.resultDiv.textContent = text.slice(0, 2000) + (text.length > 2000 ? '...' : '');
			}
		}

		function escapeHtml(str) {
			const div = document.createElement('div');
			div.textContent = str;
			return div.innerHTML;
		}

		function formatMarkdown(text) {
			// Very basic markdown formatting
			return text
				.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
				.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
				.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
				.replace(/\\n/g, '<br>');
		}

		function send() {
			const text = inputEl.value.trim();
			if (!text || isStreaming) return;

			addMessage(text, 'user');
			const payload = { type: 'prompt', payload: { text } };
			console.debug('[ws] send', payload);
			ws.send(JSON.stringify(payload));
			inputEl.value = '';
			inputEl.style.height = 'auto';
		}

		function abort() {
			console.debug('[ws] abort');
			ws.send(JSON.stringify({ type: 'abort' }));
		}

		// Event handlers
		sendBtn.onclick = send;
		abortBtn.onclick = abort;

		inputEl.onkeydown = (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				send();
			}
		};

		// Start connection
		connect();
	</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}
