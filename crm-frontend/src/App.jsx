import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import ReactFlow, {
	Background,
	Controls,
	Handle,
	MarkerType,
	Position,
	useEdgesState,
	useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://crm-social-backend.vp-dev.workers.dev";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase =
	SUPABASE_URL && SUPABASE_ANON_KEY
		? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
				auth: {
					detectSessionInUrl: true,
					flowType: "implicit",
					persistSession: true,
					autoRefreshToken: true,
				},
			})
		: null;

async function callApi(path, { token, method = "GET", body, contentType } = {}) {
	const response = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(contentType ? { "Content-Type": contentType } : {}),
		},
		body,
	});

	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
	}
	return payload;
}

export default function App() {
	const [session, setSession] = useState(null);
	const [ready, setReady] = useState(false);
	const [authError, setAuthError] = useState(readOAuthError);

	useEffect(() => {
		if (!supabase) {
			setReady(true);
			return;
		}

		let active = true;

		supabase.auth.getSession().then(({ data, error }) => {
			if (!active) return;
			if (error) setAuthError(error.message);
			setSession((current) => current ?? data.session);
			setReady(true);
		});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, nextSession) => {
			setSession(nextSession);
			setReady(true);
			if (nextSession) setAuthError("");
		});

		return () => {
			active = false;
			subscription.unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (session) clearOAuthParams();
	}, [session]);

	useEffect(() => {
		clearErrorParams();
	}, []);

	return (
		<div className="min-h-screen bg-zinc-950 bg-[radial-gradient(70rem_46rem_at_50%_-12%,rgba(244,244,245,0.08),transparent)] text-zinc-100">
			{!supabase ? (
				<ConfigNotice />
			) : !ready ? (
				<Splash message="Restoring session..." />
			) : session ? (
				<Dashboard session={session} />
			) : (
				<SignIn authError={authError} />
			)}
		</div>
	);
}

function readOAuthError() {
	const query = new URLSearchParams(window.location.search);
	const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
	return (
		query.get("error_description") ??
		hash.get("error_description") ??
		query.get("error") ??
		hash.get("error") ??
		""
	);
}

function clearErrorParams() {
	const url = new URL(window.location.href);
	const keys = ["error", "error_code", "error_description"];
	if (!keys.some((key) => url.searchParams.has(key))) return;

	for (const key of keys) url.searchParams.delete(key);
	window.history.replaceState({}, "", url.toString());
}

function clearOAuthParams() {
	const url = new URL(window.location.href);
	const consumed = ["code", "state", "error", "error_code", "error_description"];
	const hadParams = consumed.some((key) => url.searchParams.has(key));

	for (const key of consumed) url.searchParams.delete(key);
	if (url.hash.includes("access_token")) url.hash = "";

	if (hadParams || !url.hash) {
		window.history.replaceState({}, "", url.toString());
	}
}

function Splash({ message }) {
	return (
		<main className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
			{message}
		</main>
	);
}

function ConfigNotice() {
	return (
		<main className="flex min-h-screen items-center justify-center px-6">
			<div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl shadow-black/30 backdrop-blur">
				<h1 className="text-lg font-semibold text-amber-100">Supabase is not configured</h1>
				<p className="mt-3 text-sm text-amber-100/70">
					Copy <code className="text-amber-200">.env.example</code> to{" "}
					<code className="text-amber-200">.env</code> and set{" "}
					<code className="text-amber-200">VITE_SUPABASE_URL</code> and{" "}
					<code className="text-amber-200">VITE_SUPABASE_ANON_KEY</code>, then restart the dev
					server.
				</p>
			</div>
		</main>
	);
}

