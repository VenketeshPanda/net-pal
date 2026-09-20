import { DurableObject } from "cloudflare:workers";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const JWKS_TTL_MS = 10 * 60 * 1000;

// SVG is excluded on purpose: it can carry script and would execute if served same-origin.
const ALLOWED_IMAGE_TYPES = new Map([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/gif", "gif"],
]);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

const SYSTEM_PROMPT = `You are an extraction engine for a personal CRM.
Read the user's raw note and return JSON only.

- Return exactly this JSON shape:
	{ "contacts": [{ "name": "string", "facts": ["string"], "action_items": ["string"] }] }
- If multiple people are mentioned, separate them into completely distinct contact objects.
- NEVER group names together with "and".

Never invent information that is not in the note. Use empty strings and empty arrays when nothing applies.`;

const EXTRACTION_SCHEMA = {
	type: "object",
	properties: {
		contacts: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					facts: { type: "array", items: { type: "string" } },
					action_items: { type: "array", items: { type: "string" } },
				},
				required: ["name", "facts", "action_items"],
			},
		},
	},
	required: ["contacts"],
};

interface ExtractedContact {
	contact_name: string;
	new_facts: string[];
	action_items: string[];
}

interface Extraction {
	contacts: ExtractedContact[];
}

export interface ActionItem {
	item_key: string;
	item: string;
	related_contact_name: string | null;
	done: boolean;
	created_at: string;
	completed_at: string | null;
}

export interface ContactRecord {
	contact_key: string;
	contact_name: string;
	avatar_url: string | null;
	company_role: string | null;
	context_tag: string | null;
	facts: string[];
	action_items: ActionItem[];
	interactions: number;
	first_seen: string;
	updated_at: string;
}

export interface ContactBook {
	contacts: ContactRecord[];
	action_items: (ActionItem & { contact_key: string; contact_name: string })[];
}

export interface NetworkEntry {
	contact_key: string;
	contact_name: string;
	avatar_url: string | null;
	company_role: string | null;
	context_tag: string | null;
	interactions: number;
	updated_at: string;
	/** Open items only: graph edges are derived from these. */
	action_items: ActionItem[];
}

