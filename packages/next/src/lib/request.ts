/*
	Every call is made against the API base URL picked by the configuration, and
	callers only pass the path of the endpoint they want to reach. The path is
	stripped of leading slashes so that it can not turn the request into a
	protocol relative URL pointing at another host.
*/
const apiUrl = (path: string, query = {}) => {
	const baseUrl = typeof window === 'undefined' ? `${process.env.BASE_API_URL ?? ''}/api/` : '/api/';
	const queryUrl = `${baseUrl}${path.replace(/^[/\\]+/, '')}`;

	// Check if we are passing any arguments and parse them if so
	if (Object.keys(query).length) {
		return `${queryUrl}?${new URLSearchParams(query)}`;
	}

	return queryUrl;
};

const request = {
	raw: async ({ method = 'GET', url = '', query = {}, headers = {}, options = {} }) => {
		try {
			const queryUrl = apiUrl(url, query);

			const response = await fetch(queryUrl, {
				method,
				credentials: typeof window === 'undefined' ? 'omit' : 'include',
				headers: {
					'Content-Type': 'application/json',
					...headers
				},
				...options
			});

			if (!response.ok) {
				const error = await response.json();
				return {
					error: error.message,
					status: response.status
				};
			}

			return {
				data: response
			};
		} catch (error) {
			const err = error as Error;
			return {
				error: err.message
			};
		}
	},
	get: async ({ url = '', query = {}, headers = {}, options = {} }) => {
		try {
			const queryUrl = apiUrl(url, query);

			const response = await fetch(queryUrl, {
				method: 'GET',
				credentials: typeof window === 'undefined' ? 'omit' : 'include',
				headers: {
					'Content-Type': 'application/json',
					...headers
				},
				...options
			});

			if (!response.ok) {
				const error = await response.json();
				return {
					error: error.message,
					status: response.status
				};
			}

			return {
				data: await response.json()
			};
		} catch (error) {
			const err = error as Error;
			return {
				error: err.message
			};
		}
	},
	post: async ({ url = '', body = {}, headers = {}, options = {} }) => {
		try {
			const queryUrl = apiUrl(url);

			const response = await fetch(queryUrl, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					...headers
				},
				...options,
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const error = await response.json();
				return {
					error: error.message,
					status: response.status
				};
			}

			return {
				data: await response.json()
			};
		} catch (error) {
			const err = error as Error;
			return {
				error: err.message
			};
		}
	},
	delete: async ({ url = '', headers = {}, options = {} }) => {
		try {
			const queryUrl = apiUrl(url);

			const response = await fetch(queryUrl, {
				method: 'DELETE',
				credentials: 'include',
				headers: {
					...headers
				},
				...options
			});

			if (!response.ok) {
				const error = await response.json();
				return {
					error: error.message,
					status: response.status
				};
			}

			return {
				data: await response.json()
			};
		} catch (error) {
			const err = error as Error;
			return {
				error: err.message
			};
		}
	}
};

export default request;