function SignIn({ authError }) {
	const [pending, setPending] = useState("");
	const [error, setError] = useState(authError ?? "");

	const signInWith = async (provider) => {
		setPending(provider);
		setError("");
		const { error: cause } = await supabase.auth.signInWithOAuth({
			provider,
			options: { redirectTo: window.location.origin },
		});
		if (cause) {
			setError(cause.message);
			setPending("");
		}
	};

	return (
		<main className="flex min-h-screen items-center justify-center px-6">
			<div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl shadow-black/35 backdrop-blur">
				<h1 className="text-2xl font-semibold tracking-tight">Personal CRM</h1>
				<p className="mt-2 text-sm text-zinc-400">Sign in to open your private social memory.</p>

				<div className="mt-8 space-y-3">
					<button
						type="button"
						onClick={() => signInWith("google")}
						disabled={Boolean(pending)}
						className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-50"
					>
						<GoogleMark />
						{pending === "google" ? "Redirecting..." : "Continue with Google"}
					</button>
					<button
						type="button"
						onClick={() => signInWith("github")}
						disabled={Boolean(pending)}
						className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
					>
						<GithubMark />
						{pending === "github" ? "Redirecting..." : "Continue with GitHub"}
					</button>
				</div>

				<p className="mt-6 text-xs text-zinc-500">New accounts are created automatically on first sign-in.</p>
				{error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
			</div>
		</main>
	);
}

function DashboardErrorState({ error }) {
	if (!error) return null;

	const normalized = error.toLowerCase();
	const isSilent = /aborted|cancelled|canceled|signal/.test(normalized);
	if (isSilent) return null;

	const isNotFound = /not found|status 404|404/.test(normalized);
	if (isNotFound) {
		return (
			<section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
				<h3 className="text-sm font-semibold text-zinc-200">Nothing to display yet</h3>
				<p className="mt-1 text-sm text-zinc-400">
					We could not find data for this view right now. Add a new note or refresh in a moment.
				</p>
			</section>
		);
	}

	return (
		<p className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
			{error}
		</p>
	);
}

function Dashboard({ session }) {
	const token = session.access_token;
	const [tab, setTab] = useState("feed");
	const [contacts, setContacts] = useState([]);
	const [actionItems, setActionItems] = useState([]);
	const [network, setNetwork] = useState([]);
	const [note, setNote] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [removingEdges, setRemovingEdges] = useState(new Set());

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [book, net] = await Promise.all([
				callApi("/api/contacts", { token }),
				callApi("/api/network", { token }),
			]);
			setContacts(book?.contacts ?? []);
			setActionItems((book?.action_items ?? []).filter((item) => !item.done));
			setNetwork(net?.network ?? []);
			setError("");
		} catch (cause) {
			setError(cause.message);
		} finally {
			setLoading(false);
		}
	}, [token]);

	useEffect(() => {
		load();
	}, [load]);

	const handleLog = async (event) => {
		event.preventDefault();
		const text = note.trim();
		if (!text || saving) return;

		setSaving(true);
		setError("");
		try {
			await callApi("/api/log", { token, method: "POST", body: text, contentType: "text/plain" });
			setNote("");
			await load();
		} catch (cause) {
			setError(cause.message);
		} finally {
			setSaving(false);
		}
	};

	const uploadAvatar = async (contactName, file) => {
		const form = new FormData();
		form.append("contact_name", contactName);
		form.append("file", file);

		setError("");
		try {
			await callApi("/api/upload-avatar", { token, method: "POST", body: form });
			await load();
		} catch (cause) {
			setError(cause.message);
		}
	};

	const saveDetails = async (payload) => {
		setError("");
		try {
			await callApi("/api/contact-details", {
				token,
				method: "POST",
				body: JSON.stringify(payload),
				contentType: "application/json",
			});
			await load();
		} catch (cause) {
			setError(cause.message);
		}
	};

	const deleteContact = async (contactKey) => {
		const key = String(contactKey ?? "").trim();
		if (!key) return;

		setError("");
		const previousContacts = contacts;
		const previousNetwork = network;
		const previousActionItems = actionItems;

		setContacts((current) => current.filter((contact) => contact.contact_key !== key));
		setNetwork((current) => current.filter((contact) => contact.contact_key !== key));
		setActionItems((current) => current.filter((item) => item.contact_key !== key));

		try {
			await callApi(`/api/contacts/${encodeURIComponent(key)}`, {
				token,
				method: "DELETE",
			});
		} catch (cause) {
			setContacts(previousContacts);
			setNetwork(previousNetwork);
			setActionItems(previousActionItems);
			setError(cause.message);
		}
	};

	const toggleComplete = async ({ contact_key, item_key, edge_id }, done) => {
		if (edge_id) {
			setRemovingEdges((current) => new Set(current).add(edge_id));
			await new Promise((resolve) => setTimeout(resolve, 320));
		}

		setError("");
		const previousContacts = contacts;
		const previousNetwork = network;
		const previousActionItems = actionItems;

		const removeTask = (items) =>
			(items ?? []).filter(
				(item) => !(item.contact_key === contact_key && item.item_key === item_key) && item.item_key !== item_key,
			);

		if (done) {
			setActionItems((current) => removeTask(current));
			setContacts((current) =>
				current.map((contact) => {
					if (contact.contact_key !== contact_key) return contact;
					return {
						...contact,
						action_items: (contact.action_items ?? []).filter((item) => item.item_key !== item_key),
					};
				}),
			);
			setNetwork((current) =>
				current.map((contact) => {
					if (contact.contact_key !== contact_key) return contact;
					return {
						...contact,
						action_items: (contact.action_items ?? []).filter((item) => item.item_key !== item_key),
					};
				}),
			);
		}

		try {
			await callApi("/api/action-items/complete", {
				token,
				method: "POST",
				body: JSON.stringify({ contact_key, item_key, done }),
				contentType: "application/json",
			});
			if (!done) await load();
		} catch (cause) {
			setContacts(previousContacts);
			setNetwork(previousNetwork);
			setActionItems(previousActionItems);
			setError(cause.message);
		} finally {
			if (edge_id) {
				setRemovingEdges((current) => {
					const next = new Set(current);
					next.delete(edge_id);
					return next;
				});
			}
		}
	};

	const collisions = useMemo(() => findCollisions(contacts), [contacts]);
	const graph = useMemo(() => buildGraph(network), [network]);
	const radar = useMemo(() => buildRadar(network), [network]);
	const user = session.user;
	const displayName = user?.user_metadata?.full_name ?? user?.email ?? "Signed in";

	return (
		<div className="mx-auto max-w-7xl px-6 py-10">
			<header className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Personal CRM</h1>
					<p className="mt-1 text-sm text-zinc-400">
						{contacts.length} contacts · {actionItems.length} pending actions · {graph.edges.length} live links
					</p>
				</div>
				<div className="flex items-center gap-3">
					{user?.user_metadata?.avatar_url && (
						<img
							src={user.user_metadata.avatar_url}
							alt=""
							className="h-8 w-8 rounded-full border border-zinc-800 object-cover"
						/>
					)}
					<span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300">
						{displayName}
					</span>
					<button
						type="button"
						onClick={() => supabase.auth.signOut()}
						className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
					>
						Sign out
					</button>
				</div>
			</header>

			<TodaysRadar radar={radar} onToggle={toggleComplete} />

			<nav className="mt-8 inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1">
				{[
					["feed", "Brain Dump Feed"],
					["grid", "Network Graph"],
				].map(([id, label]) => (
					<button
						key={id}
						type="button"
						onClick={() => setTab(id)}
						className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
							tab === id
								? "bg-indigo-500 text-white"
								: "text-zinc-400 hover:text-white"
						}`}
					>
						{label}
					</button>
				))}
			</nav>

			<DashboardErrorState error={error} />

			{tab === "feed" ? (
				<FeedView
					note={note}
					setNote={setNote}
					actionItems={actionItems}
					onSubmit={handleLog}
					saving={saving}
					loading={loading}
					contacts={contacts}
					collisions={collisions}
					onToggle={toggleComplete}
					onDeleteContact={deleteContact}
				/>
			) : (
				<NetworkGraphView
					graph={graph}
					loading={loading}
					collisions={collisions}
					onUpload={uploadAvatar}
					onSaveDetails={saveDetails}
					onToggle={toggleComplete}
					removingEdges={removingEdges}
				/>
			)}
		</div>
	);
}

function FeedView({ note, setNote, actionItems, onSubmit, saving, loading, contacts, collisions, onToggle, onDeleteContact }) {
	return (
		<>
			<form
				onSubmit={onSubmit}
				className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 backdrop-blur"
			>
				<label htmlFor="note" className="text-sm font-medium text-zinc-200">
					Brain dump
				</label>
				<p className="mt-1 text-xs text-zinc-400">
					Write freely about who you talked to. Names, facts, and follow-ups are extracted automatically.
				</p>
				<textarea
					id="note"
					rows={4}
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Coffee with Priya Menon. She moved to Berlin and joined Stripe. I said I'd send her the apartment listing and intro her to Alex Chen."
					className="mt-4 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm leading-relaxed outline-none transition placeholder:text-zinc-600 focus:border-zinc-300/60 focus:ring-2 focus:ring-zinc-200/20 focus:shadow-[0_0_0_4px_rgba(244,244,245,0.06),0_0_30px_rgba(244,244,245,0.18)]"
				/>
				<div className="mt-4 flex items-center justify-between gap-4">
					<p className="text-xs text-zinc-500">Press Save to run extraction.</p>
					<button
						type="submit"
						disabled={!note.trim() || saving}
						className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{saving ? "Extracting..." : "Save note"}
					</button>
				</div>
			</form>

			<ContextCollider collisions={collisions} />

			<TaskBoard actionItems={actionItems} loading={loading} onToggle={onToggle} />

			<section className="mt-10">
				<h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Contacts</h2>

				{loading ? (
					<p className="mt-4 text-sm text-zinc-500">Loading contacts...</p>
				) : contacts.length === 0 ? (
					<p className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-12 text-center text-sm text-zinc-400">
						No contacts yet. Save your first note above.
					</p>
				) : (
					<div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{contacts.map((contact) => (
							<ContactCard
								key={contact.contact_key}
								contact={contact}
								colliding={collisions.involved.has(contact.contact_key)}
								onDelete={onDeleteContact}
							/>
						))}
					</div>
				)}
			</section>
		</>
	);
}

function ContactCard({ contact, colliding, onDelete }) {
	const decay = decayStyle(daysSince(contact.updated_at));

	return (
		<article
			className={`flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:bg-zinc-900 ${decay.border} ${
				colliding ? "ring-1 ring-fuchsia-400/30" : ""
			}`}
		>
			<header className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-white">{contact.contact_name}</h3>
					<p className="mt-0.5 text-sm text-zinc-400">
						{contact.company_role || "Unknown role"} · {contact.context_tag || "No context tag"}
					</p>
					<p className="mt-0.5 text-sm text-zinc-400">
						{contact.interactions} interaction{contact.interactions === 1 ? "" : "s"}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => onDelete?.(contact.contact_key)}
						className="rounded-md border border-zinc-700 p-1 text-zinc-400 transition hover:border-rose-400/40 hover:text-rose-300"
						aria-label={`Delete ${contact.contact_name}`}
						title="Delete contact"
					>
						<svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
							<path d="M7.5 2.5h5l.5 1.5H16a.75.75 0 1 1 0 1.5h-.6l-.6 10.4a2 2 0 0 1-2 1.9H7.2a2 2 0 0 1-2-1.9L4.6 5.5H4a.75.75 0 1 1 0-1.5h3l.5-1.5Zm-1.3 3 .5 10.2a.5.5 0 0 0 .5.5h5.6a.5.5 0 0 0 .5-.5l.5-10.2H6.2Zm2.3 2a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Zm3 0a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Z" />
						</svg>
					</button>
					<span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${decay.badge}`}>
						{decay.label}
					</span>
				</div>
			</header>

			<CardSection title="Facts" empty="No facts yet">
				{contact.facts?.map((fact) => (
					<li key={fact} className="flex gap-2 text-sm text-zinc-300">
						<span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
						{fact}
					</li>
				))}
			</CardSection>

		</article>
	);
}

