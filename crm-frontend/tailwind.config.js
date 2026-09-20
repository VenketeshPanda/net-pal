/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
	theme: {
		extend: {
			colors: {
				surface: {
					900: "#18181b",
					925: "#141417",
					950: "#09090b",
				},
			},
		},
	},
};
