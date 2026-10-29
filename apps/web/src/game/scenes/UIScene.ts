import Phaser from 'phaser';
import { ko } from '@/i18n/ko';
import type { ConnectionStatus } from '../../realtime/types';
import { BRIDGE_REGISTRY_KEY, FONT_REGISTRY_KEY, type GameBridge } from '../bridge';
import { PIXEL_FONT_SIZE } from '../font';
import { COLORS } from '../stage';

/**
 * Screen-space HUD on top of the world: a small pixel chip while (re)connecting. Terminal states
 * that need a button (replaced, failed) are React banners instead.
 */
export class UIScene extends Phaser.Scene {
  private chip!: Phaser.GameObjects.Container;
  private dim!: Phaser.GameObjects.Rectangle;
  private chipBg!: Phaser.GameObjects.Graphics;
  private chipText!: Phaser.GameObjects.Text;
  private status: ConnectionStatus = { kind: 'idle' };
  private off: (() => void) | null = null;

  constructor() {
    super({ key: 'ui' });
  }

  create(): void {
    const bridge = this.registry.get(BRIDGE_REGISTRY_KEY) as GameBridge;
    const font = (this.registry.get(FONT_REGISTRY_KEY) as string | undefined) ?? 'Galmuri11, sans-serif';
    // Dims the (now stale) world while a terminal state banner asks the user to act.
    this.dim = this.add.rectangle(0, 0, 10, 10, COLORS.ink, 0.28).setOrigin(0, 0).setVisible(false);
    this.chipBg = this.add.graphics();
    this.chipText = this.add.text(0, 0, '', { fontFamily: font, fontSize: `${PIXEL_FONT_SIZE}px`, color: '#ffffff' });
    this.chipText.setOrigin(0.5, 0.5);
    this.chip = this.add.container(0, 0, [this.chipBg, this.chipText]).setVisible(false);
    this.status = bridge.session.getStatus();
    this.off = bridge.session.on('status', (s) => {
      this.status = s;
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.off?.());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.off?.());
  }

  private label(now: number): string | null {
    const s = this.status;
    switch (s.kind) {
      case 'idle':
      case 'connecting':
        return ko.townUi.connection.connecting;
      case 'reconnecting':
        return ko.townUi.connection.reconnecting;
      case 'retrying':
        return ko.townUi.connection.retrying(Math.max(1, Math.ceil((s.retryAt - now) / 1000)));
      default:
        return null;
    }
  }

  override update(): void {
    const k = this.status.kind;
    const terminal =
      k === 'replaced' ||
      k === 'failed' ||
      k === 'map_mismatch' ||
      k === 'protocol_mismatch' ||
      k === 'forbidden' ||
      k === 'notice_required';
    if (terminal) this.dim.setSize(this.scale.width, this.scale.height);
    this.dim.setVisible(terminal);
    const text = this.label(Date.now());
    if (!text) {
      this.chip.setVisible(false);
      return;
    }
    if (text !== this.chipText.text) {
      this.chipText.setText(text);
      const w = Math.ceil(this.chipText.width) + 24;
      const h = 24;
      this.chipBg.clear();
      this.chipBg.fillStyle(COLORS.ink, 0.86);
      this.chipBg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    }
    const pulse = 0.8 + 0.2 * Math.sin(this.time.now / 260);
    this.chip.setPosition(Math.round(this.scale.width / 2), 64).setAlpha(pulse).setVisible(true);
  }
}
