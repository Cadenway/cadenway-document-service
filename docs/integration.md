# Domain and integration

[Documentation index](README.md) · [Repository instructions](../AGENTS.md)

**Status:** This page records the target design from repository instructions and skills. Its behavior has not been verified as implemented in this snapshot.

The tables and rules on this page are **target domain behavior**, not proof of a running service or an approved API. Source: `cw-document-domain` ([Claude](../.claude/skills/cw-document-domain/SKILL.md), [Codex](../.codex/skills/cw-document-domain/SKILL.md)). The linked mockup and guides remain the source for product details; confirm ambiguous values before implementation.

## What this service owns

Block documents.

**Data**: Documents: title, blocks stored as Markdown, author, dates.

**API**: List, read, create, update, delete.

**Events emitted**: `doc.created`, `doc.updated`, `doc.deleted`.

**Events consumed**: `organization.deleted`.

**External systems**: None.

**Mockup screens**: Documents (list, read, edit).

## Rules this service guards

- Blocks: paragraph, headings 1 to 3, bullet, numbered, to-do, quote, code, divider; to-do boxes stay tickable in read mode.
- Deleting a document asks for confirmation.

## Notes

Starts as a module of cadenway-task-service.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). If the mockup disagrees with this guide, update the guide and its source skill for both assistants.

## Contract and delivery sequence

The `cadenway-api-contracts` repository owns HTTP and event specifications. Consumers use published `@cadenway/contracts` packages and `@cadenway/nest-messaging`; do not redefine payloads or connect to another service's database. Change contracts first, then the producing service, followed by gateways and listeners, and finally the webapp. Planned event names on this page must be checked against the actual published specification before use.

## References

[Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE), [integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et), and [repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N). Use [AGENTS.md](../AGENTS.md) as the local source for ownership and hard limits.
