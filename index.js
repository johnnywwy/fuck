const {
  Config,
  QuoteContext,
  OAuth,
  Period,
  AdjustType,
  TradeSessions,
  NaiveDatetime,
  NaiveDate,
  Time,
} = require("longbridge");

async function main() {
  const oauth = await OAuth.build(
    "b8846729-c4b4-4bc6-a161-3cf33fee535d",
    (_, url) => console.log("Open this URL to authorize: " + url),
  );
  const config = Config.fromOAuth(oauth);

  const ctx = QuoteContext.new(config);
  const resp2 = await ctx.accountBalance();
  console.log("resp2resp2", resp2);

  const resp = await ctx?.candlesticks(
    "700.HK",
    Period.Day,
    10,
    AdjustType.NoAdjust,
    TradeSessions.Intraday,
  );
  for (let obj of resp) {
    console.log(obj.toString());
  }
}

main();
