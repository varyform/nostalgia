// The app's screens over the battlefield: title, setup, field manual, records, round card,
// turn banner, pause, round summary, shop and final standings. Layout comes from layout.js so
// the hit tests agree; the field and HUD come from the renderer.
import { savedAgo } from '@nostalgia/save';
import { AI_LEVELS, THEMES } from '../sim.js';
import { LAND_NAMES } from '../terrain.js';
import { GOODS, ITEM, ITEMS, WEAPON, WEAPONS, unitRefund } from '../weapons.js';
import { glow } from './field.js';
import { BACK, DETAIL, PAGE, SHOP_BTN, finalRect, goodRect, menuRect, pauseRect, setupRect } from './layout.js';
import { THEME } from './themes.js';
import { TAU, money } from './ui.js';

const WIND_NAMES = ['NONE', 'LIGHT', 'MODERATE', 'GALE'];
const LEVEL_COL = ['#ffffff', '#9fe0a0', '#ffe08a', '#ffb070', '#ff7a8a'];
const ROW_LABEL = { rounds: 'ROUNDS', wind: 'WIND', shifting: 'WIND CHANGES', walls: 'WALLS', land: 'FIELD', cash: 'STARTING CASH', interest: 'INTEREST' };
const ROW_HELP = {
  count: 'Two to eight tanks share the field.',
  player: 'A person at this keyboard, or a computer: the Rookie guesses, the Gunner learns from its misses, the Veteran reads the wind, the Ace rarely misses.',
  rounds: 'Rounds in the match. Cash and stock carry over from round to round.',
  wind: 'How hard the wind may blow. It pushes everything in the air.',
  shifting: 'Wind set once a round, or nudged before every turn.',
  walls: 'Open: shots leave the field. Wrap: they come back on the other side. Rubber: they bounce. Concrete: they burst on the wall.',
  land: 'The shape of the battlefield, or a different one every round.',
  cash: 'What every tank brings to the first shop.',
  interest: 'Paid on savings at the end of each round, at most $5,000.',
  start: 'Roll out with this setup. It is remembered for next time.',
};
const value = (k, v) => ({
  rounds: () => String(v), wind: () => WIND_NAMES[v], shifting: () => (v ? 'EVERY TURN' : 'EACH ROUND'),
  walls: () => v.toUpperCase(), land: () => (v === 'mixed' ? 'MIXED' : LAND_NAMES[v].toUpperCase()),
  cash: () => money(v), interest: () => (v ? `${v}% A ROUND` : 'NONE'),
})[k]();

