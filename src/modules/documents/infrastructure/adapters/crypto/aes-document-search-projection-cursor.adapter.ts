import { GetDocumentInternalParams } from '@cadenway/contracts/validators/internal/document-service';
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import type { DocumentSearchProjectionCursor } from '../../../application/ports/outbound/pagination/search-projection/document-search-projection-cursor.port.js';

type Position = Parameters<DocumentSearchProjectionCursor['encode']>[1];

const version = 1;
const algorithm = 'aes-256-gcm';
const keyBytes = 32;
const nonceBytes = 12;
const tagBytes = 16;
const idBytes = 16;
const tagStart = 1 + nonceBytes;
const payloadStart = tagStart + tagBytes;
const envelopeBytes = payloadStart + 2 * idBytes;
const encodedLength = Math.ceil((envelopeBytes * 4) / 3);

function cursorScope(organizationId: string): Buffer {
  return Buffer.from(
    JSON.stringify(['cadenway:document:search-projection:cursor:v1', organizationId.toLowerCase()]),
  );
}

function validatedPosition(position: Position): Position {
  const lastId = position.lastId.toLowerCase();
  const upperBound = position.upperBound.toLowerCase();
  if (
    lastId > upperBound ||
    !GetDocumentInternalParams.safeParse({ documentId: lastId }).success ||
    !GetDocumentInternalParams.safeParse({ documentId: upperBound }).success
  ) {
    throw new Error('Invalid document search projection cursor position.');
  }
  return { lastId, upperBound };
}

function readUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** Encrypts both UUIDv7 bounds and authenticates the organization and cursor purpose. */
export class AesDocumentSearchProjectionCursor implements DocumentSearchProjectionCursor {
  // #region Properties
  /** Stable, projection-specific key shared by active replicas. */
  private readonly key: KeyObject;
  // #endregion

  // #region Constructor
  /** Imports the service's 32-byte search projection cursor key. */
  public constructor(key: Uint8Array) {
    if (key.byteLength !== keyBytes)
      throw new Error('Invalid document search projection key length.');
    this.key = createSecretKey(key);
  }
  // #endregion

  // #region Methods
  /** Returns an opaque, fixed-length token for the last emitted row and upper fence. */
  public encode(organizationId: string, position: Position): string {
    const { lastId, upperBound } = validatedPosition(position);
    const payload = Buffer.from(lastId.replaceAll('-', '') + upperBound.replaceAll('-', ''), 'hex');
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv(algorithm, this.key, nonce, { authTagLength: tagBytes });
    cipher.setAAD(cursorScope(organizationId));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return Buffer.concat([Buffer.of(version), nonce, cipher.getAuthTag(), ciphertext]).toString(
      'base64url',
    );
  }

  /** Returns the exact bounds after validating the envelope, authenticator, and position. */
  public decode(organizationId: string, cursor: string): Position {
    if (cursor.length !== encodedLength || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error('Invalid document search projection cursor.');
    }
    const envelope = Buffer.from(cursor, 'base64url');
    if (
      envelope.byteLength !== envelopeBytes ||
      envelope[0] !== version ||
      envelope.toString('base64url') !== cursor
    ) {
      throw new Error('Invalid document search projection cursor.');
    }
    try {
      const decipher = createDecipheriv(algorithm, this.key, envelope.subarray(1, tagStart), {
        authTagLength: tagBytes,
      });
      decipher.setAAD(cursorScope(organizationId));
      decipher.setAuthTag(envelope.subarray(tagStart, payloadStart));
      const payload = Buffer.concat([
        decipher.update(envelope.subarray(payloadStart)),
        decipher.final(),
      ]);
      return validatedPosition({
        lastId: readUuid(payload.subarray(0, idBytes)),
        upperBound: readUuid(payload.subarray(idBytes)),
      });
    } catch {
      throw new Error('Invalid document search projection cursor.');
    }
  }
  // #endregion
}
