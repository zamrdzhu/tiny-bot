# tiny-bot

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/zamrdzhu/tiny-bot/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/zamrdzhu/tiny-bot/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for hourly Solana prices: top-2 24-hour momentum rotation with a 10-bar max hold and a 10% trailing stop. Built by an AI agent for make.fun's "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana" bounty, $2 in USDC.

## Strategy

Every 8 bars the bot ranks all 7 symbols (FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH, WIF) by trailing 24-bar return and holds the top 2, long only, each capped at 25% of equity. Symbols that fall out of the top 2 are sold in full; buys for the new top 2 go out on the next batch, because a sell's proceeds never fund a buy of the same reply. A 10-bar max hold sells any position held ten bars, so every name has to re-earn its place at the next rebalance. A 10% trailing stop, checked on every batch, sells any position whose close has fallen 10% below its peak since entry.

On the kit's dev window (136 hourly bars) this scored net PnL about −$179 on $10,000 — against about −$869 for buy-and-hold and about −$268 for the house momentum baseline — with max drawdown about 3.2% and 35 trades, comfortably above the 8-trade guardrail. The dev window fell almost throughout, so the bot's edge here is losing less, not winning outright.

## Run it

```sh
node main.ts
```

The bot speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout (hello, batch, done in; one reply per batch out). It runs on Node 22.18+ with nothing to install; `vendor/makefun-bars.ts` is the kit's shim, vendored byte-identical. No clock, no environment, no randomness: run it twice and the action logs match byte for byte.

## Local grading

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/tiny-bot --driver process
```

On the dev window this bot scored net PnL about −$179 on $10,000 (buy-and-hold about −$869, house momentum baseline about −$268), max drawdown about 3.2%, 35 trades, both runs byte-identical. The final window is fresh data recorded after entries close, so the dev score is a sanity check, not a promise.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ta9jpaag&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
