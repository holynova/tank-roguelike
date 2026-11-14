import Phaser from 'phaser';
import { VIEW, BLOCK, ARENA_H, FIELD_X, FIELD_Y, FOOT_Y, LAYER, COLORS } from '../core/constants';
import { PixelCjk } from './PixelCjk';
import { fcFrame, FcList } from './fc';
import { audioOf } from '../core/audio';
import type { GameScene } from '../scenes/GameScene';
import type { RunState } from '../systems/RunState';
import { cellAt, Cell } from '../systems/arena';

const W = VIEW.width;
const H = VIEW.height;

/**
 * Status strip.
 *
 * Laid out like the console HUD: score on the left, stage in the middle,
 * remaining enemies on the right. Labels render through the CJK rasteriser —
 * the 8x8 bitmap strip has no Chinese glyphs, so anything in Chinese passed
 * to it used to render as invisible gaps.
 */
export class Hud {
  private scene: GameScene;
  private run: RunState;

  private scoreText!: PixelCjk;
  private stageText!: PixelCjk;
  private waveText!: PixelCjk;
  private scrapText!: PixelCjk;
  private statusText!: PixelCjk;
  private hpG!: Phaser.GameObjects.Graphics;
  private hpText!: PixelCjk;
  private dashG!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private miniTimer = 0;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: PixelCjk;
  private bannerTitle!: PixelCjk;
  private bannerSub!: PixelCjk;
  private toastText!: PixelCjk;
  private hintText!: PixelCjk;
  private pauseLayer?: Phaser.GameObjects.Container;
  private abandonArmed = false;
  private waveTotal = 0;
  private waveIndex = 0;
  private waveProgress = 0;

  constructor(scene: GameScene) {
    this.scene = scene;
    this.run = scene.run;
    this.build();
    scene.time.delayedCall(9000, () => {
      this.scene.tweens.add({ targets: this.hintText.container, alpha: 0, duration: 900 });
    });
  }

  private build() {
    const s = this.scene;
    const g = s.add.graphics().setDepth(LAYER.ui - 3).setScrollFactor(0);
    g.fillStyle(0x101018, 1);
    g.fillRect(0, 0, W, FIELD_Y - 4);
    g.fillStyle(0x000000, 1);
    g.fillRect(0, FIELD_Y - 4, W, 4);
    g.lineStyle(2, 0x7c7c7c, 1);
    g.strokeRect(0, 0, W, FIELD_Y - 4);

    // foot strip
    g.fillStyle(0x101018, 1);
    g.fillRect(0, FOOT_Y + 4, W, VIEW.height - FOOT_Y - 4);
    g.fillStyle(0x000000, 1);
    g.fillRect(0, FOOT_Y, W, 4);

    // left column: score. (There used to be a LIFE row here, but the run ends
    // on the first death — there are no spare lives, so the icons lied.)
    this.scoreText = new PixelCjk(s, 16, 26, '分数 0', { scale: 2, px: 12, color: 0xfcfcfc, depth: LAYER.ui });

    // centre: stage + wave + hull
    this.stageText = new PixelCjk(s, W / 2, 26, '第 1 层', {
      scale: 2, px: 12, color: 0xfcd424, depth: LAYER.ui, align: 'center',
    });
    this.waveText = new PixelCjk(s, W / 2, 46, '', { scale: 1, px: 12, color: 0xbcbcbc, depth: LAYER.ui, align: 'center' });
    this.hpG = s.add.graphics().setDepth(LAYER.ui).setScrollFactor(0);
    this.hpText = new PixelCjk(s, W / 2 - 100, 64, '', { scale: 1, px: 12, color: 0xbcbcbc, depth: LAYER.ui, align: 'right' });

    // right column: scrap, level, enemies left
    this.scrapText = new PixelCjk(s, W - 16, 26, '废料 0', {
      scale: 2, px: 12, color: 0xfcd424, depth: LAYER.ui, align: 'right',
    });
    this.statusText = new PixelCjk(s, W - 16, 46, 'LV 1', {
      scale: 1, px: 12, color: 0xbcbcbc, depth: LAYER.ui, align: 'right',
    });

    // minimap sits under the status strip on the left margin
    this.minimap = s.add.graphics().setDepth(LAYER.ui).setScrollFactor(0);
    this.miniTimer = 0;

    // dash pips in the foot strip
    this.dashG = s.add.graphics().setDepth(LAYER.ui).setScrollFactor(0);

    // boss bar
    this.bossBar = s.add.graphics().setDepth(LAYER.ui).setScrollFactor(0).setVisible(false);
    this.bossName = new PixelCjk(s, W / 2, FIELD_Y + 16, '', {
      scale: 2, px: 12, color: 0xe45820, depth: LAYER.ui + 1, align: 'center',
    });
    this.bossName.container.setVisible(false);

    // banners
    this.bannerTitle = new PixelCjk(s, W / 2, H * 0.28, '', {
      scale: 4, px: 14, color: 0xfcfcfc, depth: LAYER.ui + 2, align: 'center',
    });
    this.bannerSub = new PixelCjk(s, W / 2, H * 0.28 + 56, '', {
      scale: 2, px: 12, color: 0xfcd424, depth: LAYER.ui + 2, align: 'center',
    });
    this.toastText = new PixelCjk(s, W / 2, 148, '', {
      scale: 2, px: 12, color: 0x58d854, depth: LAYER.ui + 2, align: 'center',
    });
    this.hintText = new PixelCjk(s, W / 2, FOOT_Y + 16, 'WASD 移动 鼠标瞄准 左键/空格开火 SHIFT 冲刺 ESC 暂停', {
      scale: 1, px: 12, color: 0x7c7c7c, depth: LAYER.ui + 1, align: 'center',
    });
  }

