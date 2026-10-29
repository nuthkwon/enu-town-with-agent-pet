import { PET_CHANNEL_PLATFORMS, type PetChannelPlatform } from '@enu/shared';
import { ChannelHttpError, PetChannelClient } from './client';
import type { ChannelConfig } from './config';
import { loadCredentials, removeCredentials, saveCredentials } from './credentials';
import { PLUGIN_VERSION } from './version';

/**
 * Terminal commands a person runs (`enu-pet pair <code>`, `enu-pet status`, `enu-pet unpair`). Pairing is never
 * offered to Claude as a tool. The token is never printed.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  platform?: string;
  now?: () => Date;
}

function platformOf(p: string): PetChannelPlatform {
  return (PET_CHANNEL_PLATFORMS as readonly string[]).includes(p) ? (p as PetChannelPlatform) : 'other';
}

const USAGE = [
  '사용법:',
  '  enu-pet pair <코드> [--label <이 컴퓨터 이름>]   ENU Den 설정에서 만든 코드로 이 컴퓨터를 연결해요.',
  '  enu-pet status                                  연결 상태를 보여 줘요.',
  '  enu-pet unpair                                  이 컴퓨터의 연결을 해제해요.',
];

/** Returns the process exit code. */
export async function runCli(args: string[], config: ChannelConfig, io: CliIo): Promise<number> {
  const [cmd, ...rest] = args;
  const existing = loadCredentials(config.credentialsPath, config.baseUrl);
  const client = (token: string | null) => new PetChannelClient(config.baseUrl, token, io.fetch);

  if (cmd === 'pair') {
    const code = rest[0];
    const labelAt = rest.indexOf('--label');
    const label = labelAt >= 0 ? rest[labelAt + 1] : undefined;
    if (!code || code.startsWith('--')) {
      USAGE.forEach(io.err);
      return 2;
    }
    if (existing) {
      // Never replace someone's credentials silently (a shared or borrowed computer).
      io.err(
        `이 컴퓨터는 이미 ENU Den ${existing.owner_display_name} 계정에 연결되어 있어요. 바꾸려면 먼저 \`enu-pet unpair\`를 실행해 주세요.`,
      );
      return 1;
    }
    try {
      const out = await client(null).pair({
        code,
        ...(label ? { label } : {}),
        platform: platformOf(io.platform ?? process.platform),
        plugin_version: PLUGIN_VERSION,
      });
      saveCredentials(config.credentialsPath, {
        v: 1,
        base_url: config.baseUrl,
        token: out.token,
        token_id: out.token_id,
        link_id: out.link_id,
        owner_display_name: out.owner_display_name,
        expires_at: out.expires_at,
        paired_at: (io.now?.() ?? new Date()).toISOString(),
      });
      io.out(
        `ENU Den ${out.owner_display_name} 계정에 연결했어요. 이제 \`enu-pet\`으로 Claude Code를 시작하세요.`,
      );
      return 0;
    } catch (e) {
      io.err(pairFailure(e));
      return 1;
    }
  }

  if (cmd === 'status') {
    if (!existing) {
      io.out(`연결되어 있지 않아요(${config.baseUrl}).`);
      return 1;
    }
    io.out(
      `ENU Den ${existing.owner_display_name} 계정에 연결되어 있어요(${config.baseUrl}, ${existing.expires_at.slice(0, 10)}까지).`,
    );
    return 0;
  }

  if (cmd === 'unpair') {
    if (!existing) {
      io.out('연결되어 있지 않아요.');
      return 0;
    }
    try {
      await client(existing.token).unpair();
    } catch (e) {
      // Already revoked or expired: removing the local file is all that is left to do.
      if (!(e instanceof ChannelHttpError && e.unpaired)) {
        io.err('ENU Den에 연결하지 못했어요. 잠시 후 다시 시도하거나 ENU Den 설정에서 연결을 해제해 주세요.');
        return 1;
      }
    }
    removeCredentials(config.credentialsPath);
    io.out('이 컴퓨터의 ENU Den 펫 채널 연결을 해제했어요.');
    return 0;
  }

  USAGE.forEach(io.err);
  return 2;
}

function pairFailure(e: unknown): string {
  if (!(e instanceof ChannelHttpError))
    return 'ENU Den에 연결하지 못했어요. 주소와 네트워크를 확인해 주세요.';
  switch (e.code) {
    case 'invalid_code':
    case 'invalid_body':
      return '코드가 맞지 않거나 만료되었어요. ENU Den 설정에서 새 코드를 만들어 주세요.';
    case 'too_many_machines':
      return '연결할 수 있는 컴퓨터 수(3대)를 넘었어요. ENU Den 설정에서 쓰지 않는 연결을 해제해 주세요.';
    case 'notice_required':
      return 'ENU Den을 열어 바뀐 개인정보 처리 안내를 먼저 확인해 주세요.';
    case 'rate_limited':
      return '시도가 너무 잦아요. 잠시 후 다시 시도해 주세요.';
    default:
      return `연결하지 못했어요(${e.code}).`;
  }
}
