import {
  baseConfigShape,
  internalTokenSignerConfigShape,
  internalTokenVerifierConfigShape,
} from '@cadenway/nest-common';
import type {
  BaseConfig,
  Ed25519PrivateJwk,
  InternalTokenVerifierConfig,
} from '@cadenway/nest-common';
import { databaseConfigShape } from '@cadenway/nest-common/database';
import type { DatabaseConfig } from '@cadenway/nest-common/database';
import { messagingConfigShape } from '@cadenway/nest-messaging';
import type { MessagingConfig } from '@cadenway/nest-messaging';
import { z } from 'zod';

/**
 * Type AppConfig
 *
 * @description
 * Variables the running service reads, validated when the application is created: by `loadConfig`
 * in `main.ts` for the options of `createApplication`, and by `ConfigModule` for the providers that
 * inject `CONFIG`.
 *
 * - `NODE_ENV`, `PORT`, `LOG_LEVEL`, `LOG_PRETTY`: `baseConfigShape` of `@cadenway/nest-common`;
 *   `PORT` is required, the others default to `production`, `info` and `false`.
 * - `DATABASE_URL`: the application role of this service's own database (`document_app`), subject
 *   to row-level security and holding no DDL right.
 * - `DATABASE_TRANSACTION_MAX_ATTEMPTS`: total attempts for retryable PostgreSQL transactions,
 *   defaulting to 3. Use 1 to disable retries.
 * - `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`: `messagingConfigShape` of `@cadenway/nest-messaging`.
 *   `NATS_URL` is required; the user (`document`) and its password are optional for the kit, which
 *   accepts an anonymous local broker, but every broker of Cadenway refuses a connection without
 *   them.
 * - `INTERNAL_TOKEN_AUDIENCE` and `INTERNAL_TOKEN_TRUSTED_ISSUERS`: the `aud` this service accepts
 *   and the public keys of the backends allowed to call it.
 * - `SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS`: optional comma-separated public keys for
 *   `search-service`. A `search-service` entry in the explicit issuer map takes precedence.
 * - `SEARCH_PROJECTION_CURSOR_SECRET`: optional stable, 32-byte base64url key for projection
 *   cursors. It takes precedence over a key derived from the service signer. Search trust
 *   requires one of those keys.
 * - `DOCUMENT_ACCESS_MODE`: `task-authorized` enables the user API and requires a Task origin
 *   and signing key. `search-only` keeps the Search projections available without the user API.
 * - `TASK_SERVICE_URL` and `INTERNAL_TOKEN_PRIVATE_JWK`: the Task origin and the key used to
 *   sign live direct-space access lookups as `document-service`.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is read by `telemetry.ts`, before the application exists.
 */
export type AppConfig = BaseConfig &
  DatabaseConfig &
  MessagingConfig &
  InternalTokenVerifierConfig & {
    readonly DOCUMENT_ACCESS_MODE: 'task-authorized' | 'search-only';
    readonly TASK_SERVICE_URL?: string;
    readonly INTERNAL_TOKEN_PRIVATE_JWK?: Ed25519PrivateJwk;
    readonly SEARCH_PROJECTION_CURSOR_SECRET?: string;
  };

/**
 * Constant appConfigSchema
 *
 * @description
 * Zod schema of `AppConfig`, composed from the shapes of `@cadenway/nest-common` and
 * `@cadenway/nest-messaging` so the names, defaults and validation stay those of the kit. A missing
 * or invalid variable makes `loadConfig` throw a `ConfigError` that names it without printing its
 * value.
 *
 * @type {z.ZodType<AppConfig>}
 */
