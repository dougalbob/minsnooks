// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Verified sign-in email, or null when there is no usable identity. */
			viewerEmail: string | null;
			/** True when the email came from the dev-only preview identity switch. */
			viewerIsPreview: boolean;
			/** True when the dev preview switch is allowed (AUTH_MODE=dev, not production). */
			devIdentitySwitch: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
