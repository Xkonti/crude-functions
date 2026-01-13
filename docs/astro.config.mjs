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
						// Getting Started
						{ label: 'Getting Started', slug: 'guides/getting-started' },
						{ label: 'Deployment', slug: 'guides/deployment' },
						{ label: 'First-Time Setup', slug: 'guides/first-time-setup' },
						{ label: 'Your First Function', slug: 'guides/your-first-function' },

						// Working with Functions
						{ label: 'Writing Functions', slug: 'guides/writing-functions' },
						{ label: 'Managing Code', slug: 'guides/managing-code' },
						{ label: 'Managing Functions', slug: 'guides/managing-functions' },

						// Security
						{ label: 'API Keys', slug: 'guides/api-keys' },
						{ label: 'Secrets', slug: 'guides/secrets' },

						// Configuration & Monitoring
						{ label: 'Configuration', slug: 'guides/configuration' },
						{ label: 'Logs', slug: 'guides/logs' },
						{ label: 'Metrics', slug: 'guides/metrics' },

						// Troubleshooting
						{ label: 'Troubleshooting', slug: 'guides/troubleshooting' },
					],
				},
				{
					label: 'Examples',
					items: [
						{ label: 'REST API CRUD', slug: 'guides/examples/rest-api-crud' },
						{ label: 'Webhook Handler', slug: 'guides/examples/webhook-handler' },
						{ label: 'Scheduled Task', slug: 'guides/examples/scheduled-task' },
						{ label: 'Database Connection', slug: 'guides/examples/database-connection' },
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
