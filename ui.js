/* Japa: screens, rendering and input. All game rules live in engine.js. */
(function () {
  'use strict';

  const J = window.Japa;
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');
  const toastEl = document.getElementById('toast');
  const SAVE_KEY = 'japa.save.v1';
  const BEST_KEY = 'japa.best.v1';

  let state = null; // the running game, or null on the title/setup screens
  let screen = 'title'; // 'title' | 'reveal' | 'game'
  let setup = { name: '', bg: null, dest: null };
  let exchange = null; // { mode: 'buy' | 'sell', amount } while the BDC is open
  let lastWallet = null;
  let doneSteps = new Set();
  let toastTimer = 0;

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- storage (best effort; the game works without it) ---------- */

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode or blocked storage */ }
  }
  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  const save = () => store(SAVE_KEY, state && !state.over ? state : null);

  /* ---------- passport machine-readable zone ---------- */

  function mrz(name, seed) {
    const parts = (J.cleanName(name) || 'OKAFOR ADA').split(' ');
    const surname = parts[0];
    const given = parts.slice(1).join('<');
    const line1 = `P<NGA${surname}<<${given}`.padEnd(44, '<').slice(0, 44);
    const n = String(Math.abs(seed || 0) % 100000000).padStart(8, '0');
    const line2 = `A${n}<0NGA0110014M3110010${'<'.repeat(14)}06`.slice(0, 44);
    return `${esc(line1)}<br>${esc(line2)}`;
  }

  function nameSeed(name) {
    let h = 7;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 99999989;
    return h;
  }

  /* ---------- screens ---------- */

  function render() {
    if (screen === 'game' && state) renderGame();
    else if (screen === 'reveal') renderReveal();
    else renderTitle();
    renderModal();
  }

  function renderTitle() {
    const saved = read(SAVE_KEY);
    const canResume = saved && saved.v === 1 && !saved.over;
    app.innerHTML = `
      <section class="title-screen">
        <div>
          <p class="eyebrow">A game about leaving Lagos</p>
          <h1 class="logo">JAPA<span class="stamp stamp--hero">52 weeks<br>to leave</span></h1>
        </div>
        <p class="lede">One year to get a passport, pass the test, beat the exchange rate and convince an embassy officer. Get out before the naira does.</p>
        <div class="datapage">
          <div class="datapage__head"><span>Federal Republic of Nigeria</span><span>Passport</span></div>
          <label for="name">Surname, then given name</label>
          <input id="name" maxlength="28" autocomplete="off" spellcheck="false" placeholder="OKAFOR ADA" value="${esc(setup.name)}">
          <p class="mrz" id="mrz">${mrz(setup.name, nameSeed(setup.name))}</p>
        </div>
        <div class="btn-row">
          ${canResume ? `<button class="btn btn--primary" data-act="continue">Continue week ${saved.week}</button>` : ''}
          <button class="btn ${canResume ? '' : 'btn--primary'}" data-act="draw">Draw your life</button>
        </div>
        <p class="fineprint">Your starting life is random. No rerolls, just like real life.${canResume ? ' Drawing a new life replaces your saved game once you start.' : ''}</p>
      </section>`;
  }

  function payText(bg) {
    if (bg.pay.usd) return `${J.fmtUsd(bg.pay.usd)} per shift`;
    if (Array.isArray(bg.pay.naira)) return `${J.fmtNaira(bg.pay.naira[0])}–${J.fmtNaira(bg.pay.naira[1]).slice(1)}`;
    return `${J.fmtNaira(bg.pay.naira)} per shift`;
  }

  function testTarget(d) {
    return d.test.kind === 'band' ? `band ${d.test.target.toFixed(1)}` : `${d.test.target}/100`;
  }

  function renderReveal() {
    const bg = J.BACKGROUNDS[setup.bg];
    const cash = J.fmtNaira(bg.naira) + (bg.usd ? ` + ${J.fmtUsd(bg.usd)}` : '');
    const dests = Object.values(J.DESTINATIONS).map((d) => `
      <button class="dest" data-act="dest:${d.id}" aria-pressed="${setup.dest === d.id}">
        <span class="dest__route">${esc(d.route)}</span>
        <span class="dest__name">${esc(d.name)}</span>
        <span class="dest__pitch">${esc(d.pitch)}</span>
        <ul>
          <li>${esc(d.test.name)}: ${testTarget(d)}</li>
          <li>${esc(d.offer.name)}</li>
          <li>Proof of funds ${J.fmtUsd(d.fundsUsd)}</li>
          <li>Visa ${J.fmtUsd(d.visaFeeUsd)} · Flight ${J.fmtUsd(d.flightUsd)}</li>
        </ul>
      </button>`).join('');
    app.innerHTML = `
      <section class="setup">
        <p class="eyebrow">Your life card</p>
        <article class="lifecard">
          <span class="chip">${esc(bg.tag)}</span>
          <h2>${esc(bg.name)}</h2>
          <p>${esc(bg.blurb)}</p>
          <dl>
            <div><dt>Starting cash</dt><dd>${cash}</dd></div>
            <div><dt>Pay</dt><dd>${payText(bg)}</dd></div>
            <div><dt>Passport</dt><dd>${bg.passport ? 'Already have one' : 'None yet'}</dd></div>
            <div><dt>Sanity</dt><dd>${bg.sanity}/100</dd></div>
          </dl>
        </article>
        <h2 class="section-title">Where are you going?</h2>
        <div class="dests">${dests}</div>
        <div class="btn-row">
          <button class="btn btn--primary" data-act="start" ${setup.dest ? '' : 'disabled'}>${setup.dest ? `Start: week 1 of 52` : 'Pick a destination'}</button>
          <button class="btn" data-act="home">Back</button>
        </div>
      </section>`;
  }

  function renderGame() {
    const s = state;
    const d = J.destOf(s);
    const delta = (s.rate - s.prevRate) / s.prevRate;
    const up = delta >= 0;
    const pips = Array.from({ length: J.MOVES_PER_WEEK }, (_, i) => `<span class="pip ${i < s.moves ? 'is-on' : ''}"></span>`).join('');

    const infos = J.ACTION_ORDER.map((id) => J.actionInfo(s, id)).filter((a) => !a.hidden);
    const keyIds = new Set(['passport', 'test', 'offer', 'visa', 'fly']);
    const groups = J.GROUPS.map((g) => {
      const items = infos.filter((a) => a.group === g.id);
      if (!items.length) return '';
      return `<section class="group" aria-label="${g.name}">
        <h2>${g.name}</h2>
        <div class="acts">${items.map((a) => `
          <button class="act ${keyIds.has(a.id) ? 'act--key' : ''} ${a.reason === J.NO_MOVES ? 'is-spent' : ''}" data-act="do:${a.id}" ${a.enabled ? '' : 'disabled'}>
            <span class="act__label">${esc(a.label)}</span>
            <span class="act__hint">${esc(a.reason && a.reason !== J.NO_MOVES ? a.reason : a.hint)}</span>
          </button>`).join('')}
        </div>
      </section>`;
    }).join('');

    const rows = J.checklist(s);
    const steps = rows.map((r, i) => {
      const fresh = r.status === 'done' && !doneSteps.has(r.id);
      const mark = r.status === 'done' ? (r.id === 'visa' ? 'Approved' : 'Done') : r.status === 'pending' ? 'In progress' : '';
      return `<li class="step step--${r.status === 'done' ? 'done' : r.status === 'pending' ? 'pending' : 'todo'} ${fresh ? 'step--fresh' : ''}">
        <span class="step__n">${i + 1}</span>
        <span><span class="step__label">${esc(r.label)}</span><br><span class="step__detail">${esc(r.detail)}</span></span>
        <span class="step__mark">${mark}</span>
      </li>`;
    }).join('');
    doneSteps = new Set(rows.filter((r) => r.status === 'done').map((r) => r.id));

    const feed = s.log.slice(0, 40).map((e) => `
      <li class="${e.w < s.week ? 'is-old' : ''}"><span class="wk">WK ${e.w}</span><span class="${e.tone}">${esc(e.t)}</span></li>`).join('');

    const wallet = { naira: s.naira, usd: s.usd, sanity: s.sanity };
    const cell = (key, label, html) => {
      let cls = '';
      if (lastWallet && lastWallet[key] !== wallet[key]) cls = wallet[key] > lastWallet[key] ? 'is-up' : 'is-down';
      return `<div class="cell ${cls}"><span class="eyebrow">${label}</span>${html}</div>`;
    };
    const low = s.sanity < 25;

    app.innerHTML = `
      <header class="topbar">
        <button class="brand" data-act="menu" aria-label="Back to title screen">JAPA</button>
        <span class="week"><b>Week ${s.week}</b> of ${J.MAX_WEEKS} · ${J.fmtDate(s.week)}</span>
        <span class="moves" aria-label="${s.moves} of ${J.MOVES_PER_WEEK} moves left this week">Moves ${pips}</span>
      </header>

      <div class="rateboard">
        <div class="rate">
          <span class="rate__label">BDC RATE</span>
          <span class="rate__value">$1 = ${J.fmtRate(s.rate)}</span>
          <span class="rate__delta">${delta === 0 ? 'Opening rate' : `${up ? '▲' : '▼'} ${J.fmtPct(delta)} ${up ? 'naira weaker' : 'naira stronger'}`}</span>
        </div>
        <button class="btn btn--ink" data-act="exchange">Change money</button>
      </div>

      <div class="cols">
        <div class="col-main">
          <section class="wallet" aria-label="Your money and sanity">
            ${cell('naira', 'Naira', `<span class="num">${J.fmtNaira(s.naira)}</span><span class="sub">Bills ${J.fmtNaira(J.livingCost(s))}/wk</span>`)}
            ${cell('usd', 'Dollars', `<span class="num">${J.fmtUsd(s.usd)}</span><span class="sub">${s.locked ? `+${J.fmtUsd(s.locked)} held` : `Goal ${J.fmtUsd(J.fundsNeeded(s))}`}</span>`)}
            ${cell('sanity', 'Sanity', `<span class="num">${s.sanity}</span><span class="meter ${low ? 'is-low' : ''}"><i style="width:${s.sanity}%"></i></span>`)}
          </section>

          <p class="next"><span class="eyebrow">Next</span><span>${esc(J.nextStep(s))}</span></p>

          ${groups}

          <div class="endbar">
            <button class="btn btn--primary btn--end ${s.moves === 0 ? 'is-ready' : ''}" data-act="end-week">
              ${s.moves === 0 ? `End week ${s.week}` : `End week ${s.week} (${s.moves} move${s.moves > 1 ? 's' : ''} unused)`}
            </button>
          </div>
        </div>

        <div class="col-side">
          <section class="panel checklist">
            <h2>Japa checklist<small>${esc(d.name)} · ${esc(d.route)}</small></h2>
            <ol>${steps}</ol>
          </section>
          <section class="panel feed">
            <h2>Lagos diary</h2>
            <ul>${feed}</ul>
          </section>
          <p class="prefs"><span>Saved automatically in this browser.</span><button class="linkish" data-act="menu">Title screen</button></p>
        </div>
      </div>`;
    lastWallet = wallet;
  }

  /* ---------- modal ---------- */

  function renderModal() {
    let html = '';
    let tone = '';
    if (screen === 'game' && state) {
      if (state.over) {
        html = endingHtml();
      } else if (state.choice) {
        const c = state.choice;
        html = `<h2 id="modal-title">${esc(c.title)}</h2><p>${esc(c.body)}</p>
          <div class="options">${c.options.map((o, i) => `
            <button class="option" data-act="choice:${i}" ${o.disabled ? 'disabled' : ''}>
              <b>${esc(o.label)}</b><span>${esc(o.disabled ? 'You can’t afford this' : o.note)}</span>
            </button>`).join('')}</div>`;
      } else if (state.popups.length) {
        const p = state.popups[0];
        tone = p.tone;
        html = `<h2 id="modal-title">${esc(p.title)}</h2><p>${esc(p.body)}</p>
          <div class="btn-row"><button class="btn btn--primary" data-act="popup-ok">OK</button></div>`;
      } else if (exchange) {
        html = exchangeHtml();
      }
    }
    if (!html) {
      modal.hidden = true;
      modal.innerHTML = '';
      return;
    }
    modal.hidden = false;
    modal.innerHTML = `<div class="card ${tone ? `card--${tone}` : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</div>`;
    const first = modal.querySelector('button:not(:disabled), input');
    if (first) first.focus({ preventScroll: true });
  }

  function exchangeMax() {
    return exchange.mode === 'buy' ? state.naira : state.usd;
  }

  function exchangePreview() {
    const s = state;
    const amt = Math.min(exchange.amount, exchangeMax());
    if (exchange.mode === 'buy') {
      const usd = Math.floor(amt / J.buyRate(s));
      return { text: `${J.fmtNaira(usd * J.buyRate(s))} → ${J.fmtUsd(usd)}`, ok: usd > 0, label: usd > 0 ? `Buy ${J.fmtUsd(usd)}` : 'Buy dollars' };
    }
    const usd = Math.floor(amt);
    return { text: `${J.fmtUsd(usd)} → ${J.fmtNaira(usd * J.sellRate(s))}`, ok: usd > 0, label: usd > 0 ? `Sell ${J.fmtUsd(usd)}` : 'Sell dollars' };
  }

  function exchangeHtml() {
    const s = state;
    if (s.flags.bdcClosed) {
      return `<h2 id="modal-title">Bureau de change</h2>
        <p>The BDC is closed and your bank app is down this week. Try again next week.</p>
        <div class="btn-row"><button class="btn btn--primary" data-act="close">OK</button></div>`;
    }
    const max = exchangeMax();
    const step = exchange.mode === 'buy' ? 5000 : 10;
    const pv = exchangePreview();
    return `<h2 id="modal-title">Bureau de change</h2>
      <div class="ex-rates">
        <div><span>You buy $1 at</span><b>${J.fmtRate(J.buyRate(s))}</b></div>
        <div><span>You sell $1 at</span><b>${J.fmtRate(J.sellRate(s))}</b></div>
      </div>
      <div class="seg" role="group" aria-label="Direction">
        <button data-act="ex-mode:buy" aria-pressed="${exchange.mode === 'buy'}">Buy dollars</button>
        <button data-act="ex-mode:sell" aria-pressed="${exchange.mode === 'sell'}">Sell dollars</button>
      </div>
      <div class="ex-amount">
        <label for="ex-amount">${exchange.mode === 'buy' ? `Naira to spend (you have ${J.fmtNaira(s.naira)})` : `Dollars to sell (you have ${J.fmtUsd(s.usd)})`}</label>
        <input type="range" id="ex-amount" min="0" max="${Math.max(0, Math.floor(max))}" step="${step}" value="${Math.min(exchange.amount, max)}">
        <div class="quick">
          <button data-act="ex-pct:25">25%</button><button data-act="ex-pct:50">50%</button><button data-act="ex-pct:75">75%</button><button data-act="ex-pct:100">All</button>
        </div>
        <p class="ex-preview" id="ex-preview">${pv.text}</p>
      </div>
      <p class="fineprint">The naira usually weakens over time. Bills are paid in naira, so keep enough for this week’s ${J.fmtNaira(J.livingCost(s))}. Changing money does not use a move.</p>
      <div class="btn-row">
        <button class="btn btn--primary" id="ex-go" data-act="ex-confirm" ${pv.ok ? '' : 'disabled'}>${pv.label}</button>
        <button class="btn" data-act="close">Close</button>
      </div>`;
  }

  function endingHtml() {
    const s = state;
    const e = J.ending(s);
    const d = J.destOf(s);
    const best = read(BEST_KEY) || {};
    const bestWeek = best[s.dest];
    const bestLine = e.kind === 'win'
      ? (bestWeek && bestWeek < s.week ? `Your best to ${d.name}: week ${bestWeek}.` : `New personal best for ${d.name}.`)
      : bestWeek ? `Your best to ${d.name}: week ${bestWeek}.` : '';
    return `<div class="ending ending--${e.kind}" style="display:grid;gap:14px">
        <div class="stamp stamp--big">${esc(e.stamp)}<small>${esc(e.place)} · ${esc(e.date)}</small></div>
        <h2 id="modal-title">${esc(e.headline)}</h2>
        <p>${esc(e.body)}</p>
        <dl class="facts">
          <div><dt>Week</dt><dd>${s.week}</dd></div>
          <div><dt>Refusals</dt><dd>${s.refusals}</dd></div>
          <div><dt>Scammed</dt><dd>${s.stats.scammed}</dd></div>
        </dl>
        <p class="mrz">${mrz(s.name, nameSeed(s.name + s.bg))}</p>
        <label class="fineprint" for="share-text">Share your result</label>
        <textarea id="share-text" class="share-text" readonly rows="3">${esc(e.share)}</textarea>
        ${bestLine ? `<p class="best">${esc(bestLine)}</p>` : ''}
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn--primary" data-act="copy">Copy result</button>
          <button class="btn" data-act="again">Play again</button>
        </div>
      </div>`;
  }

  /* ---------- feedback ---------- */

  function toast(entry) {
    if (!entry) return;
    clearTimeout(toastTimer);
    toastEl.className = `toast ${entry.tone || ''}`;
    toastEl.textContent = entry.t;
    toastEl.hidden = false;
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3800);
  }

  // Run a state change, then save, re-render and toast the newest diary line.
  function act(fn) {
    const before = state.log[0];
    const changed = fn();
    if (changed === false) return;
    if (state.over) recordEnding();
    save();
    render();
    if (state.log[0] !== before && !state.choice && !state.popups.length && !state.over) toast(state.log[0]);
  }

  function recordEnding() {
    if (state.over.type !== 'japa') return;
    const best = read(BEST_KEY) || {};
    if (!best[state.dest] || state.week < best[state.dest]) {
      best[state.dest] = state.week;
      store(BEST_KEY, best);
    }
  }

  /* ---------- input ---------- */

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const [cmd, arg] = el.dataset.act.split(':');

    switch (cmd) {
      case 'draw':
        setup.bg = J.drawBackground();
        setup.dest = null;
        screen = 'reveal';
        render();
        window.scrollTo(0, 0);
        break;
      case 'dest':
        setup.dest = arg;
        render();
        break;
      case 'home':
        screen = 'title';
        render();
        break;
      case 'start':
        state = J.newGame({ name: setup.name, bg: setup.bg, dest: setup.dest });
        lastWallet = null;
        doneSteps = new Set(J.checklist(state).filter((r) => r.status === 'done').map((r) => r.id));
        screen = 'game';
        save();
        render();
        window.scrollTo(0, 0);
        break;
      case 'continue':
        state = read(SAVE_KEY);
        lastWallet = null;
        doneSteps = new Set(J.checklist(state).filter((r) => r.status === 'done').map((r) => r.id));
        screen = 'game';
        render();
        break;
      case 'menu':
        save();
        state = null;
        exchange = null;
        screen = 'title';
        render();
        break;
      case 'do':
        act(() => J.perform(state, arg));
        break;
      case 'choice':
        act(() => J.resolveChoice(state, Number(arg)));
        break;
      case 'popup-ok':
        state.popups.shift();
        save();
        renderModal();
        break;
      case 'end-week':
        act(() => {
          const ok = J.endWeek(state);
          if (ok) window.scrollTo({ top: 0, behavior: 'smooth' });
          return ok;
        });
        break;
      case 'exchange':
        exchange = { mode: 'buy', amount: 0 };
        renderModal();
        break;
      case 'ex-mode':
        exchange = { mode: arg, amount: 0 };
        renderModal();
        break;
      case 'ex-pct': {
        const max = exchangeMax();
        exchange.amount = Math.floor((max * Number(arg)) / 100);
        renderModal();
        break;
      }
      case 'ex-confirm': {
        const amt = Math.min(exchange.amount, exchangeMax());
        const mode = exchange.mode;
        act(() => (mode === 'buy' ? J.buyUsd(state, amt) : J.sellUsd(state, amt)));
        exchange = { mode, amount: 0 };
        renderModal();
        break;
      }
      case 'close':
        exchange = null;
        renderModal();
        break;
      case 'copy': {
        const ta = document.getElementById('share-text');
        const done = () => { el.textContent = 'Copied'; };
        const fallback = () => { ta.focus(); ta.select(); el.textContent = 'Selected, press copy'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
        else fallback();
        break;
      }
      case 'again':
        store(SAVE_KEY, null);
        state = null;
        setup = { name: setup.name, bg: null, dest: null };
        screen = 'title';
        render();
        break;
      default:
        break;
    }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'name') {
      setup.name = ev.target.value;
      document.getElementById('mrz').innerHTML = mrz(setup.name, nameSeed(setup.name));
    } else if (ev.target.id === 'ex-amount' && exchange) {
      exchange.amount = Number(ev.target.value);
      const pv = exchangePreview();
      document.getElementById('ex-preview').textContent = pv.text;
      const go = document.getElementById('ex-go');
      go.textContent = pv.label;
      go.disabled = !pv.ok;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && exchange && !modal.hidden) {
      exchange = null;
      renderModal();
    }
    if (ev.key === 'Enter' && ev.target.id === 'name') {
      document.querySelector('[data-act="continue"], [data-act="draw"]').click();
    }
  });

  /* ---------- boot ---------- */

  function start(data) {
    if (data && data.state) {
      state = data.state;
      screen = data.screen || 'game';
      setup = data.setup || setup;
      doneSteps = new Set(J.checklist(state).filter((r) => r.status === 'done').map((r) => r.id));
    } else if (data && data.setup) {
      setup = data.setup;
      screen = data.screen || 'title';
    }
    render();
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ state, screen, setup }));
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
