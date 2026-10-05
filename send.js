'use strict';
// One-approval GIL (+ optional SOL) transfer, for wallets that hide unknown tokens.
(() => {
  const RPC = 'https://solana-rpc.publicnode.com';
  const MINT = 'DN355ibWteCMRihi3bnaEGn2dXTZf6yKhr3zAC8aE9LZ';
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const $ = (id) => document.getElementById(id);
  const btn = $('ring-go');
  const q = new URLSearchParams(location.search);
  for (const k of ['to', 'gil', 'sol']) if (q.get(k)) $(k).value = q.get(k);

  const rpc = async (method, params) => {
    const d = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
    if (d.error) throw new Error(d.error.message);
    return d.result;
  };
  const status = (t, bad) => { $('status').textContent = t; $('status').dataset.bad = bad ? '1' : ''; };
  const found = [];
  const api = { register: (...ws) => { for (const w of ws) if (!found.includes(w)) found.push(w); return () => {}; } };
  window.addEventListener('wallet-standard:register-wallet', (e) => { try { e.detail(api); } catch {} });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  const web3 = () => new Promise((ok, no) => {
    if (window.solanaWeb3) return ok(window.solanaWeb3);
    const s = document.createElement('script'); s.src = 'vendor/solana-web3-1.99.0.iife.min.js';
    s.onload = () => ok(window.solanaWeb3); s.onerror = () => no(new Error('Could not load the Solana library.'));
    document.head.append(s);
  });
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } for (const b of bytes) { if (b) break; o = '1' + o; } return o; };

  let wallet = null, account = null, busy = false;
  const connect = async () => {
    const ws = found.filter((w) => (w.chains || []).includes('solana:mainnet') && w.features['standard:connect'] && (w.features['solana:signAndSendTransaction'] || w.features['solana:signTransaction']));
    if (!ws.length) throw new Error("No Solana wallet found. Open this page in your wallet app's browser.");
    wallet = ws[0];
    const r = await wallet.features['standard:connect'].connect();
    account = (r.accounts || wallet.accounts)[0];
    btn.textContent = 'Send';
    status(`Connected ${account.address.slice(0, 4)}…${account.address.slice(-4)}.`);
  };
  const send = async () => {
    const W = await web3();
    let to; try { to = new W.PublicKey($('to').value.trim()); } catch { throw new Error('That is not a Solana address.'); }
    const gil = Number($('gil').value), sol = Number($('sol').value);
    if (!Number.isInteger(gil) || gil < 0 || !(sol >= 0) || (gil === 0 && sol === 0)) throw new Error('Enter a whole GIL amount and/or a SOL amount.');
    const owner = new W.PublicKey(account.address), mint = new W.PublicKey(MINT), token = new W.PublicKey(TOKEN), ataProg = new W.PublicKey(ATA);
    const ataOf = (o) => W.PublicKey.findProgramAddressSync([o.toBuffer(), token.toBuffer(), mint.toBuffer()], ataProg)[0];
    const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
    const tx = new W.Transaction({ feePayer: owner, recentBlockhash: blockhash });
    if (sol > 0) tx.add(W.SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: Math.round(sol * 1e9) }));
    if (gil > 0) {
      const src = ataOf(owner), dst = ataOf(to);
      // Create the receiver's GIL account if missing (idempotent), then transferChecked.
      tx.add(new W.TransactionInstruction({ programId: ataProg, data: Uint8Array.of(1), keys: [
        { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: token, isSigner: false, isWritable: false }] }));
      const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, BigInt(gil) * 10n ** 9n, true); data[9] = 9;
      tx.add(new W.TransactionInstruction({ programId: token, data, keys: [
        { pubkey: src, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }] }));
    }
    const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    status('Approve in your wallet.');
    let sig;
    if (wallet.features['solana:signAndSendTransaction']) {
      sig = b58((await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({ account, transaction: bytes, chain: 'solana:mainnet' }))[0].signature);
    } else {
      const [o] = await wallet.features['solana:signTransaction'].signTransaction({ account, transaction: bytes, chain: 'solana:mainnet' });
      let s = ''; for (const b of o.signedTransaction) s += String.fromCharCode(b);
      sig = await rpc('sendTransaction', [btoa(s), { encoding: 'base64' }]);
    }
    status('Sent. Waiting for confirmation…');
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = (await rpc('getSignatureStatuses', [[sig]])).value[0];
      if (st?.err) throw new Error('Solana rejected the transaction. Nothing was sent.');
      if (st && ['confirmed', 'finalized'].includes(st.confirmationStatus)) return status(`Done. ${sig}`);
    }
    status(`Not confirmed yet: ${sig}`, true);
  };
  btn.addEventListener('click', async () => {
    if (busy) return; busy = true; btn.disabled = true;
    try { if (!account) await connect(); else await send(); } catch (e) { status(e.message || String(e), true); } finally { busy = false; btn.disabled = false; }
  });
})();
