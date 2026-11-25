// Tiny Bot — top-2 24-hour momentum rotation with a trailing stop and a 10-bar max hold.
//
// Strategy, in one paragraph: every 8 bars the bot ranks all 7 symbols by
// trailing 24-bar return and holds the top 2, long only, each capped at the
// harness's max weight (25% of equity). Symbols that fall out of the top 2
// are sold in full; the buys for the new top 2 go out on the next batch,
// because a sell's proceeds never fund a buy of the same reply. Two risk
// controls run on every batch: a 10% trailing stop sells any position whose
// close has fallen 10% below its peak since entry, and a 10-bar max hold
// sells any position held ten bars, so no name is ever carried on
// autopilot — it has to re-earn its place at the next rebalance, at most
// eight bars later. The rest of the time the bot sits in the two strongest
// names and lets the rotation do the work.
//
// Why this shape, from the dev window (136 hourly bars, 2026-10-28..11-02):
// the window fell almost throughout — buy-and-hold lost about $869 on
// $10,000 — and the plain cross-sectional momentum rotation was the family
// that lost least. A 24-bar lookback with an 8-bar rebalance, 2 names and
// a 10-bar max hold was the best of that family on rolling 72-bar windows
// (the final window is 72 bars): it beat buy-and-hold on 11 of 17 of them,
// kept max drawdown near 3%, and never traded fewer than 13 times in any
// 72-bar window — comfortably above the 8-trade guardrail. Shorter
// lookbacks (12, 18) and longer ones (30, 48) both scored worse; holding
// more names (top 5, top 6) scored worse on the rolling windows even though
// it looked better on the full window alone, and a positive-return entry
// filter (sit in cash while the top names' 24-hour returns are negative)
// scored worse too: in this universe the least-falling names rebound more
// often than cash wins. The parameters sit in a flat region, not a sharp
// optimum: max holds of 8, 10 and 12 bars, and rebalances every 4, 6, 8
// or 24 bars, all beat buy-and-hold on 11 of 17 windows, so the final
// window's new data should not punish the choice. Stops and take-profits
// at 4-10% never fired on the dev window — hourly moves are near 1% — so
// the trailing stop is crash insurance for the drawdown guardrail, not a
// profit engine, and it costs nothing while it sleeps.
//
// Determinism (the entry runs twice and the two action logs must match
// byte for byte): no clock, no environment, no Math.random anywhere.
// Every decision comes from the bars the harness sent and the account
// state it reports; ties in the ranking keep universe order because
// Array.prototype.sort is stable. Diagnostics go to stderr only; stdout
// carries replies, owned by the shim.
//
// The wire is spoken by the kit's shim, vendor/makefun-bars.ts, a
// byte-identical copy of the kit's sdk/makefun-bars.ts: runBars owns the
// hello / batch / done line protocol, and this file only decides orders
// in onBatch. A "batch" here is one bar's close for every symbol; an
// "order" is a buy or sell the harness fills at the next bar's open.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

/** Bars of history a symbol's trailing return is measured over. */
const LOOKBACK_BARS = 24;
/** How many of the strongest symbols the bot holds at once. */
const TOP_N = 2;
/** Bars between rebalances (the first rebalance is the first bar with a full lookback). */
const REBALANCE_BARS = 8;
/** A position is sold in full when its close falls this far below its peak since entry (bps). */
const TRAIL_STOP_BPS = 1000;
/** A position is sold in full once it has been held this many bars; it must re-earn its place. */
const MAX_HOLD_BARS = 10;
/** Slippage left wide open, like the house baselines: the bot measures the rotation, not the fill. */
const MAX_SLIPPAGE_BPS = 10_000;

/** Each universe symbol's latest close as of every batch so far (null before its first bar), by seq. */
const history = new Map<string, (bigint | null)[]>();
/** Each held symbol's highest close since it was entered, by symbol; cleared when the position exits. */
const peaks = new Map<string, bigint>();
/** The first batch each held symbol was seen in a position, by symbol; cleared when it exits. */
const heldSince = new Map<string, number>();
/** The next rebalance bar; set from hello: max(LOOKBACK_BARS, the warm-up's batches). */
let nextRebalance = LOOKBACK_BARS;
/** The symbols to buy on this batch, chosen on the rebalance bar before it (whose sells have now filled). */
let entering: string[] | null = null;

