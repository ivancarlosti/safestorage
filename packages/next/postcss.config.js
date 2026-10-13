// Tailwind CSS v4 is wired through its own PostCSS plugin; autoprefixer is
// bundled into it (the standalone dependency was dropped in the v4 migration).
module.exports = {
	plugins: {
		'@tailwindcss/postcss': {}
	}
};
