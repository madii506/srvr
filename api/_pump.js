// nfa's pump.fun builder: the server writes the launch transactions, the launcher's wallet signs them. No key here.
//   tx 1  create_v2 (the coin, creator = the launcher) + create_fee_sharing_config (the creator vault becomes the
//         coin's own sharing config)
//   tx 2  open the agent vault (0.001 SOL, so it exists before the first payout) + update_fee_shares_v2:
//         80% of creator fees to the agent vault, 20% to the nfa treasury. This revokes the admin, so the split can
//         never change again, not even by the launcher.
//   tx 3  optional: the launcher's first buy, after the fees are routed.
// The three are signed together in one wallet prompt. Built with pump.fun's own SDK against the live Global account.
const S = require('@pump-fun/pump-sdk');
const { PUMP_SDK, OnlinePumpSdk, feeSharingConfigPda, newBondingCurve, getBuyTokenAmountFromSolAmount, bondingCurvePda, creatorVaultPda, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } = S;
const { Connection, PublicKey, ComputeBudgetProgram, SystemProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const BN = require('bn.js');

let cache = null;
async function chainState(rpcUrl, mock) {
  if (mock && mock.pumpState) return mock.pumpState();
  if (cache && Date.now() - cache.at < 60e3) return cache.v;
  const online = new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed'));
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  cache = { at: Date.now(), v: { global, feeConfig } }; return cache.v;
}
const v0 = (payer, ixs, blockhash) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
const cuIx = (units, price) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price || 150000 })];

// o: { rpcUrl, mint, user, name, symbol, uri, shares: [{address, bps}], prefund: [{to, lamports}], devBuy (lamports), blockhash, mock }
async function buildLaunch(o) {
  const { global, feeConfig } = await chainState(o.rpcUrl, o.mock);
  if (global.createV2Enabled === false) throw new Error('pump.fun has coin creation switched off right now.');
  const M = new PublicKey(o.mint), U = new PublicKey(o.user);
  const tx1 = [...cuIx(320000, o.cuPrice),
    await PUMP_SDK.createV2Instruction({ mint: M, name: o.name, symbol: o.symbol, uri: o.uri, creator: U, user: U, mayhemMode: false }),
    await PUMP_SDK.createFeeSharingConfig({ creator: U, mint: M, pool: null })];
  const tx2 = [...cuIx(250000, o.cuPrice)];
  for (const p of o.prefund || []) if (p.lamports > 0) tx2.push(SystemProgram.transfer({ fromPubkey: U, toPubkey: new PublicKey(p.to), lamports: p.lamports }));
  tx2.push(await PUMP_SDK.updateFeeSharesV2({ authority: U, mint: M, currentShareholders: [U],
    newShareholders: o.shares.map(s => ({ address: new PublicKey(s.address), shareBps: s.bps })), quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }));
  const txs = [v0(U, tx1, o.blockhash), v0(U, tx2, o.blockhash)];
  let expectOut = null;
  if (o.devBuy && Number(o.devBuy) > 0) {
    const fresh = newBondingCurve(global, NATIVE_MINT), sol = new BN(String(o.devBuy));
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply, bondingCurve: fresh, amount: sol, quoteMint: NATIVE_MINT });
    const bc = { ...fresh, creator: feeSharingConfigPda(M) };      // by the time it buys, the curve's creator is the sharing config
    const ix = await PUMP_SDK.buyV2Instructions({ global, bondingCurveAccountInfo: null, bondingCurve: bc, associatedUserAccountInfo: null, mint: M, user: U, amount, quoteAmount: sol, slippage: 3, tokenProgram: TOKEN_2022_PROGRAM_ID, quoteTokenProgram: TOKEN_PROGRAM_ID });
    txs.push(v0(U, [...cuIx(280000, o.cuPrice), ...ix], o.blockhash));
    expectOut = amount.toString();
  }
  const raw = txs.map(t => t.serialize());
  return { txs: raw.map(b => Buffer.from(b).toString('base64')), sizes: raw.map(b => b.length), expectOut, supply: global.tokenTotalSupply.toString(),
    sharingConfig: feeSharingConfigPda(M).toBase58(), bondingCurve: bondingCurvePda(M).toBase58(), creatorVault: creatorVaultPda(feeSharingConfigPda(M)).toBase58() };
}

// a first buy, priced on a fresh pump.fun curve from the live Global account: tokens out, share of supply, and where
// the curve and the market cap land afterwards. Read-only.
async function quote({ rpcUrl, mock, lamports }) {
  const { global, feeConfig } = await chainState(rpcUrl, mock);
  const fresh = newBondingCurve(global, NATIVE_MINT), n = x => Number(x.toString());
  const vS = n(global.initialVirtualSolReserves), vT = n(global.initialVirtualTokenReserves), rT = n(global.initialRealTokenReserves), sup = n(global.tokenTotalSupply);
  const out = { supply: sup, decimals: 6, startMcapSol: vS / vT * sup / 1e9, realTokens: rT, tokens: 0, pct: 0, progress: 0, afterMcapSol: vS / vT * sup / 1e9 };
  if (lamports > 0) {
    const amt = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply, bondingCurve: fresh, amount: new BN(String(lamports)), quoteMint: NATIVE_MINT });
    const t = n(amt), vT2 = vT - t, vS2 = vS * vT / vT2;
    Object.assign(out, { tokens: t, pct: t / sup, progress: Math.min(1, t / rT), afterMcapSol: vS2 / vT2 * sup / 1e9 });
  }
  return out;
}

