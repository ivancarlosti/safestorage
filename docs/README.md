# SafeStorage documentation

**SafeStorage** is a self-hosted, blazing-fast file uploader and "bunker" written in Node.js. It stores your files on your own hardware — or in your own S3-compatible bucket — and gives you short links, albums, tags, snippets and a full admin panel.

## Where do I start?

| I want to…                                | Read                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Deploy it in two minutes                  | [Deployment](deployment.md) (+ the [Docker quick start](../docker/README.md))  |
| Integrate with the API                    | [API reference](api.md) or the live reference at `/docs` on a running instance |
| Configure the instance                    | [Configuration](configuration.md)                                              |
| Store files off-site (S3/R2/Spaces/MinIO) | [Storage](storage.md)                                                          |
| Understand how it is built                | [Architecture](architecture.md)                                                |
| Contribute code                           | [Development](development.md)                                                  |
| Fix a problem                             | [Troubleshooting](troubleshooting.md)                                          |

## Index

| Document                                 | Description                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| [api.md](api.md)                         | Authentication, rate limiting and every REST endpoint.                  |
| [configuration.md](configuration.md)     | Every admin setting and every environment variable.                     |
| [deployment.md](deployment.md)           | Running SafeStorage with Docker Compose, TLS, backups and updates.      |
| [storage.md](storage.md)                 | Local disk vs. network (S3-compatible) storage, bucket policy and CORS. |
| [architecture.md](architecture.md)       | The monorepo, the backend, the frontend and the combined container.     |
| [development.md](development.md)         | Local setup, scripts, code style and the release workflow.              |
| [troubleshooting.md](troubleshooting.md) | Common problems and how to fix them.                                    |

## About this repository

SafeStorage is an independent project, de-forked from [chibisafe](https://github.com/chibisafe/chibisafe). It has its own identity, storage layout and container stack, and **there are no legacy versions to migrate from** — a fresh installation starts from an empty database and is usable immediately.
