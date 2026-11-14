# cadenway-document-service

cadenway-document-service owns block documents. NestJS, its own PostgreSQL database (one database and one user in the shared PostgreSQL of the VPS), events over NATS JetStream through `@cadenway/nest-messaging`, internal REST for the API gateway. Local port 3014.

|            |                                                             |
| ---------- | ----------------------------------------------------------- |
| Data       | Documents: title, blocks stored as Markdown, author, dates. |
| API        | List, read, create, update, delete.                         |
| Emits      | `doc.created`, `doc.updated`, `doc.deleted`                 |
| Listens to | `organization.deleted`                                      |
| External   | None.                                                       |
| Phase      | After the first version                                     |

Built in this repository from the start: it never lives as a module of another service.

## Getting started

Requirements: Node.js LTS and pnpm (versions in `package.json`), and Docker.

1. Clone this repository next to the other Cadenway repositories, flat, in one folder.
2. To run it with the rest of Cadenway, start the stack from `cadenway-ops`; it builds the sibling
   folders, this one included (`core` profile; `full` adds every other service):

   ```bash
   cd ../cadenway-ops/compose
   docker compose -f compose.yaml -f compose.local.yaml --profile core up -d
   ```

3. To work on this repository alone:

   ```bash
   pnpm install
   pnpm start:dev              # http://localhost:3014
   ```

## Checks

Run the narrowest check first; CI runs them all on every pull request.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test src/modules/<module>      # targeted
pnpm test:integration                    # PostgreSQL and NATS in Docker
pnpm test:coverage
pnpm build
docker compose -f compose.dev.yaml config -q
```

## Contributing

- [Contributing guide](CONTRIBUTING.md): branches, commits, pull requests, releases.
- [Code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), [getting help](SUPPORT.md).
- AI assistants follow [AGENTS.md](../AGENTS.md); Claude Code also reads [CLAUDE.md](../CLAUDE.md) and the
  tooling described in [.claude/README.md](../.claude/README.md).

## License

This repository is proprietary. See [LICENSE](../LICENSE) for the rights and restrictions that apply.

## References

- [Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE): every screen, state and interaction.
- [Integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et): tokens, data shapes, component names.
- [Repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N): what each repository owns, deployment.
