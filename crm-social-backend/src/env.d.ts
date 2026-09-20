// Secrets are not part of wrangler.jsonc, so they are declared here and merged into Env.
declare global {
	interface Env {
		/** Supabase legacy HS256 signing secret. Required only if your project issues HS256 tokens. */
		SUPABASE_JWT_SECRET?: string;
	}
}

export {};
