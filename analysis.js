/**
 * KLineAnalyzer - 斐波那契量化分析核心
 */
const KLineAnalyzer = {
  // 斐波那契数列与黄金分割比
  FIB_NUMS: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377],
  FIB_RATIOS: [0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.0, 2.618],

  preprocess: (data) =>
    data.map((d) => ({
      ...d,
      fullDate: new Date(d.timestamp).toISOString().split("T")[0],
      year: new Date(d.timestamp).getFullYear(),
    })),

  getPivots(data, n = 5) {
    let raw = [];
    for (let i = n; i < data.length - n; i++) {
      const h = data[i].high,
        l = data[i].low;
      if (data.slice(i - n, i + n + 1).every((d) => d.high <= h))
        raw.push({ index: i, price: h, type: "Peak" });
      else if (data.slice(i - n, i + n + 1).every((d) => d.low >= l))
        raw.push({ index: i, price: l, type: "Valley" });
    }
    const res = [];
    raw.forEach((p) => {
      if (!res.length || res[res.length - 1].type !== p.type) res.push(p);
      else if (
        (p.type === "Peak" && p.price > res[res.length - 1].price) ||
        (p.type === "Valley" && p.price < res[res.length - 1].price)
      )
        res[res.length - 1] = p;
    });
    return res;
  },

  // 核心统计：寻找时间与空间的斐波那契共振
  analyzeFibonacci(visiblePivots) {
    if (visiblePivots.length < 2) return null;
    let hits = 0;
    const results = [];

    for (let i = 1; i < visiblePivots.length; i++) {
      const curr = visiblePivots[i],
        prev = visiblePivots[i - 1];
      const diffDays = curr.index - prev.index;

      // 1. 时间匹配 (允许 ±1 天误差)
      const tMatch = this.FIB_NUMS.find((n) => Math.abs(n - diffDays) <= 1);

      // 2. 空间比率匹配 (与上一个波段长度对比)
      let rMatch = null;
      if (i > 1) {
        const pPrev = visiblePivots[i - 2];
        const prevRange = Math.abs(prev.price - pPrev.price);
        const currRange = Math.abs(curr.price - prev.price);
        const ratio = currRange / prevRange;
        rMatch = this.FIB_RATIOS.find((r) => Math.abs(r - ratio) < 0.05);
      }

      if (tMatch || rMatch) hits++;

      results.push({
        date: curr.date,
        days: diffDays,
        tMatch: tMatch || null,
        rMatch: rMatch || null,
      });
    }

    return {
      prob: ((hits / (visiblePivots.length - 1)) * 100).toFixed(1),
      list: results, // 保持正向顺序
    };
  },

  // 核心：生成 25x25 大矩阵以覆盖跨年跨度
  generateGannMatrix(centerValue, size = 25) {
    const matrix = Array(size)
      .fill()
      .map(() => Array(size).fill(0));
    let x = Math.floor(size / 2),
      y = Math.floor(size / 2);
    let step = 1,
      direction = 0;
    let current = centerValue;

    matrix[y][x] = current;

    let count = 0;
    while (step < size) {
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < step; j++) {
          if (direction === 0) x++;
          else if (direction === 1) y--;
          else if (direction === 2) x--;
          else if (direction === 3) y++;

          if (x >= 0 && x < size && y >= 0 && y < size) {
            matrix[y][x] = ++current;
          }
        }
        direction = (direction + 1) % 4;
      }
      step++;
    }
    return matrix;
  },
};
