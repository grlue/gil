'use strict';
// Vault parameters are the on-chain Jupiter Lock values (docs/22), amounts in base units (9 decimals).
(() => {
  const DAY = 86400n;
  const VAULTS = [
    { share: 45, total: 45000000000000000n, cliff: 1791065981n, cliffAmount: 1720n, perDay: 15410958904109n, days: 2920n },
    { share: 25, total: 25000000000000000n, cliff: 1791065981n, cliffAmount: 550n, perDay: 11415525114155n, days: 2190n },
    { share: 15, total: 15000000000000000n, cliff: 1791065981n, cliffAmount: 1060n, perDay: 10273972602739n, days: 1460n },
    { share: 15, total: 15000000000000000n, cliff: 1822601981n, cliffAmount: 330n, perDay: 13698630136986n, days: 1095n },
  ];

  const state = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    let released = 0n, next = null;
    const fractions = VAULTS.map((v) => {
      if (now < v.cliff) { if (next === null || v.cliff < next) next = v.cliff; return 0; }
      const days = (now - v.cliff) / DAY;
      const r = v.cliffAmount + v.perDay * (days < v.days ? days : v.days);
      released += r;
      if (days < v.days) { const t = v.cliff + (days + 1n) * DAY; if (next === null || t < next) next = t; }
      return Number((r * 1000000n) / v.total) / 1000000;
    });
    return { now, released, next, fractions };
  };

  // Ring drawing (viewBox -500..500, coin radius 210).
  const svg = document.getElementById('ring-art');
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent = svg) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  };
  const pt = (deg, r) => { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
  const arc = (a1, a2, r) => {
    const [x1, y1] = pt(a1, r), [x2, y2] = pt(a2, r);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const VAULT_R = 300;

  const draw = (s) => {
    if (!svg) return;
    svg.textContent = '';
    // Tree-ring spacing: uneven, widening outward, deterministic.
    let seed = 7, r = 226, i = 0;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Three layers turn slowly at different speeds and directions; each ring wobbles a little, like a real growth ring.
    const layers = [0, 1, 2].map((k) => el('g', { class: `spin spin-${k}` }));
    while (r < 1000) {
      if (Math.abs(r - VAULT_R) > 14) {
        const amp = 0.008 + rand() * 0.01 + (r - 226) / 50000;
        // Off-centre like a real trunk's rings, so the turning reads as a slow sway.
        const ox = (rand() - 0.5) * r * 0.05, oy = (rand() - 0.5) * r * 0.05;
        const h = [2, 3, 5].map(() => [amp * (0.4 + rand()), rand() * Math.PI * 2]);
        let d = '';
        for (let s = 0; s <= 144; s++) {
          const t = (s / 144) * Math.PI * 2;
          const rr = r * (1 + h[0][0] * Math.sin(2 * t + h[0][1]) + h[1][0] * Math.sin(3 * t + h[1][1]) + h[2][0] * Math.sin(5 * t + h[2][1]));
          d += `${s ? 'L' : 'M'}${(ox + rr * Math.sin(t)).toFixed(1)} ${(oy - rr * Math.cos(t)).toFixed(1)}`;
        }
        const c = el('path', { class: 'ring', d: d + 'Z', pathLength: 1000 }, layers[i % 3]);
        // Breaks in some rings make the turning visible.
        if (rand() < 0.85) {
          const n = 2 + Math.floor(rand() * 2), parts = [];
          let left = 1000;
          for (let q = 0; q < n; q++) { const gap = 25 + rand() * 60, dash = q === n - 1 ? left - gap : (left / (n - q)) * (0.6 + rand() * 0.6) - gap; parts.push(dash.toFixed(0), gap.toFixed(0)); left -= dash + gap; }
          c.setAttribute('stroke-dasharray', parts.join(' '));
        }
        c.style.setProperty('--i', i++);
        c.style.setProperty('--o', Math.max(0.14, 0.62 - (r - 226) / 1300).toFixed(2));
      }
      r += 9 + rand() * 13 + (r - 226) / 26;
    }
    el('circle', { class: 'vault-base', r: VAULT_R });
    let a = -81;
    VAULTS.forEach((v, k) => {
      const span = v.share * 3.6, gap = 2.5;
      const a1 = a + gap / 2, a2 = a + span - gap / 2;
      const p = el('path', { class: 'vault', d: arc(a1, a2, VAULT_R), pathLength: 1 });
      p.style.setProperty('--i', k);
      const f = s.fractions[k];
      if (f > 0) {
        const [x, y] = pt(a1 + (a2 - a1) * f, VAULT_R);
        el('circle', { class: 'vault-done', cx: x.toFixed(2), cy: y.toFixed(2), r: 5 });
      }
      a += span;
    });
    for (let k = 0; k < 3; k++) el('circle', { class: 'ripple', r: 214 }).style.setProperty('--i', k);
  };

  const fmt = (base) => Number(base / 1000000000n).toLocaleString('en-US');
  const pad = (n) => String(n).padStart(2, '0');
  const out = document.getElementById('released');
  const nextWrap = document.getElementById('next-wrap');
  const nextOut = document.getElementById('next');

  let s = state();
  draw(s);

  // Slow turning of the three ring layers (SVG attribute, so the centre is always the coin).
  const SPEEDS = [360 / 32, -360 / 46, 360 / 64];
  if (svg && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const start = performance.now();
    const spin = (t) => {
      svg.querySelectorAll('.spin').forEach((g, k) => g.setAttribute('transform', `rotate(${(((t - start) / 1000) * SPEEDS[k] % 360).toFixed(2)})`));
      requestAnimationFrame(spin);
    };
    requestAnimationFrame(spin);
  }
  const tick = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (s.next !== null && now >= s.next) { s = state(); draw(s); }
    if (out) out.textContent = fmt(s.released);
    if (nextWrap && s.next !== null) {
      const left = Number(s.next - now);
      nextOut.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`;
      nextWrap.hidden = false;
    }
  };
  tick();
  setInterval(tick, 1000);

  for (const b of document.querySelectorAll('.copy')) {
    const label = b.querySelector('span');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); label.textContent = 'Copied'; b.dataset.done = ''; }
      catch {
        const code = b.parentElement.querySelector('code');
        const range = document.createRange(); range.selectNodeContents(code);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        label.textContent = 'Selected — copy it';
      }
      setTimeout(() => { label.textContent = 'Copy'; delete b.dataset.done; }, 1800);
    });
  }
})();