/** One instance per user: owns the full contact book for that user only. */
export class MyDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS contacts (
					contact_key TEXT PRIMARY KEY,
					contact_name TEXT NOT NULL,
					interactions INTEGER NOT NULL DEFAULT 0,
					first_seen TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);
			`);
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS contact_facts (
					contact_key TEXT NOT NULL,
					fact_key TEXT NOT NULL,
					fact TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (contact_key, fact_key)
				);
			`);
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS contact_action_items (
					contact_key TEXT NOT NULL,
					item_key TEXT NOT NULL,
					item TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (contact_key, item_key)
				);
			`);

			const addColumn = (table: string, column: string, definition: string) => {
				const exists = this.ctx.storage.sql
					.exec<{ name: string }>(`PRAGMA table_info(${table})`)
					.toArray()
					.some((row) => row.name === column);
				if (!exists) {
					this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
				}
			};

			addColumn("contacts", "avatar_url", "TEXT");
			addColumn("contacts", "company_role", "TEXT");
			addColumn("contacts", "context_tag", "TEXT");
			addColumn("contact_action_items", "related_contact_name", "TEXT");
			addColumn("contact_action_items", "done", "INTEGER NOT NULL DEFAULT 0");
			addColumn("contact_action_items", "completed_at", "TEXT");
		});
	}

	/** Merges extracted contacts into the user's contact map and returns all updated contacts. */
	async logInteraction(extraction: Extraction): Promise<ContactRecord[]> {
		const now = new Date().toISOString();
		const sql = this.ctx.storage.sql;
		const touchedKeys = new Set<string>();

		for (const extractedContact of extraction.contacts) {
			const contactName = extractedContact.contact_name.trim() || "Unknown";
			const key = contactKey(contactName);

			sql.exec(
				`INSERT INTO contacts (contact_key, contact_name, company_role, context_tag, interactions, first_seen, updated_at)
				 VALUES (?, ?, ?, ?, 1, ?, ?)
				 ON CONFLICT (contact_key) DO UPDATE SET
					contact_name = excluded.contact_name,
					company_role = COALESCE(NULLIF(excluded.company_role, ''), contacts.company_role),
					context_tag = COALESCE(NULLIF(excluded.context_tag, ''), contacts.context_tag),
					interactions = contacts.interactions + 1,
					updated_at = excluded.updated_at`,
				key,
				contactName,
				"",
				"",
				now,
				now,
			);

			for (const fact of extractedContact.new_facts) {
				sql.exec(
					`INSERT INTO contact_facts (contact_key, fact_key, fact, created_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT (contact_key, fact_key) DO NOTHING`,
					key,
					normalizeKey(fact),
					fact,
					now,
				);
			}

			for (const rawItem of extractedContact.action_items) {
				const item = rawItem.trim();
				if (!item) continue;
				const stableItemKey = normalizeKey(item);

				sql.exec(
					`INSERT INTO contact_action_items (contact_key, item_key, item, related_contact_name, created_at, done, completed_at)
					 VALUES (?, ?, ?, ?, ?, 0, NULL)
					 ON CONFLICT (contact_key, item_key) DO UPDATE SET
						item = excluded.item,
						related_contact_name = excluded.related_contact_name,
						done = 0,
						completed_at = NULL`,
					key,
					stableItemKey,
					item,
					null,
					now,
				);
			}

			touchedKeys.add(key);
		}

		const book = await this.listContacts();
		return book.contacts.filter((contact) => touchedKeys.has(contact.contact_key));
	}

	/** Upserts profile metadata for one contact. */
	async upsertContactDetails(input: {
		contact_name: string;
		company_role?: string | null;
		context_tag?: string | null;
		avatar_url?: string | null;
	}): Promise<ContactRecord> {
		const now = new Date().toISOString();
		const key = contactKey(input.contact_name);

		this.ctx.storage.sql.exec(
			`INSERT INTO contacts (contact_key, contact_name, company_role, context_tag, interactions, first_seen, updated_at, avatar_url)
			 VALUES (?, ?, ?, ?, 0, ?, ?, ?)
			 ON CONFLICT (contact_key) DO UPDATE SET
				contact_name = excluded.contact_name,
				company_role = COALESCE(NULLIF(excluded.company_role, ''), contacts.company_role),
				context_tag = COALESCE(NULLIF(excluded.context_tag, ''), contacts.context_tag),
				avatar_url = COALESCE(excluded.avatar_url, contacts.avatar_url),
				updated_at = excluded.updated_at`,
			key,
			input.contact_name,
			input.company_role ?? "",
			input.context_tag ?? "",
			now,
			now,
			input.avatar_url ?? null,
		);

		const book = await this.listContacts();
		return book.contacts.find((contact) => contact.contact_key === key)!;
	}

	async markActionItemDone(contactKey: string, itemKey: string, done: boolean): Promise<{ ok: true }> {
		this.ctx.storage.sql.exec(
			`UPDATE contact_action_items
			 SET done = ?,
				 completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE NULL END
			 WHERE contact_key = ? AND item_key = ?`,
			done ? 1 : 0,
			done ? 1 : 0,
			new Date().toISOString(),
			contactKey,
			itemKey,
		);
		return { ok: true };
	}

	async deleteContact(contactKey: string): Promise<{ ok: true }> {
		const key = normalizeContactKey(contactKey);
		this.ctx.storage.sql.exec("DELETE FROM contact_action_items WHERE contact_key = ?", key);
		this.ctx.storage.sql.exec("DELETE FROM contact_facts WHERE contact_key = ?", key);
		this.ctx.storage.sql.exec("DELETE FROM contacts WHERE contact_key = ?", key);
		return { ok: true };
	}

	async listNetwork(): Promise<NetworkEntry[]> {
		const actionRows = this.ctx.storage.sql
			.exec<{
				contact_key: string;
				item_key: string;
				item: string;
				related_contact_name: string | null;
				done: number;
				created_at: string;
				completed_at: string | null;
			}>(
				"SELECT contact_key, item_key, item, related_contact_name, done, created_at, completed_at FROM contact_action_items ORDER BY created_at, item_key",
			)
			.toArray();

		const actionsByContact = new Map<string, ActionItem[]>();
		for (const row of actionRows) {
			const list = actionsByContact.get(row.contact_key) ?? [];
			list.push({
				item_key: row.item_key,
				item: row.item,
				related_contact_name: row.related_contact_name,
				done: Boolean(row.done),
				created_at: row.created_at,
				completed_at: row.completed_at,
			});
			actionsByContact.set(row.contact_key, list);
		}

		return this.ctx.storage.sql
			.exec<{
				contact_key: string;
				contact_name: string;
				avatar_url: string | null;
				company_role: string | null;
				context_tag: string | null;
				interactions: number;
				updated_at: string;
			}>(
				"SELECT contact_key, contact_name, avatar_url, company_role, context_tag, interactions, updated_at FROM contacts ORDER BY updated_at DESC",
			)
			.toArray()
			.map((row) => ({
				...row,
				avatar_url: row.avatar_url ?? null,
				company_role: row.company_role ?? null,
				context_tag: row.context_tag ?? null,
				action_items: (actionsByContact.get(row.contact_key) ?? []).filter((item) => !item.done),
			}));
	}

	async listContacts(): Promise<ContactBook> {
		const sql = this.ctx.storage.sql;

		const factsByContact = new Map<string, string[]>();
		for (const row of sql
			.exec<{ contact_key: string; fact: string }>(
				"SELECT contact_key, fact FROM contact_facts ORDER BY created_at, fact_key",
			)
			.toArray()) {
			const list = factsByContact.get(row.contact_key) ?? [];
			list.push(row.fact);
			factsByContact.set(row.contact_key, list);
		}

		const actionRows = sql
			.exec<{
				contact_key: string;
				item_key: string;
				item: string;
				related_contact_name: string | null;
				done: number;
				created_at: string;
				completed_at: string | null;
			}>(
				"SELECT contact_key, item_key, item, related_contact_name, done, created_at, completed_at FROM contact_action_items ORDER BY created_at, item_key",
			)
			.toArray();

		const actionsByContact = new Map<string, ActionItem[]>();
		for (const row of actionRows) {
			const list = actionsByContact.get(row.contact_key) ?? [];
			list.push({
				item_key: row.item_key,
				item: row.item,
				related_contact_name: row.related_contact_name,
				done: Boolean(row.done),
				created_at: row.created_at,
				completed_at: row.completed_at,
			});
			actionsByContact.set(row.contact_key, list);
		}

		const contacts = sql
			.exec<{
				contact_key: string;
				contact_name: string;
				avatar_url: string | null;
				company_role: string | null;
				context_tag: string | null;
				interactions: number;
				first_seen: string;
				updated_at: string;
			}>(
				"SELECT contact_key, contact_name, avatar_url, company_role, context_tag, interactions, first_seen, updated_at FROM contacts ORDER BY updated_at DESC",
			)
			.toArray()
			.map((row) => ({
				...row,
				avatar_url: row.avatar_url ?? null,
				company_role: row.company_role ?? null,
				context_tag: row.context_tag ?? null,
				facts: factsByContact.get(row.contact_key) ?? [],
				action_items: actionsByContact.get(row.contact_key) ?? [],
			}));

		const nameByKey = new Map(contacts.map((contact) => [contact.contact_key, contact.contact_name]));

		return {
			contacts,
			action_items: actionRows.map((row) => ({
				contact_key: row.contact_key,
				contact_name: nameByKey.get(row.contact_key) ?? "Unknown",
				item_key: row.item_key,
				item: row.item,
				related_contact_name: row.related_contact_name,
				done: Boolean(row.done),
				created_at: row.created_at,
				completed_at: row.completed_at,
			})),
		};
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(request.url);
		const { pathname } = url;

		// Served before auth because <img> cannot send an Authorization header.
		// Object keys embed a random UUID, so they are unguessable and cannot be listed.
		if (pathname.startsWith("/api/avatar/") && request.method === "GET") {
			return serveAvatar(env, decodeURIComponent(pathname.slice("/api/avatar/".length)));
		}

		let claims: SupabaseClaims;
		try {
			claims = await verifySupabaseJwt(bearerToken(request), env);
		} catch (cause) {
			return json({ error: (cause as Error).message }, 401);
		}

		// Each user gets a dedicated Durable Object, so tenants can never read each other's data.
		const userId = claims.sub;
		const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(userId));

		if (pathname === "/api/log" && request.method === "POST") {
			const note = (await request.text()).trim();
			if (!note) {
				return json({ error: "Request body must contain note text" }, 400);
			}
			if (new TextEncoder().encode(note).byteLength > MAX_INPUT_BYTES) {
				return json({ error: "Note too large" }, 413);
			}

			let extraction: Extraction;
			try {
				extraction = await extract(env, note);
			} catch {
				return json({ error: "Failed to extract structured data from note" }, 502);
			}

			const contacts = await stub.logInteraction(extraction);
			return json({ extracted: extraction, contacts });
		}

		if (pathname === "/api/contacts" && request.method === "GET") {
			return json(await stub.listContacts());
		}

		if (pathname.startsWith("/api/contacts/") && request.method === "DELETE") {
			const contactKey = decodeURIComponent(pathname.slice("/api/contacts/".length));
			if (!contactKey.trim()) return json({ error: "contact_key is required" }, 400);
			return json(await stub.deleteContact(contactKey));
		}

		if (pathname === "/api/network" && request.method === "GET") {
			return json({ network: await stub.listNetwork() });
		}

		if (pathname === "/api/contact-details" && request.method === "POST") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json({ error: "Expected JSON body" }, 400);
			}

			if (typeof payload !== "object" || payload === null) {
				return json({ error: "Invalid body" }, 400);
			}

			const input = payload as Record<string, unknown>;
			const contactName = typeof input.contact_name === "string" ? input.contact_name.trim() : "";
			if (!contactName) {
				return json({ error: "contact_name is required" }, 400);
			}

			const companyRole = typeof input.company_role === "string" ? input.company_role.trim() : null;
			const contextTag = typeof input.context_tag === "string" ? input.context_tag.trim() : null;
			const contact = await stub.upsertContactDetails({
				contact_name: contactName,
				company_role: companyRole,
				context_tag: contextTag,
			});

			return json({ contact });
		}

		if (pathname === "/api/action-items/complete" && request.method === "POST") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return json({ error: "Expected JSON body" }, 400);
			}

			if (typeof payload !== "object" || payload === null) {
				return json({ error: "Invalid body" }, 400);
			}

			const input = payload as Record<string, unknown>;
			const contactKey = typeof input.contact_key === "string" ? input.contact_key : "";
			const itemKey = typeof input.item_key === "string" ? input.item_key : "";
			const done = Boolean(input.done);

			if (!contactKey || !itemKey) {
				return json({ error: "contact_key and item_key are required" }, 400);
			}

			return json(await stub.markActionItemDone(contactKey, itemKey, done));
		}

		if (pathname === "/api/upload-avatar" && request.method === "POST") {
			return uploadAvatar(request, env, url, userId, stub);
		}

		if (KNOWN_PATHS.has(pathname) || pathname.startsWith("/api/avatar/") || pathname.startsWith("/api/contacts/")) {
			return json({ error: "Method not allowed" }, 405);
		}

		return json({ error: "Not found" }, 404);
	},
} satisfies ExportedHandler<Env>;

const KNOWN_PATHS = new Set([
	"/api/log",
	"/api/contacts",
	"/api/network",
	"/api/upload-avatar",
	"/api/contact-details",
	"/api/action-items/complete",
]);

async function uploadAvatar(
	request: Request,
	env: Env,
	url: URL,
	userId: string,
	stub: DurableObjectStub<MyDurableObject>,
): Promise<Response> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: "Expected multipart/form-data body" }, 400);
	}

	const contactName = String(form.get("contact_name") ?? "").trim();
	if (!contactName) {
		return json({ error: "Field 'contact_name' is required" }, 400);
	}

	const file = form.get("file");
	if (!(file instanceof File)) {
		return json({ error: "Field 'file' must be an uploaded file" }, 400);
	}
	if (file.size === 0 || file.size > MAX_AVATAR_BYTES) {
		return json({ error: `Avatar must be between 1 byte and ${MAX_AVATAR_BYTES} bytes` }, 413);
	}

	const extension = ALLOWED_IMAGE_TYPES.get(file.type);
	if (!extension) {
		return json(
			{ error: `Unsupported image type. Allowed: ${[...ALLOWED_IMAGE_TYPES.keys()].join(", ")}` },
			415,
		);
	}

	// Namespacing by user id keeps one tenant's objects unreadable by another.
	const key = `avatars/${encodeURIComponent(userId)}/${slug(contactName)}-${crypto.randomUUID()}.${extension}`;
	await env.PROFILE_PICS.put(key, file.stream(), {
		httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
	});

	const base = env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
	const avatarUrl = base
		? `${base}/${key}`
		: new URL(`/api/avatar/${encodeURIComponent(key)}`, url.origin).toString();

	const contact = await stub.upsertContactDetails({
		contact_name: contactName,
		avatar_url: avatarUrl,
	});
	return json({ avatar_url: avatarUrl, contact });
}

async function serveAvatar(env: Env, key: string): Promise<Response> {
	if (!key.startsWith("avatars/") || key.includes("..")) {
		return json({ error: "Not found" }, 404);
	}

	const object = await env.PROFILE_PICS.get(key);
	if (!object) {
		return json({ error: "Not found" }, 404);
	}

	const headers = new Headers(CORS_HEADERS);
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(object.body, { headers });
}

function bearerToken(request: Request): string {
	const match = /^Bearer\s+(\S+)$/i.exec((request.headers.get("Authorization") ?? "").trim());
	if (!match) {
		throw new Error("Missing or malformed Authorization: Bearer <token> header");
	}
	return match[1];
}

interface SupabaseClaims {
	sub: string;
	email?: string;
	exp?: number;
	nbf?: number;
	iss?: string;
	aud?: string | string[];
}

/** Verifies a Supabase Auth JWT (HS256 via shared secret, or RS256/ES256 via the project JWKS). */
async function verifySupabaseJwt(token: string, env: Env): Promise<SupabaseClaims> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Malformed token");

	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
	const algorithm = VERIFY_ALGORITHMS[header.alg ?? ""];
	if (!algorithm) throw new Error("Unsupported token algorithm");

	const key = await resolveKey(header.alg!, header.kid, env);
	const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
	const valid = await crypto.subtle.verify(algorithm, key, base64UrlDecode(encodedSignature), signed);
	if (!valid) throw new Error("Invalid token signature");

	const claims = decodeJson<SupabaseClaims>(encodedPayload);
	const now = Math.floor(Date.now() / 1000);
	if (typeof claims.exp === "number" && claims.exp <= now) throw new Error("Token expired");
	if (typeof claims.nbf === "number" && claims.nbf > now) throw new Error("Token not yet valid");

	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!audience.includes("authenticated")) throw new Error("Unexpected token audience");

	const expectedIssuer = `${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
	if (claims.iss !== expectedIssuer) throw new Error("Unexpected token issuer");

	if (!claims.sub) throw new Error("Token is missing a subject");
	return claims;
}

const VERIFY_ALGORITHMS: Record<string, { name: string; hash?: string }> = {
	HS256: { name: "HMAC" },
	RS256: { name: "RSASSA-PKCS1-v1_5" },
	ES256: { name: "ECDSA", hash: "SHA-256" },
};

const IMPORT_ALGORITHMS: Record<string, { name: string; hash?: string; namedCurve?: string }> = {
	RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
	ES256: { name: "ECDSA", namedCurve: "P-256" },
};

let jwksCache: { expiresAt: number; keys: Map<string, CryptoKey> } | null = null;

async function resolveKey(alg: string, kid: string | undefined, env: Env): Promise<CryptoKey> {
	if (alg === "HS256") {
		if (!env.SUPABASE_JWT_SECRET) {
			throw new Error("SUPABASE_JWT_SECRET is not configured");
		}
		return crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
	}

	if (!kid) throw new Error("Token is missing a key id");

	if (!jwksCache || jwksCache.expiresAt < Date.now() || !jwksCache.keys.has(kid)) {
		jwksCache = { expiresAt: Date.now() + JWKS_TTL_MS, keys: await fetchJwks(env) };
	}

	const key = jwksCache.keys.get(kid);
	if (!key) throw new Error("Unknown signing key");
	return key;
}

async function fetchJwks(env: Env): Promise<Map<string, CryptoKey>> {
	const endpoint = `${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
	const response = await fetch(endpoint);
	if (!response.ok) throw new Error("Unable to fetch signing keys");

	const { keys } = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
	const imported = new Map<string, CryptoKey>();

	for (const jwk of keys ?? []) {
		const importParams = IMPORT_ALGORITHMS[jwk.alg ?? ""];
		if (!jwk.kid || !importParams) continue;
		imported.set(
			jwk.kid,
			await crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]),
		);
	}

	return imported;
}

function decodeJson<T>(segment: string): T {
	return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

function base64UrlDecode(segment: string): Uint8Array {
	const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: CORS_HEADERS });
}

async function extract(env: Env, note: string): Promise<Extraction> {
	const result = (await env.AI.run(MODEL, {
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: note },
		],
		response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
		max_tokens: 1024,
	} as never)) as { response?: unknown };

	const raw = result?.response;
	return validate(typeof raw === "string" ? JSON.parse(raw) : raw);
}

function validate(value: unknown): Extraction {
	if (typeof value !== "object" || value === null) {
		throw new Error("Model did not return a JSON object");
	}

	const candidate = value as Record<string, unknown>;

	const parsedContacts = Array.isArray(candidate.contacts)
		? candidate.contacts.map(parseContact).filter((entry): entry is ExtractedContact => Boolean(entry))
		: [parseContact(candidate)].filter((entry): entry is ExtractedContact => Boolean(entry));

	return {
		contacts: parsedContacts.length > 0 ? parsedContacts : [unknownContact()],
	};
}

function parseContact(value: unknown): ExtractedContact | null {
	if (typeof value !== "object" || value === null) return null;

	const candidate = value as Record<string, unknown>;
	const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

	return {
		contact_name: name || "Unknown",
		new_facts: toStringList(candidate.facts),
		action_items: toStringList(candidate.action_items),
	};
}

function unknownContact(): ExtractedContact {
	return {
		contact_name: "Unknown",
		new_facts: [],
		action_items: [],
	};
}

function toStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function contactKey(name: string): string {
	return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeContactKey(name: string): string {
	return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "contact"
	);
}
