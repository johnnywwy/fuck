const axios = require("axios");
const fs = require("fs");
const path = require("path");
const {
  Config,
  QuoteContext,
  OAuth,
  Period,
  AdjustType,
  TradeSessions,
  NaiveDate,
  NaiveDatetime,
  Time,
} = require("longbridge");

const CREDENTIAL_PATH = path.join(__dirname, "credentials.json");

// ==================== 🛠️ 策略与参数配置 ====================
const SYMBOLS = ["TQQQ.US", "QQQ.US"]; // A 和 B 两个标的
const WINDOW_SIZE = 5; // 滑动窗口周期 (天)
const SIGMA_LEVEL = 5; // 偏离阈值 (倍数)
const MIN_PROFIT_THRESHOLD = 0.5; // 利润过滤器 (低于 0.2% 的信号跳过)
// ========================================================

/**
 * 1. 凭证管理 (保留原始 Log)
 */
async function getCredentials() {
  if (fs.existsSync(CREDENTIAL_PATH)) {
    console.log("📂 [Step 1] 检测到本地凭证，直接读取...");
    return JSON.parse(fs.readFileSync(CREDENTIAL_PATH, "utf-8"));
  }
  console.log("🚀 [Step 1] 本地无凭证，正在向长桥注册应用...");
  try {
    const response = await axios.post(
      "https://openapi.longbridgeapp.com/oauth2/register",
      {
        client_name: "My Arbitrage Bot",
        redirect_uris: ["http://localhost:60355/callback"],
        grant_types: ["authorization_code", "refresh_token"],
      },
      { headers: { "Content-Type": "application/json" } },
    );
    const creds = {
      client_id: response.data.client_id,
      client_secret: response.data.client_secret,
    };
    fs.writeFileSync(CREDENTIAL_PATH, JSON.stringify(creds, null, 2));
    console.log(`✅ 注册成功并已保存至 ${CREDENTIAL_PATH}`);
    return creds;
  } catch (error) {
    console.error("❌ 注册失败:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * 2. 授权登录 (保留 OAuth 提示)
 */
async function getContext(credentials) {
  console.log("🔑 [Step 2] 正在初始化 OAuth 授权...");
  const oauth = await OAuth.build(credentials.client_id, (_, url) => {
    console.log("\n👉 请访问此 URL 完成授权：\n" + url + "\n");
  });
  return await QuoteContext.new(Config.fromOAuth(oauth));
}

/**
 * 3. 历史数据获取
 */
async function fetchPairs(ctx, symbols, limit = 1000) {
  const datetime = new NaiveDatetime(
    new NaiveDate(2023, 1, 1),
    new Time(0, 0, 0),
  );
  console.log(`📊 [Step 3] 正在拉取 ${symbols.join("/")} 历史数据...`);
  const tasks = symbols.map((s) =>
    ctx.historyCandlesticksByOffset(
      s,
      Period.Day,
      AdjustType.ForwardAdjust,
      true,
      datetime,
      limit,
      TradeSessions.Intraday,
    ),
  );
  return await Promise.all(tasks);
}

/**
 * 4. 每日清单打印 (数据对齐验证)
 */
async function printDailyRatios(dataA, dataB) {
  const mapB = new Map();
  dataB.forEach((c) => {
    const date = new Date(c.timestamp.toString()).toISOString().split("T")[0];
    mapB.set(date, c.close.toNumber());
  });

  console.log("\n📅 [每日比例清单] 时间对齐验证：");
  console.log(
    "--------------------------------------------------------------------------------------",
  );
  console.log(
    `${SYMBOLS[0]} 日期 | ${SYMBOLS[0].padEnd(8)} | ${SYMBOLS[1]} 价格 | 比例 (Ratio) | 状态`,
  );
  console.log(
    "--------------------------------------------------------------------------------------",
  );

  const ratioList = [];
  dataA.forEach((a) => {
    const dateA = new Date(a.timestamp.toString()).toISOString().split("T")[0];
    const priceB = mapB.get(dateA);
    if (priceB) {
      const priceA = a.close.toNumber();
      const ratio = priceA / priceB;
      ratioList.push({ date: dateA, ratio });
      console.log(
        `${dateA} | ${priceA.toFixed(2).padEnd(8)} | ${priceB.toFixed(2).padEnd(8)} | ${ratio.toFixed(6)} | ✅ 对齐`,
      );
    } else {
      console.log(
        `${dateA} | ${a.close.toNumber().toFixed(2).padEnd(8)} | [缺失数据]  | -------- | ❌ 失败`,
      );
    }
  });
  return ratioList;
}

/**
 * 5. 核心策略回测 (滑动窗口 + 过滤器 + 持仓逻辑)
 */
async function runBacktest(ratioSeries, sigmaMultiplier) {
  let trades = [];
  let activeTrade = null;
  let skippedByFee = 0;

  console.log(
    `\n⚖️ [回测报告] 窗口: ${WINDOW_SIZE}天 | 阈值: ±${sigmaMultiplier}σ | 门槛: >${MIN_PROFIT_THRESHOLD}%`,
  );
  console.log(
    "---------------------------------------------------------------------------------------------------------",
  );
  console.log(
    "入场日期    | 出场日期    | 天数 | 偏离(σ) | 预估空间 | 实际收益 | 策略方向",
  );
  console.log(
    "---------------------------------------------------------------------------------------------------------",
  );

  for (let i = WINDOW_SIZE; i < ratioSeries.length; i++) {
    // A. 计算滚动窗口统计量
    const window = ratioSeries.slice(i - WINDOW_SIZE, i).map((s) => s.ratio);
    const rollingAvg = window.reduce((a, b) => a + b) / WINDOW_SIZE;
    const rollingStd = Math.sqrt(
      window.reduce((a, b) => a + Math.pow(b - rollingAvg, 2), 0) / WINDOW_SIZE,
    );

    const { date, ratio } = ratioSeries[i];
    const upperBond = rollingAvg + sigmaMultiplier * rollingStd;
    const lowerBond = rollingAvg - sigmaMultiplier * rollingStd;

    if (!activeTrade) {
      // B. 入场判定
      if (ratio > upperBond || ratio < lowerBond) {
        const potentialProfit = (Math.abs(ratio - rollingAvg) / ratio) * 100;

        // C. 手续费/利润过滤器
        if (potentialProfit >= MIN_PROFIT_THRESHOLD) {
          const isHigh = ratio > upperBond;
          activeTrade = {
            entryDate: date,
            entryRatio: ratio,
            type: isHigh
              ? `🔴 卖 ${SYMBOLS[0]} / 买 ${SYMBOLS[1]}`
              : `🟢 买 ${SYMBOLS[0]} / 卖 ${SYMBOLS[1]}`,
            sigmaAtEntry: ((ratio - rollingAvg) / rollingStd).toFixed(2),
            potential: potentialProfit,
            isShortA: isHigh,
          };
        } else {
          skippedByFee++;
        }
      }
    } else {
      // D. 出场判定 (回归均线)
      const isReverted =
        (activeTrade.isShortA && ratio <= rollingAvg) ||
        (!activeTrade.isShortA && ratio >= rollingAvg);

      if (isReverted) {
        const holdDays = Math.ceil(
          (new Date(date) - new Date(activeTrade.entryDate)) /
            (1000 * 60 * 60 * 24),
        );
        const actualProfit =
          (Math.abs(activeTrade.entryRatio - ratio) / activeTrade.entryRatio) *
          100;

        trades.push({ profit: actualProfit, holdDays });
        console.log(
          `${activeTrade.entryDate} | ${date} | ` +
            `${holdDays.toString().padEnd(4)} | ` +
            `${activeTrade.sigmaAtEntry.padEnd(7)} | ` +
            `${activeTrade.potential.toFixed(2)}%    | ` +
            `${actualProfit.toFixed(2)}%   | ${activeTrade.type}`,
        );
        activeTrade = null;
      }
    }
  }

  // E. 统计总结
  if (trades.length > 0) {
    const totalProfit = trades.reduce((s, t) => s + t.profit, 0);
    const avgHold = (
      trades.reduce((s, t) => s + t.holdDays, 0) / trades.length
    ).toFixed(1);
    console.log(
      "---------------------------------------------------------------------------------------------------------",
    );
    console.log(
      `📊 总结: 完成 ${trades.length} 次 | 过滤 ${skippedByFee} 次 | 平均持仓 ${avgHold} 天 | 累计理论收益 ${totalProfit.toFixed(2)}%`,
    );
  } else {
    console.log("⚠️ 未捕获到符合条件的完整交易。");
  }
}

/**
 * 通用历史数据获取函数 (支持跨度超过单次请求限制)
 * @param {QuoteContext} ctx - 长桥 Quote 上下文
 * @param {string} symbol - 标的代码 (如 ".SPX", "SPY.US", "AAPL.US")
 * @param {number} years - 获取过去几年的数据
 * @param {Period} period - 周期，默认为日线 (Period.Day)
 */
/**
 * 通用历史数据获取函数 (使用字符串解析修复 NaiveDatetime 兼容性)
 */
async function fetchHistoricalData(
  ctx,
  symbol,
  years = 5, // 保持参数位置和默认值
  period = Period.Day,
) {
  let allCandles = [];
  const limitPerRequest = 1000;

  // --- 🎯 核心逻辑：强制从 2023-01-01 开始 ---
  // 忽略传入的 years 动态计算，直接硬编码起点
  const startYear = 2023;
  const startMonth = 1;
  const startDay = 1;

  let currentStart = new NaiveDatetime(
    new NaiveDate(startYear, startMonth, startDay),
    new Time(0, 0, 0),
  );

  console.log(
    `📡 [Data Fetch] ${symbol} 任务启动: 固定从 ${startYear}-01-01 开始拉取...`,
  );

  try {
    while (true) {
      const batch = await ctx.historyCandlesticksByOffset(
        symbol,
        period,
        AdjustType.ForwardAdjust,
        true,
        currentStart,
        limitPerRequest,
        TradeSessions.Intraday,
      );

      if (!batch || batch.length === 0) break;

      allCandles.push(...batch);

      // 如果这一批次没填满 limit (1000)，说明已经拉到头了
      if (batch.length < limitPerRequest) break;

      // 否则，解析最后一条的时间，更新起点继续拉下一页
      const lastStr = batch[batch.length - 1].timestamp.toString();
      const [datePart, timePart] = lastStr.split(" ");
      const [y, m, d] = datePart.split("-").map(Number);
      const [hh, mm, ss] = timePart.split(":").map(Number);

      currentStart = new NaiveDatetime(
        new NaiveDate(y, m, d),
        new Time(hh, mm, ss),
      );
    }

    // 去重逻辑
    const uniqueMap = new Map();
    allCandles.forEach((c) => uniqueMap.set(c.timestamp.toString(), c));
    const result = Array.from(uniqueMap.values());

    console.log(
      `✅ [${symbol}] 拉取成功: 共 ${result.length} 条数据 (起点: 2023-01-01)`,
    );
    return result;
  } catch (error) {
    console.error(`❌ [${symbol}] 拉取失败:`, error.message);
    throw error;
  }
}
/**
 * 6. 主程序
 */
async function main() {
  try {
    const credentials = await getCredentials();
    const ctx = await getContext(credentials);
    const sp500 = await fetchHistoricalData(ctx, ".SPX.US", 3);
    console.log("sp500", JSON.stringify(sp500));
    if (sp500 && sp500.length > 0) {
      // 2. 预处理数据：将 SDK 的 Decimal 对象和 Timestamp 对象转为普通 JS 类型
      // 否则 JSON.stringify 可能会得到空对象或报错
      const plainData = sp500.map((c) => ({
        date: c.timestamp.toString().split(" ")[0], // 提取日期 YYYY-MM-DD
        timestamp: c.timestamp.toString(),
        open: c.open.toNumber(),
        high: c.high.toNumber(),
        low: c.low.toNumber(),
        close: c.close.toNumber(),
        volume: c.volume.toString(), // 成交量可能很大，转字符串保存比较安全
      }));

      // 3. 写入 JSON 文件
      const fileName = `spy_3yr_data.json`;
      fs.writeFileSync(fileName, JSON.stringify(plainData, null, 2), "utf-8");

      console.log(`-----------------------------------`);
      console.log(`✅ 成功获取 ${plainData.length} 条数据`);
      console.log(`📂 已保存至: ${path.join(__dirname, fileName)}`);
      console.log(
        `📅 数据范围: ${plainData[0].date} 至 ${plainData[plainData.length - 1].date}`,
      );
      console.log(`-----------------------------------`);
    }
    // const [dataA, dataB] = await fetchPairs(ctx, SYMBOLS);
    // const ratioSeries = await printDailyRatios(dataA, dataB);

    // if (ratioSeries.length > WINDOW_SIZE) {
    //   await runBacktest(ratioSeries, SIGMA_LEVEL);
    // } else {
    //   console.log("❌ 数据太少，不足以支撑滑动窗口计算。");
    // }
  } catch (err) {
    console.error("💥 出错:", err);
  }
}

main();