function TaskBoard({ actionItems, loading, onToggle }) {
	const pending = (actionItems ?? []).filter((item) => !item.done);

	return (
		<section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
			<h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Task Board</h2>
			<p className="mt-1 text-sm text-zinc-400">All active follow-ups across your CRM.</p>

			{loading ? (
				<p className="mt-4 text-sm text-zinc-500">Loading tasks...</p>
			) : pending.length === 0 ? (
				<p className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-8 text-center text-sm text-zinc-400">
					No pending tasks right now.
				</p>
			) : (
				<ul className="mt-4 space-y-2">
					{pending.map((item) => {
						const taskText = resolveTaskText(item);
						return (
							<li key={`${item.contact_key}:${item.item_key}`} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
								<div className="min-w-0">
									<p className="truncate text-sm text-zinc-100">{taskText}</p>
									<p className="text-xs text-zinc-400">{item.contact_name || "Unknown"}</p>
								</div>
								<button
									type="button"
									onClick={() => onToggle({ contact_key: item.contact_key, item_key: item.item_key }, true)}
									className="shrink-0 rounded-md border border-violet-400/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-200 hover:bg-violet-400/10"
								>
									Mark complete
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function resolveTaskText(item) {
	if (!item || typeof item !== "object") return "Untitled task";
	return (
		item.item ||
		item.task_text ||
		item.text ||
		item.title ||
		item.description ||
		"Untitled task"
	);
}

function CardSection({ title, empty, children }) {
	const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];

	return (
		<div className="mt-5">
			<h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h4>
			{items.length === 0 ? <p className="mt-2 text-sm text-zinc-600">{empty}</p> : <ul className="mt-2 space-y-2">{items}</ul>}
		</div>
	);
}

function NetworkGraphView({ graph, loading, collisions, onUpload, onSaveDetails, onToggle, removingEdges }) {
	const [selectedContactKey, setSelectedContactKey] = useState(null);

	const selectedContact = useMemo(
		() => graph.nodes.find((node) => node.contact_key === selectedContactKey) ?? null,
		[graph.nodes, selectedContactKey]
	);

	useEffect(() => {
		if (selectedContactKey && !graph.nodes.some((node) => node.contact_key === selectedContactKey)) {
			setSelectedContactKey(null);
		}
	}, [graph.nodes, selectedContactKey]);

	if (loading) {
		return <p className="mt-8 text-sm text-zinc-500">Loading network...</p>;
	}

	if (graph.nodes.length === 0) {
		return (
			<p className="mt-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-16 text-center text-sm text-zinc-400">
				Your network is empty. Log a note to add someone.
			</p>
		);
	}

	return (
		<>
			<DecayLegend />
			<GraphCanvas
				graph={graph}
				removingEdges={removingEdges}
				onNodeClick={(contactKey) =>
					setSelectedContactKey((current) => (current === contactKey ? null : contactKey))
				}
				selectedContactKey={selectedContactKey}
			/>

			<section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
				<h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Active connection links</h3>
				<div className="mt-4 space-y-3">
					{graph.edges.length === 0 ? (
						<p className="text-sm text-zinc-500">No active links. Connections appear when an action item references another contact by name.</p>
					) : (
						graph.edges.map((edge) => (
							<div
								key={edge.edge_id}
								className={`rounded-xl border border-zinc-800 bg-zinc-950 p-3 transition-all duration-300 ${
									removingEdges.has(edge.edge_id) ? "scale-95 opacity-0" : "opacity-100"
								}`}
							>
								<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
									<span className="rounded bg-zinc-900 px-2 py-1 text-zinc-200">{edge.from.contact_name}</span>
									<span>→</span>
									<span className="rounded bg-zinc-900 px-2 py-1 text-zinc-200">{edge.to.contact_name}</span>
								</div>
								<ul className="mt-3 space-y-2">
									{edge.items.map((item) => (
										<li key={item.item_key} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
											<span>{item.item}</span>
											<button
												type="button"
												onClick={() => onToggle({ contact_key: item.contact_key, item_key: item.item_key, edge_id: edge.edge_id }, true)}
												className="shrink-0 rounded-md border border-indigo-400/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-200 hover:bg-indigo-400/10"
											>
												Mark complete
											</button>
										</li>
									))}
								</ul>
							</div>
						))
					)}
				</div>
			</section>

			<div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{graph.nodes.map((node) => (
					<NetworkCard
						key={node.contact_key}
						entry={node}
						colliding={collisions.involved.has(node.contact_key)}
						onUpload={onUpload}
						onSaveDetails={onSaveDetails}
					/>
				))}
			</div>

			<ContextCollider collisions={collisions} />

			<ContactSidePanel
				contact={selectedContact}
				onClose={() => setSelectedContactKey(null)}
				onToggle={onToggle}
			/>
		</>
	);
}

function DecayLegend() {
	return (
		<div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
			<span className="font-semibold uppercase tracking-wider">Connection decay</span>
			<LegendDot className="bg-emerald-400" label="Within 30 days" />
			<LegendDot className="bg-amber-400" label="Over 30 days" />
			<LegendDot className="bg-rose-500" label="Over 60 days" />
		</div>
	);
}

function LegendDot({ className, label }) {
	return (
		<span className="flex items-center gap-2">
			<span className={`h-2 w-2 rounded-full ${className}`} />
			{label}
		</span>
	);
}

const FLOW_NODE_TYPES = {
	contact: ContactFlowNode,
};

function GraphCanvas({ graph, removingEdges, onNodeClick, selectedContactKey }) {
	const nextNodes = useMemo(
		() =>
			graph.nodes.map((node) => ({
				id: node.contact_key,
				type: "contact",
				position: {
					x: (node.x / 100) * 900,
					y: (node.y / 100) * 560,
				},
				data: {
					name: node.contact_name,
					avatarUrl: node.avatar_url,
					initials: initials(node.contact_name),
					selected: node.contact_key === selectedContactKey,
				},
				draggable: true,
				sourcePosition: Position.Right,
				targetPosition: Position.Left,
			})),
		[graph.nodes, selectedContactKey]
	);

	const nextEdges = useMemo(
		() =>
			graph.edges.map((edge) => {
				const fading = removingEdges.has(edge.edge_id);
				return {
					id: edge.edge_id,
					source: edge.from.contact_key,
					target: edge.to.contact_key,
					type: "smoothstep",
					animated: !fading,
					label: edge.items.length > 1 ? `${edge.items.length}` : undefined,
					labelStyle: {
						fill: "#e4e4e7",
						fontSize: 10,
						fontWeight: 600,
					},
					markerEnd: {
						type: MarkerType.ArrowClosed,
						color: "#818cf8",
					},
					style: {
						stroke: fading ? "#52525b" : "#818cf8",
						strokeWidth: fading ? 1.2 : 1.8,
						opacity: fading ? 0.25 : 0.85,
					},
				};
			}),
		[graph.edges, removingEdges]
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(nextNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(nextEdges);

	useEffect(() => {
		setNodes(nextNodes);
	}, [nextNodes, setNodes]);

	useEffect(() => {
		setEdges(nextEdges);
	}, [nextEdges, setEdges]);

	return (
		<section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
			<div className="h-[32rem] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
				<ReactFlow
					nodes={nodes}
					edges={edges}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onNodeClick={(_event, node) => onNodeClick(node.id)}
					nodeTypes={FLOW_NODE_TYPES}
					fitView
					minZoom={0.45}
					maxZoom={1.8}
					panOnDrag
					zoomOnScroll
					zoomOnPinch
					proOptions={{ hideAttribution: true }}
				>
					<Background variant="dots" gap={18} size={1.2} color="#3f3f46" />
					<MiniFlowOverlay />
					<Controls className="!rounded-lg !border !border-zinc-700 !bg-zinc-900/95" />
				</ReactFlow>
			</div>
		</section>
	);
}

function MiniFlowOverlay() {
	return (
		<div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-zinc-700 bg-zinc-900/90 px-2.5 py-1 text-[11px] font-medium tracking-wide text-zinc-300">
			Drag to pan, scroll to zoom
		</div>
	);
}

function ContactFlowNode({ data }) {
	return (
		<>
			<Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-zinc-700 !bg-zinc-900" />
			<div
				className={`flex min-w-[9.5rem] items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-lg shadow-black/40 transition ${
					data.selected
						? "border-violet-400/60 bg-zinc-900 ring-2 ring-violet-400/25"
						: "border-zinc-700 bg-zinc-900/95"
				}`}
			>
				<span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-[11px] font-semibold text-zinc-300">
					{data.avatarUrl ? (
						<img src={data.avatarUrl} alt="" className="h-full w-full object-cover" />
					) : (
						data.initials
					)}
				</span>
				<span className="max-w-[11rem] truncate font-medium text-zinc-100">{data.name}</span>
			</div>
			<Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-zinc-700 !bg-zinc-900" />
		</>
	);
}

function ContactSidePanel({ contact, onClose, onToggle }) {
	if (!contact) return null;

	const pending = (contact.action_items ?? []).filter((item) => !item.done);

	return (
		<div className="fixed inset-0 z-40 flex justify-end">
			<button
				type="button"
				onClick={onClose}
				className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
				aria-label="Close contact panel"
			/>
			<aside className="relative h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 px-6 py-6 shadow-2xl shadow-black/50">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-300">
							{contact.avatar_url ? (
								<img src={contact.avatar_url} alt="" className="h-full w-full object-cover" />
							) : (
								initials(contact.contact_name)
							)}
						</span>
						<div className="min-w-0">
							<h3 className="truncate text-lg font-semibold text-zinc-100">{contact.contact_name}</h3>
							<p className="text-sm text-zinc-400">{contact.company_role || "Unknown role"}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
					>
						Close
					</button>
				</div>

				<div className="mt-6 space-y-4">
					<section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
						<h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Profile</h4>
						<dl className="mt-3 space-y-2 text-sm">
							<div>
								<dt className="text-zinc-500">Context</dt>
								<dd className="text-zinc-200">{contact.context_tag || "No context tag"}</dd>
							</div>
							<div>
								<dt className="text-zinc-500">Interactions</dt>
								<dd className="text-zinc-200">{contact.interactions}</dd>
							</div>
							<div>
								<dt className="text-zinc-500">Last updated</dt>
								<dd className="text-zinc-200">{new Date(contact.updated_at).toLocaleString()}</dd>
							</div>
						</dl>
					</section>

					<section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
						<h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Facts</h4>
						{(contact.facts ?? []).length === 0 ? (
							<p className="mt-2 text-sm text-zinc-500">No facts saved yet.</p>
						) : (
							<ul className="mt-3 space-y-2">
								{contact.facts.map((fact) => (
									<li key={fact} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
										{fact}
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
						<h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Pending actions</h4>
						{pending.length === 0 ? (
							<p className="mt-2 text-sm text-zinc-500">No pending follow-ups.</p>
						) : (
							<ul className="mt-3 space-y-2">
								{pending.map((item) => (
									<li key={item.item_key} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
										<div className="flex items-start justify-between gap-3">
											<p className="text-sm text-zinc-100">{item.item}</p>
											<button
												type="button"
												onClick={() => onToggle({ contact_key: contact.contact_key, item_key: item.item_key }, true)}
												className="shrink-0 rounded-md border border-indigo-400/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-200 hover:bg-indigo-400/10"
											>
												Done
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>
			</aside>
		</div>
	);
}

function NetworkCard({ entry, colliding, onUpload, onSaveDetails }) {
	const inputRef = useRef(null);
	const [uploading, setUploading] = useState(false);
	const [editing, setEditing] = useState({
		company_role: entry.company_role ?? "",
		context_tag: entry.context_tag ?? "",
	});
	const days = daysSince(entry.updated_at);
	const decay = decayStyle(days);

	useEffect(() => {
		setEditing({
			company_role: entry.company_role ?? "",
			context_tag: entry.context_tag ?? "",
		});
	}, [entry.company_role, entry.context_tag]);

	const handleFile = async (event) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;

		setUploading(true);
		try {
			await onUpload(entry.contact_name, file);
		} finally {
			setUploading(false);
		}
	};

	const save = async () => {
		await onSaveDetails({
			contact_name: entry.contact_name,
			company_role: editing.company_role,
			context_tag: editing.context_tag,
		});
	};

	return (
		<article
			className={`group relative flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:bg-zinc-900 ${decay.border} ${
				colliding ? "ring-1 ring-fuchsia-400/30" : ""
			}`}
		>
			<div className="flex items-start gap-4">
				<button
					type="button"
					onClick={() => inputRef.current?.click()}
					className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
					aria-label={`Upload a photo for ${entry.contact_name}`}
				>
					{entry.avatar_url ? (
						<img src={entry.avatar_url} alt="" className="h-full w-full object-cover" />
					) : (
						<span className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-500">
							{initials(entry.contact_name)}
						</span>
					)}
					<span className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
						{uploading ? "Uploading..." : "Change"}
					</span>
				</button>
				<input
					ref={inputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					onChange={handleFile}
					className="hidden"
				/>

				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold text-white">{entry.contact_name}</h3>
					<p className="mt-0.5 text-xs text-zinc-500">{entry.interactions} interactions</p>
					<span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${decay.badge}`}>
						{decay.label}
					</span>
				</div>
			</div>

			<div className="mt-4 space-y-2">
				<label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Company / Role</label>
				<input
					value={editing.company_role}
					onChange={(event) => setEditing((current) => ({ ...current, company_role: event.target.value }))}
					placeholder="Stripe — PM"
					className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
				/>
				<label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Context Tag</label>
				<input
					value={editing.context_tag}
					onChange={(event) => setEditing((current) => ({ ...current, context_tag: event.target.value }))}
					placeholder="college"
					className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
				/>
				<button
					type="button"
					onClick={save}
					className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-400/20"
				>
					Save profile details
				</button>
			</div>
		</article>
	);
}

function TodaysRadar({ radar, onToggle }) {
	return (
		<section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-xl shadow-black/25">
			<h2 className="text-sm font-semibold uppercase tracking-wider text-violet-200">Today's Radar</h2>
			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				<div>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Pending actions</h3>
					<ul className="mt-2 space-y-2">
						{radar.pending.length === 0 ? (
							<li>
								<RadarEmptyState />
							</li>
						) : (
							radar.pending.slice(0, 6).map((item) => (
								<li key={`${item.contact_key}:${item.item_key}`} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
									<div>
										<p className="text-zinc-100">{item.item}</p>
										<p className="text-xs text-zinc-500">{item.contact_name}</p>
									</div>
									<button
										type="button"
										onClick={() => onToggle(item, true)}
										className="rounded-md border border-violet-400/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-200 hover:bg-violet-400/10"
									>
										Done
									</button>
								</li>
							))
						)}
					</ul>
				</div>
				<div>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Stale connections</h3>
					<ul className="mt-2 space-y-2">
						{radar.stale.length === 0 ? (
							<li className="text-sm text-zinc-500">No stale connections over 30 days.</li>
						) : (
							radar.stale.map((entry) => (
								<li key={entry.contact_key} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
									{entry.contact_name} · {entry.days}d since last touch
								</li>
							))
						)}
					</ul>
				</div>
			</div>
		</section>
	);
}

function RadarEmptyState() {
	return (
		<div className="rounded-xl border border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),rgba(24,24,27,0.94))] px-4 py-5">
			<p className="text-sm font-semibold text-zinc-100">Inbox Zero for Today</p>
			<p className="mt-1 text-xs text-zinc-400">
				No pending action items. Use Brain Dump to capture a new follow-up.
			</p>
		</div>
	);
}

function ContextCollider({ collisions }) {
	if (collisions.overlaps.length === 0) return null;

	return (
		<section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
			<h2 className="text-sm font-semibold uppercase tracking-wider text-fuchsia-300">Context collider</h2>
			<p className="mt-1 text-xs text-zinc-400">Keywords that show up in more than one person's facts. Possible introductions.</p>

			<ul className="mt-5 space-y-3">
				{collisions.overlaps.map((overlap) => (
					<li
						key={overlap.keyword}
						className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"
					>
						<span className="rounded-md bg-fuchsia-500/15 px-2.5 py-1 text-xs font-semibold text-fuchsia-200">{overlap.keyword}</span>
						<span className="text-xs text-zinc-500">connects</span>
						<span className="flex flex-wrap gap-2">
							{overlap.names.map((name) => (
								<span key={name} className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-200">
									{name}
								</span>
							))}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

const STOPWORDS = new Set([
	"about", "after", "also", "although", "always", "another", "because", "been", "before", "being",
	"between", "could", "different", "does", "doing", "during", "each", "every", "from", "have",
	"having", "here", "into", "just", "like", "likes", "more", "most", "much", "never", "next",
	"often", "once", "only", "other", "over", "really", "said", "same", "should", "since", "some",
	"start", "started", "still", "such", "than", "that", "their", "them", "then", "there", "these",
	"they", "thing", "things", "this", "those", "through", "time", "told", "very", "want", "wants",
	"were", "what", "when", "where", "which", "while", "will", "with", "would", "your",
]);

function tokenize(text) {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word))
		.filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

function findCollisions(contacts) {
	const byKeyword = new Map();

	for (const contact of contacts) {
		const seen = new Set();
		for (const fact of contact.facts ?? []) {
			for (const word of tokenize(fact)) {
				if (seen.has(word)) continue;
				seen.add(word);
				const entry = byKeyword.get(word) ?? { keys: new Set(), names: [] };
				entry.keys.add(contact.contact_key);
				entry.names.push(contact.contact_name);
				byKeyword.set(word, entry);
			}
		}
	}

	const involved = new Set();
	const overlaps = [];

	for (const [keyword, entry] of byKeyword) {
		if (entry.keys.size < 2) continue;
		overlaps.push({ keyword, names: entry.names, size: entry.keys.size });
		for (const key of entry.keys) involved.add(key);
	}

	overlaps.sort((a, b) => b.size - a.size || a.keyword.localeCompare(b.keyword));
	return { overlaps: overlaps.slice(0, 8), involved };
}

function buildGraph(entries) {
	const nodes = entries.map((entry, index) => {
		const angle = (index / Math.max(entries.length, 1)) * Math.PI * 2;
		const radius = entries.length <= 2 ? 24 : 32;
		return {
			...entry,
			x: 50 + Math.cos(angle) * radius,
			y: 50 + Math.sin(angle) * radius,
		};
	});

	const byKey = new Map(nodes.map((node) => [node.contact_key, node]));
	const edgesByPair = new Map();

	for (const from of nodes) {
		for (const item of from.action_items ?? []) {
			const target =
				findRelatedContact(item.related_contact_name, nodes, from.contact_key) ??
				findMentionedContact(item.item, nodes, from.contact_key);
			if (!target) continue;

			const pair = [from.contact_key, target.contact_key].sort();
			const edgeId = pair.join("::");
			const edge = edgesByPair.get(edgeId) ?? {
				edge_id: edgeId,
				from: byKey.get(pair[0]),
				to: byKey.get(pair[1]),
				items: [],
			};

			edge.items.push({
				contact_key: from.contact_key,
				item_key: item.item_key,
				item: item.item,
				related_contact_name: item.related_contact_name ?? null,
			});
			edgesByPair.set(edgeId, edge);
		}
	}

	return {
		nodes,
		edges: [...edgesByPair.values()].filter((edge) => edge.from && edge.to),
	};
}

function findRelatedContact(relatedContactName, nodes, currentKey) {
	if (typeof relatedContactName !== "string" || !relatedContactName.trim()) return null;
	const targetKey = toContactKey(relatedContactName);

	for (const candidate of nodes) {
		if (candidate.contact_key === currentKey) continue;
		if (candidate.contact_key === targetKey) return candidate;
		if (toContactKey(candidate.contact_name) === targetKey) return candidate;
	}

	return null;
}

function findMentionedContact(text, nodes, currentKey) {
	const haystack = text.toLowerCase();
	for (const candidate of nodes) {
		if (candidate.contact_key === currentKey) continue;
		if (haystack.includes(candidate.contact_name.toLowerCase())) return candidate;
	}
	return null;
}

function toContactKey(name) {
	return String(name).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildRadar(network) {
	const pending = [];
	const stale = [];

	for (const contact of network) {
		for (const item of contact.action_items ?? []) {
			pending.push({ ...item, contact_key: contact.contact_key, contact_name: contact.contact_name });
		}
		const days = daysSince(contact.updated_at);
		if (days > 30) {
			stale.push({ contact_key: contact.contact_key, contact_name: contact.contact_name, days });
		}
	}

	stale.sort((a, b) => b.days - a.days);
	return { pending, stale: stale.slice(0, 6) };
}

function daysSince(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return 0;
	return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function decayStyle(days) {
	if (days > 60) {
		return {
			border: "border-rose-500/50",
			badge: "bg-rose-500/15 text-rose-200",
			label: `${days}d cold`,
		};
	}
	if (days > 30) {
		return {
			border: "border-amber-400/50",
			badge: "bg-amber-400/15 text-amber-200",
			label: `${days}d quiet`,
		};
	}
	return {
		border: "border-zinc-800",
		badge: "bg-emerald-400/15 text-emerald-200",
		label: days === 0 ? "Today" : `${days}d ago`,
	};
}

function initials(name) {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0] ?? "")
		.join("")
		.toUpperCase();
}

function GoogleMark() {
	return (
		<svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
			<path
				fill="#4285F4"
				d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.5 5.5 0 0 1-2.4 3.6v3h3.87c2.27-2.09 3.58-5.17 3.58-8.63Z"
			/>
			<path
				fill="#34A853"
				d="M12 24c3.24 0 5.96-1.08 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
			/>
			<path
				fill="#FBBC05"
				d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z"
			/>
			<path
				fill="#EA4335"
				d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z"
			/>
		</svg>
	);
}

function GithubMark() {
	return (
		<svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
			<path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
		</svg>
	);
}

