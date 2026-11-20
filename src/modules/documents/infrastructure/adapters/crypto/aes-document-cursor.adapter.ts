import { GetDocumentInternalParams } from '@cadenway/contracts/validators/internal/document-service';
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import type { DocumentPosition } from '../../../application/models/document/document-position.model.js';
import { DocumentApplicationError } from '../../../application/ports/outbound/pagination/document/document-cursor.port.js';
import type { DocumentCursor } from '../../../application/ports/outbound/pagination/document/document-cursor.port.js';

type EncodeInput = Parameters<DocumentCursor['encode']>[0];
type DecodeInput = Parameters<DocumentCursor['decode']>[0];
type CursorScope = Pick<EncodeInput, 'organizationId' | 'actorUserId' | 'query'>;

const version = 1;
const algorithm = 'aes-256-gcm';
const keyBytes = 32;
const nonceBytes = 12;
const tagBytes = 16;
const timestampBytes = 8;
const idBytes = 16;
const payloadBytes = timestampBytes + idBytes;
const tagStart = 1 + nonceBytes;
const payloadStart = tagStart + tagBytes;
const envelopeBytes = payloadStart + payloadBytes;
const encodedBytes = Math.ceil((envelopeBytes * 4) / 3);

function cursorScope(scope: CursorScope): Buffer {
  return Buffer.from(
    JSON.stringify([
      'cadenway:document:list:cursor:v1',
      scope.organizationId.toLowerCase(),
      scope.actorUserId.toLowerCase(),
      scope.query,
    ]),
  );
}

/** Encrypts the fixed-length scan position with authenticated caller and query binding. */
export class AesDocumentCursorAdapter implements DocumentCursor {
  // #region Properties
  /** Scoped service key shared by active replicas. */
  private readonly key: KeyObject;
  // #endregion

  // #region Constructor
  /** Imports a 32-byte key derived specifically for document listing cursors. */
  public constructor(key: Uint8Array) {
    if (key.byteLength !== keyBytes) throw new Error('Invalid document cursor key length.');
    this.key = createSecretKey(key);
  }
  // #endregion

  // #region Methods
  /** Retains the exact millisecond and UUID of the last examined row without exposing either. */
  public encode(input: EncodeInput): string {
    const time = input.position.updatedAt.getTime();
    const id = GetDocumentInternalParams.safeParse({ documentId: input.position.id });
    if (!Number.isFinite(time) || !id.success) throw new DocumentApplicationError('unavailable');

    const payload = Buffer.alloc(payloadBytes);
    payload.writeBigInt64BE(BigInt(time));
    payload.set(Buffer.from(id.data.documentId.replaceAll('-', ''), 'hex'), timestampBytes);
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv(algorithm, this.key, nonce, { authTagLength: tagBytes });
    cipher.setAAD(cursorScope(input));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return Buffer.concat([Buffer.of(version), nonce, cipher.getAuthTag(), ciphertext]).toString(
      'base64url',
    );
  }

  /** Refuses malformed, modified and out-of-scope envelopes with the same error. */
  public decode(input: DecodeInput): DocumentPosition {
    const { cursor } = input;
    if (cursor.length !== encodedBytes || !/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new DocumentApplicationError('invalid-cursor');
    }
    const envelope = Buffer.from(cursor, 'base64url');
    if (
      envelope.byteLength !== envelopeBytes ||
      envelope[0] !== version ||
      envelope.toString('base64url') !== cursor
    ) {
      throw new DocumentApplicationError('invalid-cursor');
    }
    try {
      const decipher = createDecipheriv(algorithm, this.key, envelope.subarray(1, tagStart), {
        authTagLength: tagBytes,
      });
      decipher.setAAD(cursorScope(input));
      decipher.setAuthTag(envelope.subarray(tagStart, payloadStart));
      const payload = Buffer.concat([
        decipher.update(envelope.subarray(payloadStart)),
        decipher.final(),
      ]);
      const updatedAt = new Date(Number(payload.readBigInt64BE()));
      const hex = payload.subarray(timestampBytes).toString('hex');
      const id = [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join('-');
      if (
        !Number.isFinite(updatedAt.getTime()) ||
        !GetDocumentInternalParams.safeParse({ documentId: id }).success
      ) {
        throw new DocumentApplicationError('invalid-cursor');
      }
      return { id, updatedAt };
    } catch {
      throw new DocumentApplicationError('invalid-cursor');
    }
  }
  // #endregion
}
