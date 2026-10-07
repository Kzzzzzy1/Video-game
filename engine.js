/* Japa: game rules. Pure state and logic with no DOM, so the same file runs in the browser and in Node. */
(function (root) {
  'use strict';

  const START_RATE = 1550;
  const MAX_WEEKS = 52;
  const MOVES_PER_WEEK = 3;
  const START_DATE = Date.UTC(2026, 9, 1); // 1 October 2026
  const BUY_SPREAD = 1.025; // the BDC sells you dollars above market
  const SELL_SPREAD = 0.975; // and buys them back below it
  const LIVING_BASE = 45000;
  const STAY_TARGET_USD = 35000;
  const LUCK_CAP = 4;
  const NO_MOVES = 'No moves left. End the week.';

  /* ---------- helpers ---------- */

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const chance = (p) => Math.random() < p;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const roundTo = (x, step) => Math.round(x / step) * step;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function gauss() {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function weighted(list) {
    const total = list.reduce((t, x) => t + x.w, 0);
    let r = Math.random() * total;
    for (const x of list) {
      r -= x.w;
      if (r < 0) return x;
    }
    return list[list.length - 1];
  }

  function fmtNaira(n) {
    const sign = n < 0 ? '−' : '';
    n = Math.abs(Math.round(n));
    if (n >= 1e6) return `${sign}₦${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
    if (n >= 1e4) return `${sign}₦${Math.round(n / 1e3)}k`;
    return `${sign}₦${n.toLocaleString('en-US')}`;
  }
  const fmtUsd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const fmtPct = (p) => `${(Math.abs(p) * 100).toFixed(1)}%`;
  const fmtRate = (r) => `₦${Math.round(r).toLocaleString('en-US')}`;

  /* ---------- content ---------- */

  const BACKGROUNDS = {
    corper: {
      id: 'corper', name: 'Fresh Corper', tag: 'Broke but sharp',
      blurb: 'You just finished NYSC. Big dreams, small account. At least you read fast.',
      naira: 250000, usd: 0, sanity: 85, passport: false,
      pay: { naira: 180000 }, job: 'Graduate trainee shift', workSanity: 3, studyBonus: 0.5, crsBonus: 25,
    },
    dev: {
      id: 'dev', name: 'Remote Dev', tag: 'Paid in dollars',
      blurb: 'A startup in Delaware pays you in USD. Standups start at 4am, so sleep is a rumour.',
      naira: 300000, usd: 400, sanity: 70, passport: true,
      pay: { usd: 100 }, job: 'Ship a feature', workSanity: 5, crsBonus: 15,
    },
    nurse: {
      id: 'nurse', name: 'Staff Nurse', tag: 'In demand abroad',
      blurb: 'Night shifts at the teaching hospital. Every recruiter in London is in your DMs.',
      naira: 300000, usd: 0, sanity: 75, passport: false,
      pay: { naira: 210000 }, job: 'Night shift', workSanity: 5, offerBonus: 0.2, crsBonus: 40, approvalBonus: 0.05,
    },
    trader: {
      id: 'trader', name: 'Balogun Trader', tag: 'Up and down',
      blurb: 'Your shop sells everything from lace to phone chargers. Some weeks are sweet. Some weeks, nothing.',
      naira: 1200000, usd: 0, sanity: 80, passport: false,
      pay: { naira: [40000, 380000] }, job: 'Open the shop', workSanity: 3,
    },
    pk: {
      id: 'pk', name: "Pastor's Kid", tag: 'Prayer warrior',
      blurb: 'You already have a passport from youth camp in Accra. Heaven is on your side. Your bank account is not.',
      naira: 450000, usd: 0, sanity: 90, passport: true,
      pay: { naira: 165000 }, job: 'Church media unit', workSanity: 3, prayBonus: true,
    },
    uncle: {
      id: 'uncle', name: 'Has Uncle in Houston', tag: 'Diaspora connect',
      blurb: 'Uncle Sunday sends dollars when he remembers. He remembers sometimes.',
      naira: 200000, usd: 300, sanity: 80, passport: false,
      pay: { naira: 170000 }, job: 'Bank teller shift', workSanity: 3, giftChance: 0.16,
    },
  };

  const DESTINATIONS = {
    uk: {
      id: 'uk', name: 'United Kingdom', city: 'Manchester', route: 'Student visa', code: 'GBR', flag: '🇬🇧',
      pitch: 'A master’s degree up north. Bring a tuition deposit and a winter jacket.',
      test: { name: 'IELTS Academic', short: 'IELTS', kind: 'band', target: 6.5, feeUsd: 240 },
      offer: { mode: 'apply', name: 'University admission', verb: 'Apply to universities', noun: 'admission letter', feeNaira: 45000, chance: 0.3, wait: [1, 3] },
      fundsUsd: 9000, fundsName: 'Tuition deposit and living funds', visaFeeUsd: 1000, flightUsd: 800, approval: 0.8,
    },
    ca: {
      id: 'ca', name: 'Canada', city: 'Toronto', route: 'Express Entry', code: 'CAN', flag: '🇨🇦',
      pitch: 'Points decide everything. A higher IELTS score means a better chance in each draw.',
      test: { name: 'IELTS General', short: 'IELTS', kind: 'band', target: 6.0, feeUsd: 240 },
      offer: { mode: 'draw', name: 'Invitation to Apply', verb: 'Create Express Entry profile', noun: 'ITA' },
      fundsUsd: 8500, fundsName: 'Settlement funds', visaFeeUsd: 650, flightUsd: 1000, approval: 0.9,
    },
    de: {
      id: 'de', name: 'Germany', city: 'Berlin', route: 'Skilled worker visa', code: 'DEU', flag: '🇩🇪',
      pitch: 'The cheapest visa and the hardest language. You need a job offer and a blocked account.',
      test: { name: 'Goethe B1', short: 'Goethe B1', kind: 'score', target: 60, feeUsd: 190 },
      offer: { mode: 'apply', name: 'Job offer', verb: 'Apply for jobs', noun: 'job offer', feeNaira: 10000, chance: 0.2, wait: [1, 2] },
      fundsUsd: 9000, fundsName: 'Blocked account', visaFeeUsd: 90, flightUsd: 700, approval: 0.74,
    },
  };

  const FRIENDS = ['Tunde', 'Chiamaka', 'Your secondary school crush', 'Kunle from work', 'Your church usher', 'Amaka', 'Your barber'];
  const AIRPORTS = ['Heathrow Terminal 5', 'Toronto Pearson', 'Frankfurt Airport', 'Dublin Airport', 'Manchester Airport'];
  const UNIS = ['University of Salford', 'Coventry University', 'University of Hull', 'Teesside University', 'University of Sunderland', 'Bangor University'];
  const COURSES = ['Data Science', 'Public Health', 'Project Management', 'Cyber Security', 'International Business'];
  const COMPANIES = ['A care home in Bremen', 'Siemens Healthineers', 'A logistics firm in Hamburg', 'A Berlin fintech', 'A hospital in Leipzig'];
  const REFUSALS = [
    'The officer was not satisfied that you are a genuine visitor.',
    'The officer could not verify the source of your funds.',
    'The officer felt your ties to Nigeria were not strong enough.',
    'Your bank statement showed a sudden large deposit.',
  ];

  const HUSTLES = [
    { w: 30, text: 'You ran a POS stand at the bus stop.', naira: [120000, 240000] },
    { w: 22, text: 'You drove Bolt all night.', naira: [100000, 200000], sanity: -4 },
    { w: 18, text: 'You resold sneakers on Instagram.', naira: [200000, 400000] },
    { w: 8, text: 'Your memecoin pumped and you sold at the top.', naira: [500000, 900000] },
    { w: 12, text: 'Your memecoin rugged.', naira: [-300000, -120000] },
    { w: 10, text: 'The customer collected the goods and switched off his phone.', naira: [0, 0] },
  ];

  /* ---------- derived values ---------- */

  const bgOf = (s) => BACKGROUNDS[s.bg];
  const destOf = (s) => DESTINATIONS[s.dest];
  const buyRate = (s) => Math.round(s.rate * BUY_SPREAD);
  const sellRate = (s) => Math.round(s.rate * SELL_SPREAD);
  const inflation = (s) => Math.pow(s.rate / START_RATE, 0.6);
  const livingCost = (s) => roundTo(LIVING_BASE * s.livingMult * inflation(s), 500);
  const testFee = (s) => roundTo(destOf(s).test.feeUsd * s.rate, 1000);
  const testPassed = (s) => s.bestScore != null && s.bestScore >= destOf(s).test.target;
  const fundsNeeded = (s) => destOf(s).fundsUsd + destOf(s).visaFeeUsd;
  const netWorthUsd = (s) => s.usd + s.locked + s.naira / sellRate(s);

  function prepTarget(s) {
    const t = destOf(s).test;
    return Math.ceil(t.kind === 'band' ? (t.target - 4.5) / 0.12 : (t.target - 15) / 2.4);
  }

  function fmtScore(s, score) {
    const t = destOf(s).test;
    if (score == null) return '—';
    return t.kind === 'band' ? score.toFixed(1) : `${score}/100`;
  }

  function crs(s) {
    if (s.bestScore == null) return 0;
    return Math.round(380 + (s.bestScore - 6) * 60 + (bgOf(s).crsBonus || 0));
  }

  function weekDate(week) {
    return new Date(START_DATE + (week - 1) * 7 * 864e5);
  }

  function fmtDate(week, withYear) {
    const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    if (withYear) opts.year = 'numeric';
    return weekDate(week).toLocaleDateString('en-GB', opts);
  }

  function isDetty(s) {
    const d = weekDate(s.week);
    return (d.getUTCMonth() === 11 && d.getUTCDate() >= 12) || (d.getUTCMonth() === 0 && d.getUTCDate() <= 3);
  }

  /* ---------- state ---------- */

  function cleanName(name) {
    return String(name || '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
  }

  function drawBackground() {
    return pick(Object.keys(BACKGROUNDS));
  }

  function newGame(opts) {
    const bg = BACKGROUNDS[opts.bg];
    const s = {
      v: 1, name: cleanName(opts.name) || 'OKAFOR ADA', bg: bg.id, dest: opts.dest,
      week: 1, moves: MOVES_PER_WEEK,
      naira: bg.naira, usd: bg.usd, locked: 0, sanity: bg.sanity,
      rate: START_RATE, prevRate: START_RATE,
      livingMult: 1, payMult: 1, workCount: 0, owed: 0, luck: 0,
      prep: 0, bestScore: null, tests: 0,
      passport: bg.passport ? 'done' : 'none', passportWeek: 0,
      offer: 'none', apps: [], profile: false, cutoff: null, nextDraw: 0,
      visa: 'none', visaWeek: 0, visaChance: 0, visaCooldown: 0, refusals: 0,
      debts: [], seen: {}, flags: {},
      stats: { scammed: 0, applications: 0, hustles: 0 },
      choice: null, popups: [], log: [], over: null,
    };
    const d = DESTINATIONS[opts.dest];
    log(s, `1 October. Independence Day. You decided: by this time next year you will be in ${d.city}.`, 'info');
    return s;
  }

  function log(s, text, tone) {
    s.log.unshift({ w: s.week, t: text, tone: tone || '' });
    if (s.log.length > 80) s.log.length = 80;
  }

  function popup(s, title, body, tone) {
    s.popups.push({ title, body, tone: tone || '' });
  }

  // Bills that cannot wait: pay in naira, sell dollars if needed, borrow if broke.
  function forceSpend(s, amt) {
    if (s.naira >= amt) {
      s.naira -= amt;
      return;
    }
    let short = amt - s.naira;
    s.naira = 0;
    const rate = sellRate(s);
    const usdNeeded = Math.ceil(short / rate);
    if (s.usd >= usdNeeded) {
      s.usd -= usdNeeded;
      s.naira = usdNeeded * rate - short;
      log(s, `Your naira ran out. You sold ${fmtUsd(usdNeeded)} at the BDC to cover bills.`, 'info');
      return;
    }
    short -= s.usd * rate;
    s.usd = 0;
    s.sanity -= 7;
    log(s, `You were ${fmtNaira(short)} short and had to borrow from friends. They will remember.`, 'bad');
  }

  // What you can spend in naira if you sell all your dollars at the BDC.
  const spendable = (s) => s.naira + s.usd * sellRate(s);
  const canPay = (s, amt) => spendable(s) >= amt;

  // Voluntary payments in naira; sells just enough dollars when naira is short.
  function payNaira(s, amt) {
    if (s.naira < amt) {
      const rate = sellRate(s);
      const usd = Math.min(s.usd, Math.ceil((amt - s.naira) / rate));
      s.usd -= usd;
      s.naira += usd * rate;
      log(s, `You sold ${fmtUsd(usd)} at ${fmtRate(rate)} to cover it.`, 'info');
    }
    s.naira -= amt;
  }

  function checkOver(s) {
    s.sanity = clamp(Math.round(s.sanity), 0, 100);
    if (!s.over && s.sanity <= 0) s.over = { type: 'burnout' };
  }

  /* ---------- actions ---------- */

  const ACTIONS = {
    work: {
      group: 'earn',
      label: (s) => bgOf(s).job,
      hint(s) {
        const p = bgOf(s).pay;
        if (p.usd) return `+${fmtUsd(p.usd * s.payMult)}`;
        if (s.flags.salaryDelayed) return 'Salary delayed';
        if (Array.isArray(p.naira)) return `${fmtNaira(p.naira[0] * s.payMult)}–${fmtNaira(p.naira[1] * s.payMult).slice(1)}`;
        return `+${fmtNaira(p.naira * s.payMult)}`;
      },
      run(s) {
        const bg = bgOf(s);
        if (bg.pay.usd) {
          const usd = Math.round(bg.pay.usd * s.payMult);
          s.usd += usd;
          log(s, `${bg.job}: +${fmtUsd(usd)}, straight into your dollar account.`, 'good');
        } else {
          const base = Array.isArray(bg.pay.naira) ? rand(bg.pay.naira[0], bg.pay.naira[1]) : bg.pay.naira;
          const pay = roundTo(base * s.payMult, 1000);
          if (s.flags.salaryDelayed) {
            s.owed += pay;
            log(s, `${bg.job}. Pay of ${fmtNaira(pay)} is held back until next week.`, 'info');
          } else {
            s.naira += pay;
            log(s, `${bg.job}: +${fmtNaira(pay)}.`, pay > 0 ? 'good' : 'info');
          }
        }
        s.sanity -= bg.workSanity;
        s.workCount += 1;
        if (s.workCount % 8 === 0) {
          s.payMult *= 1.08;
          log(s, 'Promotion! Your pay goes up 8%. Inflation is not impressed.', 'good');
        }
      },
    },

    hustle: {
      group: 'earn',
      label: () => 'Side hustle',
      hint: () => 'Risky · −5 sanity',
      run(s) {
        const h = weighted(HUSTLES);
        let amt = roundTo(rand(h.naira[0], h.naira[1]), 1000);
        if (amt < 0) amt = -Math.min(-amt, s.naira);
        s.naira += amt;
        s.sanity -= 5 - (h.sanity || 0);
        s.stats.hustles += 1;
        const result = amt > 0 ? `+${fmtNaira(amt)}` : amt < 0 ? `${fmtNaira(amt)}` : 'Nothing.';
        log(s, `${h.text} ${result}`, amt > 0 ? 'good' : 'bad');
      },
    },

    study: {
      group: 'paper',
      label: (s) => `Study for ${destOf(s).test.short}`,
      hint: (s) => `Prep ${Math.floor(s.prep)} / aim ${prepTarget(s)}`,
      hidden: (s) => testPassed(s) && destOf(s).offer.mode !== 'draw',
      check: (s) => (destOf(s).offer.mode === 'draw' && s.offer === 'done' ? 'You already have your ITA' : null),
      run(s) {
        let gain = 1.5 + (bgOf(s).studyBonus || 0);
        if (s.sanity < 25) gain /= 2;
        s.prep += gain;
        s.sanity -= 4;
        log(s, s.sanity < 25
          ? `You read past questions but nothing is entering. Prep +${gain.toFixed(1)}.`
          : `You did two past papers and a speaking drill. Prep +${gain.toFixed(1)}.`, 'info');
      },
    },

    passport: {
      group: 'paper',
      opensChoice: true,
      label: () => 'Passport office',
      hint: () => 'From ₦100k',
      hidden: (s) => s.passport !== 'none',
      check: (s) => (canPay(s, 100000) ? null : 'Need ₦100k for the fee'),
      run(s) {
        s.choice = {
          id: 'passport', move: true,
          title: 'Passport office, Ikoyi',
          body: 'The queue goes round the building. An officer at the gate says he can “help you fast-track it”.',
          options: [
            { label: 'Join the queue', note: '₦100k · ready in 5 to 9 weeks' },
            { label: 'Settle the officer', note: '₦250k · 1 to 2 weeks if he delivers', disabled: !canPay(s, 250000) },
            { label: 'Not today', note: 'No move used' },
          ],
        };
      },
    },

    test: {
      group: 'paper',
      label: (s) => `Write ${destOf(s).test.short}`,
      hint: (s) => `Fee ${fmtNaira(testFee(s))}`,
      hidden: (s) => testPassed(s) && destOf(s).offer.mode !== 'draw',
      check(s) {
        if (s.passport !== 'done') return 'You need a passport to register';
        if (destOf(s).offer.mode === 'draw' && s.offer === 'done') return 'You already have your ITA';
        if (!canPay(s, testFee(s))) return `Need ${fmtNaira(testFee(s))} for the fee`;
        return null;
      },
      run(s) {
        const t = destOf(s).test;
        payNaira(s, testFee(s));
        s.tests += 1;
        const luck = s.luck;
        s.luck = 0;
        const score = t.kind === 'band'
          ? clamp(roundTo(4.5 + s.prep * 0.12 + gauss() * 0.35 + luck * 0.1, 0.5), 3, 9)
          : clamp(Math.round(15 + s.prep * 2.4 + gauss() * 6 + luck * 2), 0, 100);
        const prev = s.bestScore;
        s.bestScore = prev == null ? score : Math.max(prev, score);
        const pass = score >= t.target;
        let body = pass
          ? `You scored ${fmtScore(s, score)}. You needed ${fmtScore(s, t.target)}.`
          : `You scored ${fmtScore(s, score)}. You needed ${fmtScore(s, t.target)}. Study more and try again.`;
        if (pass && destOf(s).offer.mode === 'draw') body += ` Your CRS is now ${crs(s)}.`;
        popup(s, pass ? `${t.name}: passed` : `${t.name}: not yet`, body, pass ? 'good' : 'bad');
        log(s, `${t.name} result: ${fmtScore(s, score)}.`, pass ? 'good' : 'bad');
        if (!pass) s.sanity -= 6;
      },
    },

    offer: {
      group: 'paper',
      label: (s) => destOf(s).offer.verb,
      hint(s) {
        const o = destOf(s).offer;
        return o.mode === 'draw' ? 'Free · enter the draws' : `Fee ${fmtNaira(o.feeNaira)} each`;
      },
      hidden: (s) => s.offer === 'done' || (destOf(s).offer.mode === 'draw' && s.profile),
      check(s) {
        const d = destOf(s);
        if (!testPassed(s)) return `Pass ${d.test.name} first`;
        if (d.offer.mode === 'apply' && !canPay(s, d.offer.feeNaira)) return `Need ${fmtNaira(d.offer.feeNaira)}`;
        return null;
      },
      run(s) {
        const d = destOf(s);
        if (d.offer.mode === 'draw') {
          s.profile = true;
          s.nextDraw = s.week + 1;
          log(s, `Your Express Entry profile is in the pool. CRS ${crs(s)}. Draws happen every two weeks.`, 'info');
          return;
        }
        payNaira(s, d.offer.feeNaira);
        const p = clamp(d.offer.chance + (bgOf(s).offerBonus || 0) + s.luck * 0.04, 0.05, 0.9);
        s.luck = 0;
        s.apps.push({ week: s.week + randInt(d.offer.wait[0], d.offer.wait[1]), p });
        s.stats.applications += 1;
        log(s, d.id === 'uk'
          ? 'You submitted an application, personal statement and two reference letters.'
          : 'You sent a CV with a German-style photo and a Bewerbung letter.', 'info');
      },
    },

    visa: {
      group: 'paper',
      label: () => 'Apply for visa',
      hint: (s) => `${fmtUsd(fundsNeeded(s))} in dollars`,
      hidden: (s) => s.offer !== 'done' || s.visa !== 'none',
      check(s) {
        if (s.week < s.visaCooldown) return `You can reapply in week ${s.visaCooldown}`;
        if (s.usd < fundsNeeded(s)) return `Need ${fmtUsd(fundsNeeded(s))}, you have ${fmtUsd(s.usd)}`;
        return null;
      },
      run(s) {
        const d = destOf(s);
        s.usd -= d.visaFeeUsd + d.fundsUsd;
        s.locked = d.fundsUsd;
        s.visa = 'pending';
        s.visaWeek = s.week + randInt(2, 4);
        const cushion = clamp(s.usd / d.fundsUsd, 0, 1) * 0.06;
        s.visaChance = clamp(d.approval + (bgOf(s).approvalBonus || 0) + cushion + s.luck * 0.02 - s.refusals * 0.04, 0.3, 0.97);
        s.luck = 0;
        log(s, `Biometrics done at the visa centre. ${fmtUsd(d.fundsUsd)} is held as proof of funds until they decide.`, 'info');
      },
    },

    fly: {
      group: 'paper',
      label: (s) => `Fly to ${destOf(s).city}`,
      hint: (s) => `Ticket ${fmtUsd(destOf(s).flightUsd)}`,
      hidden: (s) => s.visa !== 'done',
      check: (s) => (s.usd < destOf(s).flightUsd ? `Need ${fmtUsd(destOf(s).flightUsd)} for the ticket` : null),
      run(s) {
        const d = destOf(s);
        s.usd -= d.flightUsd;
        log(s, `Boarding at Murtala Muhammed. Next stop: ${d.city}.`, 'good');
        s.over = { type: 'japa' };
      },
    },

    stay: {
      group: 'paper',
      move: false,
      label: () => 'Stay and build here',
      hint: () => 'Ends the game',
      hidden: (s) => netWorthUsd(s) < STAY_TARGET_USD,
      run(s) {
        log(s, 'You cancelled the embassy appointment. Lagos is yours now.', 'good');
        s.over = { type: 'stay' };
      },
    },

    rest: {
      group: 'rest',
      label: () => 'Rest at home',
      hint: () => '+16 sanity',
      check: (s) => (s.sanity >= 100 ? 'You are fully rested' : null),
      run(s) {
        s.sanity += 16;
        log(s, pick([
          'You slept for eleven hours. The generator held up.',
          'You watched Nollywood and ignored every group chat.',
          'You ate pepper soup and switched off your phone.',
        ]), 'good');
      },
    },

    pray: {
      group: 'rest',
      label: () => 'Night vigil',
      hint: (s) => (bgOf(s).prayBonus ? '+14 sanity · +2 luck' : '+8 sanity · +1 luck'),
      run(s) {
        const pk = bgOf(s).prayBonus;
        s.sanity += pk ? 14 : 8;
        s.luck = Math.min(LUCK_CAP, s.luck + (pk ? 2 : 1));
        log(s, 'You prayed through the night for open doors and a good embassy officer. Your next test, application or visa gets a lift.', 'good');
      },
    },
  };

  const ACTION_ORDER = ['work', 'hustle', 'passport', 'study', 'test', 'offer', 'visa', 'fly', 'stay', 'rest', 'pray'];
  const GROUPS = [
    { id: 'earn', name: 'Earn' },
    { id: 'paper', name: 'Paperwork' },
    { id: 'rest', name: 'Recover' },
  ];

  function actionInfo(s, id) {
    const a = ACTIONS[id];
    const hidden = a.hidden ? a.hidden(s) : false;
    let reason = a.check ? a.check(s) : null;
    if (!reason && a.move !== false && s.moves <= 0) reason = NO_MOVES;
    if (!reason && (s.over || s.choice)) reason = 'Finish what is open first';
    return { id, group: a.group, label: a.label(s), hint: a.hint ? a.hint(s) : '', hidden, reason, enabled: !hidden && !reason };
  }

  function perform(s, id) {
    if (!ACTIONS[id] || !actionInfo(s, id).enabled) return false;
    const a = ACTIONS[id];
    a.run(s);
    if (a.move !== false && !a.opensChoice) s.moves -= 1;
    checkOver(s);
    return true;
  }

  /* ---------- choices (passport and events) ---------- */

  const CHOICES = {
    passport(s, i) {
      if (i === 2) return false;
      if (i === 0) {
        payNaira(s, 100000);
        s.passport = 'pending';
        s.passportWeek = s.week + randInt(5, 9);
        log(s, `You queued from 6am. Passport should be ready around week ${s.passportWeek}.`, 'info');
        return true;
      }
      payNaira(s, 250000);
      if (chance(0.7)) {
        s.passport = 'pending';
        s.passportWeek = s.week + randInt(1, 2);
        log(s, `The officer collected the money with a smile. “Come back week ${s.passportWeek}.”`, 'info');
      } else {
        s.passport = 'pending';
        s.passportWeek = s.week + randInt(6, 10);
        s.sanity -= 8;
        log(s, `The officer was transferred to Kano. Your ₦150k went with him. Normal queue: week ${s.passportWeek}.`, 'bad');
      }
      return true;
    },
    mummy(s, i, d) {
      if (i === 0) {
        payNaira(s, d.amt);
        s.sanity += 4;
        log(s, `You sent ${fmtNaira(d.amt)}. Mummy prayed for you on the phone for fifteen minutes.`, 'good');
      } else {
        s.sanity -= 12;
        log(s, 'You said the network was bad and cut the call. The guilt is heavy.', 'bad');
      }
    },
    agent(s, i, d) {
      if (i === 0) {
        if (s.usd >= d.usd) s.usd -= d.usd;
        else payNaira(s, d.naira);
        s.stats.scammed += 1;
        s.sanity -= 10;
        log(s, 'He blocked you an hour after payment. The “testimonies” were his cousins.', 'bad');
      } else {
        s.sanity += 2;
        log(s, 'Blocked and reported. Not today, Satan.', 'good');
      }
    },
    owambe(s, i, d) {
      if (i === 0) {
        payNaira(s, d.amt);
        s.sanity += 14;
        log(s, 'You danced until 2am and sprayed money you did not have. Worth it.', 'good');
      } else {
        s.sanity -= 3;
        log(s, 'You watched the party on Instagram stories from your bed.', 'info');
      }
    },
    cousin(s, i, d) {
      if (i === 0) {
        payNaira(s, d.amt);
        if (chance(0.45)) s.debts.push({ week: s.week + randInt(3, 6), amt: d.amt });
        log(s, `You lent Chidi ${fmtNaira(d.amt)}. “Month end,” he said.`, 'info');
      } else {
        s.sanity -= 4;
        log(s, 'You said no. Chidi has told the whole family WhatsApp group.', 'bad');
      }
    },
    detty(s, i, d) {
      if (i === 0) {
        payNaira(s, d.amt);
        s.sanity += 22;
        log(s, 'Concert, beach, after-party. Your friends from London paid for nothing. You feel alive.', 'good');
      } else {
        s.sanity -= 6;
        log(s, 'You stayed home in December. Your timeline is all owambe and beach pictures.', 'bad');
      }
    },
  };

  function resolveChoice(s, i) {
    const c = s.choice;
    if (!c) return false;
    const opt = c.options[i];
    if (!opt || opt.disabled) return false;
    s.choice = null;
    const used = CHOICES[c.id](s, i, c.data);
    if (c.move && used !== false) s.moves -= 1;
    checkOver(s);
    return true;
  }

  /* ---------- weekly events ---------- */

  const EVENTS = [
    { id: 'nepa', w: 10, run(s) {
      const c = roundTo(rand(15000, 35000) * inflation(s), 500);
      forceSpend(s, c);
      s.sanity -= 5;
      log(s, `NEPA took light for four days. Diesel for the generator cost ${fmtNaira(c)}.`, 'bad');
    } },
    { id: 'fuel', w: 5, run(s) {
      s.sanity -= 6;
      log(s, 'Fuel scarcity. You spent Saturday in a queue at the filling station.', 'bad');
    } },
    { id: 'crash', w: 6, run(s) {
      const p = rand(0.06, 0.12);
      s.rate = Math.round(s.rate * (1 + p));
      log(s, `The naira crashed ${fmtPct(p)} overnight. Dollars just got more expensive.`, 'bad');
    } },
    { id: 'cbn', w: 4, run(s) {
      const p = rand(0.04, 0.08);
      s.rate = Math.round(s.rate * (1 - p));
      log(s, `CBN intervened and the naira gained ${fmtPct(p)}. Good week to buy dollars.`, 'good');
    } },
    { id: 'friend', w: 6, run(s) {
      s.sanity -= 6;
      log(s, `${pick(FRIENDS)} just posted a picture at ${pick(AIRPORTS)}. Caption: “Lagos, I’ll miss you.”`, 'bad');
    } },
    { id: 'mummy', w: 7, choice(s) {
      const amt = roundTo(rand(60000, 150000), 5000);
      return {
        title: 'Mummy is calling',
        body: `The roof in the village is leaking again. She needs ${fmtNaira(amt)}.`,
        options: [{ label: `Send ${fmtNaira(amt)}`, note: '+4 sanity', disabled: !canPay(s, amt) }, { label: '“Network is bad, ma”', note: '−12 sanity' }],
        data: { amt },
      };
    } },
    { id: 'agent', w: 5, choice(s) {
      const d = destOf(s);
      const usd = 1500;
      const naira = roundTo(usd * s.rate, 1000);
      return {
        title: 'New WhatsApp message',
        body: `“${d.name} visa 100% guaranteed in 2 weeks. No IELTS, no proof of funds. Pay $1,500 only. Many testimonies.”`,
        options: [
          { label: 'Pay him', note: `${fmtUsd(usd)} or ${fmtNaira(naira)}`, disabled: s.usd < usd && !canPay(s, naira) },
          { label: 'Block him', note: '+2 sanity' },
        ],
        data: { usd, naira },
      };
    } },
    { id: 'owambe', w: 6, choice(s) {
      const amt = 45000;
      return {
        title: 'Owambe on Saturday',
        body: 'Your cousin is getting married. The aso-ebi is ₦45k and everyone is wearing it.',
        options: [{ label: 'Buy aso-ebi and go', note: '₦45k · +14 sanity', disabled: !canPay(s, amt) }, { label: 'Skip it', note: '−3 sanity' }],
        data: { amt },
      };
    } },
    { id: 'cousin', w: 5, choice(s) {
      const amt = 80000;
      return {
        title: 'Chidi needs a loan',
        body: '“Bro, abeg, ₦80k till month end. I go pay back, I swear.”',
        options: [{ label: 'Lend him ₦80k', note: 'Maybe he pays back', disabled: !canPay(s, amt) }, { label: 'Refuse', note: '−4 sanity' }],
        data: { amt },
      };
    } },
    { id: 'phone', w: 4, run(s) {
      const c = roundTo(rand(120000, 180000), 5000);
      forceSpend(s, c);
      s.sanity -= 8;
      log(s, `Your phone was snatched in traffic at Ojuelegba. A new one cost ${fmtNaira(c)}.`, 'bad');
    } },
    { id: 'landlord', w: 3, once: true, run(s) {
      s.livingMult *= 1.2;
      log(s, 'Your landlord increased rent by 20%. “Everything has gone up.”', 'bad');
    } },
    { id: 'gig', w: 4, run(s) {
      const amt = randInt(15, 35) * 10;
      s.usd += amt;
      log(s, `A client abroad paid you ${fmtUsd(amt)} for a quick weekend gig.`, 'good');
    } },
    { id: 'salary', w: 4, when: (s) => !bgOf(s).pay.usd && s.bg !== 'trader', run(s) {
      s.flags.salaryDelayed = true;
      log(s, 'Salary delayed this week. “Management is looking into it.” You will be paid next week.', 'bad');
    } },
    { id: 'bdc', w: 3, run(s) {
      s.flags.bdcClosed = true;
      log(s, 'Your bank app is down and the BDC on your street is closed. No changing money this week.', 'bad');
    } },
    { id: 'pastor', w: 4, run(s) {
      s.sanity += 6;
      s.luck = Math.min(LUCK_CAP, s.luck + 1);
      log(s, 'Pastor declared on Sunday: “This is your season of crossing over.” +1 luck.', 'good');
    } },
    { id: 'conductor', w: 3, run(s) {
      forceSpend(s, 2000);
      log(s, 'The danfo conductor had no change. ₦2,000 gone.', 'bad');
    } },
    { id: 'flood', w: 3, run(s) {
      forceSpend(s, 25000);
      s.sanity -= 6;
      log(s, 'Heavy rain. Lekki flooded and your good shoes did not survive. −₦25k.', 'bad');
    } },
    { id: 'jollof', w: 3, run(s) {
      s.sanity += 5;
      log(s, 'Your neighbour sent party jollof. Life is good small.', 'good');
    } },
    { id: 'detty', w: 40, once: true, when: isDetty, choice(s) {
      const amt = 150000;
      return {
        title: 'Detty December',
        body: 'Your friends from London are in town and they have tickets to a concert at Eko Hotel.',
        options: [{ label: 'Go out with them', note: '₦150k · +22 sanity', disabled: !canPay(s, amt) }, { label: 'Stay home and save', note: '−6 sanity' }],
        data: { amt },
      };
    } },
  ];

  function runEvent(s) {
    const pool = EVENTS.filter((e) => (!e.once || !s.seen[e.id]) && (!e.when || e.when(s)));
    const e = weighted(pool);
    if (e.once) s.seen[e.id] = true;
    if (e.choice) s.choice = Object.assign({ id: e.id }, e.choice(s));
    else e.run(s);
  }

  function weeklyTimers(s) {
    const d = destOf(s);
    const bg = bgOf(s);

    if (s.passport === 'pending' && s.week >= s.passportWeek) {
      s.passport = 'done';
      log(s, 'Your passport is ready. Green book in hand.', 'good');
    }

    const due = s.apps.filter((a) => s.week >= a.week);
    s.apps = s.apps.filter((a) => s.week < a.week);
    for (const a of due) {
      if (s.offer === 'done') break;
      if (chance(a.p)) {
        s.offer = 'done';
        s.apps = [];
        const body = d.id === 'uk'
          ? `${pick(UNIS)} offered you a place on an MSc in ${pick(COURSES)}.`
          : `${pick(COMPANIES)} offered you a contract. They even said “Herzlich willkommen”.`;
        popup(s, `${cap(d.offer.noun)} received`, body, 'good');
        log(s, body, 'good');
      } else {
        log(s, d.id === 'uk'
          ? `${pick(UNIS)} rejected your application.`
          : `${pick(COMPANIES)} said they went with another candidate.`, 'bad');
      }
    }

    if (d.offer.mode === 'draw' && s.profile && s.offer !== 'done' && s.week >= s.nextDraw) {
      s.cutoff = randInt(440, 505);
      s.nextDraw = s.week + 2;
      const score = crs(s);
      if (score >= s.cutoff) {
        s.offer = 'done';
        popup(s, 'Invitation to Apply', `This draw’s cutoff was ${s.cutoff}. Your CRS is ${score}. You are in.`, 'good');
        log(s, `Express Entry draw: cutoff ${s.cutoff}, your CRS ${score}. ITA received!`, 'good');
      } else {
        log(s, `Express Entry draw: cutoff ${s.cutoff}, your CRS ${score}. Not this time.`, 'bad');
      }
    }

    if (s.visa === 'pending' && s.week >= s.visaWeek) {
      s.usd += s.locked;
      s.locked = 0;
      if (chance(s.visaChance)) {
        s.visa = 'done';
        popup(s, 'Visa approved', `Your passport came back with a ${d.name} visa inside. Buy your ticket.`, 'good');
        log(s, `VISA APPROVED. ${d.name}, here you come.`, 'good');
      } else {
        s.visa = 'none';
        s.refusals += 1;
        s.visaCooldown = s.week + 2;
        s.sanity -= 15;
        const why = pick(REFUSALS);
        popup(s, 'Visa refused', `${why} You lost the ${fmtUsd(d.visaFeeUsd)} fee. Your funds are back in your account. You can reapply in week ${s.visaCooldown}.`, 'bad');
        log(s, `Visa refused. ${why}`, 'bad');
      }
    }

    const repaid = s.debts.filter((x) => s.week >= x.week);
    s.debts = s.debts.filter((x) => s.week < x.week);
    for (const x of repaid) {
      s.naira += x.amt;
      log(s, `Chidi paid back ${fmtNaira(x.amt)}. Miracles happen.`, 'good');
    }

    if (bg.giftChance && chance(bg.giftChance)) {
      const amt = randInt(10, 40) * 10;
      s.usd += amt;
      log(s, `Uncle Sunday sent ${fmtUsd(amt)}. “Don’t spend it on nonsense.”`, 'good');
    }
  }

  function endWeek(s) {
    if (s.over || s.choice) return false;
    forceSpend(s, livingCost(s));
    s.sanity -= 3;
    s.prevRate = s.rate;
    s.rate = Math.round(s.rate * Math.exp(0.003 + gauss() * 0.013));
    const wasDelayed = s.flags.salaryDelayed;
    s.flags = {};
    if (s.week >= MAX_WEEKS) {
      checkOver(s);
      if (!s.over) s.over = { type: 'deadline' };
      return true;
    }
    s.week += 1;
    s.moves = MOVES_PER_WEEK;
    if (wasDelayed && s.owed > 0) {
      s.naira += s.owed;
      log(s, `Your delayed salary finally landed: ${fmtNaira(s.owed)}.`, 'good');
      s.owed = 0;
    }
    weeklyTimers(s);
    if (chance(0.6)) runEvent(s);
    checkOver(s);
    return true;
  }

  /* ---------- money ---------- */

  function buyUsd(s, nairaAmt) {
    if (s.flags.bdcClosed || s.over) return false;
    const rate = buyRate(s);
    const usd = Math.floor(Math.min(nairaAmt, s.naira) / rate);
    if (usd <= 0) return false;
    s.naira -= usd * rate;
    s.usd += usd;
    log(s, `You bought ${fmtUsd(usd)} at ${fmtRate(rate)} each.`, 'info');
    return true;
  }

  function sellUsd(s, usdAmt) {
    if (s.flags.bdcClosed || s.over) return false;
    const usd = Math.floor(Math.min(usdAmt, s.usd));
    if (usd <= 0) return false;
    const rate = sellRate(s);
    s.usd -= usd;
    s.naira += usd * rate;
    log(s, `You sold ${fmtUsd(usd)} at ${fmtRate(rate)} each.`, 'info');
    return true;
  }

  /* ---------- guidance and summaries ---------- */

  function nextStep(s) {
    const d = destOf(s);
    if (s.over) return '';
    if (s.sanity < 25) return 'Your sanity is low. Rest or go for a night vigil before you crash.';
    if (s.naira + s.usd * sellRate(s) < livingCost(s)) return `You can’t cover this week’s ${fmtNaira(livingCost(s))} bills. Work or hustle, or you’ll borrow and lose sanity.`;
    if (s.passport === 'none') return 'Start with your passport. Visit the passport office.';
    if (!testPassed(s)) {
      const wait = s.passport === 'pending' ? 'Your passport is processing. ' : '';
      return `${wait}Study until your prep is around ${prepTarget(s)}, then write ${d.test.name}. You need ${fmtScore(s, d.test.target)}.`;
    }
    if (s.offer !== 'done') {
      if (d.offer.mode === 'draw') {
        return s.profile
          ? `Wait for the next draw in week ${s.nextDraw}. Your CRS is ${crs(s)}. A higher IELTS score raises it.`
          : 'Create your Express Entry profile to enter the draws.';
      }
      return s.apps.length
        ? `${s.apps.length} application${s.apps.length > 1 ? 's' : ''} pending. More applications mean better odds.`
        : `${d.offer.verb}. Each one is a gamble, so send a few.`;
    }
    if (s.visa === 'pending') return `Visa decision due around week ${s.visaWeek}. Keep earning for the flight.`;
    if (s.visa === 'done') {
      return s.usd >= d.flightUsd ? `Book your flight to ${d.city}!` : `Save ${fmtUsd(d.flightUsd)} in dollars for your flight.`;
    }
    if (s.week < s.visaCooldown) return `Wait until week ${s.visaCooldown} to reapply.`;
    if (s.usd < fundsNeeded(s)) {
      return `Hold ${fmtUsd(fundsNeeded(s))} in dollars for proof of funds and the visa fee. Buy dollars before the naira slides.`;
    }
    return 'Everything is ready. Apply for your visa.';
  }

  function checklist(s) {
    const d = destOf(s);
    const rows = [];
    rows.push({
      id: 'passport', label: 'International passport',
      status: s.passport,
      detail: s.passport === 'done' ? 'Ready' : s.passport === 'pending' ? `Ready around week ${s.passportWeek}` : 'Not started',
    });
    rows.push({
      id: 'test', label: d.test.name,
      status: testPassed(s) ? 'done' : s.prep > 0 || s.tests > 0 ? 'pending' : 'none',
      detail: `Need ${fmtScore(s, d.test.target)} · Best ${fmtScore(s, s.bestScore)} · Prep ${Math.floor(s.prep)}/${prepTarget(s)}`,
    });
    let offerDetail;
    if (s.offer === 'done') offerDetail = 'Received';
    else if (d.offer.mode === 'draw') {
      offerDetail = s.profile
        ? `In the pool · CRS ${crs(s)} · next draw week ${s.nextDraw}${s.cutoff ? ` · last cutoff ${s.cutoff}` : ''}`
        : 'Profile not created';
    } else {
      offerDetail = s.apps.length ? `${s.apps.length} pending · ${s.stats.applications} sent` : s.stats.applications ? `${s.stats.applications} sent, none yet` : 'Not started';
    }
    rows.push({
      id: 'offer', label: d.offer.name,
      status: s.offer === 'done' ? 'done' : s.apps.length || s.profile ? 'pending' : 'none',
      detail: offerDetail,
    });
    const fundsReady = s.visa !== 'none' || s.usd >= fundsNeeded(s);
    rows.push({
      id: 'funds', label: d.fundsName,
      status: fundsReady ? 'done' : s.usd > 0 ? 'pending' : 'none',
      detail: s.visa !== 'none' ? `${fmtUsd(d.fundsUsd)} shown` : `${fmtUsd(s.usd)} of ${fmtUsd(fundsNeeded(s))} incl. visa fee`,
    });
    rows.push({
      id: 'visa', label: `Visa: ${d.route}`,
      status: s.visa,
      detail: s.visa === 'done' ? 'Approved' : s.visa === 'pending' ? `Decision around week ${s.visaWeek}`
        : s.refusals ? `Refused ${s.refusals}× · reapply from week ${Math.max(s.visaCooldown, s.week)}` : 'Not applied',
    });
    rows.push({
      id: 'flight', label: `Flight to ${d.city}`,
      status: s.over && s.over.type === 'japa' ? 'done' : 'none',
      detail: `${fmtUsd(d.flightUsd)} one way`,
    });
    return rows;
  }

  function ending(s) {
    const d = destOf(s);
    const bg = bgOf(s);
    const type = s.over && s.over.type;
    const done = checklist(s).filter((r) => r.status === 'done').length;
    const date = fmtDate(s.week, true);
    if (type === 'japa') {
      return {
        kind: 'win', stamp: 'Arrived', place: d.city, date,
        headline: 'You don japa!',
        body: `You landed in ${d.city} in week ${s.week} with ${fmtUsd(s.usd)} in your pocket. The naira was ${fmtRate(s.rate)} to the dollar when you left.`,
        share: `I japa'd to ${d.name} ${d.flag} in ${s.week} weeks as a ${bg.name}. The naira was ${fmtRate(s.rate)}/$ when I left. Can you beat me? #JapaGame`,
      };
    }
    if (type === 'stay') {
      const net = netWorthUsd(s);
      return {
        kind: 'stay', stamp: 'Stayed', place: 'Lagos', date,
        headline: 'Lagos no dey carry last',
        body: `You cancelled the embassy appointment. With ${fmtUsd(net)} to your name, you are building here.`,
        share: `I chose to stay. ${fmtUsd(net)} net worth by week ${s.week} as a ${bg.name}. Lagos no dey carry last. #JapaGame`,
      };
    }
    if (type === 'burnout') {
      return {
        kind: 'lose', stamp: 'Burnout', place: 'Lagos', date,
        headline: 'Your body said no more',
        body: `In week ${s.week} you collapsed after one shift too many. Mummy came to carry you to the village to rest. You finished ${done} of 6 steps.`,
        share: `I burnt out in week ${s.week} trying to japa to ${d.name} as a ${bg.name}. ${done}/6 steps done. #JapaGame`,
      };
    }
    return {
      kind: 'lose', stamp: 'Still here', place: 'Lagos', date,
      headline: 'Week 52. Still in Lagos.',
      body: `A whole year and you are still here. You finished ${done} of 6 steps. The naira is now ${fmtRate(s.rate)} to the dollar.`,
      share: `52 weeks later I'm still in Lagos. ${done}/6 japa steps done as a ${bg.name}. #JapaGame`,
    };
  }

  root.Japa = {
    START_RATE, MAX_WEEKS, MOVES_PER_WEEK, STAY_TARGET_USD, NO_MOVES,
    BACKGROUNDS, DESTINATIONS, ACTION_ORDER, GROUPS,
    drawBackground, newGame, cleanName,
    actionInfo, perform, resolveChoice, endWeek, buyUsd, sellUsd,
    nextStep, checklist, ending,
    bgOf, destOf, buyRate, sellRate, livingCost, testFee, testPassed, fundsNeeded, netWorthUsd, prepTarget, crs,
    fmtNaira, fmtUsd, fmtPct, fmtRate, fmtDate, fmtScore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
