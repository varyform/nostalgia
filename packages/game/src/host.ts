/**
 * Runtime side of the launcher ⇄ game protocol, used by every game page.
 *
 *   ?demo=on    attract mode: the autopilot plays, input is ignored, nothing is saved
 *   ?sound=off  start muted
 *
 * The launcher shows a game as `<iframe src="game.html?demo=on&sound=off">`, scaled down
 * into its preview box. To launch it zooms the frame to full size and posts `play`
 * (with the player's sound setting); the page then drops the demo and boots the real
 * game in place. Leaving the game from its title screen posts `exit` back.
 *
 * Messages only, never contentWindow access: opened from disk (file://) the launcher
 * and the game are different origins.
 */

export interface Run {
  stop(): void;
}

export interface GameOptions {
  sound: boolean;
  /** Return to the launcher; null when the page is not embedded in it. */
  onExit: (() => void) | null;
}

export interface HostOptions {
  /** Attract mode on the page's main canvas. */
  demo: (opts: { reducedMotion: boolean }) => Run;
  /** The real game. */
  play: (opts: GameOptions) => Run;
}

type Message = { nostalgia: 'play'; sound: boolean } | { nostalgia: 'exit' };

const on = (v: string | null) => v !== null && !['off', '0', 'false'].includes(v);

export const params = new URLSearchParams(location.search);
export const isDemo = on(params.get('demo'));
export const embedded = window.parent !== window;

/** Start the page as the URL asks, and follow the launcher's messages. */
export function host({ demo, play }: HostOptions): void {
  const sound = params.get('sound') === null || on(params.get('sound'));
  const onExit = embedded ? () => post({ nostalgia: 'exit' }) : null;
  if (!isDemo) {
    play({ sound, onExit });
    return;
  }
  // the page's own screens (title, HUD) stay hidden while the autopilot plays
  document.documentElement.toggleAttribute('data-demo', true);
  const run = demo({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
  let playing = false;
  addEventListener('message', (e: MessageEvent<Message>) => {
    if (e.source !== window.parent || e.data?.nostalgia !== 'play' || playing) return;
    playing = true;
    run.stop();
    document.documentElement.toggleAttribute('data-demo', false);
    window.focus();
    play({ sound: e.data.sound, onExit });
  });
}

function post(msg: Message) {
  window.parent.postMessage(msg, '*');
}
