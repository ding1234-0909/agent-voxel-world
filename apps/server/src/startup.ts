import { PrismaClient } from '@prisma/client';

export function databaseStartupMessage(error: unknown, databaseUrl: string) {
  const value = error as { code?: string; errorCode?: string } | null;
  const code = value?.errorCode ?? value?.code;
  let address = 'DATABASE_URL 指定的地址';
  let local = false;
  try {
    const url = new URL(databaseUrl);
    address = `${url.hostname}:${url.port || '5432'}`;
    local =
      url.hostname === '127.0.0.1' &&
      url.port === '55432' &&
      url.pathname === '/voxel';
  } catch {
    // Never include the raw URL or Prisma message: either can contain credentials.
  }
  let reason: string;
  let advice: string;
  switch (code) {
    case 'P1001':
    case 'P1002':
    case 'P1008':
    case 'P1017':
      reason = `无法连接 PostgreSQL（${address}），数据库可能未启动或连接超时。`;
      advice = local
        ? '如使用项目本地数据库，请手动运行 pnpm db:start。'
        : '请检查数据库服务、网络和 DATABASE_URL 中的地址。';
      break;
    case 'P1000':
    case 'P1010':
      reason = 'PostgreSQL 身份验证或访问权限检查失败。';
      advice = '请检查 DATABASE_URL 中的用户名、密码和数据库访问权限。';
      break;
    case 'P1003':
      reason = '配置的 PostgreSQL 数据库不存在。';
      advice = local
        ? '请手动运行 pnpm db:start，再运行 pnpm db:migrate。'
        : '请确认 DATABASE_URL 指向已创建的数据库。';
      break;
    case 'P2021':
    case 'P2022':
      reason = '数据库表结构尚未准备好。';
      advice =
        '请确认 DATABASE_URL 指向正确的数据库，再手动运行 pnpm db:migrate。';
      break;
    case 'P1012':
    case 'P1013':
      reason = '数据库连接配置无效。';
      advice = '请检查 .env 或环境变量中的 DATABASE_URL 格式。';
      break;
    default:
      reason = '数据库启动检查失败。';
      advice = '请检查 DATABASE_URL 配置及 PostgreSQL 服务日志。';
  }
  return [
    `[启动失败] ${reason}`,
    advice,
    '处理完成后重新运行 pnpm dev（当前开发任务可用 Ctrl+C 停止）。',
    '[警告] 后端未启动；即使 Vite 显示 ready，页面也无法连接世界。不会自动启动数据库或切换到内存模式。',
  ].join('\n');
}

export async function checkStartupDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn(
      '[警告] 未配置 DATABASE_URL，使用内存模式；服务重启后世界编辑会丢失。',
    );
    return;
  }
  let db: PrismaClient | undefined;
  try {
    db = new PrismaClient();
    await db.$connect();
    // Read-only check before Colyseus creates a room and logs initialization errors.
    await db.world.findFirst({ select: { id: true } });
  } catch (error) {
    throw new Error(databaseStartupMessage(error, databaseUrl));
  } finally {
    await db?.$disconnect().catch(() => {});
  }
}
