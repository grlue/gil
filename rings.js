'use strict';
// Engrave a ring: burn GIL with a memo; the page reads those burns back from the chain.
(() => {
  const RPC = 'https://solana-rpc.publicnode.com';
  const MINT = 'DN355ibWteCMRihi3bnaEGn2dXTZf6yKhr3zAC8aE9LZ';
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const TAG = 'grlue ring: ';
  const MIN_BURN = 100, MAX_LEN = 24, DECIMALS = 9n;
  const CACHE = 'gil-rings-v1';
  const $ = (id) => document.getElementById(id);

  const rpc = async (method, params) => {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return d.result;
  };
  const load = () => { try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch { return {}; } };
  const save = (c) => { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch {} };
  const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const BANNED = /https?:|www\.|t\.me|@|\.(com|net|org|io|xyz|me|gg|app|kr)\b/i;
  const clean = (t) => t.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').trim();

  // ---------- Reading ----------
  const parse = (tx) => {
    if (!tx || tx.meta?.err) return null;
    const ix = tx.transaction.message.instructions;
    const burn = ix.find((i) => i.program === 'spl-token' && /^burn/.test(i.parsed?.type) && i.parsed.info.mint === MINT);
    const memo = ix.find((i) => i.program === 'spl-memo' && typeof i.parsed === 'string' && i.parsed.startsWith(TAG));
    if (!burn || !memo) return null;
    const raw = BigInt(burn.parsed.info.tokenAmount?.amount ?? burn.parsed.info.amount);
    const text = clean(memo.parsed.slice(TAG.length)).slice(0, 32);
    if (!text) return null;
    return { text, amount: Number(raw / 10n ** DECIMALS), owner: burn.parsed.info.authority || burn.parsed.info.multisigAuthority, time: tx.blockTime };
  };

  const read = async () => {
    const cache = load();
    let hidden = [];
    try { hidden = await fetch('rings-hidden.json', { cache: 'no-store' }).then((r) => r.json()); } catch {}
    const sigs = await rpc('getSignaturesForAddress', [MINT, { limit: 1000 }]);
    for (const s of sigs) {
      if (s.err || !s.memo || !s.memo.includes(TAG) || s.signature in cache) continue;
      try {
        const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (tx) cache[s.signature] = parse(tx);
      } catch { /* try again next visit */ }
    }
    save(cache);
    return Object.entries(cache)
      .filter(([sig, e]) => e && !hidden.includes(sig))
      .map(([sig, e]) => ({ sig, ...e }))
      .sort((a, b) => b.amount - a.amount || a.time - b.time);
  };

  const render = (list, supply) => {
    const ol = $('ring-list');
    ol.textContent = '';
    $('ring-empty').hidden = list.length > 0;
    list.slice(0, 50).forEach((e) => {
      const li = document.createElement('li');
      const t = document.createElement('span'); t.className = 'r-text'; t.textContent = e.text;
      const a = document.createElement('span'); a.className = 'r-amt'; a.textContent = `${e.amount.toLocaleString('en-US')} GIL`;
      const m = document.createElement('a'); m.className = 'r-meta'; m.href = `https://solscan.io/tx/${e.sig}`; m.target = '_blank'; m.rel = 'noopener';
      m.textContent = `${short(e.owner || '')} · ${e.time ? new Date(e.time * 1000).toISOString().slice(0, 10) : ''}`;
      li.append(t, a, m);
      ol.append(li);
    });
    const burned = list.reduce((n, e) => n + e.amount, 0);
    $('ring-burned').textContent = burned.toLocaleString('en-US');
    if (supply !== null && supply < 100000000) $('supply-now').textContent = `${supply.toLocaleString('en-US')} GIL after burns`;
    window.__gilEngraved = list.slice(0, 3);
    if (window.gilRedraw) window.gilRedraw();
  };

  const refresh = async () => {
    try {
      const [list, mint] = await Promise.all([read(), rpc('getAccountInfo', [MINT, { encoding: 'jsonParsed' }]).catch(() => null)]);
      const sup = mint?.value?.data?.parsed?.info?.supply;
      render(list, sup ? Number(BigInt(sup) / 10n ** DECIMALS) : null);
    } catch (e) { $('ring-status').textContent = 'Could not read the rings from Solana right now. Try again in a minute.'; }
  };

  // ---------- Wallet ----------
  const found = [];
  const api = { register: (...ws) => { for (const w of ws) if (!found.includes(w)) found.push(w); return () => {}; } };
  window.addEventListener('wallet-standard:register-wallet', (e) => { try { e.detail(api); } catch {} });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  const usable = () => found.filter((w) => (w.chains || []).includes('solana:mainnet') && w.features['standard:connect'] && (w.features['solana:signAndSendTransaction'] || w.features['solana:signTransaction']));

  let wallet = null, account = null, busy = false;
  const status = (t, bad = false) => { const el = $('ring-status'); el.textContent = t; el.dataset.bad = bad ? '1' : ''; };

  const web3 = () => new Promise((ok, no) => {
    if (window.solanaWeb3) return ok(window.solanaWeb3);
    const s = document.createElement('script'); s.src = 'vendor/solana-web3-1.99.0.iife.min.js';
    s.onload = () => ok(window.solanaWeb3); s.onerror = () => no(new Error('Could not load the Solana library.'));
    document.head.append(s);
  });

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes) => {
    let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
    let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
    return out;
  };

  const connect = async () => {
    const ws = usable();
    if (!ws.length) throw new Error('No Solana wallet found. Open this page in your wallet app\'s browser (Phantom, Solflare or Coinbase Wallet).');
    wallet = ws[0];
    const r = await wallet.features['standard:connect'].connect();
    account = (r.accounts || wallet.accounts).find((a) => (a.chains || ['solana:mainnet']).includes('solana:mainnet')) || (r.accounts || wallet.accounts)[0];
    if (!account) throw new Error('The wallet did not share an account.');
    $('ring-go').textContent = 'Burn & engrave';
    status(`Connected ${short(account.address)} with ${wallet.name}.`);
  };

  const engrave = async () => {
    const text = clean($('ring-text').value);
    const amount = Number($('ring-amount').value);
    if (!text) throw new Error('Write the words to engrave.');
    if ([...text].length > MAX_LEN) throw new Error(`Keep it to ${MAX_LEN} characters.`);
    if (BANNED.test(text)) throw new Error('Links, handles and web addresses cannot be engraved.');
    if (!Number.isInteger(amount) || amount < MIN_BURN) throw new Error(`Burn at least ${MIN_BURN} GIL, in whole numbers.`);
    const W = await web3();
    const owner = new W.PublicKey(account.address), mint = new W.PublicKey(MINT), token = new W.PublicKey(TOKEN);
    const ata = W.PublicKey.findProgramAddressSync([owner.toBuffer(), token.toBuffer(), mint.toBuffer()], new W.PublicKey(ATA))[0];
    const raw = BigInt(amount) * 10n ** DECIMALS;
    const bal = await rpc('getAccountInfo', [ata.toBase58(), { encoding: 'jsonParsed' }]);
    const have = BigInt(bal?.value?.data?.parsed?.info?.tokenAmount?.amount ?? 0);
    if (have < raw) throw new Error(`This wallet holds ${Number(have / 10n ** DECIMALS).toLocaleString('en-US')} GIL.`);
    const data = new Uint8Array(10); data[0] = 15; new DataView(data.buffer).setBigUint64(1, raw, true); data[9] = Number(DECIMALS);
    const burn = new W.TransactionInstruction({ programId: token, keys: [
      { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data });
    const memo = new W.TransactionInstruction({ programId: new W.PublicKey(MEMO), keys: [{ pubkey: owner, isSigner: true, isWritable: false }], data: new TextEncoder().encode(TAG + text) });
    const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
    const tx = new W.Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(burn, memo);
    const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    status(`Approve burning ${amount.toLocaleString('en-US')} GIL in your wallet.`);
    let sig;
    if (wallet.features['solana:signAndSendTransaction']) {
      const [out] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({ account, transaction: bytes, chain: 'solana:mainnet' });
      sig = b58(out.signature);
    } else {
      const [out] = await wallet.features['solana:signTransaction'].signTransaction({ account, transaction: bytes, chain: 'solana:mainnet' });
      let bin = ''; for (const b of out.signedTransaction) bin += String.fromCharCode(b);
      sig = await rpc('sendTransaction', [btoa(bin), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    }
    status('Sent. Waiting for Solana to confirm…');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = (await rpc('getSignatureStatuses', [[sig]])).value[0];
      if (st?.err) throw new Error('Solana rejected the transaction. Nothing was burned.');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        status(`Engraved. ${amount.toLocaleString('en-US')} GIL burned.`);
        $('ring-text').value = '';
        return refresh();
      }
    }
    status(`Not confirmed yet. Check it on Solscan: ${sig}`, true);
  };

  $('ring-go').addEventListener('click', async () => {
    if (busy) return; busy = true; $('ring-go').disabled = true;
    try { if (!account) await connect(); else await engrave(); }
    catch (e) { status(e.message || String(e), true); }
    finally { busy = false; $('ring-go').disabled = false; }
  });
  $('ring-text').addEventListener('input', () => { $('ring-count').textContent = `${[...$('ring-text').value].length}/${MAX_LEN}`; });

  refresh();
})();
