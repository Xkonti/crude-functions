// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Crude Functions Documentation',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/xkonti/crude-functions' }],
			sidebar: [
				{
					label: 'Guides',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Getting Started', slug: 'guides/getting-started' },
						{ label: 'Deployment', slug: 'guides/deployment' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
      editLink: {
        baseUrl: 'https://github.com/xkonti/crude-functions/edit/main/',
      },
		}),
	],
});
