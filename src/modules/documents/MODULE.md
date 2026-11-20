# Documents

## Purpose

Owns the organization document catalog, Markdown content, document versions, deletion fences,
and creation receipts. Task owns active membership and direct space access.

## Public entry points

None. The internal HTTP contract is the Gateway entry point.

## Owned tables

| Table                      | Scope and data                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `documents`                | Organization, immutable space, current content and version or tombstone               |
| `document_create_receipts` | Organization, actor and key digest, request fingerprint, original response and expiry |

Both tables use forced row-level security. Organization is part of every persistence key.

## API

The Gateway calls these operations with a verified user actor and organization. The operations
return private, uncacheable responses and recheck access through Task.

| Method and path                              | Operation                        |
| -------------------------------------------- | -------------------------------- |
| `GET /internal/v1/documents`                 | List currently readable metadata |
| `POST /internal/v1/documents`                | Create or replay a document      |
| `GET /internal/v1/documents/{documentId}`    | Read current Markdown            |
| `PATCH /internal/v1/documents/{documentId}`  | Edit supplied fields             |
| `DELETE /internal/v1/documents/{documentId}` | Delete with a strong version     |

## Events emitted

`doc.created.v1`, `doc.updated.v1` and `doc.deleted.v1` carry the routing identifiers, version
and actor defined by the published contract.

## Events consumed

None.

## Invariants

- A caller needs a current direct-space role to read. Creation, editing and deletion require
  `edit`. A list share alone cannot reveal a document. A replay requires current edit access.
- A document starts at version 1 and remains in its original space. Editing or deleting requires
  the strong ETag of the current version. Equivalent edits preserve the version and emit no fact.
- A deletion retains the identifiers and terminal version. It clears document content and the
  matching receipt snapshot in the same transaction.
- Listing scans in batches of at most 100 candidate locators within the request deadline. Only
  currently authorized locations reach the title and body filter. The service issues a
  continuation only after finding another authorized match. The opaque cursor binds the last
  visible position to the organization, actor and normalized query.

## Transactions

Use cases check Task authorization before entering their write transaction. The document, its
receipt and the outbox fact commit together. A concurrent create with a caller key already in use
returns a conflict without waiting. Edits and deletes check the current strong version under the
document row lock. A system maintenance transaction removes up to 500 expired receipts per
replica every 30 seconds, and skips rows locked by concurrent work.

## Decisions

- Store Markdown source and preserve valid body line endings and Unicode. A null character or
  unpaired UTF-16 surrogate is invalid text.
- Preserve the original create response for up to 24 hours, including after edits. Deletion
  discards the saved response and retains the fingerprint until expiry.
- Task authorization fails closed. Configuring the Task URL and issuer key enables calls.
  Replicas derive the cursor key from the service signer. Rotating that key invalidates existing
  cursors, which callers can recover from by restarting the list.
