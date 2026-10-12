import { getSafeStorageVersion } from './Util.js';

const readme = `
# Welcome to the API docs

These are the official docs for the [SafeStorage](https://github.com/ivancarlosti/safestorage) project.
On the sidebar you will find all available endpoints the API offers.
Keep in mind that some of those are only accessible to administrators of the instance, for operations such as configuring the instance or managing users.

A written overview — covering authentication, rate limiting and a table of every endpoint — lives in the repository at [\`docs/api.md\`](https://github.com/ivancarlosti/safestorage/blob/main/docs/api.md).

If you want to try the API by hand, the repository ships an Insomnia collection at \`packages/backend/insomnia.json\`.
It follows the Insomnia v4 export format, so it can also be imported into Thunder Client, Postman and any other client that reads that format.

The default rate limit for the API is 100 requests per 1000ms.
`;

export default {
	openapi: {
		info: {
			title: 'SafeStorage API',
			description: readme,
			version: getSafeStorageVersion()
		},
		tags: [
			{
				name: 'Auth',
				description: 'Authentication routes.'
			},
			{
				name: 'User',
				description: 'Routes that return data related to the authenticated user.'
			},
			{
				name: 'Albums',
				description: 'Routes that return data related to albums.'
			},
			{
				name: 'Files',
				description: 'Routes that return data related to files.'
			},
			{
				name: 'Tags',
				description: 'Routes that return data related to tags.'
			},
			{
				name: 'Server',
				description: 'Routes that returns info about the server instance.'
			},
			{
				name: 'Invites',
				description: 'Routes that return data related to invites.'
			},
			{
				name: 'User Management',
				description: 'Routes that return data related to User Management.'
			},
			{
				name: 'IP Management',
				description: 'Routes that return data related to IP Management.'
			},
			{
				name: 'Admin',
				description: 'Routes that return data related to the admin panel.'
			}
		]
	}
};