export const appConfigSchema: z.ZodType<AppConfig> = z
  .object({
    ...baseConfigShape,
    ...databaseConfigShape,
    ...messagingConfigShape,
    ...internalTokenVerifierConfigShape,
    DOCUMENT_ACCESS_MODE: z.enum(['task-authorized', 'search-only']).default('task-authorized'),
    TASK_SERVICE_URL: z
      .url({ protocol: /^https?$/u, error: 'Expected the HTTP(S) base URL of task-service.' })
      .refine((value) => {
        const url = URL.parse(value);
        return (
          url !== null &&
          url.username === '' &&
          url.password === '' &&
          url.search === '' &&
          url.hash === ''
        );
      }, 'Expected a base URL without credentials, a query or a fragment.')
      .optional(),
    INTERNAL_TOKEN_PRIVATE_JWK:
      internalTokenSignerConfigShape.INTERNAL_TOKEN_PRIVATE_JWK.optional(),
    SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: z.string().trim().optional(),
    SEARCH_PROJECTION_CURSOR_SECRET: z
      .string()
      .refine(
        (value) =>
          value.length === 43 && Buffer.from(value, 'base64url').toString('base64url') === value,
        'Expected a canonical unpadded base64url key of 32 bytes.',
      )
      .optional(),
  })
  .superRefine((config, context) => {
    if (config.DOCUMENT_ACCESS_MODE === 'task-authorized') {
      for (const setting of ['TASK_SERVICE_URL', 'INTERNAL_TOKEN_PRIVATE_JWK'] as const) {
        if (config[setting] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [setting],
            message: 'Required in task-authorized mode.',
          });
        }
      }
    } else if (config.TASK_SERVICE_URL !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['TASK_SERVICE_URL'],
        message: 'Use task-authorized mode when configuring the Task origin.',
      });
    }
  })
  .transform(
    ({ SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: searchKeys, ...config }, context): AppConfig => {
      if (!searchKeys || Object.hasOwn(config.INTERNAL_TOKEN_TRUSTED_ISSUERS, 'search-service')) {
        return config;
      }
      try {
        const keys: unknown = JSON.parse(`[${searchKeys}]`);
        const searchIssuer =
          internalTokenVerifierConfigShape.INTERNAL_TOKEN_TRUSTED_ISSUERS.safeParse(
            JSON.stringify({ 'search-service': keys }),
          );
        if (searchIssuer.success) {
          return {
            ...config,
            INTERNAL_TOKEN_TRUSTED_ISSUERS: {
              ...config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
              ...searchIssuer.data,
            },
          };
        }
      } catch {
        // Report the setting name without reflecting its contents.
      }
      context.addIssue({
        code: 'custom',
        path: ['SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'],
        message: 'Expected comma-separated public Ed25519 JWKs.',
      });
      return z.NEVER;
    },
  )
  .superRefine((config, context) => {
    if (
      Object.hasOwn(config.INTERNAL_TOKEN_TRUSTED_ISSUERS, 'search-service') &&
      config.SEARCH_PROJECTION_CURSOR_SECRET === undefined &&
      config.INTERNAL_TOKEN_PRIVATE_JWK === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SEARCH_PROJECTION_CURSOR_SECRET'],
        message: 'Required when Search is trusted and no service signer is configured.',
      });
    }
  });

/**
 * Interface MigrationConfig
 *
 * @description
 * Variable the one-off migration container reads (`node dist/migrate.js`). The running service
 * never reads it: only the migrator role may change the structure of the database.
 */
export interface MigrationConfig {
  // #region Properties
  /**
   * Property MIGRATION_DATABASE_URL
   *
   * @description
   * Connection string of the migrator role (`document_migrator`), which owns the tables and runs
   * the DDL. A secret; cadenway-ops passes it from `DOCUMENT_SERVICE_MIGRATION_DATABASE_URL`.
   *
   * @type {string}
   * @readonly
   */
  readonly MIGRATION_DATABASE_URL: string;
  // #endregion
}

/**
 * Constant migrationConfigSchema
 *
 * @description
 * Zod schema of `MigrationConfig`: a `postgres://` or `postgresql://` URL, like `DATABASE_URL`.
 *
 * @type {z.ZodType<MigrationConfig>}
 */
export const migrationConfigSchema: z.ZodType<MigrationConfig> = z.object({
  MIGRATION_DATABASE_URL: z.url({
    protocol: /^postgres(?:ql)?$/u,
    error: 'Expected the postgres:// URL of the migrator role.',
  }),
});
