// The whole 2D layer: health and armour, ammunition and money, the round clock
// and score, a dynamic crosshair that breathes with the gun's spread, hit
// markers, a kill feed, centre banners, the buy menu, and the full-screen
// states (title, pause, match end). Plain DOM over the canvas; the simulation
// pushes values in and reads menu clicks back through callbacks.
export function createHud({ onPlay, onRestart, onBuy }) {
  const el = (id) => document.getElementById(id);
  const screen = el('screen');
  const screenTitle = el('screen-title');
  const screenKicker = el('screen-kicker');
  const screenCopy = el('screen-copy');
  const screenBtn = el('screen-btn');
  const screenKeys = el('screen-keys');
  const hpNum = el('hp-num');
  const hpFill = el('hp-fill');
  const apFill = el('ap-fill');
  const ammoMag = el('ammo-mag');
  const ammoRes = el('ammo-res');
  const gunName = el('gun-name');
  const moneyEl = el('money');
  const timerEl = el('timer');
  const scoreA = el('score-a');
  const scoreB = el('score-b');
  const roundEl = el('round-num');
  const cross = el('cross');
  const hitmark = el('hitmark');
  const feed = el('feed');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const promptEl = el('prompt');
  const prog = el('prog');
  const progFill = el('prog-fill');
  const progLabel = el('prog-label');
  const vig = el('vig');
  const blind = el('blind');
  const scopeEl = el('scope');
  const dmgDir = el('dmgdir');
  const buyEl = el('buy');
  const buyGrid = el('buy-grid');
  const buyMoney = el('buy-money');
  const noteEl = el('note');
  const chargeEl = el('chargebar');
  const chargeFill = el('charge-fill');

  let bannerLeft = 0;
  let hitLeft = 0;
  let vigLevel = 0;
  let blindLevel = 0;
  let dirLeft = 0;
  let buyItems = [];
  let screenMode = null;

  screenBtn.addEventListener('click', () => {
    if (screenMode === 'end') onRestart();
    else onPlay();
  });

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    showScreen(mode, { kicker = '', title = '', copy = '', button = '' } = {}) {
      screenMode = mode;
      screenKicker.textContent = kicker;
      screenTitle.textContent = title;
      screenCopy.textContent = copy;
      screenBtn.textContent = button;
      screenKeys.style.display = mode === 'title' ? '' : 'none';
      screen.hidden = false;
    },
    hideScreen() { screen.hidden = true; screenMode = null; },
    screenMode() { return screenMode; },

    setHealth(hp, armor) {
      hpNum.textContent = String(Math.max(0, Math.ceil(hp)));
      hpFill.style.width = `${Math.max(0, hp)}%`;
      hpFill.style.background = hp <= 30 ? '#e8452c' : '';
      apFill.style.width = `${Math.max(0, armor)}%`;
    },
    setAmmo(mag, reserve, name) {
      ammoMag.textContent = String(mag);
      ammoRes.textContent = `/ ${reserve}`;
      gunName.textContent = name;
      ammoMag.style.color = mag === 0 ? '#e8452c' : '';
    },
    setMoney(m) { moneyEl.textContent = `$${m}`; },
    setTimer(sec, hot = false) {
      timerEl.textContent = fmtTime(sec);
      timerEl.style.color = hot ? '#ff5a3c' : '';
    },
    setScore(a, b, round, of) {
      scoreA.textContent = String(a);
      scoreB.textContent = String(b);
      roundEl.textContent = `ROUND ${round} / ${of}`;
    },
    setSpread(px) { cross.style.setProperty('--sp', `${px.toFixed(0)}px`); },
    hitmarker(kill) {
      hitLeft = kill ? 0.28 : 0.16;
      hitmark.classList.toggle('kill', kill);
      hitmark.style.opacity = '1';
    },
    hurt(dirAngle) {
      vigLevel = Math.min(1, vigLevel + 0.55);
      if (dirAngle !== null && dirAngle !== undefined) {
        dmgDir.style.transform = `translate(-50%,-50%) rotate(${dirAngle}rad)`;
        dirLeft = 0.9;
        dmgDir.style.opacity = '1';
      }
    },
    flash(amount) { blindLevel = Math.max(blindLevel, amount); },
    scoped(on) { scopeEl.style.opacity = on ? '1' : '0'; cross.style.opacity = on ? '0' : '1'; },
    addFeed(text, cls = '') {
      const row = document.createElement('div');
      row.className = `feed-row ${cls}`;
      row.textContent = text;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => { row.style.opacity = '0'; }, 4200);
      setTimeout(() => { row.remove(); }, 4900);
    },
    banner(title, sub, cls = '', dur = 2.6) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.className = cls;
      banner.style.opacity = '1';
      bannerLeft = dur;
    },
    prompt(text) {
      promptEl.textContent = text || '';
      promptEl.style.opacity = text ? '1' : '0';
    },
    progress(frac, label) {
      if (frac === null || frac === undefined) { prog.style.opacity = '0'; return; }
      prog.style.opacity = '1';
      progFill.style.width = `${Math.round(frac * 100)}%`;
      progLabel.textContent = label || '';
    },
    chargeBar(frac) {
      if (frac === null || frac === undefined) { chargeEl.style.opacity = '0'; return; }
      chargeEl.style.opacity = '1';
      chargeFill.style.width = `${Math.round(frac * 100)}%`;
    },
    note(text) {
      noteEl.textContent = text || '';
      noteEl.style.opacity = text ? '1' : '0';
    },
    buyOpen(items, money) {
      buyItems = items;
      buyMoney.textContent = `$${money}`;
      buyGrid.innerHTML = '';
      for (const item of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `buy-item ${item.state}`;
        b.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">${item.state === 'owned' ? 'OWNED' : '$' + item.price}</span>`;
        b.addEventListener('click', () => onBuy(item.id));
        buyGrid.appendChild(b);
      }
      buyEl.hidden = false;
    },
    buyRefresh(items, money) { if (!buyEl.hidden) this.buyOpen(items, money); },
    buyClose() { buyEl.hidden = true; buyItems = []; },
    buyVisible() { return !buyEl.hidden; },
    buyItems() { return buyItems; },

    update(dt) {
      if (bannerLeft > 0) { bannerLeft -= dt; if (bannerLeft <= 0) banner.style.opacity = '0'; }
      if (hitLeft > 0) { hitLeft -= dt; if (hitLeft <= 0) hitmark.style.opacity = '0'; }
      if (dirLeft > 0) { dirLeft -= dt; if (dirLeft <= 0) dmgDir.style.opacity = '0'; }
      vigLevel = Math.max(0, vigLevel - dt * 1.4);
      vig.style.opacity = String(Math.min(0.85, vigLevel));
      blindLevel = Math.max(0, blindLevel - dt * 0.25);
      blind.style.opacity = String(Math.min(1, blindLevel));
    },
  };
}