// what the chain says about a coin: does it exist, are its fees routed and locked, and what is waiting in pump's
// creator vault. `getAccounts(addresses)` returns raw accounts ({data: Buffer, lamports} or null) in order.
const MOCK = process.env.NI_MOCK ? require(process.env.NI_MOCK) : null;
async function routing(mint, getAccounts, extra = []) {
  if (MOCK && MOCK.routing) return MOCK.routing(mint, extra);
  const M = new PublicKey(mint), cfg = feeSharingConfigPda(M), bcAddr = bondingCurvePda(M), vault = creatorVaultPda(cfg);
  const [bcInfo, cfgInfo, vInfo, ...more] = await getAccounts([bcAddr.toBase58(), cfg.toBase58(), vault.toBase58(), ...extra]);
  if (!bcInfo) return { exists: false, extra: more };
  const bc = PUMP_SDK.decodeBondingCurve(bcInfo), sc = cfgInfo ? PUMP_SDK.decodeSharingConfig(cfgInfo) : null;
  const vq = bc.virtualQuoteReserves || bc.virtualSolReserves, vt = bc.virtualTokenReserves;
  return {
    exists: true, complete: !!bc.complete, creator: bc.creator.toBase58(), routed: !!sc && bc.creator.equals(cfg), revoked: !!(sc && sc.adminRevoked),
    shareholders: sc ? sc.shareholders.map(s => ({ address: s.address.toBase58(), bps: Number(s.shareBps) })) : [],
    creatorVault: vault.toBase58(), waitingLamports: vInfo ? Number(vInfo.lamports) : 0,
    mcapSol: vt && !vt.isZero() ? Number(vq.mul(bc.tokenTotalSupply).div(vt).toString()) / 1e9 : null, extra: more,
  };
}

// one pump.fun coin's bonding curve, straight from the chain: market cap in SOL, how full the curve is, graduated or not
async function curveOf(mint, getAccounts, rpcUrl, mock) {
  const M = new PublicKey(mint);
  const [info] = await getAccounts([bondingCurvePda(M).toBase58()]);
  if (!info) return { exists: false };
  const bc = PUMP_SDK.decodeBondingCurve(info), n = x => (x == null ? 0 : Number(x.toString()));
  let initReal = 793100000000000; try { const { global } = await chainState(rpcUrl, mock); initReal = n(global.initialRealTokenReserves) || initReal; } catch {}
  const vq = bc.virtualQuoteReserves || bc.virtualSolReserves, vt = bc.virtualTokenReserves, rt = n(bc.realTokenReserves);
  return { exists: true, complete: !!bc.complete, creator: bc.creator.toBase58(), mcapSol: vt && !vt.isZero() ? Number(vq.mul(bc.tokenTotalSupply).div(vt).toString()) / 1e9 : null,
    progress: bc.complete ? 1 : Math.max(0, Math.min(1, 1 - rt / initReal)), realSol: n(bc.realQuoteReserves || bc.realSolReserves) / 1e9 };
}

// the permissionless push: anyone can pay a coin's creator vault out to its shareholders (the clicker pays the tx fee)
async function buildFeed({ mint, payer, blockhash, getAccounts }) {
  if (MOCK) { const tx = v0(new PublicKey(payer), [SystemProgram.transfer({ fromPubkey: new PublicKey(payer), toPubkey: new PublicKey(payer), lamports: 0 })], blockhash); return { tx: Buffer.from(tx.serialize()).toString('base64') }; }
  const M = new PublicKey(mint), P = new PublicKey(payer), cfg = feeSharingConfigPda(M);
  const [info] = await getAccounts([cfg.toBase58()]);
  if (!info) throw new Error('This coin has no fee-sharing config.');
  const sharingConfig = PUMP_SDK.decodeSharingConfig(info);
  const ix = await PUMP_SDK.distributeCreatorFeesV2({ mint: M, sharingConfig, sharingConfigAddress: cfg, quoteMint: NATIVE_MINT, payer: P, shouldInitializeAta: false, quoteTokenProgram: TOKEN_PROGRAM_ID });
  return { tx: Buffer.from(v0(P, [...cuIx(150000, 100000), ix], blockhash).serialize()).toString('base64') };
}

module.exports = { buildLaunch, quote, curveOf, routing, buildFeed, PUMP_PROGRAM_ID: PUMP_PROGRAM_ID.toBase58(), PUMP_FEE_PROGRAM_ID: PUMP_FEE_PROGRAM_ID.toBase58() };
