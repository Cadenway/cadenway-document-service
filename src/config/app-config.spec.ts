import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { ConfigError, loadConfig } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { appConfigSchema, migrationConfigSchema } from './app-config.js';

describe('appConfigSchema', () => {
  const trustedIssuers: string =
    '{"api-gateway":[{"kty":"OKP","crv":"Ed25519","x":"MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0","kid":"local-placeholder"}]}';
  const complete: Readonly<Record<string, string>> = {
    PORT: '3014',
    DOCUMENT_ACCESS_MODE: 'search-only',
    DATABASE_URL: 'postgres://document_app:document_app@localhost:5432/document',
    NATS_URL: 'nats://localhost:4222',
    NATS_USER: 'document',
    NATS_PASSWORD: 'document',
    INTERNAL_TOKEN_AUDIENCE: 'document-service',
    INTERNAL_TOKEN_TRUSTED_ISSUERS: trustedIssuers,
  };
  const taskServiceUrl = 'http://task-service:3013';

  function taskSigningKey(): string {
    const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    return JSON.stringify({ ...jwk, kid: 'document-test' });
  }

  function searchPublicKey(kid: string): string {
    const jwk = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    return JSON.stringify({ ...jwk, kid });
  }

  it('reads the variables of the service with the defaults of the kit', () => {
    expect(loadConfig(appConfigSchema, complete)).toEqual({
      NODE_ENV: 'production',
      PORT: 3014,
      DOCUMENT_ACCESS_MODE: 'search-only',
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      DATABASE_URL: 'postgres://document_app:document_app@localhost:5432/document',
      DATABASE_TRANSACTION_MAX_ATTEMPTS: 3,
      NATS_URL: 'nats://localhost:4222',
      NATS_USER: 'document',
      NATS_PASSWORD: 'document',
      INTERNAL_TOKEN_AUDIENCE: 'document-service',
      INTERNAL_TOKEN_TRUSTED_ISSUERS: {
        'api-gateway': [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
            kid: 'local-placeholder',
          },
        ],
      },
    });
  });

  it('accepts the committed .env.example as it is', () => {
    const example: NodeJS.Dict<string> = parseEnv(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'),
    );

    expect(() => loadConfig(appConfigSchema, example)).not.toThrow();
    expect(() => loadConfig(migrationConfigSchema, example)).not.toThrow();
  });

  it('refuses to start without the database, the broker, the audience or the trusted issuers', () => {
    expect(() => loadConfig(appConfigSchema, { PORT: '3014' })).toThrow(ConfigError);
    try {
      loadConfig(appConfigSchema, { PORT: '3014' });
    } catch (error) {
      const issues: readonly string[] = (error as ConfigError).issues;
      expect(issues.map((issue) => issue.split(':')[0])).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'NATS_URL',
          'INTERNAL_TOKEN_AUDIENCE',
          'INTERNAL_TOKEN_TRUSTED_ISSUERS',
        ]),
      );
    }
  });

  it('refuses a database URL that is not PostgreSQL, without printing it', () => {
    const secret: string = 'mysql://document_app:s3cret@localhost/document';

    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).toThrow(
      /DATABASE_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a broker URL that is not NATS, without printing it', () => {
    const secret: string = 'http://document:s3cret@localhost:4222';

    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).toThrow(
      /NATS_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a private key listed as a verification key', () => {
    const withPrivateKey: string = trustedIssuers.replace('"kid"', `"d":"${'A'.repeat(43)}","kid"`);

    expect(() =>
      loadConfig(appConfigSchema, { ...complete, INTERNAL_TOKEN_TRUSTED_ISSUERS: withPrivateKey }),
    ).toThrow(/INTERNAL_TOKEN_TRUSTED_ISSUERS/u);
  });

  it('leaves Search unconfigured when Compose supplies empty defaults', () => {
    const config = loadConfig(appConfigSchema, {
      ...complete,
      SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: '',
      SEARCH_PROJECTION_CURSOR_SECRET: '',
    });

    expect(config).toEqual(loadConfig(appConfigSchema, complete));
  });

  it('adds the Search public keys alongside the explicitly trusted issuers', () => {
    const first = searchPublicKey('search-first');
    const second = searchPublicKey('search-second');
    const config = loadConfig(appConfigSchema, {
      ...complete,
      SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: `${first},${second}`,
    });

    expect(Object.keys(config.INTERNAL_TOKEN_TRUSTED_ISSUERS)).toEqual([
      'api-gateway',
      'search-service',
    ]);
    expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS['search-service']?.map((key) => key.kid)).toEqual([
      'search-first',
      'search-second',
    ]);
  });

  it('uses explicit Search trust even when an unused fallback is malformed', () => {
    const config = loadConfig(appConfigSchema, {
      ...complete,
      INTERNAL_TOKEN_TRUSTED_ISSUERS: `{"search-service":[${searchPublicKey('explicit-search')}]}`,
      SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: 'unused-fallback',
    });

    expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS['search-service']?.map((key) => key.kid)).toEqual([
      'explicit-search',
    ]);
  });

  it('rejects malformed Search keys without printing the supplied text', () => {
    const load = () =>
      loadConfig(appConfigSchema, {
        ...complete,
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: 'invalid-search-key-sentinel',
      });

    expect(load).toThrow(/SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS/u);
    expect(load).not.toThrow(/invalid-search-key-sentinel/u);
  });

  it('rejects private material in the Search verification key list', () => {
    expect(() =>
      loadConfig(appConfigSchema, {
        ...complete,
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: taskSigningKey(),
      }),
    ).toThrow(/SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS/u);
  });

  it('rejects fallback input that attempts to introduce another issuer', () => {
    const key = searchPublicKey('search-test');

    expect(() =>
      loadConfig(appConfigSchema, {
        ...complete,
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: `${key}],"other-service":[${key}`,
      }),
    ).toThrow(/SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS/u);
  });

  it('loads a canonical cursor key independently of the Task signer', () => {
    const key = randomBytes(32).toString('base64url');
    const config = loadConfig(appConfigSchema, {
      ...complete,
      SEARCH_PROJECTION_CURSOR_SECRET: key,
    });

    expect(config.SEARCH_PROJECTION_CURSOR_SECRET).toBe(key);
    expect(config.INTERNAL_TOKEN_PRIVATE_JWK).toBeUndefined();
  });

  it.each([`${'A'.repeat(42)}B`, `${'A'.repeat(43)}=`, 'invalid-cursor-key-sentinel'])(
    'rejects a noncanonical cursor key without printing it',
    (key) => {
      const load = () =>
        loadConfig(appConfigSchema, { ...complete, SEARCH_PROJECTION_CURSOR_SECRET: key });

      expect(load).toThrow(/SEARCH_PROJECTION_CURSOR_SECRET/u);
      expect(load).not.toThrow(key);
    },
  );

  it('does not read the migrator URL: the running service never needs it', () => {
    expect(loadConfig(appConfigSchema, complete)).not.toHaveProperty('MIGRATION_DATABASE_URL');
  });

  it('allows empty Task access settings in explicit search-only mode', () => {
    const config = loadConfig(appConfigSchema, {
      ...complete,
      TASK_SERVICE_URL: '',
      INTERNAL_TOKEN_PRIVATE_JWK: '',
    });
    expect(config.TASK_SERVICE_URL).toBeUndefined();
    expect(config.INTERNAL_TOKEN_PRIVATE_JWK).toBeUndefined();
  });

  it('requires both Task settings unless search-only mode was chosen', () => {
    const environment = { ...complete, DOCUMENT_ACCESS_MODE: undefined };
    const load = () => loadConfig(appConfigSchema, environment);
    expect(load).toThrow(/TASK_SERVICE_URL: required, not set/u);
    expect(load).toThrow(/INTERNAL_TOKEN_PRIVATE_JWK: required, not set/u);
  });

  it('refuses a Task origin in search-only mode', () => {
    expect(() =>
      loadConfig(appConfigSchema, { ...complete, TASK_SERVICE_URL: taskServiceUrl }),
    ).toThrow(/Use task-authorized mode/u);
  });

  it('loads the Task base URL and a signing key in the default mode', () => {
    const config = loadConfig(appConfigSchema, {
      ...complete,
      DOCUMENT_ACCESS_MODE: undefined,
      TASK_SERVICE_URL: taskServiceUrl,
      INTERNAL_TOKEN_PRIVATE_JWK: taskSigningKey(),
    });
    expect(config.DOCUMENT_ACCESS_MODE).toBe('task-authorized');
    expect(config.TASK_SERVICE_URL).toBe(taskServiceUrl);
    expect(config.INTERNAL_TOKEN_PRIVATE_JWK?.kid).toBe('document-test');
  });

  it('names the missing setting when only half of Task access is configured', () => {
    expect(() =>
      loadConfig(appConfigSchema, {
        ...complete,
        DOCUMENT_ACCESS_MODE: 'task-authorized',
        TASK_SERVICE_URL: taskServiceUrl,
      }),
    ).toThrow(/INTERNAL_TOKEN_PRIVATE_JWK: required, not set/u);
    expect(() =>
      loadConfig(appConfigSchema, {
        ...complete,
        DOCUMENT_ACCESS_MODE: 'task-authorized',
        INTERNAL_TOKEN_PRIVATE_JWK: taskSigningKey(),
      }),
    ).toThrow(/TASK_SERVICE_URL: required, not set/u);
  });

  it.each([
    'not-a-url',
    'ftp://task-service:3013',
    'http://document:task-password@task-service:3013',
  ])('refuses an invalid or credential-bearing Task URL', (url) => {
    const load = () =>
      loadConfig(appConfigSchema, {
        ...complete,
        DOCUMENT_ACCESS_MODE: 'task-authorized',
        TASK_SERVICE_URL: url,
        INTERNAL_TOKEN_PRIVATE_JWK: taskSigningKey(),
      });
    expect(load).toThrow(/TASK_SERVICE_URL/u);
    expect(load).not.toThrow(/task-password/u);
  });

  it('names an invalid Task signing key without reflecting its value', () => {
    const load = () =>
      loadConfig(appConfigSchema, {
        ...complete,
        DOCUMENT_ACCESS_MODE: 'task-authorized',
        TASK_SERVICE_URL: taskServiceUrl,
        INTERNAL_TOKEN_PRIVATE_JWK: 'invalid-key-sentinel',
      });
    expect(load).toThrow(/INTERNAL_TOKEN_PRIVATE_JWK/u);
    expect(load).not.toThrow(/invalid-key-sentinel/u);
  });
});

describe('migrationConfigSchema', () => {
  it('reads the URL of the migrator role', () => {
    expect(
      loadConfig(migrationConfigSchema, {
        MIGRATION_DATABASE_URL:
          'postgres://document_migrator:document_migrator@localhost:5432/document',
      }),
    ).toEqual({
      MIGRATION_DATABASE_URL:
        'postgres://document_migrator:document_migrator@localhost:5432/document',
    });
  });

  it('names MIGRATION_DATABASE_URL when it is missing', () => {
    expect(() =>
      loadConfig(migrationConfigSchema, {
        DATABASE_URL: 'postgres://document_app:document_app@localhost:5432/document',
      }),
    ).toThrow(/MIGRATION_DATABASE_URL: required, not set/u);
  });

  it('names MIGRATION_DATABASE_URL when it is not a PostgreSQL URL, without printing it', () => {
    const secret: string = 'mysql://document_migrator:s3cret@localhost/document';

    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).toThrow(
      /MIGRATION_DATABASE_URL: Expected the postgres:\/\/ URL of the migrator role/u,
    );
    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });
});