/** How many symbols the bot holds at most: TOP_N unless a cap is tighter. */
const slots = (state: BarsState) => Math.min(TOP_N, state.hello.caps.max_open_positions, state.hello.caps.max_orders_per_bar);

/** The top n symbols by trailing return as of batch `seq`, best first. */
function target(state: BarsState, seq: number): string[] {
  const ranked: { symbol: string; now: bigint; then: bigint }[] = [];
  for (const { symbol } of state.hello.symbols) {
    const closes = history.get(symbol)!;
    const now = closes[seq];
    const then = closes[seq - LOOKBACK_BARS];
    if (now !== null && now !== undefined && then !== null && then !== undefined) ranked.push({ symbol, now, then });
  }
  // now_a / then_a > now_b / then_b, exactly; Array.prototype.sort is stable, so ties keep universe order.
  ranked.sort((a, b) => {
    const l = a.now * b.then;
    const r = b.now * a.then;
    return l > r ? -1 : l < r ? 1 : 0;
  });
  return ranked.slice(0, slots(state)).map((x) => x.symbol);
}

/** Full-quantity sell orders for every symbol in `symbols` that is currently held. */
function sells(state: BarsState, symbols: readonly string[]): OrderInput[] {
  return symbols
    .filter((symbol) => state.positions.has(symbol))
    .map((symbol) => ({ side: 'sell', symbol, qty: state.positions.get(symbol)!.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }));
}

/** Buy orders for the target symbols not already held, splitting the cash evenly, capped by max weight. */
function buys(state: BarsState, symbols: readonly string[]): BuyInput[] {
  const { caps, fees } = state.hello;
  const room = slots(state) - state.positions.size;
  const coming = symbols.filter((s) => !state.positions.has(s) && state.close(s) !== null).slice(0, room > 0 ? room : 0);
  if (coming.length === 0) return [];
  const even = state.cash / BigInt(coming.length);
  const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
  const slice = even < byWeight ? even : byWeight;
  if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
  return coming.map((symbol) => ({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS }));
}

await runBars({
  onHello(state) {
    nextRebalance = Math.max(LOOKBACK_BARS, state.warmupBars);
  },
  onBatch(state, batch) {
    for (const { symbol } of state.hello.symbols) {
      const closes = history.get(symbol) ?? [];
      closes.push(state.close(symbol));
      history.set(symbol, closes);
    }
    // Track each held symbol's peak close since entry, and the batch it was first seen held.
    for (const [symbol, p] of state.positions) {
      const close = state.close(symbol);
      if (close !== null) {
        const prev = peaks.get(symbol);
        if (prev === undefined || close > prev) peaks.set(symbol, close);
      }
      if (!heldSince.has(symbol)) heldSince.set(symbol, batch.seq);
      if (p.qty === 0n) {
        peaks.delete(symbol);
        heldSince.delete(symbol);
      }
    }
    for (const symbol of [...peaks.keys()]) if (!state.positions.has(symbol)) peaks.delete(symbol);
    for (const symbol of [...heldSince.keys()]) if (!state.positions.has(symbol)) heldSince.delete(symbol);

    // Risk exits, checked on every batch: the trailing stop and the one-day max hold.
    const stopped: string[] = [];
    for (const [symbol, peak] of peaks) {
      const close = state.close(symbol);
      if (close !== null && close * BPS < peak * (BPS - BigInt(TRAIL_STOP_BPS))) stopped.push(symbol);
    }
    for (const [symbol, since] of heldSince) {
      if (batch.seq - since >= MAX_HOLD_BARS && !stopped.includes(symbol)) stopped.push(symbol);
    }

    if (entering !== null) {
      // A risk exit that fired on this batch sells first; the pending buys wait one batch.
      const stopOuts = sells(state, stopped);
      if (stopOuts.length > 0) return stopOuts;
      const orders = buys(state, entering);
      entering = null;
      return orders;
    }
    if (batch.seq < nextRebalance) {
      if (state.warmingUp) return [];
      return sells(state, stopped);
    }
    nextRebalance = batch.seq + REBALANCE_BARS;
    const want = target(state, batch.seq).filter((s) => !stopped.includes(s));
    const outs = sells(state, [...state.positions].filter(([symbol]) => !want.includes(symbol)).map(([symbol]) => symbol));
    if (outs.length === 0) return buys(state, want);
    entering = want;
    return outs;
  },
});
