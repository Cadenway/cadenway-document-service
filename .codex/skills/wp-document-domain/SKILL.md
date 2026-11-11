---
name: wp-document-domain
description: "The data, rules, events and screens waypoint-document-service owns, taken from the mockup, the integration guide and the repositories document. Load it before naming, modeling or testing anything in this service."
---

# document-service domain

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

Starts as a module of waypoint-task-service.

Everything above comes from the [repositories document](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N) and the
[integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et). When the mockup and this skill disagree, the mockup wins and
this skill is corrected in the same change.
