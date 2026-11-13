// Shared model shapes (spec section 4). Documentation only; no runtime code.

/**
 * @typedef {'claude-code' | 'codex'} Source
 * @typedef {'session' | 'agent' | 'llm' | 'tool'} SpanKind
 * @typedef {'running' | 'ok' | 'error' | 'cancelled' | 'unknown'} SpanStatus
 * @typedef {'anthropic' | 'openai' | 'google' | 'other'} Provider
 * @typedef {'search' | 'web' | 'db' | 'git' | 'shell' | 'file' | 'edit' | 'agent' | 'mcp' | 'other'} ToolCategory
 */

/**
 * @typedef {object} Tokens
 * @property {number} input New input without cache.
 * @property {number} output
 * @property {number} [cacheRead]
 * @property {number} [cacheWrite]
 * @property {number} [reasoning]
 * @property {boolean} [includedInOutput] True when reasoning is already part of output.
 */

/**
 * @typedef {object} RunSpan
 * @property {string} id Unique within a source.
 * @property {string | null} parentId
 * @property {string} sessionId
 * @property {Source} source
 * @property {SpanKind} kind
 * @property {string} name
 * @property {SpanStatus} status
 * @property {number} start Epoch ms.
 * @property {number | null} end Null while running.
 * @property {boolean} [startApprox]
 * @property {string} [model]
 * @property {string} [agentType]
 * @property {Tokens} [tokens]
 * @property {{ usd: number | null, basis: 'reported' | 'priced' | 'unknown' }} [cost]
 * @property {{ message: string, code?: string | number }} [error]
 * @property {{ fileId: string, line: number }} ref
 * @property {number} [depth]
 * @property {'orchestrator' | 'worker' | 'watcher'} [role]
 * @property {string} [task]
 * @property {Provider} [provider]
 * @property {ToolCategory} [toolCategory]
 * @property {string} [toolBrand] simple-icons slug from brand-map.json.
 * @property {string} [command]
 * @property {string} [spawnsAgentId]
 * @property {boolean} [external] agent: another session (teammate), shown as a bare node.
 * @property {number} lastActivity
 * @property {number} seq
 */

/**
 * @typedef {object} SessionSummary
 * @property {string} id
 * @property {Source} source
 * @property {string} [title]
 * @property {string} project
 * @property {string} [cwd]
 * @property {string} [branch]
 * @property {number} start
 * @property {number | null} end
 * @property {number} lastWrite
 * @property {SpanStatus} status
 * @property {number} agentCount
 * @property {number} callCount
 * @property {number} errorCount
 * @property {Tokens & { usd: number | null }} totals
 * @property {string[]} models
 */

export {};