export function createScreens(g, ui, { drawField, hud }) {
  const pulse = t => 0.6 + 0.4 * Math.sin(t * 4);
  const accent = app => THEME[THEMES[app.sim.theme]]?.accent ?? '#ffd27a';
  const titleItem = { continue: 'CONTINUE', play: 'NEW MATCH', manual: 'FIELD MANUAL', records: 'RECORDS', exit: 'EXIT' };

  function title(app, t) {
    drawField(app, t);
    ui.shade(0.5);
    const a = accent(app);
    glow(g, a, 960, 330, 520, 0.28);
    ui.outlined('BARRAGE', 960, 380, 210, '#fff4e0', '#140a18', 18, 'center', 26);
    ui.label('TURN-BASED ARTILLERY  ·  TWO TO EIGHT TANKS  ·  ONE HILLSIDE', 960, 450, 26, 'rgba(255,255,255,0.75)', 600, 'center', 6);
    const items = app.titleItems();
    items.forEach((it, i) => {
      const R = menuRect(i, items.length), on = i === app.menu, col = on ? '#ffffff' : 'rgba(255,255,255,0.62)';
      if (on) { ui.panel(R.x, R.y, R.w, R.h, 18, 0.7, a); glow(g, a, R.x + 30, R.y + R.h / 2, 26, 0.9); }
      if (it === 'continue') {
        // the checkpoint under its entry: the round the match stands at, and how long ago
        ui.label(titleItem[it], 960, R.y + 34, on ? 30 : 27, col, 700, 'center', 5);
        ui.label(`${app.saved.label} · ${savedAgo(app.saved.at)}`.toUpperCase(), 960, R.y + 55, 17, on ? a : 'rgba(255,255,255,0.5)', 700, 'center', 3);
      } else ui.label(titleItem[it], 960, R.y + 45, on ? 38 : 32, col, 700, 'center', 5);
    });
    const kb = app.input.device.kind === 'keyboard';
    const extra = [['start', 'SELECT']];
    if (kb) extra.push(['sound', app.soundOn ? 'SOUND ON' : 'SOUND OFF'], ['fullscreen', 'FULL SCREEN']);
    if (kb && app.hdr?.supported) extra.push(['hdr', app.hdr.label]);
    if (app.onExit) extra.push(['quit', 'EXIT']);
    ui.legend(app.input, [[['aim', 'ANGLE'], ['power', 'POWER'], ['fire', 'FIRE'], ['next', 'WEAPON'], ['items', 'GEAR']], extra], 960, 940, 48, 22);
    ui.label('READ THE WIND  ·  MIND THE SLOPE  ·  SPEND WISELY', 960, 1056, 18, 'rgba(255,255,255,0.4)', 600, 'center', 6);
  }

  function setup(app, t) {
    drawField(app, t);
    ui.shade(0.62);
    ui.panel(70, 34, 1780, 1012, 30, 0.8);
    ui.outlined('BATTLE SETUP', 110, 122, 60, '#fff4e0', '#140a18', 10, 'left', 8);
    ui.chip(BACK.x, BACK.y, BACK.w, BACK.h, false);
    ui.label('BACK', BACK.x + BACK.w / 2, BACK.y + 38, 24, '#ffffff', 700, 'center', 3);
    const S = app.setup, rows = app.setupRows(), kb = app.input.device.kind === 'keyboard';
    rows.forEach((row, i) => {
      const R = setupRect(app, i), on = i === app.setupRow, cy = R.y + R.h / 2 + 10;
      if (row === 'start') {
        ui.chip(R.x, R.y, R.w, R.h, on, '#ff8a5a', 20);
        if (on) glow(g, '#ff8a5a', R.x + R.w / 2, R.y + R.h / 2, 260, 0.25);
        ui.label('ROLL OUT', R.x + R.w / 2, R.y + 66, 46, on ? '#ffffff' : 'rgba(255,255,255,0.7)', 700, 'center', 10);
        return;
      }
      ui.chip(R.x, R.y, R.w, R.h, on, '#ffd27a');
      const arrows = (s, col, x1) => {
        ui.label(s, x1 - 40, cy, 28, col, 700, 'right', 2);
        if (on) { ui.label('◀', x1 - 40 - ui.width(s, 28, 700, 2) - 34, cy, 22, '#ffd27a', 700, 'left'); ui.label('▶', x1 - 26, cy, 22, '#ffd27a', 700, 'left'); }
      };
      if (row === 'count') {
        ui.label('TANKS', R.x + 24, cy, 28, '#ffffff', 700, 'left', 4);
        arrows(String(S.players.length), '#ffffff', R.x + R.w);
      } else if (row.startsWith('p')) {
        const k = +row.slice(1), p = S.players[k], col = app.colors[p.color];
        ui.label(String(k + 1), R.x + 28, cy, 24, 'rgba(255,255,255,0.45)', 700, 'center');
        g.fillStyle = col; g.beginPath(); g.arc(R.x + 74, R.y + R.h / 2, 17, 0, TAU); g.fill();
        if (on) glow(g, col, R.x + 74, R.y + R.h / 2, 36, 0.5);
        const caret = on && kb && Math.sin(t * 8) > 0 ? '▏' : '';
        ui.fit(p.name + caret, R.x + 108, cy, 30, '#ffffff', 330, 700, 'left', 1);
        arrows(AI_LEVELS[p.ai].toUpperCase(), LEVEL_COL[p.ai], R.x + R.w);
      } else {
        ui.label(ROW_LABEL[row], R.x + 24, cy, 26, '#ffffff', 700, 'left', 4);
        arrows(value(row, S[row]), '#ffe7b0', R.x + R.w);
      }
    });
    const row = rows[app.setupRow] ?? '';
    ui.wrap(ROW_HELP[row.startsWith('p') ? 'player' : row] ?? '', 1000, 920, 22, 'rgba(255,255,255,0.72)', 800, 30, 500, 3);
    const hint = kb ? '{rows} CHOOSE · {change} CHANGE · {start} COLOUR / OK · TYPE A NAME · {back} BACK' : '{rows} CHOOSE · {change} CHANGE · {start} COLOUR / OK · {back} BACK';
    ui.prompt(app.input, hint, 110, 1010, 20, 'rgba(255,255,255,0.75)', 'left');
  }

  function manual(app, t) {
    drawField(app, t);
    ui.shade(0.66);
    ui.panel(70, 34, 1780, 1012, 30, 0.84);
    ui.outlined(app.manualPage ? 'ARSENAL' : 'FIELD MANUAL', 110, 122, 60, '#fff4e0', '#140a18', 10, 'left', 8);
    ui.chip(BACK.x, BACK.y, BACK.w, BACK.h, false);
    ui.label('BACK', BACK.x + BACK.w / 2, BACK.y + 38, 24, '#ffffff', 700, 'center', 3);
    ui.chip(PAGE.x, PAGE.y, PAGE.w, PAGE.h, true);
    ui.label(app.manualPage ? '◀ CONTROLS' : 'ARSENAL ▶', PAGE.x + PAGE.w / 2, PAGE.y + 37, 20, '#ffd27a', 700, 'center', 1);
    if (app.manualPage) { arsenal(); return; }
    const rows = [
      ['aim', 'Swing the barrel'], ['power', 'Charge (power)'], ['coarse', 'Hold for big steps'], ['powerUp', 'Charge +50 (and {powerDown} −50)'],
      ['fire', 'Fire'], ['next', 'Next weapon (and {prev} back)'], ['items', 'Gear: shields, repairs, blink, fuel'], ['move', 'Drive, while you have fuel'],
      ['pause', 'Pause'], ['sound', 'Sound on and off'], ['fullscreen', 'Full screen'],
    ];
    rows.forEach(([a, l], i) => {
      const y = 220 + i * 62;
      ui.prompt(app.input, `{${a}}`, 420, y, 24, '#ffffff', 'right');
      ui.prompt(app.input, l, 450, y, 24, 'rgba(255,255,255,0.85)', 'left', 500);
    });
    ui.label('Mouse and touch: press on the field and drag away from your tank to aim. Further is harder.', 110, 930, 22, 'rgba(255,255,255,0.7)', 500);
    const rules = [
      ['Turns', 'Tanks fire one at a time. Set the barrel and the charge, read the wind, fire.'],
      ['Armour', 'A hurt tank cannot charge as hard: its top power falls with its armour.'],
      ['Ground', 'Earth that loses its footing falls, and tanks fall with it. A long fall hurts unless a Glider opens.'],
      ['Pay', `Every point of damage to others pays $20, a kill $2,500, and the round's last tank $4,000. Everyone draws $1,000 a round.`],
      ['Shop', 'Spend between rounds. Bundles go back for half price, one at a time.'],
      ['Score', 'Three points a round won, one a kill. Ties go to damage dealt.'],
    ];
    rules.forEach(([h, s], i) => {
      const y = 230 + i * 112;
      ui.label(h.toUpperCase(), 1040, y, 24, '#ffd27a', 700, 'left', 4);
      ui.wrap(s, 1040, y + 34, 22, 'rgba(255,255,255,0.82)', 760, 30, 500, 2);
    });
  }
  function arsenal() {
    const all = [...WEAPONS, ...ITEMS];
    all.forEach((w, i) => {
      const col = Math.floor(i / 9), row = i % 9, x = 110 + col * 590, y = 196 + row * 90;
      glow(g, w.col, x + 14, y + 4, 18, 0.7);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + 14, y + 4, 5, 0, TAU); g.fill();
      ui.label(w.name.toUpperCase(), x + 38, y + 12, 24, '#ffffff', 700, 'left', 2);
      ui.label(w.price ? `${money(w.price)} · ${w.qty}` : 'FREE · ∞', x + 540, y + 12, 18, w.col, 600, 'right', 1);
      ui.wrap(w.blurb, x + 38, y + 42, 18, 'rgba(255,255,255,0.7)', 500, 22, 500, 2);
    });
  }

  function records(app, t) {
    drawField(app, t);
    ui.shade(0.66);
    ui.panel(330, 60, 1260, 960, 30, 0.84);
    ui.outlined('RECORDS', 960, 160, 70, '#fff4e0', '#140a18', 10, 'center', 10);
    const R = app.records, names = Object.keys(R.players).sort((a, b) => R.players[b].wins - R.players[a].wins || R.players[b].kills - R.players[a].kills).slice(0, 12);
    ui.label(`${R.matches} MATCH${R.matches === 1 ? '' : 'ES'} PLAYED ON THIS COMPUTER`, 960, 214, 22, 'rgba(255,255,255,0.6)', 600, 'center', 4);
    const cols = [['NAME', 400, 'left'], ['MATCHES', 900, 'right'], ['WINS', 1060, 'right'], ['ROUNDS', 1220, 'right'], ['KILLS', 1360, 'right'], ['DAMAGE', 1520, 'right']];
    cols.forEach(([h, x, al]) => ui.label(h, x, 280, 18, 'rgba(255,255,255,0.5)', 700, al, 3));
    if (!names.length) ui.label('No matches yet. Roll out!', 960, 480, 32, 'rgba(255,255,255,0.7)', 600, 'center');
    names.forEach((n, i) => {
      const p = R.players[n], y = 336 + i * 54;
      if (i % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(380, y - 36, 1160, 50); }
      ui.label(n + (p.ai ? `  · ${AI_LEVELS[p.ai]}` : ''), 400, y, 28, i === 0 ? '#ffd27a' : '#ffffff', 700);
      [p.matches, p.wins, p.rounds, p.kills, p.dmg].forEach((v, k) => ui.label(String(v), cols[k + 1][1], y, 28, '#ffffff', 600, 'right'));
    });
    ui.prompt(app.input, '{back} BACK', 960, 990, 24, 'rgba(255,255,255,0.75)', 'center');
  }

  function intro(app, t) {
    drawField(app, t);
    hud(app, t);
    const sim = app.sim, T = THEME[THEMES[sim.theme]], k = Math.min(1, app.stT * 3);
    g.save(); g.translate(960, 560); g.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k); g.translate(-960, -560); g.globalAlpha = k;
    ui.panel(540, 360, 840, 380, 34, 0.8, T.accent);
    ui.label(`ROUND ${sim.round} OF ${sim.setup.rounds}`, 960, 430, 30, T.accent, 700, 'center', 8);
    ui.outlined(T.name.toUpperCase(), 960, 530, 84, '#ffffff', '#140a18', 12, 'center', 6);
    ui.label(LAND_NAMES[sim.land].toUpperCase(), 960, 590, 28, 'rgba(255,255,255,0.75)', 600, 'center', 6);
    const wind = sim.wind ? `WIND ${Math.abs(sim.wind)} ${sim.wind > 0 ? '▶' : '◀'}` : 'NO WIND';
    ui.label(`${wind}   ·   WALLS: ${sim.walls.toUpperCase()}`, 960, 650, 26, '#ffe7b0', 600, 'center', 4);
    if (!app.demo) ui.prompt(app.input, '{start} GO', 960, 705, 22, `rgba(255,255,255,${pulse(t)})`, 'center');
    g.restore(); g.globalAlpha = 1;
  }
  function banner(app) {
    const b = app.banner;
    if (!b) return;
    const k = Math.min(1, b.t * 5, (1.6 - b.t) * 4), y = 150 + (1 - k) * -40;
    g.globalAlpha = Math.max(0, k);
    ui.panel(760, y, 400, 76, 20, 0.78, b.col);
    ui.fit(b.text.toUpperCase(), 960, y + 40, 32, b.col, 360, 700, 'center', 4);
    ui.label(b.human ? 'YOUR TURN' : 'TAKING AIM', 960, y + 66, 18, 'rgba(255,255,255,0.75)', 600, 'center', 6);
    g.globalAlpha = 1;
  }
  function pause(app, t) {
    drawField(app, t);
    hud(app, t);
    ui.shade(0.5);
    ui.panel(660, 360, 600, 340, 34, 0.86);
    ui.outlined('PAUSED', 960, 460, 80, '#ffffff', '#140a18', 12, 'center', 10);
    ['RESUME', 'QUIT TO TITLE'].forEach((s, i) => {
      const R = pauseRect(i), on = i === app.pauseMenu;
      ui.chip(R.x, R.y, R.w, R.h, on);
      ui.label(s, 960, R.y + 45, 30, on ? '#ffffff' : 'rgba(255,255,255,0.6)', 700, 'center', 4);
    });
  }
  function table(app, x, y, rows, { earned = false } = {}) {
    const sim = app.sim;
    const cols = [['TANK', x + 70, 'left'], ['ROUNDS', x + 560, 'right'], ['KILLS', x + 690, 'right'], [earned ? 'THIS ROUND' : 'DAMAGE', x + 860, 'right'], ['CASH', x + 1020, 'right']];
    cols.forEach(([h, cx, al]) => ui.label(h, cx, y, 18, 'rgba(255,255,255,0.5)', 700, al, 3));
    rows.forEach((p, i) => {
      const ry = y + 58 + i * 58, col = app.colors[p.color], tk = sim.tanks[p.i];
      if (i % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(x + 20, ry - 38, 1020, 52); }
      g.fillStyle = col; g.beginPath(); g.arc(x + 44, ry - 10, 13, 0, TAU); g.fill();
      ui.fit(p.name + (tk && !tk.alive && !earned ? '' : ''), x + 70, ry, 30, tk?.alive || !earned ? '#ffffff' : 'rgba(255,255,255,0.5)', 340, 700);
      if (p.ai) ui.label(AI_LEVELS[p.ai].toUpperCase(), x + 420, ry, 16, LEVEL_COL[p.ai], 600, 'left', 2);
      ui.label(String(p.stats.wins), cols[1][1], ry, 30, '#ffffff', 700, 'right');
      ui.label(String(p.stats.kills), cols[2][1], ry, 30, '#ffffff', 600, 'right');
      const e = earned ? sim.roundLog?.[p.i]?.earned ?? 0 : p.stats.dmg;
      ui.label(earned ? (e >= 0 ? '+' : '−') + money(Math.abs(e)) : String(e), cols[3][1], ry, 28, earned ? '#ffe08a' : '#ffffff', 600, 'right');
      ui.label(money(p.cash), cols[4][1], ry, 28, '#ffffff', 600, 'right');
    });
  }
  function roundEnd(app, t) {
    drawField(app, t);
    ui.shade(0.42);
    const sim = app.sim, n = sim.players.length, h = 250 + n * 58;
    const y0 = 540 - h / 2;
    ui.panel(400, y0, 1120, h, 34, 0.86);
    const w = sim.winner >= 0 ? sim.players[sim.tanks[sim.winner].p] : null;
    ui.label(`ROUND ${sim.round} OF ${sim.setup.rounds}`, 960, y0 + 60, 24, accent(app), 700, 'center', 8);
    ui.outlined(w ? `${w.name.toUpperCase()} TAKES IT` : 'NOBODY IS LEFT', 960, y0 + 130, 60, w ? app.colors[w.color] : '#ffffff', '#140a18', 10, 'center', 4);
    table(app, 420, y0 + 190, app.standings ?? sim.players, { earned: true });
    if (!app.demo) ui.prompt(app.input, sim.phase === 'match' ? '{start} FINAL STANDINGS' : sim.players.some(p => !p.ai) ? '{start} TO THE SHOP' : '{start} NEXT ROUND', 960, y0 + h - 28, 22, `rgba(255,255,255,${pulse(t)})`, 'center');
  }

  function shop(app, t) {
    drawField(app, t);
    ui.shade(0.66);
    ui.panel(70, 34, 1780, 1012, 30, 0.88);
    const sim = app.sim, S = app.shop, P = sim.players[S.pi], col = app.colors[P.color];
    ui.outlined('QUARTERMASTER', 110, 112, 54, '#fff4e0', '#140a18', 10, 'left', 8);
    g.fillStyle = col; g.beginPath(); g.arc(124, 160, 13, 0, TAU); g.fill();
    ui.label(`${P.name.toUpperCase()} · BEFORE ROUND ${sim.round + (S.pre ? 0 : 1)} OF ${sim.setup.rounds}`, 148, 170, 26, col, 700, 'left', 3);
    ui.label('CASH', 1810, 76, 18, 'rgba(255,255,255,0.55)', 700, 'right', 4);
    ui.outlined(money(P.cash), 1810, 140, 56, '#ffe08a', '#140a18', 8, 'right', 2);
    const cols = [GOODS.filter(g2 => WEAPON[g2.id]), GOODS.filter(g2 => ITEM[g2.id])];
    ui.label('ORDNANCE', 110, 222, 18, 'rgba(255,255,255,0.5)', 700, 'left', 4);
    ui.label('PRICE', 800, 222, 18, 'rgba(255,255,255,0.5)', 700, 'right', 4);
    ui.label('OWNED', 940, 222, 18, 'rgba(255,255,255,0.5)', 700, 'right', 4);
    ui.label('GEAR', 1000, 222, 18, 'rgba(255,255,255,0.5)', 700, 'left', 4);
    cols.forEach((list, c) => list.forEach((gd, i) => {
      const R = goodRect(c, i), on = c === S.col && i === S.sel, afford = P.cash >= gd.price;
      if (on) ui.chip(R.x, R.y, R.w, R.h, true, gd.col, 10);
      g.fillStyle = gd.col; g.beginPath(); g.arc(R.x + 22, R.y + R.h / 2, 7, 0, TAU); g.fill();
      ui.label(gd.name, R.x + 44, R.y + 28, 24, afford ? '#ffffff' : 'rgba(255,255,255,0.4)', on ? 700 : 600);
      const px = c === 0 ? 800 : R.x + R.w - 150;
      ui.label(`${gd.qty} for ${money(gd.price)}`, px, R.y + 28, 20, afford ? '#ffe7b0' : 'rgba(255,190,170,0.5)', 600, 'right');
      ui.label(String(P.inv[gd.id] ?? 0), c === 0 ? 940 : R.x + R.w - 20, R.y + 28, 24, (P.inv[gd.id] ?? 0) ? '#ffffff' : 'rgba(255,255,255,0.3)', 700, 'right');
    }));
    // what the selection does
    const gd = cols[S.col][S.sel];
    if (gd) {
      ui.panel(DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h, 20, 0.5, gd.col);
      glow(g, gd.col, DETAIL.x + 50, DETAIL.y + 52, 40, 0.8);
      ui.label(gd.name.toUpperCase(), DETAIL.x + 90, DETAIL.y + 66, 40, '#ffffff', 700, 'left', 3);
      ui.wrap(gd.blurb, DETAIL.x + 30, DETAIL.y + 118, 24, 'rgba(255,255,255,0.85)', DETAIL.w - 60, 32, 500, 2);
      const w = WEAPON[gd.id], it = ITEM[gd.id];
      const facts = w ? (w.kind === 'dirt' ? `Earth ball ${w.r}` : w.kind === 'beam' ? `Beam · ${w.dmg} damage` : `Blast ${w.r} · up to ${w.dmg} damage${w.n ? ` · ${w.n} ${w.kind === 'fire' ? 'droplets' : 'bomblets'}` : ''}`)
        : it.kind === 'shield' ? `Soaks ${it.hp} damage` : it.kind === 'patch' ? `+${it.hp} armour` : it.kind === 'fuel' ? `${it.fuel} fuel each` : 'Used automatically or on your turn';
      ui.label(facts, DETAIL.x + 30, DETAIL.y + 206, 22, gd.col, 600, 'left', 1);
      ui.label(`Sells back for ${money(unitRefund(gd))} each`, DETAIL.x + 30, DETAIL.y + 248, 20, 'rgba(255,255,255,0.55)', 500);
    }
    if (S.flash && S.flashT > 0) {
      g.globalAlpha = Math.min(1, S.flashT * 2);
      ui.label(S.flash.msg, DETAIL.x + DETAIL.w - 24, DETAIL.y + 248, 22, S.flash.good ? '#7dff9a' : '#ff8a8a', 700, 'right', 1);
      g.globalAlpha = 1;
    }
    for (const [k, s, c] of [['buy', 'BUY', '#7dff9a'], ['sell', 'SELL ONE', '#ffb38a'], ['done', 'DONE', '#ffd27a']]) {
      const R = SHOP_BTN[k];
      ui.chip(R.x, R.y, R.w, R.h, k === 'done', c, 16);
      ui.label(s, R.x + R.w / 2, R.y + 51, 28, c, 700, 'center', 3);
    }
    ui.prompt(app.input, '{pick} CHOOSE · {start} BUY · {sell} SELL ONE · {back} DONE', 1000, 1000, 20, 'rgba(255,255,255,0.75)', 'left');
  }

  function final(app, t) {
    drawField(app, t);
    ui.shade(0.55);
    const sim = app.sim, list = app.standings ?? sim.players, w = list[0], n = list.length, h = 330 + n * 58;
    const y0 = Math.max(40, 500 - h / 2);
    ui.panel(380, y0, 1160, h, 36, 0.88, app.colors[w.color]);
    glow(g, app.colors[w.color], 960, y0 + 90, 300, 0.3);
    ui.label('FINAL STANDINGS', 960, y0 + 64, 26, accent(app), 700, 'center', 10);
    ui.outlined(`${w.name.toUpperCase()} WINS`, 960, y0 + 150, 78, app.colors[w.color], '#140a18', 12, 'center', 6);
    table(app, 400, y0 + 220, list);
    list.forEach((p, i) => ui.label(String(i + 1), 412, y0 + 278 + i * 58, 22, 'rgba(255,255,255,0.45)', 700, 'left'));
    if (!app.demo) ['PLAY AGAIN', 'TITLE'].forEach((s, i) => {
      const R = finalRect(i), on = i === app.finalMenu;
      ui.chip(R.x, R.y, R.w, R.h, on);
      ui.label(s, R.x + R.w / 2, R.y + 47, 30, on ? '#ffffff' : 'rgba(255,255,255,0.6)', 700, 'center', 4);
    });
  }

  function draw(app, t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const u = g.canvas.height / 1080;
    const ref = () => g.setTransform(u, 0, 0, u, 0, 0);
    ref();
    switch (app.state) {
      case 'title': title(app, t); break;
      case 'setup': setup(app, t); break;
      case 'manual': manual(app, t); break;
      case 'records': records(app, t); break;
      case 'intro': intro(app, t); break;
      case 'pause': pause(app, t); break;
      case 'roundEnd': roundEnd(app, t); break;
      case 'shop': shop(app, t); break;
      case 'final': final(app, t); break;
      default: drawField(app, t); ref(); hud(app, t); banner(app);
    }
  }
  return { draw };
}
