import { db } from '@/server/infrastructure/db/client';
import { DrizzleUserRepository } from '@/server/infrastructure/repositories/drizzle-user.repository';
import { User } from '@/server/domain/entities/user.entity';
import { UsernameVO } from '@/server/domain/value-objects/username.vo';
import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import { env } from '@/server/env';

const logger = new LoggerService('bootstrap');

/**
 * When auth is disabled, the app runs as a single default user but settings are
 * FK-keyed to a users row. Ensure one exists. Empty passwordHash makes in-app
 * login impossible (login rejects users without a password), so this is safe to
 * leave even if auth is re-enabled later. To recover the "admin" account after
 * re-enabling auth, run the password recovery script (see README).
 */
export async function seedDefaultUser(): Promise<void> {
  if (!env.AUTH_DISABLED) return;

  const userRepository = new DrizzleUserRepository(db);
  if ((await userRepository.count()) > 0) return;

  await userRepository.save(
    User.create({ username: UsernameVO.create('admin'), passwordHash: '' })
  );
  logger.info('AUTH_DISABLED: seeded default user "admin"');
}