  // ------------------------------------------------------------------ api

  setDepth(depth: number) {
    this.stageText.setText(`第 ${depth} 层`);
    this.waveTotal = 0;
    this.waveIndex = 0;
    this.waveProgress = 0;
    this.refreshWave();
  }

  setWave(total: number, index: number, progress: number) {
    this.waveTotal = total;
    this.waveIndex = index;
    this.waveProgress = progress;
    this.refreshWave();
  }

  private refreshWave() {
    const run = this.run;
    if (run.isBossDepth()) {
      this.waveText.setText(run.bossActive ? '首领战' : '首领即将出现');
      this.statusText.setText(`LV${this.run.level}`);
      return;
    }
    const remaining = Math.max(0, Math.round(this.waveTotal * (1 - this.waveProgress)));
    this.waveText.setText(`第 ${Math.max(1, this.waveIndex)} 波 / 共 3 波`);
    this.statusText.setText(`LV${this.run.level} 敌军 ${remaining}`);
  }

  setBossHp(ratio: number) {
    const w = 300;
    const x = W / 2 - w / 2;
    const y = FIELD_Y + 34;
    const g = this.bossBar;
    g.clear();
    g.fillStyle(0x000000, 0.85);
    g.fillRect(x - 2, y - 2, w + 4, 14);
    g.fillStyle(0x3c1010, 1);
    g.fillRect(x, y, w, 10);
    g.fillStyle(0xe45820, 1);
    g.fillRect(x, y, w * Phaser.Math.Clamp(ratio, 0, 1), 10);
    g.fillStyle(0xfcd424, 0.4);
    g.fillRect(x, y, w * Phaser.Math.Clamp(ratio, 0, 1), 3);
  }

  showBoss(name?: string) {
    this.bossBar.setVisible(true);
    this.bossName.container.setVisible(true);
    if (name) this.bossName.setText(name);
    this.setBossHp(1);
  }

  hideBoss() {
    this.bossBar.setVisible(false).clear();
    this.bossName.container.setVisible(false);
  }

  banner(title: string, sub = '') {
    this.bannerTitle.setText(title).setAlpha(1);
    this.bannerTitle.container.setScale(1.5);
    this.bannerSub.setText(sub).setAlpha(1);
    const s = this.scene;
    s.tweens.add({ targets: this.bannerTitle.container, scale: 1, duration: 300, ease: 'Back.Out' });
    s.tweens.add({ targets: [this.bannerTitle.container, this.bannerSub.container], alpha: 0, delay: 1500, duration: 500 });
  }

  toast(message: string) {
    this.toastText.setText(message).setAlpha(1);
    this.scene.tweens.add({ targets: this.toastText.container, alpha: 0, duration: 1300, ease: 'Cubic.Out' });
  }

  update(dt: number) {
    const run = this.run;
    const p = this.scene.playerRef();
    const ratio = Phaser.Math.Clamp(p.hp / run.stats.maxHp, 0, 1);

    this.scoreText.setText(`分数 ${run.score}`);
    this.scrapText.setText(`废料 ${run.scrap}`);

    // hull bar sits just under the wave counter
    const bw = 180;
    const bx = W / 2 - bw / 2;
    const g = this.hpG;
    g.clear();
    g.fillStyle(0x101018, 1);
    g.fillRect(bx - 2, 54, bw + 4, 14);
    g.fillStyle(0x3c1010, 1);
    g.fillRect(bx, 56, bw, 10);
    g.fillStyle(ratio > 0.5 ? 0x58d854 : ratio > 0.25 ? 0xfcd424 : 0xe45820, 1);
    g.fillRect(bx, 56, bw * ratio, 10);
    this.hpText.setText(`${Math.ceil(p.hp)}`);

    // dash charge pips, parked in the foot strip
    const dg = this.dashG;
    dg.clear();
    const total = run.stats.dashCharges;
    for (let i = 0; i < total; i++) {
      const x = 16 + i * 20;
      const y = FOOT_Y + 8;
      const ready = p.dashReady(i);
      dg.fillStyle(0x000000, 1);
      dg.fillRect(x - 2, y - 2, 18, 12);
      dg.fillStyle(ready ? 0x58d854 : 0x3c3c3c, 1);
      dg.fillRect(x, y, 14 * (ready ? 1 : p.dashProgress(i)), 8);
    }

    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.15;
      this.drawMinimap();
    }
  }

  /**
   * Small battlefield map, parked in the left margin where the console leaves
   * its spare black.
   */
  private drawMinimap() {
    const s = this.scene;
    const g = this.minimap;
    g.clear();
    // the console leaves no margin, but an 800px-wide screen does: the radar
    // lives in the dead strip beside the field so it never covers a tank
    const size = Math.min(FIELD_X - 10, ARENA_H - 260);
    const x = Math.round((FIELD_X - size) / 2);
    const y = FIELD_Y + 10;
    const arena = s.arenaRef();
    const cell = Math.max(1, Math.floor(size / Math.max(arena.cols, arena.rows)));
    const w = cell * arena.cols;
    const h = cell * arena.rows;
    const ox = x + (size - w) / 2;
    const oy = y + (size - h) / 2;

    g.fillStyle(0x101018, 1);
    g.fillRect(x - 4, y - 4, size + 8, size + 8);
    g.lineStyle(2, 0x3c3c3c, 1);
    g.strokeRect(x - 4, y - 4, size + 8, size + 8);
    g.fillStyle(0x000000, 1);
    g.fillRect(ox, oy, w, h);
    for (let r = 0; r < arena.rows; r++) {
      for (let c = 0; c < arena.cols; c++) {
        const v = cellAt(arena, c, r);
        if (v === Cell.Steel) g.fillStyle(0x5c5c5c, 1);
        else if (v === Cell.Brick) g.fillStyle(0x782c10, 1);
        else if (v === Cell.Water) g.fillStyle(0x1038a0, 1);
        else if (v === Cell.Trees) g.fillStyle(0x0a6a0a, 1);
        else if (v === Cell.Ice) g.fillStyle(0x3a5a6a, 1);
        else if (v === Cell.Oil) g.fillStyle(0x4a2a00, 1);
        else if (v === Cell.Base) g.fillStyle(0xfcd424, 1);
        else continue;
        g.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
    for (const e of s.enemiesList()) {
      if (e.dead) continue;
      const ex = ox + (e.x / (arena.cols * BLOCK)) * w;
      const ey = oy + (e.y / (arena.rows * BLOCK)) * h;
      if (e.isBoss) {
        g.fillStyle(0xe45820, 1);
        g.fillRect(ex - 2, ey - 2, 5, 5);
      } else if (e.isElite) {
        g.fillStyle(0xfcd424, 1);
        g.fillRect(ex - 1, ey - 1, 3, 3);
      } else {
        g.fillStyle(0xfcfcfc, 1);
        g.fillRect(ex, ey, 2, 2);
      }
    }
    const p = s.playerRef();
    const px = ox + (p.x / (arena.cols * BLOCK)) * w;
    const py = oy + (p.y / (arena.rows * BLOCK)) * h;
    g.fillStyle(0x58d854, 1);
    g.fillRect(px - 1, py - 1, 3, 3);
  }

  // ------------------------------------------------------------------ pause

  setPaused(v: boolean) {
    if (v) this.showPause();
    else this.hidePause();
  }

  showPause() {
    if (this.pauseLayer) return;
    const s = this.scene;
    audioOf(s).play('uiSelect');
    const c = s.add.container(0, 0).setDepth(900).setScrollFactor(0);
    c.add(s.add.rectangle(0, 0, W, H, 0x000000, 0.86).setOrigin(0).setInteractive().setScrollFactor(0));

    const frame = fcFrame(s, W / 2, H / 2, 460, 300, { border: COLORS.amber });
    frame.setScrollFactor(0);
    c.add(frame);

    const title = new PixelCjk(s, W / 2, H / 2 - 108, '已暂停', {
      scale: 3, px: 13, color: COLORS.amber, depth: 901, align: 'center',
    });
    const sub = new PixelCjk(s, W / 2, H / 2 - 64, `第 ${this.run.depth} 层  分数 ${this.run.score}`, {
      scale: 1, px: 12, color: COLORS.bone, depth: 901, align: 'center',
    });
    const hint = new PixelCjk(s, W / 2, H / 2 + 132, '上下选择 空格确认', {
      scale: 1, px: 12, color: COLORS.steel, depth: 901, align: 'center',
    });
    c.add([title.container, sub.container, hint.container]);

    const list = new FcList(s, W / 2, H / 2 - 18, 56);
    list.add('继续游戏', () => {
      audioOf(s).play('uiSelect');
      s.events.emit('resume-game');
    }, { width: 320, height: 46, cjk: true });
    // Abandoning a run is irreversible, so the first click only arms it.
    list.add(this.abandonArmed ? '确认放弃本局？' : '放弃本局', () => {
      audioOf(s).play('uiSelect');
      if (!this.abandonArmed) {
        this.abandonArmed = true;
        this.hidePause();
        this.showPause();
        return;
      }
      this.run.finish('dead');
      s.events.emit('quit-to-menu');
    }, { width: 320, height: 46, cjk: true, accent: COLORS.rust });
    list.add(`静音：${audioOf(s).isMuted() ? '开' : '关'}`, () => {
      audioOf(s).play('uiSelect');
      audioOf(s).setMuted(!audioOf(s).isMuted());
      this.hidePause();
      this.showPause();
    }, { width: 320, height: 46, cjk: true });
    for (const b of list.buttons) c.add(b.container);

    // one shared selection for pointer and keyboard
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') list.move(-1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') list.move(1);
      else if (e.code === 'Space' || e.code === 'Enter') list.confirm();
    };
    s.input.keyboard?.on('keydown', onKey);
    this.pauseLayer = c;
    c.once('destroy', () => s.input.keyboard?.off('keydown', onKey));
  }

  hidePause() {
    if (!this.pauseLayer) return;
    this.abandonArmed = false;
    this.pauseLayer.destroy(true);
    this.pauseLayer = undefined;
  }
}
